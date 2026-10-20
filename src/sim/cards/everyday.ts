// Everyday cards (chunk b2): the small stuff of living in a block, mostly about the tenants
// and the building. Paying late this once, a mate on the sofa, a bike in the hall, a parcel
// opened by mistake, odd jobs for rent off, a tap that drips all night, a door that sticks.
//
// Each one trades two different things (1.0), and who's involved changes how it plays: a
// party animal let off a week's rent spends it on a party; a handy neighbour can fix the tap
// for nothing; a light sleeper hears the birthday do. Ignoring one is always worst (1.6).
//
// Many have a follow-up, so an answer comes back days later as a card (the rent paid back,
// the mate still on the sofa, the washing machine through the ceiling, the slates the gutter
// man found), and the kinder answers often leave a tale for Sunday's recap (`praise`).
//
// The choice notes hint at the kind of thing that happens, not the numbers.

import { tenants } from '../chat';
import { furnitureDef } from '../defs';
import { POUND, flatInfo } from '../economy';
import { SHARED, dirtOf, neighboursOf, outdoorTemp, seasonName, tempOf } from '../environment';
import { hasFlag } from '../flags';
import { household } from '../leases';
import { random } from '../rng';
import type { Sim } from '../sim';
import { chemistry, opinion } from '../social';
import { TICKS_PER_HOUR, type Card, type Furniture, type Pawn } from '../state';
import { has } from '../traits';
import { COUNCIL, MEMORIES, OPINION, UPKEEP } from '../tuning';
import { repairCost } from '../upkeep';
import { fixtureSim, letFlat, sitting } from './rule';
import type { CardDef, CardSubject, Effect, Outcome } from './types';

// ------------------------------------------------------------------ helpers

const first = (p: Pawn): string => p.name.split(' ')[0];

function pawnOf(sim: Sim, id: number | string | undefined): Pawn | undefined {
  if (id === undefined || id === '') return undefined;
  const n = Number(id);
  return sim.state.pawns.find((p) => p.id === n);
}

/** The card's own tenant: the drip only deals a card whose `when` found them. */
const who = (sim: Sim, card: Card): Pawn => pawnOf(sim, card.pawn)!;
/** Someone else the card names in its data. */
const other = (sim: Sim, card: Card, key: string): Pawn => pawnOf(sim, card.data?.[key])!;

const flatName = (sim: Sim, id: string | undefined): string => sim.layout.flat(id ?? null)?.name ?? 'the flat';

/** In the building, not on their way out. */
const here = (p: Pawn): boolean => !!p.life && !p.life.leaving;
/** In and on the map. */
const home = (p: Pawn): boolean => here(p) && !p.life!.away;
/** Lived here at least this many days. */
const settled = (sim: Sim, p: Pawn, days: number): boolean => sim.day - p.life!.since >= days;

/** Remembers this, and it hasn't faded yet. */
function remembers(sim: Sim, p: Pawn, id: string): boolean {
  const hours = MEMORIES[id]?.hours ?? 24;
  return p.life!.memories.some((m) => m.id === id && sim.state.tick - m.at < hours * TICKS_PER_HOUR);
}

/** Everyone else in the building, outside this person's flat. */
const othersOut = (sim: Sim, p: Pawn): Pawn[] => tenants(sim).filter((o) => o.life!.flat !== p.life!.flat);

const friends = (sim: Sim, a: Pawn, b: Pawn): boolean => opinion(sim, a, b) >= OPINION.friend || opinion(sim, b, a) >= OPINION.friend;

/** The people next door (through a wall, a floor or a ceiling). */
function nextDoor(sim: Sim, flat: string): Pawn[] {
  const near = new Set(neighboursOf(sim, flat));
  return tenants(sim).filter((o) => o.life!.flat !== flat && near.has(o.life!.flat));
}

/** One subject per household: its first tenant. */
const heads = (sim: Sim): Pawn[] => tenants(sim).filter((p) => household(sim, p.life!.flat).filter(here)[0] === p);

/** A let flat's lease, if it's an ordinary one (not a sitting tenant's, not on notice). */
function ordinaryLease(sim: Sim, p: Pawn) {
  const lease = flatInfo(sim, p.life!.flat).lease;
  return lease && !lease.sitting && !lease.notice ? lease : null;
}

/** Furniture standing in a flat. */
function inFlat(sim: Sim, flatId: string): Furniture[] {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return [];
  const cells = new Set(lay.flatCells(flat));
  return sim.state.furniture.filter((f) => cells.has(lay.node(f.x, f.s)));
}

/** The worst thing in a flat that does something: broken first, then the most worn past UPKEEP.worn. */
function worstIn(sim: Sim, flatId: string): Furniture | undefined {
  const things = inFlat(sim, flatId).filter((f) => furnitureDef(f.def).offers);
  return things.find((f) => f.broken !== undefined) ?? things.filter((f) => (f.wear ?? 0) > UPKEEP.worn).sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0))[0];
}

/** The most worn working thing in a flat: what the water gets into. */
function soaked(sim: Sim, flatId: string): Furniture | undefined {
  return inFlat(sim, flatId)
    .filter((f) => f.broken === undefined && furnitureDef(f.def).offers)
    .sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0) || a.id - b.id)[0];
}

/** What mending a thing costs, as a note. */
function thingCost(sim: Sim, id: number | undefined): string {
  const f = sim.state.furniture.find((x) => x.id === id);
  return f ? `£${repairCost(f) / POUND}` : '';
}

const lower = (f: Furniture): string => furnitureDef(f.def).name.toLowerCase();

/** A notch more wear on something, never breaking it. */
const wearUp = (f: Furniture | undefined, by: number): Effect[] => (f ? [`wear:${f.id}:${Math.min(0.95, Math.round(((f.wear ?? 0) + by) * 100) / 100)}`] : []);

/** The flat directly below, if anyone lives there. */
function flatBelow(sim: Sim, flatId: string): string | undefined {
  const lay = sim.layout;
  const f = lay.flat(flatId);
  if (!f) return undefined;
  const cells = lay.flatCells(f);
  const cols = new Set(cells.map((n) => n % lay.w));
  const lowest = Math.min(...cells.map((n) => Math.floor(n / lay.w)));
  return lay.flats.find((o) => o.id !== flatId && lay.flatCells(o).some((n) => {
    const row = Math.floor(n / lay.w);
    return row < lowest && row >= lowest - 5 && cols.has(n % lay.w);
  }))?.id;
}

const belowOf = (sim: Sim, flatId: string): Pawn[] => {
  const b = flatBelow(sim, flatId);
  return b ? household(sim, b).filter(here) : [];
};

/** The flats on the top floor. */
function topFloor(sim: Sim): string[] {
  const lay = sim.layout;
  const row = (id: string) => Math.min(...lay.flatCells(lay.flat(id)!).map((n) => Math.floor(n / lay.w)));
  const top = Math.max(...lay.flats.map((f) => row(f.id)));
  return lay.flats.filter((f) => row(f.id) === top).map((f) => f.id);
}

/** A hidden trait to show, if they have one: a `reveal` effect. */
const revealOne = (p: Pawn): Effect[] => {
  const t = p.life!.traits.find((x) => !p.life!.revealed.includes(x));
  return t ? [`reveal:${p.id}:${t}`] : [];
};

const mems = (people: Pawn[], id: string): Effect[] => people.map((p) => `mem:${p.id}:${id}`);

/** For fixtures: lived here a while. */
function settle(...ps: Pawn[]): void {
  for (const p of ps) p.life!.since = -30;
}

/** For fixtures: two people who get on. */
function befriend(sim: Sim, a: Pawn, b: Pawn): void {
  const at = sim.state.tick - TICKS_PER_HOUR;
  for (const [x, y] of [[a, b], [b, a]]) {
    for (let i = 0; i < 3; i++) x.life!.social.push({ id: 'deepTalk', about: y.id, at });
    x.life!.social.push({ id: 'favour', about: y.id, at });
  }
}

const out = (effects: Effect[], notice: string): Outcome => ({ effects, notice });

// ------------------------------------------------------------------ paying late, this once

const LATE_WHY: Record<string, string> = { student: 'Loan\'s late', partyAnimal: 'Big weekend', none: 'Between jobs', other: 'Car\'s packed in' };

function lateWhy(p: Pawn): string {
  const life = p.life!;
  if (life.schedule === 'student') return LATE_WHY.student;
  if (has(life, 'partyAnimal')) return LATE_WHY.partyAnimal;
  if (!life.job && life.schedule !== 'retired' && life.schedule !== 'home') return LATE_WHY.none;
  return LATE_WHY.other;
}

/** Money now against goodwill. A party animal let off a week spends it on a party; told no, they can't afford one. */
const lateRent: CardDef = {
  id: 'lateRent',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 14,
  turnsOn: ['trait:partyAnimal', 'lease.late', 'schedule'],
  when(sim) {
    return heads(sim)
      .filter((p) => {
        const lease = ordinaryLease(sim, p);
        return lease && !(lease.prepaid ?? 0) && !has(p.life!, 'paysEarly') && settled(sim, p, 5) && !remembers(sim, p, 'helpedOut') && !remembers(sim, p, 'refusedLate');
      })
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { why: lateWhy(p), what: 'let them pay the rent late' }, weight: 1 + (flatInfo(sim, p.life!.flat).lease!.late > 0 ? 0.5 : 0) }));
  },
  hook: (sim, c) => `${first(who(sim, c))} asks to pay late. Just this once.`,
  text: (sim, c) => `${first(who(sim, c))}: "${String(c.data?.why ?? 'Bad week')}. Could this week's rent wait a few days?"`,
  choices: () => [
    { label: 'This once, fine', note: '' },
    { label: 'Rent\'s due', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const flat = c.flat!;
    const party = has(p.life!, 'partyAnimal');
    if (answer === 0) return out([`act:prepay:${flat}:7`, `mem:${p.id}:helpedOut`, `tale:praise:${p.id}`, 'thread:rentBack:96', ...(party ? [`risk:party:1:7:${flat}`] : [])], party ? `${n} can pay in a few days. There's a party on Friday. Funny, that.` : `${n} can pay in a few days. ${n} won't forget it.`);
    if (answer === 1) return out([`mem:${p.id}:refusedLate`, ...(party ? [`risk:party:-1:7:${flat}`] : [])], party ? `${n} paid. No money for Friday's party now.` : `${n} paid, and went without.`);
    return out([`act:prepay:${flat}:7`, `mem:${p.id}:ignored`, ...(party ? [`risk:party:1:7:${flat}`] : [])], `Nobody answered ${n}, so the rent just didn't come this week.`);
  },
  fixtures: [
    {
      name: 'a student',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['friendly', 'keenCook'], schedule: 'student' }]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { why: LATE_WHY.student, what: 'let them pay the rent late' } } };
      },
    },
    {
      name: 'a party animal, late before',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['partyAnimal', 'messy']]);
        settle(p);
        flatInfo(sim, p.life!.flat).lease!.late = 2;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { why: LATE_WHY.partyAnimal, what: 'let them pay the rent late' } } };
      },
    },
  ],
};

/** The follow-up: they're back with the rent. Take it, or let them off. */
const rentBack: CardDef = {
  id: 'rentBack',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:partyAnimal'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !flatInfo(sim, p.life!.flat).lease) return [];
    return [{ pawn: p.id, flat: p.life!.flat, data: { what: 'let them off a week\'s rent' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))}'s back with the rent.`,
  text: (sim, c) => (has(who(sim, c).life!, 'partyAnimal') ? `${first(who(sim, c))}'s brought the rent they owed. Most of it. And a bottle of wine.` : `${first(who(sim, c))}'s brought the rent they owed, and a tin of biscuits.`),
  choices: () => [
    { label: 'Keep it, this once', note: '' },
    { label: 'Take it, thanks', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const lease = flatInfo(sim, c.flat!).lease;
    const party = has(p.life!, 'partyAnimal');
    const owed = Math.round(((lease?.rent ?? 0) * (party ? 0.8 : 1)) / POUND) * POUND;
    if (answer === 0) return out([`mem:${p.id}:helpedOut`, `tale:praise:${p.id}`], `You told ${n} to keep it. The whole stairs will know by tonight.`);
    if (answer === 1) return out([`pay:${owed}:Late rent paid back · ${flatName(sim, c.flat)}`, `mem:${p.id}:squareAgain`, ...(party ? [`risk:party:1:3:${c.flat}`] : [])], party ? `${n} paid most of it back. The rest went on Saturday.` : `${n} paid it back. All square.`);
    return out([`mem:${p.id}:leftToIt`, ...(party ? [`risk:party:1:3:${c.flat}`] : [])], `Nobody came to the door, so ${n} spent it. That's the last you'll see of it.`);
  },
  fixtures: [
    {
      name: 'a student',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['friendly', 'keenCook'], schedule: 'student' }]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a party animal',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['partyAnimal', 'messy']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a mate on the sofa, a few nights

/** A friend between flats. Kindness to one tenant against the flat, and the neighbours' sleep. */
const friendStaying: CardDef = {
  id: 'friendStaying',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 10,
  turnsOn: ['trait:lightSleeper', 'trait:friendly', 'household'],
  when(sim) {
    return tenants(sim)
      .filter((p) => household(sim, p.life!.flat).length === 1 && settled(sim, p, 3) && !hasFlag(sim, 'lodger', p.life!.flat) && !remembers(sim, p, 'mateStayed') && !remembers(sim, p, 'noGuests'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { what: 'let their mate stay' }, weight: has(p.life!, 'friendly') || has(p.life!, 'partyAnimal') ? 1.5 : 0.7 }));
  },
  hook: (sim, c) => `${first(who(sim, c))}'s mate needs a sofa.`,
  text: (sim, c) => `${first(who(sim, c))}: "A mate's between flats. Could they have my sofa a few nights?"`,
  choices: () => [
    { label: 'A few nights, fine', note: '' },
    { label: 'Sorry, no guests', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const flat = c.flat!;
    // Light sleepers next door hear a second set of feet, and a second telly.
    const sleepers = nextDoor(sim, flat).filter((o) => has(o.life!, 'lightSleeper'));
    const heard = sleepers.map((o) => `soc:${o.id}:noise:${p.id}`);
    if (answer === 0) return out([`mem:${p.id}:mateStayed`, `flag:lodger:${flat}:4`, `tale:praise:${p.id}`, 'thread:stillOnSofa:72', ...heard], `${n}'s mate is on the sofa, for a few nights.${sleepers.length > 0 ? ' Next door can hear them.' : ''}`);
    if (answer === 1) return out([`mem:${p.id}:noGuests`], `No guests. ${n}'s mate is on someone else's sofa.`);
    return out([`mem:${p.id}:ignored`, `flag:lodger:${flat}:14`, ...heard], `Nobody answered, so the mate moved in anyway. Nobody's said for how long.`);
  },
  fixtures: [
    {
      name: 'friendly, nobody next door',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['friendly', 'keenCook']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a light sleeper next door',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['partyAnimal', 'messy']]);
        const [s] = letFlat(sim, 2, [['lightSleeper', 'complainer']]);
        sitting(sim)[1].life!.traits = ['lightSleeper', 'keenCook'];
        settle(p, s);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: a week on, the mate's still there. */
const stillOnSofa: CardDef = {
  id: 'stillOnSofa',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:friendly', 'neighbours'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !flatInfo(sim, p.life!.flat).lease) return [];
    return [{ pawn: p.id, flat: p.life!.flat, data: { what: 'let their mate move in properly' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))}'s mate is still on the sofa.`,
  text: (sim, c) => `${first(who(sim, c))}'s mate is still on the sofa. Day four. Their shoes are in the hall.`,
  choices: () => [
    { label: 'On the lease, then', note: '£15 a week more' },
    { label: 'Out by Sunday', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const flat = c.flat!;
    if (answer === 0) return out([`rent:${flat}:${15 * POUND}`, `flag:lodger:${flat}:28`, `mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `${n}'s mate is on the lease now, paying their way.`);
    if (answer === 1) return out([`mem:${p.id}:nosyLandlord`, ...(has(p.life!, 'friendly') ? [`mem:${p.id}:noGuests`] : [])], `The mate's gone by Sunday. ${n} helped carry the bags, quietly.`);
    // Nobody said a word, so the mate stays, unasked and unpaid, and the stairs mind.
    const near = othersOut(sim, p);
    return out([`flag:lodger:${flat}:28`, ...(near.length > 0 ? mems(near, 'leftToIt') : [`mem:${p.id}:ignored`])], `Nobody said anything, so the mate lives in ${flatName(sim, flat)} now. Rent-free.`);
  },
  fixtures: [
    {
      name: 'friendly, neighbours',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['friendly', 'keenCook']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'easy-going, alone in the building',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['easyGoing', 'nightOwl']]);
        settle(p);
        for (const s of sitting(sim)) s.life!.leaving = true;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a bike in the hall

/** One tenant's bike, another tenant's shins. Take a side, or let it lie. */
const bikeInHall: CardDef = {
  id: 'bikeInHall',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 12,
  turnsOn: ['trait:clumsy', 'friendsWith', 'bikeRack'],
  when(sim) {
    if (sim.state.furniture.some((f) => f.def === 'bikeRack')) return [];
    const riders = tenants(sim).filter((p) => (p.life!.schedule === 'office' || p.life!.schedule === 'student') && settled(sim, p, 3));
    const list: CardSubject[] = [];
    for (const r of riders) {
      for (const c of tenants(sim)) {
        if (c.life!.flat === r.life!.flat || !home(c)) continue;
        const touchy = has(c.life!, 'houseProud') || has(c.life!, 'complainer') || has(c.life!, 'clumsy') || c.life!.schedule === 'retired';
        if (touchy) list.push({ pawn: c.id, flat: c.life!.flat, data: { rider: r.id }, weight: has(c.life!, 'clumsy') ? 1.3 : 1 });
      }
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))}: "${first(other(sim, c, 'rider'))}'s bike. In the hall."`,
  text: (sim, c) => `${first(who(sim, c))} walked into ${first(other(sim, c, 'rider'))}'s bike in the hall again. Wants it gone.`,
  choices: () => [
    { label: 'Have a word', note: '' },
    { label: 'It\'s only a bike', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const r = other(sim, c, 'rider');
    const close = friends(sim, p, r);
    if (answer === 0) return out([`mem:${r.id}:bikeMoved`, `mem:${p.id}:landlordListened`, ...(close ? [] : [`soc:${r.id}:slight:${p.id}`])], `${first(r)}'s bike lives in ${flatName(sim, r.life!.flat)} now.${close ? '' : ` ${first(r)} knows who asked.`}`);
    if (answer === 1) {
      // A clumsy neighbour goes over it, sooner or later.
      if (has(p.life!, 'clumsy')) return out([`mem:${p.id}:landlordShrugged`, `mem:${p.id}:trippedOnStairs`, `tale:stairTrip:${p.id}`], `The bike stays. ${first(p)} went over it on Tuesday.`);
      return out([`mem:${p.id}:landlordShrugged`, `soc:${p.id}:slight:${r.id}`], `The bike stays, and ${first(p)} glares at it daily.`);
    }
    return out([`mem:${p.id}:ignored`, `soc:${p.id}:slight:${r.id}`, `soc:${r.id}:slight:${p.id}`, `mem:${r.id}:leftToIt`], `Nobody answered, so ${first(p)} put the bike out on the pavement. It isn't there now.`);
  },
  fixtures: [
    {
      name: 'house-proud, an office worker',
      build(seed) {
        const sim = fixtureSim(seed);
        const [r] = letFlat(sim, 1, [{ traits: ['friendly', 'nightOwl'], schedule: 'office' }]);
        const p = sitting(sim)[1];
        p.life!.traits = ['houseProud', 'busybody'];
        settle(r);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { rider: r.id } } };
      },
    },
    {
      name: 'clumsy, a student friend',
      build(seed) {
        const sim = fixtureSim(seed);
        const [r] = letFlat(sim, 1, [{ traits: ['partyAnimal', 'messy'], schedule: 'student' }]);
        const p = sitting(sim)[1];
        p.life!.traits = ['clumsy', 'friendly'];
        settle(r);
        befriend(sim, p, r);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { rider: r.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a parcel opened by mistake

/** What a parcel gives away, by a trait you haven't seen yet. */
const GIVES_AWAY: Record<string, string> = {
  petOwner: 'a dog lead', musician: 'guitar strings', keenCook: 'a cast-iron pan', lightSleeper: 'earplugs, in bulk', partyAnimal: 'a smoke machine',
  houseProud: 'a steam mop', messy: 'one shoe', handy: 'a stud finder', clumsy: 'a new kettle', nightOwl: 'blackout blinds', busybody: 'binoculars',
  complainer: 'a pad of complaint forms', knowsRights: 'a book on tenancy law', haggler: 'a book of coupons', paysEarly: 'a budget planner', friendly: 'forty birthday cards', easyGoing: 'a hammock',
};

/** Opened by the wrong flat. Smooth it over yourself (and see what it was), or let the two of them sort it. */
const parcelMixup: CardDef = {
  id: 'parcelMixup',
  source: 'tenant',
  kind: 'moment',
  cooldownDays: 8,
  turnsOn: ['trait:busybody', 'chemistry', 'hiddenTraits'],
  when(sim) {
    const m = sim.minuteOfDay;
    if (m < 9 * 60 || m >= 20 * 60) return [];
    const list: CardSubject[] = [];
    for (const x of tenants(sim).filter(home)) {
      for (const y of othersOut(sim, x)) {
        const t = y.life!.traits.find((tr) => !y.life!.revealed.includes(tr) && GIVES_AWAY[tr]);
        if (t) list.push({ pawn: x.id, flat: x.life!.flat, data: { owner: y.id, trait: t, what: 'kept quiet about what was in their parcel' }, weight: has(x.life!, 'busybody') ? 1 : 0.6 });
      }
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} opened ${first(other(sim, c, 'owner'))}'s parcel.`,
  text: (sim, c) => `${first(who(sim, c))} opened ${first(other(sim, c, 'owner'))}'s parcel by mistake. It's ${GIVES_AWAY[String(c.data?.trait)] ?? 'something odd'}.`,
  choices: () => [
    { label: 'Take it round yourself', note: '' },
    { label: 'Let them sort it', note: '' },
  ],
  resolve(sim, c, answer) {
    const x = who(sim, c);
    const y = other(sim, c, 'owner');
    const trait = String(c.data?.trait);
    // A busybody tells the stairs what was in it.
    const tells = has(x.life!, 'busybody') ? othersOut(sim, y).filter((o) => o !== x).map((o) => `soc:${o.id}:heardThings:${y.id}`) : [];
    if (answer === 0) return out([`mem:${y.id}:keptMyBusiness`, `mem:${x.id}:landlordListened`, `reveal:${y.id}:${trait}`, `tale:praise:${y.id}`], `You took it round to ${first(y)} and said nothing about what was in it.`);
    if (answer === 1) {
      const odds = 0.5 + chemistry(sim, x.id, y.id) * 0.4 - (tells.length > 0 ? 0.2 : 0);
      if (random(sim.state) < Math.max(0.1, Math.min(0.9, odds))) return out([`soc:${x.id}:chat:${y.id}`, `soc:${y.id}:chat:${x.id}`, `soc:${y.id}:favour:${x.id}`], `${first(x)} took it round. They laughed about it over a cuppa.`);
      return out([`soc:${y.id}:slight:${x.id}`, ...tells], tells.length > 0 ? `${first(x)} took it round, and told the stairs what was in it.` : `${first(x)} took it round. ${first(y)} wasn't amused.`);
    }
    return out([`mem:${y.id}:leftToIt`, `soc:${y.id}:slight:${x.id}`, ...tells, ...(tells.length > 0 ? [] : [`soc:${x.id}:slight:${y.id}`])], `Nobody came, so ${first(x)} left it open on the stairs for anyone to see.`);
  },
  fixtures: [
    {
      name: 'a busybody opened it',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['busybody', 'complainer']]);
        const [z] = letFlat(sim, 2, [['easyGoing', 'keenCook']]);
        settle(x, z);
        const y = sitting(sim)[1];
        y.life!.traits = ['musician', 'friendly'];
        return { sim, subject: { pawn: x.id, flat: x.life!.flat, data: { owner: y.id, trait: 'musician' } } };
      },
    },
    {
      name: 'friends',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['friendly', 'easyGoing']]);
        settle(x);
        const y = sitting(sim)[1];
        y.life!.traits = ['petOwner', 'keenCook'];
        befriend(sim, x, y);
        return { sim, subject: { pawn: x.id, flat: x.life!.flat, data: { owner: y.id, trait: 'petOwner' } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ odd jobs for rent off

/** A tenant offers to do the odd jobs round the building for money off. Trust them with it, or don't. */
const oddJobs: CardDef = {
  id: 'oddJobs',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['trait:handy', 'trait:clumsy'],
  when(sim) {
    if (hasFlag(sim, 'oddJobs')) return [];
    const tired = sim.state.furniture.some((f) => f.broken === undefined && (f.wear ?? 0) > 0.5 && furnitureDef(f.def).offers) || dirtOf(sim, SHARED) > 0.2;
    if (!tired) return [];
    return tenants(sim)
      .filter((p) => (has(p.life!, 'handy') || ['retired', 'home', 'student'].includes(p.life!.schedule)) && settled(sim, p, 7) && flatInfo(sim, p.life!.flat).lease && !remembers(sim, p, 'trustedWithJobs') && !remembers(sim, p, 'notTrusted'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { what: 'trusted them with the odd jobs' }, weight: has(p.life!, 'handy') ? 1.5 : 0.7 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} offers to do odd jobs.`,
  text: (sim, c) => `${first(who(sim, c))} will do odd jobs round the building, for £10 a week off the rent.`,
  choices: () => [
    { label: 'You\'re on', note: '£10 a week off' },
    { label: 'No, ta', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const handy = has(p.life!, 'handy');
    // What a keen pair of hands without the knack has a go at first.
    const victim = sim.state.furniture.filter((f) => f.broken === undefined && furnitureDef(f.def).offers && (f.wear ?? 0) > 0.5).sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0))[0];
    const bodge = !handy && victim ? [`wear:${victim.id}:1`] : [];
    if (answer === 0) return out([`rent:${c.flat}:${-10 * POUND}`, `flag:oddJobs:${p.id}:42`, `mem:${p.id}:trustedWithJobs`, ...(handy ? [`reveal:${p.id}:handy`, `tale:praise:${p.id}`, 'thread:boilerService:72'] : bodge)], handy ? `${n} does the odd jobs now. Properly, it turns out.` : `${n} does the odd jobs now. The ${victim ? lower(victim) : 'first one'} didn't survive the first week.`);
    if (answer === 1) return out([handy ? `mem:${p.id}:notTrusted` : `mem:${p.id}:brushedOff`], `No odd jobs. ${n} took it ${handy ? 'personally' : 'well enough'}.`);
    return out([`mem:${p.id}:ignored`, ...(handy ? [`mem:${p.id}:leftToIt`] : bodge)], handy ? `Nobody answered, so ${n} fixed things anyway. For nothing, and pointedly.` : `Nobody answered, so ${n} had a go anyway. The ${victim ? lower(victim) : 'door'} didn't survive.`);
  },
  fixtures: [
    {
      name: 'handy and retired',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['handy', 'friendly'];
        bill.life!.since = -30;
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'keen, clumsy',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['clumsy', 'friendly'], schedule: 'home' }]);
        settle(p);
        sim.state.furniture.find((f) => f.def === 'cooker')!.wear = 0.8;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a birthday do in the lobby

/** A surprise do on the stairs. Community against quiet, and a light sleeper's night. */
const lobbyDo: CardDef = {
  id: 'lobbyDo',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['trait:lightSleeper', 'friendsWith'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const y of tenants(sim).filter((p) => has(p.life!, 'friendly') || has(p.life!, 'partyAnimal'))) {
      for (const x of othersOut(sim, y)) if (opinion(sim, y, x) >= OPINION.friend) list.push({ pawn: y.id, flat: y.life!.flat, data: { friend: x.id } });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} wants a do for ${first(other(sim, c, 'friend'))}.`,
  text: (sim, c) => `${first(who(sim, c))} wants to throw ${first(other(sim, c, 'friend'))} a surprise birthday do in the lobby. Saturday.`,
  choices: () => [
    { label: 'Go on then', note: 'Saturday night' },
    { label: 'Not in the lobby', note: '' },
  ],
  resolve(sim, c, answer) {
    const y = who(sim, c);
    const x = other(sim, c, 'friend');
    const rest = tenants(sim).filter((o) => o !== x && o !== y);
    const sleepers = rest.filter((o) => has(o.life!, 'lightSleeper'));
    const guests = rest.filter((o) => !has(o.life!, 'lightSleeper'));
    if (answer === 0) return out([`mem:${x.id}:lobbyDo`, `mem:${y.id}:lobbyDo`, ...guests.map((g) => `soc:${g.id}:goodNight:${y.id}`), ...mems(sleepers, 'keptAwake'), `tale:lobbyDo:${x.id}:${y.id}`], `A do in the lobby for ${first(x)}. Bunting on the bins.${sleepers.length > 0 ? ' Not everyone slept.' : ''}`);
    if (answer === 1) return out([`mem:${y.id}:brushedOff`, `soc:${x.id}:goodNight:${y.id}`], `They went to the pub instead. ${first(y)} thinks the lobby would have been nicer.`);
    return out([`mem:${y.id}:ignored`, ...sleepers.flatMap((s) => [`mem:${s.id}:keptAwake`, `mem:${s.id}:keptAwake`, `mem:${s.id}:leftToIt`]), `risk:party:1:7:${y.life!.flat}`], `Nobody answered, so they had it anyway, with nobody to say when to stop.`);
  },
  fixtures: [
    {
      name: 'nobody minds',
      build(seed) {
        const sim = fixtureSim(seed);
        const [y] = letFlat(sim, 1, [['friendly', 'keenCook']]);
        settle(y);
        const x = sitting(sim)[1];
        befriend(sim, y, x);
        return { sim, subject: { pawn: y.id, flat: y.life!.flat, data: { friend: x.id } } };
      },
    },
    {
      name: 'a light sleeper',
      build(seed) {
        const sim = fixtureSim(seed);
        const [y] = letFlat(sim, 1, [['partyAnimal', 'friendly']]);
        settle(y);
        const x = sitting(sim)[1];
        sitting(sim)[0].life!.traits = ['lightSleeper', 'complainer'];
        befriend(sim, y, x);
        return { sim, subject: { pawn: y.id, flat: y.life!.flat, data: { friend: x.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ cooking smells

/** One tenant's curry, another's wardrobe. Pay to fix it, or take a side. */
const cookingSmells: CardDef = {
  id: 'cookingSmells',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 14,
  turnsOn: ['trait:keenCook', 'trait:easyGoing', 'trait:complainer'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const x of tenants(sim).filter((p) => has(p.life!, 'keenCook') && !hasFlag(sim, 'extractorFan', p.life!.flat))) {
      for (const y of nextDoor(sim, x.life!.flat)) {
        if (has(y.life!, 'keenCook') || friends(sim, x, y)) continue;
        list.push({ pawn: y.id, flat: y.life!.flat, data: { cook: x.id }, weight: has(y.life!, 'complainer') || has(y.life!, 'houseProud') ? 1.5 : 0.8 });
      }
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} can smell ${first(other(sim, c, 'cook'))}'s tea.`,
  text: (sim, c) => `${first(who(sim, c))}: "${first(other(sim, c, 'cook'))}'s curries. Lovely smell. In my wardrobe. Every night."`,
  choices: () => [
    { label: 'Fit an extractor fan', note: '£60' },
    { label: 'Have a word', note: '' },
  ],
  resolve(sim, c, answer) {
    const y = who(sim, c);
    const x = other(sim, c, 'cook');
    const fx = flatName(sim, x.life!.flat);
    // An easy-going cook shrugs off a word; anyone else holds it against whoever asked.
    const sulk = has(x.life!, 'easyGoing') ? [] : [`soc:${x.id}:slight:${y.id}`];
    if (answer === 0) return out([`pay:-6000:Extractor fan · ${fx}`, `flag:extractorFan:${x.life!.flat}`, `mem:${y.id}:landlordListened`, `mem:${x.id}:landlordListened`, 'thread:peaceCurry:48'], `An extractor fan in ${fx}. ${first(y)}'s wardrobe smells of wardrobe again.`);
    if (answer === 1) return out([`mem:${x.id}:cookingMoan`, `mem:${y.id}:landlordListened`, ...sulk], `You had a word with ${first(x)} about the cooking.${sulk.length > 0 ? ` ${first(x)} knows who asked.` : ''}`);
    return out([`mem:${y.id}:ignored`, `soc:${y.id}:slight:${x.id}`, `soc:${x.id}:slight:${y.id}`], `Nobody answered, so ${first(y)} had a go at ${first(x)} on the landing.`);
  },
  fixtures: [
    {
      name: 'an easy-going cook',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['keenCook', 'easyGoing']]);
        settle(x);
        const y = sitting(sim)[1];
        y.life!.traits = ['complainer', 'houseProud'];
        return { sim, subject: { pawn: y.id, flat: y.life!.flat, data: { cook: x.id } } };
      },
    },
    {
      name: 'a touchy cook',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['keenCook', 'complainer']]);
        settle(x);
        const y = sitting(sim)[1];
        y.life!.traits = ['lightSleeper', 'friendly'];
        return { sim, subject: { pawn: y.id, flat: y.life!.flat, data: { cook: x.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a washing machine of their own

const hasWasher = (sim: Sim): boolean => sim.state.furniture.some((f) => f.def === 'washer' && f.broken === undefined);

/** Their machine in your flat: a happy tenant against the ceiling below. */
const washer: CardDef = {
  id: 'washer',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['trait:handy', 'flatBelow'],
  when(sim) {
    if (hasWasher(sim)) return [];
    return heads(sim)
      .filter((p) => settled(sim, p, 5) && !hasFlag(sim, 'ownWasher', p.life!.flat) && !remembers(sim, p, 'noWasher') && !remembers(sim, p, 'ownWasher'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { what: 'let them have a washing machine' }, weight: household(sim, p.life!.flat).length > 1 ? 1.2 : 0.8 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants a washing machine in.`,
  text: (sim, c) => `${first(who(sim, c))}: "Could I plumb in a washing machine? I'll buy it. Launderette's miles."`,
  choices: () => [
    { label: 'Go ahead', note: 'They buy it' },
    { label: 'Launderette it is', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const flat = c.flat!;
    const below = belowOf(sim, flat);
    // Handy, it's plumbed in right; otherwise, with someone underneath, it'll find a way.
    const risky = below.length > 0 && !has(p.life!, 'handy');
    if (answer === 0) return out([`flag:ownWasher:${flat}`, `mem:${p.id}:ownWasher`, `tale:praise:${p.id}`, ...(risky ? ['thread:washerLeak:120'] : [])], `${n}'s got a washing machine in.${risky ? ` ${flatName(sim, flatBelow(sim, flat))} is right underneath.` : ''}`);
    if (answer === 1) return out([`mem:${p.id}:noWasher`], `Launderette it is. ${n} carries a bag down the street on Sundays.`);
    return out([`flag:ownWasher:${flat}`, `mem:${p.id}:ignored`, ...(below.length > 0 ? ['thread:washerLeak:48'] : [])], `Nobody answered, so ${n} plumbed one in anyway. Nobody checked it.`);
  },
  fixtures: [
    {
      name: 'clumsy, a flat below',
      build(seed) {
        const sim = fixtureSim(seed);
        letFlat(sim, 1, [['lightSleeper', 'easyGoing']]);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['clumsy', 'keenCook'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'handy, nobody below',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['handy', 'friendly']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: the machine has come through the ceiling below. Who pays? */
const washerLeak: CardDef = {
  id: 'washerLeak',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  icon: 'water',
  turnsOn: ['trait:knowsRights', 'flatBelow'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !hasFlag(sim, 'ownWasher', p.life!.flat) || belowOf(sim, p.life!.flat).length === 0) return [];
    return [{ pawn: p.id, flat: p.life!.flat }];
  },
  hook: (sim, c) => `${first(who(sim, c))}'s washing machine has leaked.`,
  text: (sim, c) => `${first(who(sim, c))}'s washing machine has come through ${flatName(sim, flatBelow(sim, c.flat!))}'s ceiling.`,
  choices: (sim, c) => [
    { label: 'Plumber, on me', note: '£60' },
    { label: `${first(who(sim, c))} pays`, note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const below = belowOf(sim, c.flat!);
    const bf = flatBelow(sim, c.flat!) ?? '';
    if (answer === 0) return out(['pay:-6000:Plumber: a washing machine leak', `mem:${p.id}:landlordListened`, ...mems(below, 'landlordListened')], `A plumber, on you. ${n} is mortified, and grateful.`);
    if (answer === 1) return out([`mem:${p.id}:caughtOut`, ...mems(below, 'landlordListened')], `${n} paid the plumber. ${n} isn't speaking to you, much.`);
    // Nobody came: it ran till someone below found the stopcock.
    const writes = below.some((b) => has(b.life!, 'knowsRights'));
    return out([...mems(below, 'leftToIt'), ...below.map((b) => `soc:${b.id}:leakedOnMe:${p.id}`), ...wearUp(soaked(sim, bf), 0.3), `tale:washerFlood:${p.id}`, ...(writes ? ['inspect:5:A tenant has told us water came through their ceiling'] : [])], `Nobody came. It ran into ${flatName(sim, bf)} till they found the stopcock themselves.`);
  },
  fixtures: [
    {
      name: 'an easy-going flat below',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['easyGoing', 'keenCook']]);
        settle(b);
        const bill = sitting(sim)[1];
        sim.state.drip.flags.push({ id: 'ownWasher', subject: bill.life!.flat });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'knows their rights, below',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['knowsRights', 'houseProud']]);
        settle(b);
        const bill = sitting(sim)[1];
        sim.state.drip.flags.push({ id: 'ownWasher', subject: bill.life!.flat });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ thinking of leaving

/** An unhappy tenant says so. What would keep them, against letting them go. */
const thinkingOfLeaving: CardDef = {
  id: 'thinkingOfLeaving',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 14,
  turnsOn: ['thing:worn', 'liking'],
  when(sim) {
    return heads(sim)
      .filter((p) => ordinaryLease(sim, p) && p.life!.liking < 45 && settled(sim, p, 7) && !remembers(sim, p, 'landlordListened'))
      .map((p) => {
        const thing = worstIn(sim, p.life!.flat);
        return { pawn: p.id, flat: p.life!.flat, ...(thing ? { furniture: thing.id } : {}), weight: 1 + (45 - p.life!.liking) / 10 };
      });
  },
  hook: (sim, c) => `${first(who(sim, c))} is thinking of leaving.`,
  text: (sim, c) => {
    const f = sim.state.furniture.find((x) => x.id === c.furniture);
    return `${first(who(sim, c))}: "Thinking of moving on. Not you, exactly. The ${f ? lower(f) : 'rent'}, mostly."`;
  },
  choices: () => [
    { label: 'What would keep you?', note: '' },
    { label: 'Sorry to hear it', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const f = sim.state.furniture.find((x) => x.id === c.furniture);
    if (answer === 0) {
      if (f) return out([`mend:${f.id}`, `mem:${p.id}:landlordListened`, 'thread:stayingOn:72'], `You got the ${lower(f)} seen to. ${n} says they'll think about it.`);
      return out([`rent:${c.flat}:${-5 * POUND}`, `mem:${p.id}:rentCut`, 'thread:stayingOn:72'], `£5 a week off. ${n} says they'll think about it.`);
    }
    if (answer === 1) return out([`mem:${p.id}:landlordShrugged`], `You said you were sorry to hear it. ${n} is looking at flats.`);
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:landlordShrugged`], `Nobody answered ${n}. That was answer enough.`);
  },
  fixtures: [
    {
      name: 'a worn cooker',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['complainer', 'keenCook']]);
        settle(p);
        p.life!.liking = 30;
        const cooker = inFlat(sim, p.life!.flat).find((f) => f.def === 'cooker')!;
        cooker.wear = 0.85;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: cooker.id } };
      },
    },
    {
      name: 'nothing worn, just the rent',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['haggler', 'friendly']]);
        settle(p);
        p.life!.liking = 35;
        for (const f of inFlat(sim, p.life!.flat)) f.wear = 0.2;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: they're staying, if the rent stays put. */
const stayingOn: CardDef = {
  id: 'stayingOn',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:easyGoing', 'trait:haggler'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !ordinaryLease(sim, p)) return [];
    return [{ pawn: p.id, flat: p.life!.flat, data: { what: 'talked them into staying' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))} will stay, if the rent does.`,
  text: (sim, c) => `${first(who(sim, c))}'s staying on. Asks if the rent can stay as it is for a while.`,
  choices: () => [
    { label: 'Same rent, fine', note: '' },
    { label: 'Up a little', note: '£5 a week more' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    if (answer === 0) return out([`mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `Same rent. ${n} is staying, and says so on the stairs.`);
    if (answer === 1) return out([`rent:${c.flat}:${5 * POUND}`, ...(has(p.life!, 'easyGoing') ? [] : [`mem:${p.id}:rentRiseSmall`])], `£5 more a week. ${n} is staying, ${has(p.life!, 'easyGoing') ? 'and doesn\'t much mind' : 'just about'}.`);
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:landlordShrugged`, `mem:${p.id}:keptWaiting`], `Nobody answered ${n}, so ${n} is looking at flats again.`);
  },
  fixtures: [
    {
      name: 'easy-going',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['easyGoing', 'keenCook']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a haggler',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['haggler', 'complainer']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a rota for the stairs

/** Nobody does the stairs. A rota puts it on the tenants, and some will mind; no rota, and one tenant minds a lot. */
const rota: CardDef = {
  id: 'rota',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['trait:messy', 'trait:houseProud', 'cleaner'],
  when(sim) {
    if (sim.state.cleaner || hasFlag(sim, 'lorraine') || hasFlag(sim, 'rota') || dirtOf(sim, SHARED) < 0.25) return [];
    return tenants(sim)
      .filter((p) => (has(p.life!, 'houseProud') || has(p.life!, 'complainer')) && settled(sim, p, 5))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: 1 + dirtOf(sim, SHARED) }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants a rota for the stairs.`,
  text: (sim, c) => `${first(who(sim, c))}: "Nobody does the stairs. Can we have a rota? On the wall."`,
  choices: () => [
    { label: 'Put a rota up', note: '' },
    { label: 'The stairs are fine', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const messy = othersOut(sim, p).filter((o) => has(o.life!, 'messy'));
    if (answer === 0) return out(['flag:rota::21', `mem:${p.id}:landlordListened`, ...mems(messy, 'onTheRota'), 'thread:rotaSlips:168'], `There's a rota on the wall now.${messy.length > 0 ? ' Not everyone looked pleased.' : ''}`);
    if (answer === 1) return out([`mem:${p.id}:landlordShrugged`], `No rota. ${n} looks at the stairs and sighs.`);
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`, ...messy.map((m) => `soc:${p.id}:slight:${m.id}`)], `Nobody answered, so ${n} does the stairs alone, and knows who doesn't.`);
  },
  fixtures: [
    {
      name: 'a messy neighbour',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['houseProud', 'busybody']]);
        letFlat(sim, 2, [['messy', 'partyAnimal']]);
        settle(p);
        sim.state.dirt[SHARED] = 0.4;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'tidy neighbours',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['complainer', 'keenCook']]);
        settle(p);
        for (const s of sitting(sim)) s.life!.traits = ['easyGoing', 'friendly'];
        sim.state.dirt[SHARED] = 0.4;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: someone's not doing their turn. */
const rotaSlips: CardDef = {
  id: 'rotaSlips',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:easyGoing', 'trait:messy'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !hasFlag(sim, 'rota')) return [];
    const rest = othersOut(sim, p);
    const s = rest.find((o) => has(o.life!, 'messy')) ?? rest[0];
    return s ? [{ pawn: p.id, flat: p.life!.flat, data: { slacker: s.id } }] : [];
  },
  hook: (sim, c) => `${first(who(sim, c))}: the rota's slipping.`,
  text: (sim, c) => `${first(who(sim, c))}: "${first(other(sim, c, 'slacker'))} hasn't done one turn on the rota. Not one."`,
  choices: () => [
    { label: 'Have a word', note: '' },
    { label: 'Let it slide', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const s = other(sim, c, 'slacker');
    const sulk = has(s.life!, 'easyGoing') ? [] : [`soc:${s.id}:slight:${p.id}`];
    if (answer === 0) return out([`mem:${s.id}:onTheRota`, `mem:${p.id}:landlordListened`, ...sulk], `You had a word with ${first(s)}. The stairs got done, once.`);
    if (answer === 1) return out([`mem:${p.id}:landlordShrugged`, `soc:${p.id}:slight:${s.id}`], `You let it slide. ${first(p)} is keeping a list.`);
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`, `soc:${p.id}:slight:${s.id}`, `soc:${s.id}:slight:${p.id}`], `Nobody answered, so ${first(p)} pinned a note to ${first(s)}'s door.`);
  },
  fixtures: [
    {
      name: 'a messy slacker',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['houseProud', 'busybody']]);
        const [s] = letFlat(sim, 2, [['messy', 'partyAnimal']]);
        settle(p, s);
        sim.state.drip.flags.push({ id: 'rota' });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { slacker: s.id } } };
      },
    },
    {
      name: 'an easy-going slacker',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['complainer', 'keenCook']]);
        const [s] = letFlat(sim, 2, [['easyGoing', 'nightOwl']]);
        settle(p, s);
        sim.state.drip.flags.push({ id: 'rota' });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { slacker: s.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ smoke on the step

/** A smoker's habit against a neighbour's window. */
const smokingOnStep: CardDef = {
  id: 'smokingOnStep',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 14,
  turnsOn: ['habit:smoke', 'friendsWith'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const s of tenants(sim).filter((p) => p.life!.habits.includes('smoke') && !hasFlag(sim, 'smokesIn', p.life!.flat))) {
      for (const a of othersOut(sim, s)) {
        const touchy = has(a.life!, 'houseProud') || has(a.life!, 'complainer') || has(a.life!, 'lightSleeper') || a.life!.schedule === 'retired';
        list.push({ pawn: a.id, flat: a.life!.flat, data: { smoker: s.id }, weight: touchy ? 1.2 : 0.5 });
      }
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} can smell ${first(other(sim, c, 'smoker'))}'s smoke.`,
  text: (sim, c) => `${first(who(sim, c))}: "${first(other(sim, c, 'smoker'))} smokes on the front step. It all comes up into my flat."`,
  choices: () => [
    { label: 'Not by the door', note: '' },
    { label: 'It\'s outside', note: '' },
  ],
  resolve(sim, c, answer) {
    const a = who(sim, c);
    const s = other(sim, c, 'smoker');
    const close = friends(sim, a, s);
    // Moved off the step, they smoke indoors instead: the flat takes it.
    if (answer === 0) return out([`mem:${s.id}:smokeMoved`, `mem:${a.id}:landlordListened`, `flag:smokesIn:${s.life!.flat}:28`, 'thread:smokeIndoors:72'], `${first(s)} smokes indoors now. ${flatName(sim, s.life!.flat)}'s curtains will know.`);
    if (answer === 1) return out([`mem:${a.id}:landlordShrugged`, ...(close ? [] : [`soc:${a.id}:slight:${s.id}`])], close ? `It's outside, you said. ${first(a)} shuts the window and lets it go.` : `It's outside, you said. ${first(a)} glares from the window.`);
    return out([`mem:${a.id}:ignored`, `soc:${a.id}:slight:${s.id}`, `soc:${s.id}:slight:${a.id}`], `Nobody answered, so ${first(a)} had words with ${first(s)} on the step.`);
  },
  fixtures: [
    {
      name: 'strangers',
      build(seed) {
        const sim = fixtureSim(seed);
        const [s] = letFlat(sim, 1, [['partyAnimal', 'nightOwl']]);
        settle(s);
        s.life!.habits = ['smoke'];
        const a = sitting(sim)[1];
        a.life!.traits = ['houseProud', 'complainer'];
        return { sim, subject: { pawn: a.id, flat: a.life!.flat, data: { smoker: s.id } } };
      },
    },
    {
      name: 'friends',
      build(seed) {
        const sim = fixtureSim(seed);
        const [s] = letFlat(sim, 1, [['friendly', 'easyGoing']]);
        settle(s);
        s.life!.habits = ['smoke'];
        const a = sitting(sim)[1];
        a.life!.traits = ['lightSleeper', 'friendly'];
        befriend(sim, a, s);
        return { sim, subject: { pawn: a.id, flat: a.life!.flat, data: { smoker: s.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ boxes in the empty flat

/** A favour now against the next let: viewers see someone else's boxes. */
const boxes: CardDef = {
  id: 'boxes',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['household', 'emptyFlat'],
  when(sim) {
    const empty = sim.layout.flats.find((f) => !flatInfo(sim, f.id).lease && !hasFlag(sim, 'boxesIn', f.id));
    if (!empty) return [];
    return heads(sim)
      .filter((p) => settled(sim, p, 3) && !remembers(sim, p, 'boxesStored') && !remembers(sim, p, 'crampedBoxes'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { empty: empty.id, what: 'let them store their boxes in the empty flat' }, weight: household(sim, p.life!.flat).length > 1 ? 1.2 : 0.6 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants to store boxes.`,
  text: (sim, c) => `${first(who(sim, c))}: "Could I keep a few boxes in ${flatName(sim, String(c.data?.empty))} a fortnight? Just a few."`,
  choices: () => [
    { label: 'Go on then', note: 'A fortnight' },
    { label: 'It\'s for letting', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const empty = String(c.data?.empty);
    const crowded = household(sim, c.flat!).length > 1;
    if (answer === 0) return out([`flag:boxesIn:${empty}:14`, `mem:${p.id}:boxesStored`, `tale:praise:${p.id}`], `${n}'s boxes are in ${flatName(sim, empty)}. Quite a lot of boxes.`);
    if (answer === 1) return out([`mem:${p.id}:brushedOff`, ...(crowded ? [`mem:${p.id}:crampedBoxes`] : [])], `No boxes. ${crowded ? `${flatName(sim, c.flat)} is full of them instead.` : `${n} found a garage.`}`);
    return out([`flag:boxesIn:${empty}:28`, `mem:${p.id}:ignored`, ...(crowded ? [`mem:${p.id}:crampedBoxes`] : [])], `Nobody answered, so the boxes went in ${flatName(sim, empty)} anyway. For as long as they like.`);
  },
  fixtures: [
    {
      name: 'on their own',
      build(seed) {
        const sim = fixtureSim(seed);
        const p = sitting(sim)[1];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { empty: sim.layout.flats[1].id } } };
      },
    },
    {
      name: 'a crowded flat',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['friendly', 'messy'], ['keenCook', 'easyGoing']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { empty: sim.layout.flats[2].id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a little business from the flat

const TRADES: [string, string][] = [['musician', 'teach guitar'], ['keenCook', 'bake to order'], ['handy', 'mend bikes']];
const tradeOf = (p: Pawn): string => TRADES.find(([t]) => has(p.life!, t))?.[1] ?? 'cut hair';

/** A tenant's living against the neighbours' stairs: strangers up and down all day. */
const sideHustle: CardDef = {
  id: 'sideHustle',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 28,
  turnsOn: ['trait:lightSleeper', 'trait:houseProud', 'trait:musician'],
  when(sim) {
    return tenants(sim)
      .filter((p) => ['home', 'retired', 'student', 'early'].includes(p.life!.schedule) && settled(sim, p, 7) && !hasFlag(sim, 'clients', p.life!.flat) && !remembers(sim, p, 'sideHustle') && !remembers(sim, p, 'noHustle'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { trade: tradeOf(p), what: 'let them start a business from the flat' }, weight: 0.8 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants to ${String(c.data?.trade)} at home.`,
  text: (sim, c) => `${first(who(sim, c))} wants to ${String(c.data?.trade)} from the flat. People up and down the stairs.`,
  choices: () => [
    { label: 'Good luck to them', note: '' },
    { label: 'Not from my flats', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const flat = c.flat!;
    const bothered = othersOut(sim, p).filter((o) => has(o.life!, 'lightSleeper') || has(o.life!, 'houseProud') || has(o.life!, 'complainer'));
    // Guitar lessons are heard through the wall.
    const heard = has(p.life!, 'musician') ? nextDoor(sim, flat).map((o) => `soc:${o.id}:noise:${p.id}`) : [];
    if (answer === 0) return out([`mem:${p.id}:sideHustle`, `flag:clients:${flat}:28`, ...mems(bothered, 'strangersOnStairs'), ...heard, `tale:praise:${p.id}`, 'thread:hustleGoing:96'], `${n} has customers now. The buzzer goes a lot.`);
    if (answer === 1) return out([`mem:${p.id}:noHustle`], `Not from your flats. ${n} rents a room above the chip shop instead.`);
    return out([`flag:clients:${flat}:28`, `mem:${p.id}:ignored`, ...mems(bothered, 'strangersOnStairs'), ...mems(bothered, 'leftToIt'), ...heard], `Nobody answered, so ${n} started anyway. Nobody's set any hours.`);
  },
  fixtures: [
    {
      name: 'a hairdresser, nobody minds',
      build(seed) {
        const sim = fixtureSim(seed);
        const p = sitting(sim)[0];
        p.life!.traits = ['friendly', 'paysEarly'];
        p.life!.since = -30;
        sitting(sim)[1].life!.traits = ['easyGoing', 'keenCook'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { trade: 'cut hair' } } };
      },
    },
    {
      name: 'guitar lessons, a light sleeper',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['musician', 'friendly'], schedule: 'student' }]);
        settle(p);
        sitting(sim)[1].life!.traits = ['lightSleeper', 'houseProud'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { trade: 'teach guitar' } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ water the plants

/** A favour while they're away. Do it yourself (and see the flat), or ask a neighbour. */
const plants: CardDef = {
  id: 'plants',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['trait:friendly', 'trait:complainer', 'hiddenTraits'],
  when(sim) {
    return tenants(sim)
      .filter((p) => ['office', 'early', 'late'].includes(p.life!.schedule) && settled(sim, p, 7) && othersOut(sim, p).length > 0 && !remembers(sim, p, 'wateredPlants'))
      .map((p) => {
        const near = othersOut(sim, p);
        const h = near.find((o) => has(o.life!, 'friendly')) ?? near.find((o) => friends(sim, o, p)) ?? near[0];
        return { pawn: p.id, flat: p.life!.flat, data: { neighbour: h.id, what: 'kept their plants alive' }, weight: 0.6 };
      });
  },
  hook: (sim, c) => `${first(who(sim, c))}'s away. The plants aren't.`,
  text: (sim, c) => `${first(who(sim, c))}'s away a week. Would you pop in and water the plants?`,
  choices: (sim, c) => [
    { label: 'Happy to', note: '' },
    { label: `Ask ${first(other(sim, c, 'neighbour'))}`, note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    const h = other(sim, c, 'neighbour');
    if (answer === 0) return out([`mem:${p.id}:wateredPlants`, ...revealOne(p), `tale:praise:${p.id}`], `You watered ${n}'s plants, and couldn't help noticing a few things.`);
    if (answer === 1) {
      // A friendly neighbour's glad to; anyone else minds being asked.
      const glad = has(h.life!, 'friendly') || friends(sim, h, p);
      return out([glad ? `mem:${h.id}:askedToHelp` : `mem:${h.id}:landlordShrugged`, `soc:${p.id}:favour:${h.id}`], glad ? `${first(h)} watered them, gladly.` : `${first(h)} watered them, and made sure you knew it was a favour.`);
    }
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`], `Nobody answered ${n}. The plants didn't make it.`);
  },
  fixtures: [
    {
      name: 'a friendly neighbour',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['houseProud', 'keenCook'], schedule: 'office' }]);
        settle(p);
        const h = sitting(sim)[1];
        h.life!.traits = ['friendly', 'busybody'];
        for (const s of sitting(sim)) if (s !== h) s.life!.leaving = true;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { neighbour: h.id } } };
      },
    },
    {
      name: 'a complainer next door',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['messy', 'nightOwl'], schedule: 'late' }]);
        settle(p);
        const h = sitting(sim)[1];
        h.life!.traits = ['complainer', 'lightSleeper'];
        for (const s of sitting(sim)) if (s !== h) s.life!.leaving = true;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { neighbour: h.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ follow-ups to the tenant cards

/** After the odd jobs: the handy one says the boiler wants a service, and offers. */
const boilerService: CardDef = {
  id: 'boilerService',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:clumsy'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || hasFlag(sim, 'boilerServiced')) return [];
    return [{ pawn: p.id, flat: p.life!.flat, data: { what: 'let them service the boiler' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))} says the boiler wants a look.`,
  text: (sim, c) => `${first(who(sim, c))} says the boiler's overdue a service, and offers to do it.`,
  choices: (sim, c) => [
    { label: `Let ${first(who(sim, c))} do it`, note: 'Free' },
    { label: 'Book an engineer', note: '£40' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    // Handy, but clumsy with it: something gets knocked on the way.
    const clumsy = has(p.life!, 'clumsy');
    if (answer === 0) return out([clumsy ? 'flag:boilerMoods::7' : 'flag:boilerServiced::60', `mem:${p.id}:trustedWithJobs`, `tale:praise:${p.id}`], clumsy ? `${n} serviced the boiler, and dropped a spanner in it. It's moody now.` : `${n} serviced the boiler. It purrs.`);
    if (answer === 1) return out(['pay:-4000:Boiler engineer: a service', 'flag:boilerServiced::60', `mem:${p.id}:brushedOff`], `An engineer did the boiler. ${n} watched, arms folded.`);
    return out(['flag:boilerMoods::14', `mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`], `Nobody answered ${n}. The boiler has started making a noise like a goose.`);
  },
  fixtures: [
    {
      name: 'handy',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['handy', 'friendly'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'handy and clumsy',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['handy', 'clumsy'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

/** After the little business: it's going well, and they offer you a bit more. */
const hustleGoing: CardDef = {
  id: 'hustleGoing',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:haggler'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || !flatInfo(sim, p.life!.flat).lease) return [];
    return [{ pawn: p.id, flat: p.life!.flat, data: { what: 'helped them get a little business going' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))}'s business is doing well.`,
  text: (sim, c) => `${first(who(sim, c))}'s business is doing well. Offers £5 a week more, "for the use".`,
  choices: () => [
    { label: 'No need', note: '' },
    { label: 'Very kind, yes', note: '£5 a week more' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = first(p);
    // A haggler only offered because they expected a no.
    const haggler = has(p.life!, 'haggler');
    if (answer === 0) return out([`mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `No need, you said. ${n} tells the customers about you.`);
    if (answer === 1) return out([`rent:${c.flat}:${5 * POUND}`, haggler ? `mem:${p.id}:landlordShrugged` : `mem:${p.id}:squareAgain`], haggler ? `£5 more a week. ${n} hadn't expected you to say yes.` : `£5 more a week, gladly paid.`);
    return out([`mem:${p.id}:ignored`], `Nobody answered ${n}, who has stopped offering.`);
  },
  fixtures: [
    {
      name: 'friendly',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['friendly', 'keenCook'], schedule: 'home' }]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a haggler',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [{ traits: ['haggler', 'musician'], schedule: 'student' }]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** After the extractor fan: the cook sends a curry next door, if someone will carry it. */
const peaceCurry: CardDef = {
  id: 'peaceCurry',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  icon: 'fork',
  turnsOn: ['chemistry'],
  when(sim, from) {
    // From the fan card the subject is the neighbour, with the cook in its data; once dealt, the cook.
    const fromFan = from?.data?.cook !== undefined;
    const x = pawnOf(sim, fromFan ? from?.data?.cook : from?.pawn);
    const y = pawnOf(sim, fromFan ? from?.pawn : from?.data?.neighbour);
    if (!x || !y || !here(x) || !here(y)) return [];
    return [{ pawn: x.id, flat: x.life!.flat, data: { neighbour: y.id, what: 'got two neighbours talking again' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))} has made a curry for ${first(other(sim, c, 'neighbour'))}.`,
  text: (sim, c) => `${first(who(sim, c))} made ${first(other(sim, c, 'neighbour'))} a curry, as a peace offering. Would you take it round?`,
  choices: () => [
    { label: 'Take it round', note: '' },
    { label: 'Leave them to it', note: '' },
  ],
  resolve(sim, c, answer) {
    const x = who(sim, c);
    const y = other(sim, c, 'neighbour');
    if (answer === 0) return out([`soc:${y.id}:favour:${x.id}`, `soc:${x.id}:chat:${y.id}`, `mem:${x.id}:landlordListened`, `tale:praise:${x.id}`], `You took the curry round. ${first(y)} had seconds.`);
    // Old friends make it up whoever carries the curry; anyone else, it's down to how they get on.
    const close = friends(sim, x, y);
    if (answer === 1) {
      const good = close || random(sim.state) < Math.max(0.1, Math.min(0.9, 0.5 + chemistry(sim, x.id, y.id) * 0.4));
      return out([`mem:${x.id}:brushedOff`, ...(good ? [`soc:${y.id}:chat:${x.id}`] : [`soc:${y.id}:slight:${x.id}`])], good ? `${first(x)} took it round themselves. It went down well.` : `${first(x)} took it round. ${first(y)} said it was too hot. In every sense.`);
    }
    return out([`mem:${x.id}:leftToIt`, ...(close ? [] : [`soc:${y.id}:slight:${x.id}`])], `Nobody came for it. The curry went cold on ${first(y)}'s doormat.`);
  },
  fixtures: [
    {
      name: 'strangers',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['keenCook', 'complainer']]);
        settle(x);
        const y = sitting(sim)[1];
        return { sim, subject: { pawn: x.id, flat: x.life!.flat, data: { neighbour: y.id } } };
      },
    },
    {
      name: 'old friends',
      build(seed) {
        const sim = fixtureSim(seed);
        const [x] = letFlat(sim, 1, [['keenCook', 'friendly']]);
        settle(x);
        const y = sitting(sim)[1];
        befriend(sim, x, y);
        return { sim, subject: { pawn: x.id, flat: x.life!.flat, data: { neighbour: y.id } } };
      },
    },
  ],
};

/** After the step: the smoker smokes indoors, and the smoke alarm objects. */
const smokeIndoors: CardDef = {
  id: 'smokeIndoors',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:houseProud'],
  when(sim, from) {
    // From the step card the subject is the neighbour who asked, with the smoker in its data; once dealt, the smoker.
    const fromStep = from?.data?.smoker !== undefined;
    const s = pawnOf(sim, fromStep ? from?.data?.smoker : from?.pawn);
    const a = pawnOf(sim, fromStep ? from?.pawn : from?.data?.asker);
    if (!s || !a || !here(s) || !here(a) || !hasFlag(sim, 'smokesIn', s.life!.flat)) return [];
    return [{ pawn: s.id, flat: s.life!.flat, data: { asker: a.id, what: 'found the smokers a spot by the bins' } }];
  },
  hook: (sim, c) => `${first(who(sim, c))}'s smoke alarm keeps going off.`,
  text: (sim, c) => `${first(who(sim, c))} smokes indoors now, and the smoke alarm keeps going off.`,
  choices: () => [
    { label: 'Smoke by the bins', note: '' },
    { label: 'Alarm stays put', note: '' },
  ],
  resolve(sim, c, answer) {
    const s = who(sim, c);
    const a = other(sim, c, 'asker');
    // House-proud neighbours don't want it by the bins either.
    if (answer === 0) return out([`mem:${s.id}:landlordListened`, has(a.life!, 'houseProud') ? `mem:${a.id}:landlordShrugged` : `mem:${a.id}:landlordListened`, `tale:praise:${s.id}`], `There's a smoking spot by the bins now, with a bucket of sand.`);
    if (answer === 1) return out([`mem:${s.id}:smokeMoved`, `flag:smokesIn:${s.life!.flat}:14`], `The alarm stays. ${first(s)} opens a window and glowers.`);
    return out([`flag:batteryOut:${s.life!.flat}:30`, `mem:${s.id}:leftToIt`], `Nobody answered, so ${first(s)} took the battery out of the alarm.`);
  },
  fixtures: [
    {
      name: 'a house-proud neighbour asked',
      build(seed) {
        const sim = fixtureSim(seed);
        const [s] = letFlat(sim, 1, [['partyAnimal', 'nightOwl']]);
        settle(s);
        const a = sitting(sim)[1];
        a.life!.traits = ['houseProud', 'complainer'];
        sim.state.drip.flags.push({ id: 'smokesIn', subject: s.life!.flat });
        return { sim, subject: { pawn: s.id, flat: s.life!.flat, data: { asker: a.id } } };
      },
    },
    {
      name: 'a light sleeper asked',
      build(seed) {
        const sim = fixtureSim(seed);
        const [s] = letFlat(sim, 1, [['friendly', 'easyGoing']]);
        settle(s);
        const a = sitting(sim)[1];
        a.life!.traits = ['lightSleeper', 'friendly'];
        sim.state.drip.flags.push({ id: 'smokesIn', subject: s.life!.flat });
        return { sim, subject: { pawn: s.id, flat: s.life!.flat, data: { asker: a.id } } };
      },
    },
  ],
};

// ================================================================== the building

/** A let flat's first tenant, for building cards about a flat. */
const lettings = (sim: Sim): { flat: string; p: Pawn }[] =>
  sim.layout.flats.flatMap((f) => {
    const p = household(sim, f.id).filter(here)[0];
    return p && flatInfo(sim, f.id).lease ? [{ flat: f.id, p }] : [];
  });

// ------------------------------------------------------------------ a weeping radiator valve

const radiatorValve: CardDef = {
  id: 'radiatorValve',
  source: 'building',
  kind: 'moment',
  cooldownDays: 12,
  icon: 'water',
  turnsOn: ['trait:houseProud'],
  when(sim) {
    if (seasonName(sim) === 'Summer') return [];
    return lettings(sim)
      .filter(({ flat }) => inFlat(sim, flat).some((f) => f.def === 'radiator') && !hasFlag(sim, 'weepingRad', flat))
      .map(({ flat, p }) => ({ pawn: p.id, flat, data: { what: 'had every radiator in the place bled' }, weight: 0.8 }));
  },
  hook: (sim, c) => `${flatName(sim, c.flat)}'s radiator is weeping.`,
  text: (sim, c) => `The radiator valve in ${flatName(sim, c.flat)} is weeping onto the floorboards. Slowly.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Plumber today', note: '£45' },
    { label: 'A bowl under it', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const proud = has(p.life!, 'houseProud');
    if (answer === 0) return out(['pay:-4500:Plumber: a radiator valve, and bled the rest', 'flag:radsBled::28', `mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `The plumber fixed the valve and bled every radiator in the place.`);
    if (answer === 1) return out([`flag:weepingRad:${flat}:10`, `mem:${p.id}:bowlUnderIt`, ...(proud ? [`mem:${p.id}:bowlUnderIt`, `mem:${p.id}:landlordShrugged`] : []), 'thread:valveGoes:72'], `There's a bowl under the radiator in ${flatName(sim, flat)}.${proud ? ` ${first(p)} empties it with feeling.` : ''}`);
    return out([`flag:weepingRad:${flat}:14`, `mem:${p.id}:leftToIt`, `mem:${p.id}:waitedForRepair`, ...wearUp(soaked(sim, flat), 0.2), ...(proud ? [`mem:${p.id}:landlordShrugged`] : []), 'thread:valveGoes:48'], `Nobody came. The floorboards in ${flatName(sim, flat)} are soft now.`);
  },
  fixtures: [
    {
      name: 'house-proud',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const p = sitting(sim)[0];
        p.life!.traits = ['houseProud', 'paysEarly'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'easy-going',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const p = sitting(sim)[1];
        p.life!.traits = ['easyGoing', 'keenCook'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: the valve's gone. */
const valveGoes: CardDef = {
  id: 'valveGoes',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  icon: 'water',
  turnsOn: ['flatBelow'],
  when(sim, from) {
    const flat = from?.flat;
    if (!flat || !hasFlag(sim, 'weepingRad', flat)) return [];
    const p = household(sim, flat).filter(here)[0];
    return p ? [{ pawn: p.id, flat }] : [];
  },
  hook: (sim, c) => `${flatName(sim, c.flat)}'s radiator valve has gone.`,
  text: (sim, c) => `The valve's gone in ${flatName(sim, c.flat)}. Water across the floor, and spreading.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Emergency plumber', note: '£90' },
    { label: 'Off till Monday', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const below = belowOf(sim, flat);
    if (answer === 0) return out(['pay:-9000:Emergency plumber: a radiator valve', `mem:${p.id}:landlordListened`], `The emergency plumber came at nine. It's sorted, and so is your evening.`);
    if (answer === 1) return out([`mem:${p.id}:waitedForRepair`, `mem:${p.id}:draughty`, ...wearUp(soaked(sim, flat), 0.15)], `The radiator's off till Monday. ${first(p)} is in a coat indoors.`);
    const thing = soaked(sim, flat);
    return out([...(thing ? [`wear:${thing.id}:1`] : []), `mem:${p.id}:leftToIt`, ...mems(below, 'leftToIt')], `Nobody came. The water got into the ${thing ? lower(thing) : 'floor'}${below.length > 0 ? ' and the ceiling below' : ''}.`);
  },
  fixtures: [
    {
      name: 'a flat below',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        letFlat(sim, 1, [['easyGoing', 'keenCook']]);
        const bill = sitting(sim)[1];
        sim.state.drip.flags.push({ id: 'weepingRad', subject: bill.life!.flat });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'the ground floor',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const p = sitting(sim)[0];
        sim.state.drip.flags.push({ id: 'weepingRad', subject: p.life!.flat });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a dripping tap

const tapDrip: CardDef = {
  id: 'tapDrip',
  source: 'building',
  kind: 'moment',
  cooldownDays: 10,
  icon: 'water',
  turnsOn: ['trait:handy', 'trait:lightSleeper'],
  when(sim) {
    return lettings(sim).flatMap(({ flat, p }) => {
      const sink = inFlat(sim, flat).find((f) => (f.def === 'sink' || f.def === 'basin') && f.broken === undefined && (f.wear ?? 0) > 0.45);
      if (!sink) return [];
      const helper = othersOut(sim, p).find((o) => has(o.life!, 'handy'));
      return [{ pawn: p.id, flat, furniture: sink.id, data: { ...(helper ? { helper: helper.id } : {}), what: 'had their tap fixed the same day' }, weight: 1 + (sink.wear ?? 0) }];
    });
  },
  hook: (sim, c) => `${flatName(sim, c.flat)}'s tap drips all night.`,
  text: (sim, c) => `The tap in ${flatName(sim, c.flat)} drips all night. ${first(who(sim, c))} has counted.`,
  choices: (sim, c) => {
    const h = pawnOf(sim, c.data?.helper);
    return [
      { label: 'Get a plumber', note: thingCost(sim, c.furniture) },
      h ? { label: `Ask ${first(h)} to look`, note: 'Free' } : { label: 'It\'ll keep', note: 'Free' },
    ];
  },
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const f = sim.state.furniture.find((x) => x.id === c.furniture)!;
    const h = pawnOf(sim, c.data?.helper);
    const sleeper = has(p.life!, 'lightSleeper');
    if (answer === 0) return out([`mend:${f.id}`, `mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `A plumber put a new washer in. Silence.`);
    if (answer === 1) {
      if (h && here(h)) return out([`mem:${h.id}:askedToHelp`, `soc:${p.id}:favour:${h.id}`, `wear:${f.id}:${Math.max(0, Math.round(((f.wear ?? 0) - 0.3) * 100) / 100)}`], `${first(h)} fixed it with a spanner and a biscuit. ${first(p)} owes them one.`);
      return out([`mem:${p.id}:waitedForRepair`, ...wearUp(f, 0.1), ...(sleeper ? [`mem:${p.id}:keptAwake`] : [])], `It'll keep, you said. Drip. Drip.`);
    }
    return out([`mem:${p.id}:leftToIt`, ...wearUp(f, 0.15), ...(sleeper ? [`mem:${p.id}:keptAwake`, `mem:${p.id}:keptAwake`] : [])], `Nobody came. ${first(p)} has a tea towel round the tap.`);
  },
  fixtures: [
    {
      name: 'a handy neighbour',
      build(seed) {
        const sim = fixtureSim(seed);
        const p = sitting(sim)[1];
        const h = sitting(sim)[0];
        h.life!.traits = ['handy', 'friendly'];
        const sink = inFlat(sim, p.life!.flat).find((f) => f.def === 'sink')!;
        sink.wear = 0.7;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: sink.id, data: { helper: h.id } } };
      },
    },
    {
      name: 'a light sleeper, nobody handy',
      build(seed) {
        const sim = fixtureSim(seed);
        const p = sitting(sim)[1];
        p.life!.traits = ['lightSleeper', 'keenCook'];
        sitting(sim)[0].life!.traits = ['clumsy', 'paysEarly'];
        const sink = inFlat(sim, p.life!.flat).find((f) => f.def === 'sink')!;
        sink.wear = 0.7;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: sink.id } };
      },
    },
  ],
};

// ------------------------------------------------------------------ the street door sticks

const frontDoor: CardDef = {
  id: 'frontDoor',
  source: 'building',
  kind: 'moment',
  cooldownDays: 21,
  icon: 'spanner',
  turnsOn: ['locks', 'schedule:retired', 'trait:clumsy'],
  when(sim) {
    const people = tenants(sim).filter(home);
    const struggling = people.filter((p) => p.life!.schedule === 'retired' || has(p.life!, 'clumsy'));
    const p = struggling[0] ?? people[0];
    return p ? [{ pawn: p.id, flat: p.life!.flat, weight: struggling.length > 0 ? 1.2 : 0.6 }] : [];
  },
  hook: () => `The street door's sticking.`,
  text: (sim, c) => `The street door's sticking. ${first(who(sim, c))}'s had to shoulder it twice today.`,
  name: () => 'The street door',
  choices: () => [
    { label: 'Get a joiner', note: '£50' },
    { label: 'A squirt of oil', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const locks = sim.state.security.locks;
    if (answer === 0) return out(['pay:-5000:Joiner: the street door', `mem:${p.id}:landlordListened`, 'flag:doorShuts::42'], `A joiner planed the door. It shuts with a proper click now.`);
    // Oil helps, a bit. With locks, a door that doesn't quite shut doesn't quite lock either.
    if (answer === 1) return out(['flag:doorSticks::14', `mem:${p.id}:waitedForRepair`, 'thread:doorJams:72', ...(locks ? ['risk:burglary:1:7'] : [])], locks ? `Oil, for now. The door doesn't always latch, so the lock doesn't always catch.` : `Oil, for now. It still sticks in the wet.`);
    return out(['flag:doorPropped::7', `mem:${p.id}:leftToIt`, 'risk:burglary:1:7'], `Nobody came, so someone propped the door open with a brick. It's still there.`);
  },
  fixtures: [
    {
      name: 'Bill, no locks',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'locks',
      build(seed) {
        const sim = fixtureSim(seed);
        sim.state.security.locks = true;
        const p = sitting(sim)[0];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up to the oil: the door's jammed with someone outside. */
const doorJams: CardDef = {
  id: 'doorJams',
  source: 'building',
  kind: 'door',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['locks'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    return p && here(p) && hasFlag(sim, 'doorSticks') ? [{ pawn: p.id, flat: p.life!.flat }] : [];
  },
  hook: () => `The street door's jammed shut.`,
  text: (sim, c) => `The street door's jammed. ${first(who(sim, c))}'s outside with the shopping, shouting up.`,
  choices: () => [
    { label: 'Joiner, today', note: '£70' },
    { label: 'Kick it open', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const locks = sim.state.security.locks;
    if (answer === 0) return out(['pay:-7000:Joiner: the street door, urgently', 'flag:doorShuts::42', `mem:${p.id}:landlordListened`], `A joiner came out and planed the door. It shuts properly now.`);
    if (answer === 1) return out(['flag:doorSticks::14', `mem:${p.id}:waitedForRepair`, ...(locks ? ['risk:burglary:1:7'] : [])], `You kicked it open. ${first(p)} got in. The door has a new dent and the same problem.`);
    return out(['flag:doorPropped::7', `mem:${p.id}:leftToIt`, 'risk:burglary:1:7'], `Nobody came. A neighbour let ${first(p)} in, and wedged the door open so it wouldn't happen again.`);
  },
  fixtures: [
    {
      name: 'no locks',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        sim.state.drip.flags.push({ id: 'doorSticks' });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'locks',
      build(seed) {
        const sim = fixtureSim(seed);
        sim.state.security.locks = true;
        const p = sitting(sim)[0];
        sim.state.drip.flags.push({ id: 'doorSticks' });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ mould in the bathroom

const mould: CardDef = {
  id: 'mould',
  source: 'building',
  kind: 'moment',
  cooldownDays: 21,
  icon: 'water',
  turnsOn: ['trait:houseProud', 'trait:messy', 'trait:knowsRights'],
  when(sim) {
    const damp = seasonName(sim) === 'Winter' || seasonName(sim) === 'Autumn';
    return lettings(sim)
      .filter(({ flat, p }) => !hasFlag(sim, 'mould', flat) && inFlat(sim, flat).some((f) => f.def === 'shower' || f.def === 'bath') && (damp || has(p.life!, 'messy') || dirtOf(sim, flat) > 0.3))
      .map(({ flat, p }) => ({ pawn: p.id, flat, data: { what: 'got rid of the mould properly' }, weight: 0.8 + dirtOf(sim, flat) }));
  },
  hook: (sim, c) => `Black mould in ${flatName(sim, c.flat)}'s bathroom.`,
  text: (sim, c) => `Black mould's creeping across ${flatName(sim, c.flat)}'s bathroom ceiling. ${first(who(sim, c))} sent a photo.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Treat it properly', note: '£60' },
    { label: 'Bleach will shift it', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const fn = flatName(sim, flat);
    const writes = has(p.life!, 'knowsRights');
    if (answer === 0) return out([`pay:-6000:Mould treatment and a fan · ${fn}`, `mem:${p.id}:landlordListened`, `flag:extractorFan:${flat}`, `tale:praise:${p.id}`], `The mould's gone from ${fn}, and there's a fan to keep it gone.`);
    // A house-proud tenant scrubs it off for good; anyone else, it's back on the ceiling in a week.
    if (answer === 1) return out([`mem:${p.id}:toldToBleach`, ...(has(p.life!, 'houseProud') ? [] : [`flag:mould:${flat}:10`, 'thread:mouldBack:96'])], has(p.life!, 'houseProud') ? `${first(p)} bleached it off. Spotless, and cross about it.` : `${first(p)} gave it a wipe. It's coming back already.`);
    return out([`flag:mould:${flat}:28`, `mem:${p.id}:leftToIt`, ...(writes ? ['inspect:5:A tenant has sent us photographs of mould'] : [])], writes ? `Nobody answered, so ${first(p)} sent the photos to the council.` : `Nobody answered. The mould's spreading across the ceiling.`);
  },
  fixtures: [
    {
      name: 'house-proud',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const p = sitting(sim)[1];
        p.life!.traits = ['houseProud', 'keenCook'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'messy, knows their rights',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const [p] = letFlat(sim, 1, [['messy', 'knowsRights']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up to the bleach: it's back. */
const mouldBack: CardDef = {
  id: 'mouldBack',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  icon: 'water',
  turnsOn: ['trait:knowsRights'],
  when(sim, from) {
    const flat = from?.flat;
    const p = flat ? household(sim, flat).filter(here)[0] : undefined;
    return p && flat && hasFlag(sim, 'mould', flat) ? [{ pawn: p.id, flat }] : [];
  },
  hook: (sim, c) => `The mould's back in ${flatName(sim, c.flat)}.`,
  text: (sim, c) => `The mould's back on ${flatName(sim, c.flat)}'s bathroom ceiling. Blacker than before.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Treat it properly', note: '£60' },
    { label: 'More bleach', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const writes = has(p.life!, 'knowsRights') ? ['inspect:5:A tenant has sent us photographs of mould'] : [];
    if (answer === 0) return out([`pay:-6000:Mould treatment and a fan · ${flatName(sim, flat)}`, `mem:${p.id}:landlordListened`, `flag:extractorFan:${flat}`], `Treated properly this time, with a fan. ${first(p)} opened the window anyway, out of habit.`);
    if (answer === 1) return out([`mem:${p.id}:toldToBleach`, `flag:mould:${flat}:14`], `More bleach. ${first(p)}'s bathroom smells like a swimming pool, and the mould doesn't care.`);
    return out([`flag:mould:${flat}:28`, `mem:${p.id}:leftToIt`, ...writes], writes.length > 0 ? `Nobody answered, so ${first(p)} sent the council the photos.` : `Nobody answered. ${first(p)} has stopped looking at the ceiling.`);
  },
  fixtures: [
    {
      name: 'messy',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const [p] = letFlat(sim, 1, [['messy', 'friendly']]);
        settle(p);
        sim.state.drip.flags.push({ id: 'mould', subject: p.life!.flat });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'knows their rights',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const [p] = letFlat(sim, 1, [['knowsRights', 'nightOwl']]);
        settle(p);
        sim.state.drip.flags.push({ id: 'mould', subject: p.life!.flat });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ the gutter

const gutter: CardDef = {
  id: 'gutter',
  source: 'building',
  kind: 'moment',
  cooldownDays: 28,
  icon: 'water',
  turnsOn: ['trait:handy', 'topFloor'],
  when(sim) {
    if (seasonName(sim) === 'Summer') return [];
    const top = new Set(topFloor(sim));
    return lettings(sim)
      .filter(({ flat }) => top.has(flat))
      .map(({ flat, p }) => {
        const h = tenants(sim).find((o) => has(o.life!, 'handy'));
        return { pawn: p.id, flat, ...(h ? { data: { helper: h.id } } : {}), weight: 0.8 };
      });
  },
  hook: (sim, c) => `The gutter over ${flatName(sim, c.flat)} is overflowing.`,
  text: (sim, c) => `The gutter over ${flatName(sim, c.flat)} is blocked. Water's pouring down the wall.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: (sim, c) => {
    const h = pawnOf(sim, c.data?.helper);
    return [
      { label: 'Man with a ladder', note: '£40' },
      h ? { label: `Lend ${first(h)} the ladder`, note: 'Free' } : { label: 'Wait for summer', note: 'Free' },
    ];
  },
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const h = pawnOf(sim, c.data?.helper);
    if (answer === 0) return out(['pay:-4000:Gutter cleared', `mem:${p.id}:landlordListened`, 'thread:roofSlates:48'], `The gutter's clear. The man says he had a look at the slates while he was up.`);
    if (answer === 1) {
      if (h && here(h)) return out([`mem:${h.id}:askedToHelp`, `reveal:${h.id}:handy`, ...(h !== p ? [`soc:${p.id}:favour:${h.id}`] : [])], `${first(h)} was up the ladder in ten minutes. A tennis ball and a lot of leaves.`);
      return out([`flag:mould:${flat}:14`, `mem:${p.id}:waitedForRepair`], `It'll wait for summer. The wall inside ${flatName(sim, flat)} is going dark.`);
    }
    return out([`flag:mould:${flat}:21`, `mem:${p.id}:leftToIt`, ...wearUp(soaked(sim, flat), 0.15)], `Nobody came. The water's found its way inside ${flatName(sim, flat)}.`);
  },
  fixtures: [
    {
      name: 'a handy neighbour',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const bill = sitting(sim)[1];
        sitting(sim)[0].life!.traits = ['handy', 'friendly'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat, data: { helper: sitting(sim)[0].id } } };
      },
    },
    {
      name: 'nobody handy',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const bill = sitting(sim)[1];
        sitting(sim)[0].life!.traits = ['clumsy', 'paysEarly'];
        bill.life!.traits = ['easyGoing', 'keenCook'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

/** The follow-up: the gutter man found loose slates. */
const roofSlates: CardDef = {
  id: 'roofSlates',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:houseProud'],
  when(sim, from) {
    const flat = from?.flat;
    const p = flat ? household(sim, flat).filter(here)[0] : undefined;
    return p && flat ? [{ pawn: p.id, flat, data: { what: 'had the roof seen to before it leaked' } }] : [];
  },
  hook: (sim, c) => `Loose slates over ${flatName(sim, c.flat)}.`,
  text: (sim, c) => `The gutter man rang: three slates over ${flatName(sim, c.flat)} are loose. Before winter?`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Fix them now', note: '£80' },
    { label: 'After the winter', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    if (answer === 0) return out(['pay:-8000:Roofer: loose slates', `mem:${p.id}:itsYourJob`, `tale:praise:${p.id}`], `The roofer's fixed the slates. ${first(p)} heard him, and said thank you.`);
    if (answer === 1) return out([`flag:looseSlates:${flat}:28`, ...(has(p.life!, 'houseProud') ? [`mem:${p.id}:waitedForRepair`] : [])], `The slates can wait. The wind can't.`);
    const thing = soaked(sim, flat);
    return out([`flag:looseSlates:${flat}:28`, `mem:${p.id}:leftToIt`, ...(thing ? [`wear:${thing.id}:1`] : [])], `Nobody rang back. A slate came down in the night and the rain came in.`);
  },
  fixtures: [
    {
      name: 'house-proud',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['houseProud', 'keenCook'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'easy-going',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['easyGoing', 'friendly'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ the stair carpet

const stairCarpet: CardDef = {
  id: 'stairCarpet',
  source: 'building',
  kind: 'moment',
  cooldownDays: 28,
  icon: 'spanner',
  turnsOn: ['trait:clumsy', 'schedule:retired', 'trait:houseProud'],
  when(sim) {
    if (hasFlag(sim, 'tapedCarpet')) return [];
    const people = tenants(sim).filter(home);
    if (tenants(sim).length < 2 || people.length === 0) return [];
    const wobbly = people.filter((p) => has(p.life!, 'clumsy') || p.life!.schedule === 'retired');
    const p = wobbly[0] ?? people[0];
    return [{ pawn: p.id, flat: p.life!.flat, weight: wobbly.length > 0 ? 1 : 0.5 }];
  },
  hook: () => `The stair carpet's come loose.`,
  text: (sim, c) => `The stair carpet's come up on the first landing. ${first(who(sim, c))} nearly went flying.`,
  name: () => 'The stairs',
  choices: () => [
    { label: 'Carpet fitter', note: '£45' },
    { label: 'Gaffer tape', note: 'Free' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const wobbly = has(p.life!, 'clumsy') || p.life!.schedule === 'retired';
    const proud = tenants(sim).filter((o) => o !== p && has(o.life!, 'houseProud'));
    if (answer === 0) return out(['pay:-4500:Carpet fitter: the stairs', `mem:${p.id}:landlordListened`, ...mems(proud, 'itsYourJob')], `The carpet's fixed. You can walk up the stairs without looking down.`);
    if (answer === 1) return out(['flag:tapedCarpet::21', `mem:${p.id}:waitedForRepair`, ...mems(proud, 'landlordShrugged'), ...(wobbly ? ['thread:stairTrip:72'] : [])], `Gaffer tape on the landing. Silver, and already curling.`);
    return out([`mem:${p.id}:trippedOnStairs`, `mem:${p.id}:leftToIt`, `tale:stairTrip:${p.id}`, ...mems(proud, 'landlordShrugged')], `Nobody did anything. ${first(p)} went flying on Thursday.`);
  },
  fixtures: [
    {
      name: 'Bill, retired',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'steady on their feet, a house-proud neighbour',
      build(seed) {
        const sim = fixtureSim(seed);
        const p = sitting(sim)[0];
        p.life!.traits = ['friendly', 'paysEarly'];
        sitting(sim)[1].life!.traits = ['houseProud', 'keenCook'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** The follow-up: someone caught a heel on the tape. */
const stairTrip: CardDef = {
  id: 'stairTrip',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['trait:knowsRights'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    return p && here(p) && hasFlag(sim, 'tapedCarpet') ? [{ pawn: p.id, flat: p.life!.flat }] : [];
  },
  hook: (sim, c) => `${first(who(sim, c))} tripped on the taped stair.`,
  text: (sim, c) => `${first(who(sim, c))} caught a heel on the taped stair carpet. A sprained ankle.`,
  choices: () => [
    { label: 'Fix it, and flowers', note: '£60' },
    { label: 'Watch your step', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const writes = has(p.life!, 'knowsRights') ? ['inspect:5:A tenant has reported a hazard on the stairs'] : [];
    if (answer === 0) return out(['pay:-6000:Carpet fitter, and flowers', `mem:${p.id}:landlordListened`, `tale:stairTrip:${p.id}`], `The carpet's fixed and there are flowers in ${flatName(sim, c.flat)}.`);
    if (answer === 1) return out([`mem:${p.id}:trippedOnStairs`, `mem:${p.id}:landlordShrugged`, ...writes], writes.length > 0 ? `Watch your step, you said. ${first(p)} wrote to the council.` : `Watch your step, you said. ${first(p)} limped off.`);
    return out([`mem:${p.id}:trippedOnStairs`, `mem:${p.id}:leftToIt`, `mem:${p.id}:landlordShrugged`, `tale:stairTrip:${p.id}`, ...writes], `Nobody came to see. ${first(p)} hobbled up on their own.`);
  },
  fixtures: [
    {
      name: 'knows their rights',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['knowsRights', 'clumsy']]);
        settle(p);
        sim.state.drip.flags.push({ id: 'tapedCarpet' });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'Bill',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['easyGoing', 'keenCook'];
        sim.state.drip.flags.push({ id: 'tapedCarpet' });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ a draughty window

const draughtyWindow: CardDef = {
  id: 'draughtyWindow',
  source: 'building',
  kind: 'moment',
  cooldownDays: 14,
  turnsOn: ['trait:knowsRights', 'temperature'],
  when(sim) {
    if (outdoorTemp(sim) >= 11) return [];
    return lettings(sim)
      .filter(({ flat }) => !hasFlag(sim, 'draughtProof', flat))
      .map(({ flat, p }) => ({ pawn: p.id, flat, data: { what: 'draught-proofed their windows' }, weight: tempOf(sim, flat) < COUNCIL.tooCold + 3 ? 1.2 : 0.6 }));
  },
  hook: (sim, c) => `Wind whistling through ${flatName(sim, c.flat)}.`,
  text: (sim, c) => `${flatName(sim, c.flat)}'s window frame whistles when it's windy. ${first(who(sim, c))}'s stuffed a sock in it.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Draught strips', note: '£20' },
    { label: 'Thicker curtains', note: '' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const writes = has(p.life!, 'knowsRights') && tempOf(sim, flat) < COUNCIL.tooCold + 2 ? ['inspect:4:A tenant has told us their flat is too cold to live in'] : [];
    if (answer === 0) return out(['pay:-2000:Draught strips', `flag:draughtProof:${flat}`, `mem:${p.id}:landlordListened`, `tale:praise:${p.id}`], `Draught strips round ${flatName(sim, flat)}'s windows. The sock's retired.`);
    if (answer === 1) return out([`mem:${p.id}:draughty`, ...writes], writes.length > 0 ? `Thicker curtains, you said. ${first(p)} wrote to the council instead.` : `Thicker curtains, you said. ${first(p)} bought some.`);
    return out([`mem:${p.id}:draughty`, `mem:${p.id}:leftToIt`, ...writes], `Nobody answered. ${first(p)} has a second sock in it now.`);
  },
  fixtures: [
    {
      name: 'knows their rights, cold',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const [p] = letFlat(sim, 1, [['knowsRights', 'lightSleeper']]);
        settle(p);
        sim.state.temps[p.life!.flat] = 9;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'easy-going',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        const p = sitting(sim)[1];
        p.life!.traits = ['easyGoing', 'keenCook'];
        sim.state.temps[p.life!.flat] = 17;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ the catalogue

export const EVERYDAY_CARDS: CardDef[] = [
  lateRent, rentBack, friendStaying, stillOnSofa, bikeInHall, parcelMixup, oddJobs, lobbyDo, cookingSmells, washer, washerLeak,
  thinkingOfLeaving, stayingOn, rota, rotaSlips, smokingOnStep, boxes, sideHustle, plants, boilerService, hustleGoing, peaceCurry, smokeIndoors,
  radiatorValve, valveGoes, tapDrip, frontDoor, doorJams, mould, mouldBack, gutter, roofSlates, stairCarpet, stairTrip, draughtyWindow,
];
