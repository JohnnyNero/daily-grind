// Tenant cards (spec 1.4, source T): asks and moments that come from the people in the
// building, their traits, needs, liking, who likes whom. About 45% of cards. Includes the
// three old chat requests (pet, heating, paint), which moved here from `requestsHour`.
//
// Each card trades two different things, and who's involved changes how it plays: a
// haggler's fiver against a promise you have to keep, one neighbour against another, the
// building's safety against a person's liberty. Ignoring one is always worst (1.6): the
// person remembers, and the world decides badly. Every card here passes the consequence
// rule (rule.ts, test/cards.rule.test.ts) on its fixtures.

import { tenants } from '../chat';
import { furnitureDef } from '../defs';
import { POUND, flatInfo, goingRate } from '../economy';
import { dirtOf, neighboursOf, tempOf } from '../environment';
import { hasFlag } from '../flags';
import { household } from '../leases';
import { random } from '../rng';
import type { Sim } from '../sim';
import { chemistry, opinion } from '../social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Card, type Furniture, type Pawn } from '../state';
import { has } from '../traits';
import { COUNCIL, MEMORIES, OPINION, REQUESTS, TIERS, UPKEEP } from '../tuning';
import { repairCost } from '../upkeep';
import { fixtureSim, letFlat, sitting } from './rule';
import type { CardDef, CardSubject, Effect, Outcome } from './types';

// ------------------------------------------------------------------ helpers

const first = (p: Pawn): string => p.name.split(' ')[0];

function pawnOf(sim: Sim, id: number | string | undefined): Pawn | undefined {
  if (id === undefined) return undefined;
  const n = Number(id);
  return sim.state.pawns.find((p) => p.id === n);
}

/** The card's own tenant. The drip only deals a card whose `when` found them, so they're there. */
const who = (sim: Sim, card: Card): Pawn => pawnOf(sim, card.pawn)!;

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

/** Everyone else in the building. */
const others = (sim: Sim, p: Pawn): Pawn[] => tenants(sim).filter((o) => o !== p);

/** Everyone else at home, outside this flat. */
const neighboursHome = (sim: Sim, flat: string): Pawn[] => tenants(sim).filter((o) => o.life!.flat !== flat && home(o));

const friends = (sim: Sim, a: Pawn, b: Pawn): boolean => opinion(sim, a, b) >= OPINION.friend;

/** Furniture in a flat. */
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
  const broken = things.find((f) => f.broken !== undefined);
  if (broken) return broken;
  return things.filter((f) => (f.wear ?? 0) > UPKEEP.worn).sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0))[0];
}

const thingName = (sim: Sim, id: number | string | undefined): string => {
  const f = sim.state.furniture.find((x) => x.id === Number(id));
  return f ? furnitureDef(f.def).name.toLowerCase() : 'boiler';
};

/** Basics the council cares about: a broken one ends up on its list. */
const isBasic = (f: Furniture): boolean => ['kitchen', 'bathroom'].includes(furnitureDef(f.def).group);

/** Grim 0 to Impressive 6. */
const tierRank = (tier: string): number => {
  const i = TIERS.findIndex((t) => t.name === tier);
  return i < 0 ? 2 : TIERS.length - 1 - i;
};

const isNightish = (sim: Sim): boolean => sim.minuteOfDay >= 21 * 60 || sim.minuteOfDay < 3 * 60;

/** For fixtures: lived here a while. */
function settle(...ps: Pawn[]): void {
  for (const p of ps) p.life!.since = -30;
}

const out = (effects: Effect[], notice: string): Outcome => ({ effects, notice });

// ------------------------------------------------------------------ 6. a word in the lobby

/** A haggler wants a fiver off for the state of something in the flat. Money for good against a promise you have to keep. */
const haggle: CardDef = {
  id: 'haggle',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 10,
  turnsOn: ['thing:worn', 'whoPaysMore', 'trait:haggler'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const p of tenants(sim)) {
      const life = p.life!;
      const lease = flatInfo(sim, life.flat).lease;
      if (!has(life, 'haggler') || !lease || lease.notice || life.liking >= 60) continue;
      if (sim.day - lease.startDay < 7 || (lease.endDay !== null && lease.endDay - sim.day < 7)) continue;
      if (remembers(sim, p, 'agreedHaggle') || remembers(sim, p, 'refusedHaggle')) continue;
      const thing = worstIn(sim, life.flat);
      if (thing) list.push({ pawn: p.id, flat: life.flat, furniture: thing.id, weight: thing.broken !== undefined ? 2 : 1 });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} wants £5 off the rent.`,
  text: (sim, c) => `${first(who(sim, c))} caught you by the bins. £5 off, "for the state of the ${thingName(sim, c.furniture)}".`,
  choices: () => [
    { label: 'Fine, £5 off', note: 'For good. Others may hear' },
    { label: 'I\'ll fix it', note: 'Within five days' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const n = first(p);
    if (answer === 0) {
      // A cheaper flat next door is news: anyone paying more for no better hears about it.
      const lease = flatInfo(sim, flat).lease!;
      const now = lease.rent - 5 * POUND;
      const dearer = others(sim, p).filter((o) => {
        const theirs = flatInfo(sim, o.life!.flat).lease;
        return o.life!.flat !== flat && theirs && !theirs.sitting && theirs.rent > now && goingRate(sim, o.life!.flat) <= goingRate(sim, flat);
      });
      return out([`rent:${flat}:${-5 * POUND}`, `mem:${p.id}:agreedHaggle`, ...dearer.map((o) => `mem:${o.id}:paysMore`)], `${n}'s rent is £5 lower, for good.${dearer.length > 0 ? ' Word will get round.' : ''}`);
    }
    if (answer === 1) return out([`promise:mend:${c.furniture}:5`, `chat:I'll get the ${thingName(sim, c.furniture)} seen to this week.`], `You said you'd fix the ${thingName(sim, c.furniture)} within five days. ${n} will hold you to it.`);
    return out([`mem:${p.id}:refusedHaggle`, `mem:${p.id}:ignored`], `${n} took that as a no, and told the stairs.`);
  },
  fixtures: [
    {
      name: 'worn cooker, nobody dearer',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['haggler', 'messy']]);
        settle(p);
        flatInfo(sim, p.life!.flat).lease!.startDay = -10;
        p.life!.liking = 45;
        const cooker = inFlat(sim, p.life!.flat).find((f) => f.def === 'cooker')!;
        cooker.wear = 0.85;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: cooker.id } };
      },
    },
    {
      name: 'broken shower, a dearer flat',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['haggler', 'knowsRights']], 90 * POUND);
        letFlat(sim, 2, [['easyGoing']], 120 * POUND);
        settle(p);
        flatInfo(sim, p.life!.flat).lease!.startDay = -10;
        p.life!.liking = 40;
        const shower = inFlat(sim, p.life!.flat).find((f) => f.def === 'shower')!;
        shower.wear = 1;
        shower.broken = sim.day;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: shower.id } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 7. noise complaint

/** Someone kept awake by a neighbour. Take a side, or let the two of them sort it out on their chemistry. */
const noise: CardDef = {
  id: 'noise',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 4,
  turnsOn: ['chemistry', 'trait:easyGoing', 'trait:complainer', 'trait:partyAnimal', 'trait:musician'],
  when(sim) {
    const list: CardSubject[] = [];
    const since = sim.state.tick - 2 * TICKS_PER_DAY;
    for (const p of tenants(sim)) {
      const m = [...p.life!.social].reverse().find((s) => s.id === 'noise' && s.at >= since);
      const n = m && pawnOf(sim, m.about);
      if (!n || !here(n) || n.life!.flat === p.life!.flat) continue;
      list.push({ pawn: p.id, flat: p.life!.flat, data: { noisy: n.id }, weight: has(p.life!, 'lightSleeper') ? 1.5 : 1 });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))}: "${flatName(sim, pawnOf(sim, c.data?.noisy)?.life?.flat)}. Every night."`,
  text: (sim, c) => `${first(who(sim, c))}, ${flatName(sim, c.flat)}: "${flatName(sim, pawnOf(sim, c.data?.noisy)?.life?.flat)}'s noise. Every night. Every. Night."`,
  choices: () => [
    { label: 'Have a word', note: 'They\'ll know who asked' },
    { label: 'Sort it yourselves', note: 'Could go either way' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const n = pawnOf(sim, c.data?.noisy)!;
    const pl = p.life!;
    const nl = n.life!;
    const name = first(p);
    const noisy = flatName(sim, nl.flat);
    if (answer === 0) {
      // A party animal or a musician is what they are: told off, and at it again by the weekend.
      const unrepentant = has(nl, 'partyAnimal') || has(nl, 'musician');
      return out(
        [...household(sim, nl.flat).map((h) => `mem:${h.id}:toldOff`), `mem:${p.id}:landlordListened`, `soc:${n.id}:slight:${p.id}`, ...(unrepentant ? [`mem:${p.id}:keptAwake`] : []), `chat:Had a word with ${noisy} about the noise.`],
        unrepentant ? `You had a word with ${noisy}. They know who complained, and they're at it again.` : `You had a word with ${noisy}. They know who complained.`,
      );
    }
    if (answer === 1) {
      // They talk on the landing: chemistry and temperament decide how.
      const easy = has(pl, 'easyGoing') || has(nl, 'easyGoing');
      const odds = 0.5 + chemistry(sim, p.id, n.id) * 0.4 + (easy ? 0.2 : 0) - (has(pl, 'complainer') ? 0.2 : 0) - (has(nl, 'partyAnimal') || has(nl, 'musician') ? 0.15 : 0);
      const good = random(sim.state) < Math.max(0.1, Math.min(0.9, odds));
      const talk = good ? [`soc:${p.id}:deepTalk:${n.id}`, `soc:${n.id}:deepTalk:${p.id}`] : [`soc:${p.id}:row:${n.id}`, `soc:${n.id}:row:${p.id}`, 'risk:fight:1:7'];
      return out([...talk, `mem:${p.id}:landlordShrugged`], good ? `${name} knocked on ${noisy}. They sorted it out over a cup of tea.` : `${name} knocked on ${noisy}. It turned into a row on the landing.`);
    }
    return out(
      [`mem:${p.id}:ignored`, `mem:${p.id}:keptAwake`, `mem:${p.id}:keptAwake`, `mem:${p.id}:keptAwake`, `soc:${p.id}:slight:${n.id}`, `soc:${n.id}:slight:${p.id}`, `soc:${p.id}:noise:${n.id}`, 'risk:fight:1:7'],
      `Nobody answered ${name}. The noise went on, and now they're not speaking.`,
    );
  },
  fixtures: [
    {
      name: 'easy-going pair',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['easyGoing', 'lightSleeper']]);
        const [n] = letFlat(sim, 2, [['friendly', 'keenCook']]);
        settle(p, n);
        p.life!.social.push({ id: 'noise', about: n.id, at: sim.state.tick - TICKS_PER_HOUR * 8 });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { noisy: n.id } } };
      },
    },
    {
      name: 'complainer and a party animal',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['complainer', 'lightSleeper']]);
        const [n] = letFlat(sim, 2, [['partyAnimal', 'musician']]);
        settle(p, n);
        p.life!.social.push({ id: 'noise', about: n.id, at: sim.state.tick - TICKS_PER_HOUR * 8 });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { noisy: n.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 8. locked out

/** Coming home late without keys. Your goodwill against the building's safety: the key under the mat. */
const lockout: CardDef = {
  id: 'lockout',
  source: 'tenant',
  kind: 'door',
  night: true,
  cooldownDays: 5,
  turnsOn: ['trait:clumsy', 'trait:lightSleeper', 'whoIsAwake', 'locks'],
  when(sim) {
    const m = sim.minuteOfDay;
    if (m < 22 * 60 && m >= 2 * 60) return [];
    if (hasFlag(sim, 'keyUnderMat')) return [];
    const soon = sim.state.tick + 90 * TICKS_PER_MINUTE;
    return tenants(sim)
      .filter((p) => p.life!.away && p.life!.away.until <= soon)
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: has(p.life!, 'clumsy') ? 2 : has(p.life!, 'partyAnimal') || has(p.life!, 'nightOwl') ? 1.5 : 1 }));
  },
  hook: (sim, c) => `${first(who(sim, c))}'s locked out.`,
  text: (sim, c) => `${first(who(sim, c))}'s locked out. It's late. Sat on the front step, waiting.`,
  choices: () => [
    { label: 'Let them in', note: 'Grateful. Loud on the stairs' },
    { label: 'Key under the mat', note: 'No more lockouts. For anyone' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    // Light sleepers on the stairs hear every door.
    const sleepers = others(sim, p).filter((o) => home(o) && has(o.life!, 'lightSleeper'));
    if (answer === 0) return out([`mem:${p.id}:helpedLockout`, `flag:owes:${p.id}:14`, ...sleepers.map((o) => `mem:${o.id}:keptAwake`)], `You let ${name} in. ${name} owes you one.${sleepers.length > 0 ? ' The stairs heard all about it.' : ''}`);
    if (answer === 1) {
      const locks = sim.state.security.locks;
      return out([`mem:${p.id}:helpedLockout`, 'flag:keyUnderMat', 'risk:burglary:1:14'], locks ? `There's a key under the mat now. Your new locks count for nothing while it's there.` : `There's a key under the mat now. ${name} won't be locked out again. Nor will anyone else.`);
    }
    // Nobody came. Someone awake might let them in; otherwise it's a locksmith, on their money.
    const awake = others(sim, p).find((o) => home(o) && (o.pose !== 'sleep' || has(o.life!, 'nightOwl')));
    if (awake) return out([`mem:${p.id}:leftToIt`, `mem:${p.id}:leftToIt`, `soc:${p.id}:favour:${awake.id}`, ...sleepers.map((o) => `mem:${o.id}:keptAwake`)], `Nobody came. ${name} rang every bell till ${first(awake)} came down.`);
    return out([`mem:${p.id}:leftToIt`, `mem:${p.id}:leftToIt`, `tale:lockout:${p.id}`], `Nobody came. ${name} sat on the step till one, then paid a locksmith £70.`);
  },
  fixtures: [
    {
      name: 'a night owl up, a light sleeper',
      build(seed) {
        const sim = fixtureSim(seed, 3, 23);
        const [p] = letFlat(sim, 1, [['clumsy', 'friendly']]);
        const [s] = letFlat(sim, 2, [['lightSleeper', 'nightOwl']]);
        settle(p, s);
        p.life!.away = { until: sim.state.tick + 30 * TICKS_PER_MINUTE, why: 'At the pub' };
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'everyone asleep, locks',
      build(seed) {
        const sim = fixtureSim(seed, 3, 23);
        sim.state.security.locks = true;
        const [p] = letFlat(sim, 1, [['partyAnimal', 'messy']]);
        settle(p);
        p.life!.away = { until: sim.state.tick + 30 * TICKS_PER_MINUTE, why: 'At the pub' };
        for (const o of sitting(sim)) o.pose = 'sleep';
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 11. can I borrow your drill?

/** A shelf. Trust them with it, or pay to have it done properly, which a handy tenant resents. */
const drill: CardDef = {
  id: 'drill',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 7,
  turnsOn: ['trait:handy', 'trait:clumsy', 'flatBelow'],
  when(sim) {
    return tenants(sim)
      .filter((p) => home(p) && settled(sim, p, 7) && !hasFlag(sim, 'diyShelf', p.life!.flat))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: has(p.life!, 'handy') ? 1.5 : 1 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants to borrow your drill.`,
  text: (sim, c) => `${first(who(sim, c))} wants to put a shelf up. Can they borrow your drill?`,
  choices: (sim, c) => [
    { label: 'Lend it', note: has(who(sim, c).life!, 'clumsy') ? 'Mind the pipes' : 'Their shelf, their way' },
    { label: 'I\'ll send someone', note: '£25, done properly' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const life = p.life!;
    const flat = c.flat!;
    const name = first(p);
    // The same roll for every answer, so a pipe is a pipe whoever drills.
    const roll = random(sim.state);
    const pipe = (chance: number): Effect[] => {
      if (roll >= chance) return [];
      const wet = inFlat(sim, flat).filter((f) => ['shower', 'bath', 'basin', 'sink', 'toilet'].includes(f.def) && f.broken === undefined);
      const hit = wet.sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0))[0];
      const below = belowOf(sim, flat);
      return [...(hit ? [`wear:${hit.id}:${Math.max(0.95, hit.wear ?? 0)}`] : []), ...below.map((b) => `soc:${b.id}:leakedOnMe:${p.id}`)];
    };
    if (answer === 0) {
      const hit = pipe(has(life, 'clumsy') ? 1 / 3 : has(life, 'handy') ? 1 / 20 : 1 / 10);
      return out([`flag:diyShelf:${flat}:28`, `mem:${p.id}:landlordListened`, ...hit], hit.length > 0 ? `${name} put the shelf up, and a nail through a pipe.` : `${name} put the shelf up. It's nearly level.`);
    }
    if (answer === 1) return out(['pay:-2500:Handyman: a shelf', has(life, 'handy') ? `mem:${p.id}:notTrusted` : `mem:${p.id}:landlordListened`], has(life, 'handy') ? `A man put ${name}'s shelf up. ${name} could have done it in ten minutes.` : `A man put ${name}'s shelf up. Level, and no pipes.`);
    const hit = pipe(1 / 6);
    return out([`flag:diyShelf:${flat}:28`, `mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`, ...hit], hit.length > 0 ? `${name} borrowed a mate's drill. Nobody checked for pipes.` : `${name} borrowed a mate's drill. No thanks to you.`);
  },
  fixtures: [
    {
      name: 'clumsy, a let flat below',
      build(seed) {
        const sim = fixtureSim(seed);
        // Flat 4 (Bill's) is above Flat 2.
        const [b] = letFlat(sim, 1, [['lightSleeper', 'easyGoing']]);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['clumsy', 'keenCook'];
        settle(b);
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'handy, nobody below',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.traits = ['handy', 'keenCook'];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

/** Whoever lives in the flat directly below. */
function belowOf(sim: Sim, flatId: string): Pawn[] {
  const lay = sim.layout;
  const f = lay.flat(flatId);
  if (!f) return [];
  const cells = lay.flatCells(f);
  const cols = new Set(cells.map((n) => n % lay.w));
  const lowest = Math.min(...cells.map((n) => Math.floor(n / lay.w)));
  const under = lay.flats.find((o) => o.id !== flatId && lay.flatCells(o).some((n) => {
    const row = Math.floor(n / lay.w);
    return row < lowest && row >= lowest - 5 && cols.has(n % lay.w);
  }));
  return under ? household(sim, under.id) : [];
}

// ------------------------------------------------------------------ 12. someone's not on the lease

/** The busybody says someone's living in a flat who isn't on the lease. Poke your nose in, or let it go. */
const lodger: CardDef = {
  id: 'lodger',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 7,
  turnsOn: ['partnerOrLodger', 'trait:busybody'],
  when(sim) {
    const list: CardSubject[] = [];
    const busy = tenants(sim).filter((p) => has(p.life!, 'busybody'));
    for (const b of busy) {
      for (const t of others(sim, b)) {
        const flat = t.life!.flat;
        if (flat === b.life!.flat || hasFlag(sim, 'lodger', flat)) continue;
        const partner = pawnOf(sim, t.life!.partner);
        if (partner && here(partner) && partner.life!.flat !== flat) list.push({ pawn: b.id, flat, data: { who: 'partner', tenant: t.id, partner: partner.id }, weight: 1.5 });
        else if (!partner && household(sim, flat).length === 1 && (has(t.life!, 'friendly') || has(t.life!, 'partyAnimal'))) list.push({ pawn: b.id, flat, data: { who: 'lodger', tenant: t.id } });
      }
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))}: someone's not on the lease.`,
  text: (sim, c) => `${first(who(sim, c))} says someone's living in ${flatName(sim, c.flat)} who isn't on the lease.`,
  choices: (sim, c) => [
    { label: 'Knock and ask', note: 'Awkward either way' },
    { label: 'Let it go', note: `${first(who(sim, c))} won't like it` },
  ],
  resolve(sim, c, answer) {
    const b = who(sim, c);
    const t = pawnOf(sim, c.data?.tenant);
    const partner = pawnOf(sim, c.data?.partner);
    const flat = c.flat!;
    const fn = flatName(sim, flat);
    // They've moved out since: nobody to ask, and nothing to let go.
    if (!t) return out([`mem:${b.id}:${answer === 'ignored' ? 'ignored' : 'landlordListened'}`], `${fn}'s lot have gone, and whoever it was went with them.`);
    const couple = partner ? [t, partner] : [t];
    if (answer === 0) {
      if (partner) return out([`mem:${t.id}:nosyLandlord`, `mem:${partner.id}:nosyLandlord`, `mem:${b.id}:landlordListened`], `It's ${first(t)}'s partner, ${first(partner)}. They didn't like being asked.`);
      return out([`mem:${t.id}:caughtOut`, `rent:${flat}:${15 * POUND}`, `mem:${b.id}:landlordListened`], `A mate of ${first(t)}'s, on the sofa since March. He's on the lease now, at £15 a week.`);
    }
    if (answer === 1) return out([`mem:${b.id}:landlordShrugged`, `flag:lodger:${flat}:28`], `You let it go. Whoever it is stays in ${fn}, and the flat feels it.`);
    return out([`mem:${b.id}:ignored`, ...couple.map((x) => `soc:${x.id}:heardThings:${b.id}`), `flag:lodger:${flat}:28`], `Nobody answered ${first(b)}, so the whole stairs heard about ${fn} instead.`);
  },
  fixtures: [
    {
      name: 'a partner from upstairs',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'complainer']]);
        const [t] = letFlat(sim, 2, [['easyGoing', 'nightOwl']]);
        const bill = sitting(sim)[1];
        t.life!.partner = bill.id;
        bill.life!.partner = t.id;
        settle(b, t);
        return { sim, subject: { pawn: b.id, flat: t.life!.flat, data: { who: 'partner', tenant: t.id, partner: bill.id } } };
      },
    },
    {
      name: 'a lodger on the sofa',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'friendly']]);
        const [t] = letFlat(sim, 2, [['partyAnimal', 'friendly']]);
        settle(b, t);
        return { sim, subject: { pawn: b.id, flat: t.life!.flat, data: { who: 'lodger', tenant: t.id } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 14. paying more than next door

/** One tenant has found out another pays less for no better. Money against fairness, one tenant against another. */
const paysMore: CardDef = {
  id: 'paysMore',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 14,
  turnsOn: ['whoPaysWhat', 'trait:easyGoing', 'trait:haggler'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const p of tenants(sim)) {
      if (!remembers(sim, p, 'paysMore')) continue;
      const mine = flatInfo(sim, p.life!.flat).lease;
      if (!mine) continue;
      const cheaper = sim.layout.flats
        .filter((f) => f.id !== p.life!.flat && household(sim, f.id).length > 0)
        .map((f) => ({ f, lease: flatInfo(sim, f.id).lease }))
        // Not against a sitting tenant: their rent is from before your time, and everyone knows
        // it. Matching that would halve a rent at a stroke, for a rise of a fiver the other way.
        .filter((x) => x.lease && !x.lease.sitting && mine.rent - x.lease.rent > 15 * POUND && goingRate(sim, x.f.id) >= goingRate(sim, p.life!.flat) * 0.9)
        // The nearest rent under theirs, not the cheapest in the building: matching that one
        // would walk every rent down to a sitting tenant's, one card at a time.
        .sort((a, b) => b.lease!.rent - a.lease!.rent)[0];
      if (cheaper) list.push({ pawn: p.id, flat: p.life!.flat, data: { other: cheaper.f.id, gap: mine.rent - cheaper.lease!.rent }, weight: 1.5 });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} pays more than ${flatName(sim, String(c.data?.other))}.`,
  text: (sim, c) => `${first(who(sim, c))} found out ${flatName(sim, String(c.data?.other))} pays £${Math.round(Number(c.data?.gap) / POUND)} a week less. Wants to know why.`,
  choices: (sim, c) => [
    { label: 'Match it', note: `£${Math.round(Number(c.data?.gap) / POUND)} a week less` },
    { label: `${flatName(sim, String(c.data?.other))} goes up`, note: 'They\'ll hear who started it' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const flat = c.flat!;
    const other = String(c.data!.other);
    const gap = Number(c.data!.gap);
    const them = household(sim, other);
    const name = first(p);
    if (answer === 0) return out([`rent:${flat}:${-gap}`, `mem:${p.id}:rentCut`], `${name}'s rent matches ${flatName(sim, other)}'s now. The hagglers will hear.`);
    if (answer === 1) {
      // A small rise, not the whole gap. An easy-going household shrugs it off; everyone hears who started it.
      const lease = flatInfo(sim, other).lease!;
      const rise = Math.max(5 * POUND, Math.min(gap, Math.round((lease.rent * 0.1) / (5 * POUND)) * 5 * POUND));
      return out(
        [`mem:${p.id}:landlordListened`, `rent:${other}:${rise}`, ...them.filter((t) => !has(t.life!, 'easyGoing')).map((t) => `mem:${t.id}:rentRiseSmall`), ...them.map((t) => `soc:${t.id}:heardThings:${p.id}`)],
        `${flatName(sim, other)}'s rent goes up £${rise / POUND}. They know whose idea it was.`,
      );
    }
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:paysMore`, ...them.flatMap((t) => [`soc:${p.id}:slight:${t.id}`, `soc:${t.id}:slight:${p.id}`])], `Nobody explained, so ${name} had it out with ${flatName(sim, other)} on the stairs.`);
  },
  fixtures: [
    {
      name: 'next door shrugs nothing off',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 2, [['haggler', 'busybody']], 100 * POUND);
        const [o] = letFlat(sim, 4, [['lightSleeper', 'keenCook']], 75 * POUND);
        settle(p, o);
        p.life!.memories.push({ id: 'paysMore', at: sim.state.tick - TICKS_PER_HOUR });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { other: o.life!.flat, gap: 25 * POUND } } };
      },
    },
    {
      name: 'an easy-going next door',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 2, [['knowsRights', 'houseProud']], 100 * POUND);
        const [o] = letFlat(sim, 4, [['easyGoing', 'keenCook']], 75 * POUND);
        settle(p, o);
        p.life!.memories.push({ id: 'paysMore', at: sim.state.tick - TICKS_PER_HOUR });
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { other: o.life!.flat, gap: 25 * POUND } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 15. mum's visiting

/** A tenant's mum wants a word with the landlord. The flat's tier decides how it goes, both ways. */
const mumVisit: CardDef = {
  id: 'mumVisit',
  source: 'tenant',
  kind: 'moment',
  cooldownDays: 7,
  turnsOn: ['tier', 'liking'],
  when(sim) {
    const weekday = (sim.day - 1) % 7;
    const m = sim.minuteOfDay;
    if (weekday < 5 || m < 10 * 60 || m >= 18 * 60) return [];
    return tenants(sim)
      .filter((p) => home(p) && settled(sim, p, 3) && !remembers(sim, p, 'mumApproved') && !remembers(sim, p, 'mumWorried'))
      .map((p) => {
        const family = sim.state.pawns.find((v) => v.kind === 'visitor' && v.role === 'family' && v.flat === p.life!.flat);
        return { pawn: p.id, flat: p.life!.flat, ...(family ? { visitor: family.id } : {}), weight: family ? 3 : 0.5 };
      });
  },
  hook: (sim, c) => `${first(who(sim, c))}'s mum wants a word.`,
  text: (sim, c) => `${first(who(sim, c))}'s mum is here and would like a word with "the landlord".`,
  choices: () => [
    { label: 'Pop up, say hello', note: 'She\'ll look round' },
    { label: 'Send up biscuits', note: '£5. From a distance' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const rank = tierRank(flatInfo(sim, c.flat!).tier);
    if (answer === 0) {
      if (rank >= 2) return out([`mem:${p.id}:mumApproved`], `You said hello. Mum approves. ${name} might stay a while.`);
      // She lists what's wrong; you say you'll fix the worst of it by next weekend.
      const worst = worstIn(sim, c.flat!);
      if (worst) return out([`promise:mend:${worst.id}:7`, `mem:${p.id}:landlordListened`], `Mum showed you the ${furnitureDef(worst.def).name.toLowerCase()}. You promised it'd be fixed by next weekend.`);
      return out([`mem:${p.id}:landlordListened`], `Mum looked round the bare flat and went quiet. At least you came up.`);
    }
    if (answer === 1) {
      const thought = rank < 2 ? [`mem:${p.id}:mumWorried`] : rank >= 4 ? [`mem:${p.id}:mumApproved`] : [];
      return out(['pay:-500:Biscuits for a tenant\'s mum', `mem:${p.id}:landlordListened`, ...thought], rank < 2 ? `Mum ate the biscuits and worked on ${name} about the flat.` : rank >= 4 ? `Mum liked the biscuits, and the flat.` : `Mum liked the biscuits.`);
    }
    return out([`mem:${p.id}:ignored`, ...(rank < 2 ? [`mem:${p.id}:mumWorried`] : [])], `Mum left a note: "Called. Nobody about."${rank < 2 ? ` She's working on ${name}.` : ''}`);
  },
  fixtures: [
    {
      name: 'a Grim flat',
      build(seed) {
        const sim = fixtureSim(seed, 6, 14);
        const [p] = letFlat(sim, 2, [['friendly', 'keenCook']]);
        settle(p);
        flatInfo(sim, p.life!.flat).tier = 'Grim';
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a Shabby flat, a worn shower',
      build(seed) {
        const sim = fixtureSim(seed, 6, 14);
        const [p] = letFlat(sim, 1, [['complainer', 'keenCook']]);
        settle(p);
        flatInfo(sim, p.life!.flat).tier = 'Shabby';
        inFlat(sim, p.life!.flat).find((f) => f.def === 'shower')!.wear = 0.9;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'a Nice flat',
      build(seed) {
        const sim = fixtureSim(seed, 6, 14);
        const p = sitting(sim)[0];
        flatInfo(sim, p.life!.flat).tier = 'Nice';
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 16. shouting next door

/** A couple who've gone off each other, at it in the night. Step in, or let the storyteller have them. */
const shouting: CardDef = {
  id: 'shouting',
  source: 'tenant',
  kind: 'moment',
  night: true,
  cooldownDays: 5,
  turnsOn: ['emptyFlat', 'trait:lightSleeper'],
  when(sim) {
    if (!isNightish(sim)) return [];
    const list: CardSubject[] = [];
    for (const a of tenants(sim)) {
      const b = pawnOf(sim, a.life!.partner);
      if (!b || !here(b) || a.id > b.id || b.life!.flat !== a.life!.flat || !home(a) || !home(b)) continue;
      const worst = Math.min(opinion(sim, a, b), opinion(sim, b, a));
      if (worst >= 0 || neighboursHome(sim, a.life!.flat).length === 0) continue;
      list.push({ pawn: a.id, flat: a.life!.flat, data: { partner: b.id }, weight: 1 + -worst / 20 });
    }
    return list;
  },
  hook: (sim, c) => `Shouting from ${flatName(sim, c.flat)}.`,
  text: (sim, c) => `Shouting from ${flatName(sim, c.flat)}. Something just hit the wall.`,
  name: (sim, c) => flatName(sim, c.flat),
  choices: () => [
    { label: 'Knock and check', note: 'They won\'t thank you' },
    { label: 'Stay out of it', note: 'Nobody sleeps' },
  ],
  resolve(sim, c, answer) {
    const a = who(sim, c);
    const b = pawnOf(sim, c.data?.partner)!;
    const flat = c.flat!;
    const fn = flatName(sim, flat);
    const near = neighboursHome(sim, flat);
    const sleepers = near.filter((n) => has(n.life!, 'lightSleeper'));
    if (answer === 0) {
      // With somewhere to go, one of them asks for it: they part, and quietly.
      const spare = sim.layout.flats.find((f) => !flatInfo(sim, f.id).lease && inFlat(sim, f.id).some((x) => x.def === 'bed' || x.def === 'doubleBed'));
      const parting = spare ? ['risk:breakup:1:14', 'risk:fight:-1:14'] : [];
      return out([`mem:${a.id}:toldOff`, `mem:${b.id}:toldOff`, ...near.map((n) => `mem:${n.id}:landlordListened`), ...parting], spare ? `It stopped. ${first(a)} asked about ${flatName(sim, spare.id)}, quietly.` : `You knocked. It stopped. Nobody said sorry.`);
    }
    if (answer === 1) return out([...near.map((n) => `mem:${n.id}:keptAwake`), ...sleepers.map((n) => `mem:${n.id}:keptAwake`), 'risk:fight:1:7', 'risk:breakup:1:7'], `You stayed out of it. So did nobody's sleep.`);
    return out([...near.flatMap((n) => [`mem:${n.id}:keptAwake`, `mem:${n.id}:keptAwake`, `mem:${n.id}:leftToIt`]), 'risk:fight:2:7', 'risk:breakup:2:7'], `It went on in ${fn} till two. The whole stairs heard.`);
  },
  fixtures: [
    {
      name: 'an empty flat to go to',
      build(seed) {
        const sim = fixtureSim(seed, 3, 23);
        const [a, b] = letFlat(sim, 2, [['partyAnimal', 'friendly'], ['complainer', 'nightOwl']]);
        couple(sim, a, b);
        return { sim, subject: { pawn: a.id, flat: a.life!.flat, data: { partner: b.id } } };
      },
    },
    {
      name: 'no spare flat, a light sleeper',
      build(seed) {
        const sim = fixtureSim(seed, 3, 23);
        const [a, b] = letFlat(sim, 2, [['partyAnimal', 'friendly'], ['complainer', 'nightOwl']]);
        letFlat(sim, 1, [['lightSleeper', 'easyGoing']]);
        couple(sim, a, b);
        return { sim, subject: { pawn: a.id, flat: a.life!.flat, data: { partner: b.id } } };
      },
    },
  ],
};

/** For fixtures: a couple who've had a fight and aren't over it. */
function couple(sim: Sim, a: Pawn, b: Pawn): void {
  settle(a, b);
  a.life!.partner = b.id;
  b.life!.partner = a.id;
  const at = sim.state.tick - TICKS_PER_HOUR;
  for (const [x, y] of [[a, b], [b, a]]) x.life!.social.push({ id: 'fight', about: y.id, at }, { id: 'row', about: y.id, at });
}

// ------------------------------------------------------------------ 17. a month up front

/** Money now and a promise, against good service, which raises the bar for everyone. */
const upFront: CardDef = {
  id: 'upFront',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 21,
  turnsOn: ['thing:broken', 'trait:complainer', 'trait:knowsRights', 'cash'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const p of tenants(sim)) {
      const life = p.life!;
      const lease = flatInfo(sim, life.flat).lease;
      if (!has(life, 'paysEarly') || !lease || lease.notice || (lease.prepaid ?? 0) > 0 || hasFlag(sim, 'noEarly', String(p.id))) continue;
      const broken = inFlat(sim, life.flat).find((f) => f.broken !== undefined);
      if (broken) list.push({ pawn: p.id, flat: life.flat, furniture: broken.id, weight: isBasic(broken) ? 2 : 1 });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} offers a month up front.`,
  text: (sim, c) => `${first(who(sim, c))}'ll pay a month up front if you fix the ${thingName(sim, c.furniture)} this week.`,
  choices: (sim, c) => {
    const lease = flatInfo(sim, c.flat!).lease;
    const f = sim.state.furniture.find((x) => x.id === c.furniture);
    return [
      { label: 'Deal', note: `£${((lease?.rent ?? 0) * 4) / POUND} now. Fix it by Friday` },
      { label: 'Fix it today', note: f ? `£${repairCost(f) / POUND}, and keep your money` : 'Keep your money' },
    ];
  },
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const flat = c.flat!;
    const lease = flatInfo(sim, flat).lease!;
    const thing = thingName(sim, c.furniture);
    if (answer === 0) return out([`pay:${lease.rent * 4}:Four weeks' rent up front · ${flatName(sim, flat)}`, `act:prepay:${flat}:28`, `promise:mend:${c.furniture}:5`], `${name} paid four weeks up front. The ${thing} had better be working by day ${sim.day + 5}.`);
    if (answer === 1) return out([`mend:${c.furniture}`, `mem:${p.id}:landlordListened`, 'expect:1', `chat:The ${thing}'s fixed. Same day.`], `The ${thing}'s fixed today. Word gets round: same-day repairs are the bar now.`);
    // Left broken. Someone who knows where to write, writes.
    const f = sim.state.furniture.find((x) => x.id === c.furniture);
    const writes = !!f && isBasic(f) && (has(p.life!, 'complainer') || has(p.life!, 'knowsRights'));
    return out([`mem:${p.id}:ignored`, `flag:noEarly:${p.id}:14`, ...(writes ? ['inspect:7:A tenant has told us of a broken ' + thing] : [])], `${name} stopped paying early. The ${thing} is still broken.${writes ? ' And the council have heard.' : ''}`);
  },
  fixtures: [
    {
      name: 'a complainer\'s cooker',
      build(seed) {
        const sim = fixtureSim(seed);
        const aisha = sitting(sim)[0];
        const cooker = inFlat(sim, aisha.life!.flat).find((f) => f.def === 'cooker')!;
        cooker.wear = 1;
        cooker.broken = sim.day - 1;
        return { sim, subject: { pawn: aisha.id, flat: aisha.life!.flat, furniture: cooker.id } };
      },
    },
    {
      name: 'an easy-going tenant\'s bed',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['paysEarly', 'easyGoing']]);
        settle(p);
        const bed = inFlat(sim, p.life!.flat).find((f) => f.def === 'bed')!;
        bed.wear = 1;
        bed.broken = sim.day - 1;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, furniture: bed.id } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 18. the deposit

/** A tenant on their way out wants all the deposit back. What the flat's really like, and what they know, decide it. */
const deposit: CardDef = {
  id: 'deposit',
  source: 'tenant',
  kind: 'moment',
  cooldownDays: 3,
  turnsOn: ['trait:messy', 'trait:houseProud', 'trait:knowsRights'],
  when(sim) {
    const list: CardSubject[] = [];
    for (const f of sim.layout.flats) {
      const lease = flatInfo(sim, f.id).lease;
      const people = household(sim, f.id).filter(here);
      if (!lease?.notice || lease.deposit <= 0 || people.length === 0) continue;
      const tatty = dirtOf(sim, f.id) > 0.3 || inFlat(sim, f.id).some((x) => (x.wear ?? 0) > UPKEEP.worn);
      if (tatty) list.push({ pawn: people[0].id, flat: f.id, data: { keep: Math.min(lease.deposit, 60 * POUND) }, weight: 1.5 });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} wants all the deposit back.`,
  text: (sim, c) => `${first(who(sim, c))} leaves on day ${flatInfo(sim, c.flat!).lease?.notice?.day ?? sim.day}. Wants the whole deposit. The flat disagrees.`,
  choices: (_sim, c) => [
    { label: 'All of it back', note: 'A kinder review' },
    { label: `Keep £${Number(c.data?.keep) / POUND}`, note: 'For the wear and tear' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const life = p.life!;
    const name = first(p);
    const keep = Number(c.data!.keep);
    const rest = others(sim, p).filter((o) => o.life!.flat !== c.flat);
    // A house-proud tenant left it better than they found it: keeping money is petty, and the stairs hear.
    const petty = has(life, 'houseProud') ? rest.map((o) => `mem:${o.id}:landlordShrugged`) : [];
    // Someone who knows their rights takes it to the deposit scheme, and wins.
    const disputes = has(life, 'knowsRights');
    if (answer === 0) {
      const carpet = has(life, 'messy') ? ['pay:-6000:New carpet after a tenant'] : [];
      return out([`mem:${p.id}:wholeDeposit`, 'expect:1', ...carpet], has(life, 'messy') ? `${name} got it all back. The carpet's on you.` : `${name} got it all back, and will say so.`);
    }
    if (answer === 1) {
      if (disputes) return out([`pay:${keep}:Kept from a deposit`, `pay:${-(keep + 30 * POUND)}:Deposit dispute: returned, plus the fee`, `mem:${p.id}:keptDeposit`, `tale:deposit:${p.id}`, ...petty], `${name} took it to the deposit scheme. You paid it back, and £30 on top.`);
      return out([`pay:${keep}:Kept from a deposit`, `mem:${p.id}:keptDeposit`, ...petty], has(life, 'houseProud') ? `You kept £${keep / POUND}. The flat was spotless, and the stairs know it.` : `You kept £${keep / POUND} for the damage. ${name} won't forget it.`);
    }
    const half = Math.round(keep / 2);
    const fight = disputes ? [`pay:${-(half + 30 * POUND)}:Deposit dispute: returned, plus the fee`, `tale:deposit:${p.id}`] : [];
    return out([`pay:${half}:Deposit split by Denise`, `mem:${p.id}:keptDeposit`, `mem:${p.id}:ignored`, ...fight, ...petty], `Denise split it. To ${name}, it was still you.${disputes ? ' They disputed it, and won.' : ''}`);
  },
  fixtures: [
    {
      name: 'messy',
      build: (seed) => depositFixture(seed, ['messy', 'friendly']),
    },
    {
      name: 'house-proud',
      build: (seed) => depositFixture(seed, ['houseProud', 'keenCook']),
    },
    {
      name: 'knows their rights',
      build: (seed) => depositFixture(seed, ['knowsRights', 'messy']),
    },
  ],
};

function depositFixture(seed: number, traits: string[]): { sim: Sim; subject: CardSubject } {
  const sim = fixtureSim(seed);
  const [p] = letFlat(sim, 1, [traits]);
  settle(p);
  const lease = flatInfo(sim, p.life!.flat).lease!;
  lease.notice = { by: 'tenant', why: 'Not renewing', day: sim.day + 3 };
  inFlat(sim, p.life!.flat).find((f) => f.def === 'bed')!.wear = 0.8;
  return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { keep: 60 * POUND } } };
}

// ------------------------------------------------------------------ 20. a key for the family

/** A retired tenant's family want a key, in case of a fall. Safety against a person's liberty. */
const familyKey: CardDef = {
  id: 'familyKey',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 28,
  turnsOn: ['friendsWith', 'locks', 'schedule:retired'],
  when(sim) {
    if (hasFlag(sim, 'familyKey')) return [];
    return tenants(sim)
      .filter((p) => p.life!.schedule === 'retired' && settled(sim, p, 14) && !remembers(sim, p, 'noKeyForFamily'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat }));
  },
  hook: (sim, c) => `${first(who(sim, c))}'s family want a key.`,
  text: (sim, c) => `${first(who(sim, c))}'s daughter wants a key to the front door. "In case of a fall."`,
  choices: (sim) => [
    { label: 'Cut her a key', note: sim.state.security.locks ? '£5. A key outside your locks' : '£5. One more key about' },
    { label: 'She can ring', note: 'Like everyone else' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const pals = others(sim, p).filter((o) => friends(sim, o, p));
    if (answer === 0) return out(['pay:-500:A key cut', `mem:${p.id}:landlordListened`, 'flag:familyKey'], `${name}'s daughter has a key. She'll pop in most days.`);
    if (answer === 1) return out([`mem:${p.id}:noKeyForFamily`, ...pals.map((o) => `mem:${o.id}:landlordShrugged`), 'thread:badTurn:240'], `No key. ${name}'s daughter rings the bell like everyone else.${pals.length > 0 ? ` ${name}'s friends think that's mean.` : ''}`);
    return out([`mem:${p.id}:ignored`, 'flag:familyKey', 'risk:burglary:1:14', ...pals.map((o) => `mem:${o.id}:landlordShrugged`)], `Nobody answered, so she had one cut from ${name}'s. A key you can't take back.`);
  },
  fixtures: [
    {
      name: 'Bill has a friend',
      build(seed) {
        const sim = fixtureSim(seed);
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        const [f] = letFlat(sim, 1, [['friendly', 'busybody']]);
        settle(f);
        const at = sim.state.tick - TICKS_PER_HOUR;
        for (let i = 0; i < 3; i++) f.life!.social.push({ id: 'deepTalk', about: bill.id, at });
        f.life!.social.push({ id: 'favour', about: bill.id, at });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'Bill has no friends, locks',
      build(seed) {
        const sim = fixtureSim(seed);
        sim.state.security.locks = true;
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

/** The follow-up to saying no to the key: a fall, and nobody about but the postie. */
const badTurn: CardDef = {
  id: 'badTurn',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 90,
  turnsOn: ['friendsWith'],
  when(sim, from) {
    const p = pawnOf(sim, from?.pawn);
    if (!p || !here(p) || hasFlag(sim, 'familyKey')) return [];
    return [{ pawn: p.id, flat: p.life!.flat }];
  },
  hook: (sim, c) => `${first(who(sim, c))} had a fall.`,
  text: (sim, c) => `${first(who(sim, c))} had a fall. Sandra the postie heard, and got help. Nobody else knew.`,
  choices: () => [
    { label: 'Cut a key now', note: 'For the family' },
    { label: 'Ask a neighbour', note: 'To look in each day' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const pals = others(sim, p).filter((o) => friends(sim, o, p));
    if (answer === 0) return out(['pay:-500:A key cut', `mem:${p.id}:landlordListened`, 'flag:familyKey', `tale:badTurn:${p.id}`], `${name}'s daughter has a key now. Late, but there.`);
    if (answer === 1) {
      // A friend is glad to; anyone else is asked, and a complainer minds.
      const n = pals[0] ?? others(sim, p).find(home) ?? others(sim, p)[0];
      if (!n) return out([`mem:${p.id}:landlordListened`, `tale:badTurn:${p.id}`], `Nobody to ask. You'll look in on ${name} yourself.`);
      const minds = !pals.includes(n) && has(n.life!, 'complainer');
      return out([minds ? `mem:${n.id}:landlordShrugged` : `mem:${n.id}:askedToHelp`, `soc:${p.id}:favour:${n.id}`, `tale:badTurn:${p.id}`], `${first(n)} will look in on ${name} each day.${minds ? ' Not happily.' : ''}`);
    }
    return out([`mem:${p.id}:leftToIt`, ...pals.map((o) => `mem:${o.id}:landlordShrugged`), `tale:badTurn:${p.id}`], `Nothing changed. ${name}'s friends are asking what it'll take.`);
  },
  fixtures: [
    {
      name: 'a friend downstairs',
      build(seed) {
        const sim = fixtureSim(seed, 14);
        const bill = sitting(sim)[1];
        const [f] = letFlat(sim, 1, [['friendly', 'keenCook']]);
        settle(f);
        const at = sim.state.tick - TICKS_PER_HOUR;
        for (let i = 0; i < 3; i++) f.life!.social.push({ id: 'deepTalk', about: bill.id, at });
        f.life!.social.push({ id: 'favour', about: bill.id, at });
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'only a complainer to ask',
      build(seed) {
        const sim = fixtureSim(seed, 14);
        const bill = sitting(sim)[1];
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 22. what was in the parcel?

/** The busybody wants to know what was in someone's parcel. Discretion against an informant who costs you that tenant's trust. */
const parcelGossip: CardDef = {
  id: 'parcelGossip',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 10,
  turnsOn: ['trait:busybody', 'friendsWith'],
  when(sim) {
    const since = sim.state.tick - TICKS_PER_DAY;
    const list: CardSubject[] = [];
    for (const b of tenants(sim).filter((p) => has(p.life!, 'busybody') && home(p))) {
      for (const d of others(sim, b)) if (d.life!.memories.some((m) => m.id === 'tookParcel' && m.at >= since && m.from === undefined)) list.push({ pawn: b.id, flat: b.life!.flat, data: { about: d.id } });
    }
    return list;
  },
  hook: (sim, c) => `${first(who(sim, c))} asks about ${first(pawnOf(sim, c.data?.about)!)}'s parcel.`,
  text: (sim, c) => `${first(who(sim, c))} asks if you know what was in ${first(pawnOf(sim, c.data?.about)!)}'s parcel. "Only it rattled."`,
  choices: () => [
    { label: 'Mind your own', note: 'Not your business' },
    { label: 'It rattled, apparently', note: 'You\'ll hear things back' },
  ],
  resolve(sim, c, answer) {
    const b = who(sim, c);
    const d = pawnOf(sim, c.data?.about)!;
    const close = friends(sim, b, d) || friends(sim, d, b);
    if (answer === 0) {
      // It gets back to them: always between friends, half the time otherwise.
      const hears = close || random(sim.state) < 0.5;
      return out([`mem:${b.id}:brushedOff`, ...(hears ? [`mem:${d.id}:keptMyBusiness`] : [])], hears ? `You told ${first(b)} to mind their own. ${first(d)} heard, and was glad.` : `You told ${first(b)} to mind their own.`);
    }
    if (answer === 1) {
      // A friend hears it from them; anyone else hears it from the stairs, and blames them too.
      return out([`mem:${b.id}:landlordListened`, `flag:informant:${b.id}:7`, 'thread:informant:48', `mem:${d.id}:landlordGossiped`, ...(close ? [] : [`soc:${d.id}:heardThings:${b.id}`])], `${first(b)} likes you now, and will be back with news. ${first(d)} knows you talked.`);
    }
    return out([`mem:${b.id}:ignored`, `soc:${b.id}:slight:${d.id}`, `soc:${d.id}:slight:${b.id}`], `${first(b)} asked ${first(d)} straight out, and said you wouldn't say.`);
  },
  fixtures: [
    {
      name: 'strangers',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'complainer']]);
        settle(b);
        const d = sitting(sim)[1];
        d.life!.memories.push({ id: 'tookParcel', at: sim.state.tick - TICKS_PER_HOUR });
        return { sim, subject: { pawn: b.id, flat: b.life!.flat, data: { about: d.id } } };
      },
    },
    {
      name: 'friends',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'friendly']]);
        settle(b);
        const d = sitting(sim)[1];
        d.life!.memories.push({ id: 'tookParcel', at: sim.state.tick - TICKS_PER_HOUR });
        const at = sim.state.tick - TICKS_PER_HOUR;
        for (const [x, y] of [[b, d], [d, b]]) {
          for (let i = 0; i < 3; i++) x.life!.social.push({ id: 'deepTalk', about: y.id, at });
          x.life!.social.push({ id: 'favour', about: y.id, at });
        }
        return { sim, subject: { pawn: b.id, flat: b.life!.flat, data: { about: d.id } } };
      },
    },
  ],
};

/** The follow-up to gossiping with the busybody: they're back, with something about a neighbour. */
const informant: CardDef = {
  id: 'informant',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 7,
  turnsOn: ['friendsWith', 'hiddenTraits'],
  when(sim, from) {
    const b = pawnOf(sim, from?.pawn);
    if (!b || !here(b) || !hasFlag(sim, 'informant', String(b.id))) return [];
    const t = others(sim, b).find((o) => o.life!.flat !== b.life!.flat && o.life!.traits.some((x) => !o.life!.revealed.includes(x)));
    if (!t) return [];
    return [{ pawn: b.id, flat: b.life!.flat, data: { about: t.id, trait: t.life!.traits.find((x) => !t.life!.revealed.includes(x))! } }];
  },
  hook: (sim, c) => `${first(who(sim, c))} has news about ${first(pawnOf(sim, c.data?.about)!)}.`,
  text: (sim, c) => `${first(who(sim, c))} has something to tell you about ${first(pawnOf(sim, c.data?.about)!)} in ${flatName(sim, pawnOf(sim, c.data?.about)!.life?.flat)}. In confidence.`,
  choices: () => [
    { label: 'Go on then', note: 'You\'ll know something' },
    { label: 'I\'d rather not', note: 'They\'ll be put out' },
  ],
  resolve(sim, c, answer) {
    const b = who(sim, c);
    const t = pawnOf(sim, c.data?.about)!;
    const trait = String(c.data?.trait);
    const close = friends(sim, b, t) || friends(sim, t, b);
    if (answer === 0) return out([`reveal:${t.id}:${trait}`, `mem:${b.id}:landlordListened`, ...(close ? [`mem:${t.id}:landlordGossiped`] : [])], `${first(b)} told you something about ${first(t)}.${close ? ` They're friends; ${first(t)} will hear you asked.` : ''}`);
    if (answer === 1) return out([`mem:${b.id}:brushedOff`, ...(close ? [`mem:${t.id}:keptMyBusiness`] : [])], `You didn't want to know. ${first(b)} was put out.`);
    return out([`mem:${b.id}:ignored`, ...others(sim, t).filter((o) => o !== b).map((o) => `soc:${o.id}:heardThings:${t.id}`)], `You didn't listen, so ${first(b)} told the rest of the stairs instead.`);
  },
  fixtures: [
    {
      name: 'about a stranger',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'complainer']]);
        settle(b);
        sim.state.drip.flags.push({ id: 'informant', subject: String(b.id), until: sim.state.tick + TICKS_PER_DAY });
        const t = sitting(sim)[1];
        return { sim, subject: { pawn: b.id, flat: b.life!.flat, data: { about: t.id, trait: t.life!.traits[0] } } };
      },
    },
    {
      name: 'about a friend',
      build(seed) {
        const sim = fixtureSim(seed);
        const [b] = letFlat(sim, 1, [['busybody', 'friendly']]);
        settle(b);
        sim.state.drip.flags.push({ id: 'informant', subject: String(b.id), until: sim.state.tick + TICKS_PER_DAY });
        const t = sitting(sim)[1];
        const at = sim.state.tick - TICKS_PER_HOUR;
        for (let i = 0; i < 3; i++) b.life!.social.push({ id: 'deepTalk', about: t.id, at });
        b.life!.social.push({ id: 'favour', about: t.id, at });
        return { sim, subject: { pawn: b.id, flat: b.life!.flat, data: { about: t.id, trait: t.life!.traits[0] } } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 26. kittens

/** The building cat's had kittens, and someone wants one. A tenant's heart against the pets precedent and next door. */
const kittens: CardDef = {
  id: 'kittens',
  source: 'tenant',
  kind: 'moment',
  cooldownDays: 90,
  icon: 'cat',
  turnsOn: ['trait:petOwner', 'trait:houseProud', 'trait:lightSleeper'],
  when(sim) {
    const cat = sim.state.cat;
    if (!cat || sim.day - cat.since < 21) return [];
    return tenants(sim)
      .filter((p) => home(p) && p.life!.pet === undefined && (has(p.life!, 'petOwner') || has(p.life!, 'friendly') || p.life!.schedule === 'retired'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: p.id === cat.favourite ? 3 : 1 }));
  },
  hook: (sim, c) => `Kittens in ${first(who(sim, c))}'s laundry basket.`,
  text: (sim, c) => `The cat's had kittens in ${first(who(sim, c))}'s laundry basket. ${first(who(sim, c))} would like one.`,
  choices: () => [
    { label: 'Let them keep one', note: 'Pets get harder to refuse' },
    { label: 'Homes for all', note: '£40 and the vet' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const rest = others(sim, p);
    const fans = rest.filter((o) => has(o.life!, 'petOwner'));
    if (answer === 0) return out([`act:pet:a kitten`, ...fans.map((o) => `mem:${o.id}:buildingCat`), 'flag:petPrecedent'], `${name} has a kitten. Everyone's seen it. Saying no to pets just got harder.`);
    if (answer === 1) return out(['pay:-4000:Vet: the cat done, kittens rehomed', `mem:${p.id}:sadAboutKitten`, 'flag:nextDoorFriendly'], `Homes for all, and no more kittens. Next door took two, and they're delighted.`);
    const minders = rest.filter((o) => !has(o.life!, 'petOwner'));
    return out(
      [`mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`, `mem:${p.id}:itchy`, ...fans.map((o) => `mem:${o.id}:buildingCat`), ...minders.map((o) => (has(o.life!, 'houseProud') || has(o.life!, 'lightSleeper') ? `mem:${o.id}:leftToIt` : `mem:${o.id}:catHair`)), 'flag:petPrecedent', `tale:kittens:${p.id}`],
      `Nobody decided, so there are four cats on the stairs now. And fleas.`,
    );
  },
  fixtures: [
    {
      name: 'a house-proud neighbour',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        sim.state.cat = { pawn: 0, since: 5 };
        letFlat(sim, 1, [['houseProud', 'lightSleeper']]);
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
    {
      name: 'a pet owner neighbour',
      build(seed) {
        const sim = fixtureSim(seed, 30);
        sim.state.cat = { pawn: 0, since: 5 };
        letFlat(sim, 1, [['petOwner', 'easyGoing']]);
        const bill = sitting(sim)[1];
        bill.life!.schedule = 'retired';
        return { sim, subject: { pawn: bill.id, flat: bill.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ 27 to 29: the old chat requests

const PETS = ['a cat', 'a small dog', 'a rabbit called Nigel'];
const petFor = (p: Pawn): string => PETS[p.id % PETS.length];

/** Can I get a pet? Yes is a pet on the map and a flat that wears; no costs more once there's a cat. */
const pet: CardDef = {
  id: 'pet',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 10,
  turnsOn: ['catOrDog', 'trait:lightSleeper', 'buildingCat'],
  when(sim) {
    return tenants(sim)
      .filter((p) => has(p.life!, 'petOwner') && p.life!.pet === undefined && settled(sim, p, REQUESTS.settleDays) && !remembers(sim, p, 'noPet') && !remembers(sim, p, 'noPetButCat'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, data: { pet: petFor(p) }, weight: 1.5 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants ${String(c.data?.pet ?? 'a pet')}.`,
  text: (sim, c) => `${first(who(sim, c))}: "Could I get ${String(c.data?.pet ?? 'a pet')}? Very well behaved. Mostly."`,
  choices: (sim) => [
    { label: 'Yes, go on', note: 'They\'ll love you for it' },
    { label: 'No pets, sorry', note: sim.state.cat || hasFlag(sim, 'petPrecedent') ? 'With a cat on the stairs?' : 'They won\'t' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const flat = c.flat!;
    const animal = String(c.data?.pet ?? petFor(p));
    const precedent = !!sim.state.cat || hasFlag(sim, 'petPrecedent');
    const no = precedent ? `mem:${p.id}:noPetButCat` : `mem:${p.id}:noPet`;
    if (answer === 0) {
      // A dog barks: light sleepers next door hold it against its owner.
      const next = new Set(neighboursOf(sim, flat));
      const woken = animal.includes('dog') ? tenants(sim).filter((o) => next.has(o.life!.flat) && has(o.life!, 'lightSleeper')).slice(0, 2) : [];
      return out([`act:pet:${animal}`, `flag:petWear:${flat}`, ...woken.map((o) => `soc:${o.id}:noise:${p.id}`), `chat:Yes, go on. ${name}'s getting ${animal}.`], `${name}'s getting ${animal}.${woken.length > 0 ? ' Next door will hear it.' : ''}`);
    }
    if (answer === 1) return out([no, 'chat:No pets, sorry.'], precedent ? `No pets, said the landlord with a cat on the stairs. ${name} noticed.` : `No pets. ${name} took it badly.`);
    // Unanswered is a no, as it always was; a third of them get one anyway.
    const anyway = random(sim.state) < 1 / 3;
    return out([`mem:${p.id}:ignored`, no, ...(anyway ? [`flag:petWear:${flat}`] : [])], anyway ? `Nobody answered ${name}. There's ${animal} at the window anyway.` : `Nobody answered ${name}, which is a no.`);
  },
  fixtures: [
    {
      name: 'a dog, a light sleeper next door',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['petOwner', 'friendly']]);
        settle(p);
        // Bill, upstairs, is the only neighbour Flat 2 has.
        sitting(sim)[1].life!.traits = ['lightSleeper', 'keenCook'];
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { pet: 'a small dog' } } };
      },
    },
    {
      name: 'a building cat already',
      build(seed) {
        const sim = fixtureSim(seed);
        sim.state.cat = { pawn: 0, since: 1 };
        const [p] = letFlat(sim, 1, [['petOwner', 'houseProud']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat, data: { pet: 'a cat' } } };
      },
    },
  ],
};

/** Is the heating on? Warmth and a bigger gas bill, or a jumper and maybe the council. */
const heating: CardDef = {
  id: 'heating',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 3,
  icon: 'cold',
  turnsOn: ['trait:knowsRights', 'temperature'],
  when(sim) {
    if (sim.state.boiler >= 3) return [];
    return tenants(sim)
      .filter((p) => home(p) && p.life!.needs.warmth < REQUESTS.coldUnder && !remembers(sim, p, 'wearAJumper'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: 1 + (REQUESTS.coldUnder - p.life!.needs.warmth) * 4 }));
  },
  hook: (sim, c) => `${first(who(sim, c))}: is the heating on?`,
  text: (sim, c) => `${first(who(sim, c))}: "Is the heating on? It's ${Math.round(tempOf(sim, c.flat!))}° in here."`,
  choices: () => [
    { label: 'Turn the boiler up', note: 'Warmer. Dearer gas all season' },
    { label: 'Try a jumper', note: 'Free. Unpopular' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const name = first(p);
    const all = tenants(sim);
    const cold = tempOf(sim, c.flat!) < COUNCIL.tooCold;
    const writes = has(p.life!, 'knowsRights');
    const jumpers = all.map((t) => `mem:${t.id}:wearAJumper`);
    if (answer === 0) return out(['act:boilerUp', 'chat:Turned the boiler up.'], 'You turned the boiler up. Everyone\'s warmer, and the gas bill knows it.');
    if (answer === 1) return out([...jumpers, ...(writes && cold ? ['inspect:3:A tenant has told us their flat is too cold to live in'] : []), 'chat:Try a jumper.'], writes && cold ? `${name} put on a jumper, and wrote to the council.` : 'Try a jumper, you said. The whole chat saw.');
    return out([`mem:${p.id}:ignored`, ...jumpers, ...(writes ? ['inspect:3:A tenant has told us their flat is too cold to live in'] : [])], writes ? `Nobody answered ${name}, so ${name} wrote to the council.` : `Nobody answered ${name}. The heating stayed as it was.`);
  },
  fixtures: [
    {
      name: 'knows their rights, too cold',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['knowsRights', 'lightSleeper']]);
        settle(p);
        p.life!.needs.warmth = 0.2;
        sim.state.temps[p.life!.flat] = 8;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'easy-going, chilly',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['easyGoing', 'keenCook']]);
        settle(p);
        p.life!.needs.warmth = 0.4;
        sim.state.temps[p.life!.flat] = 14;
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

/** Can I paint? A happy tenant and a flat in their colours, or magnolia and an easy let. */
const paint: CardDef = {
  id: 'paint',
  source: 'tenant',
  kind: 'ask',
  cooldownDays: 7,
  turnsOn: ['trait:houseProud', 'trait:handy', 'trait:messy', 'trait:clumsy'],
  when(sim) {
    return tenants(sim)
      .filter((p) => (has(p.life!, 'houseProud') || has(p.life!, 'handy')) && settled(sim, p, REQUESTS.settleDays) && !hasFlag(sim, 'painted', p.life!.flat) && !remembers(sim, p, 'noPaint') && !remembers(sim, p, 'gotToPaint'))
      .map((p) => ({ pawn: p.id, flat: p.life!.flat, weight: 0.6 }));
  },
  hook: (sim, c) => `${first(who(sim, c))} wants to paint the bedroom.`,
  text: (sim, c) => `${first(who(sim, c))}: "Can I paint the bedroom? I'll do it myself."`,
  choices: () => [
    { label: 'Go for it', note: 'Their colour. The next tenant\'s problem' },
    { label: 'Magnolia stays', note: 'Easy to let' },
  ],
  resolve(sim, c, answer) {
    const p = who(sim, c);
    const life = p.life!;
    const name = first(p);
    const flat = c.flat!;
    if (answer === 0) {
      // Messy or clumsy: some of it ends up on the furniture.
      const splashed = has(life, 'messy') || has(life, 'clumsy') ? inFlat(sim, flat).find((f) => ['sleep', 'sit'].includes(furnitureDef(f.def).group) && f.broken === undefined) : undefined;
      return out([`mem:${p.id}:gotToPaint`, `flag:painted:${flat}`, ...(splashed ? [`wear:${splashed.id}:${Math.min(0.95, Math.round(((splashed.wear ?? 0) + 0.25) * 100) / 100)}`] : []), 'chat:Go for it.'], splashed ? `${name} painted the bedroom. Some of the ${furnitureDef(splashed.def).name.toLowerCase()} too.` : `${name} painted the bedroom. It's very them.`);
    }
    if (answer === 1) return out([`mem:${p.id}:noPaint`, ...(has(life, 'houseProud') ? [`mem:${p.id}:landlordShrugged`] : []), 'chat:Magnolia stays.'], `Magnolia stays.${has(life, 'houseProud') ? ` ${name} minds more than most.` : ''}`);
    return out([`mem:${p.id}:ignored`, `mem:${p.id}:leftToIt`, `flag:painted:${flat}`], `Nobody answered, so ${name} painted it anyway.`);
  },
  fixtures: [
    {
      name: 'house-proud',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['houseProud', 'keenCook']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
    {
      name: 'handy and messy',
      build(seed) {
        const sim = fixtureSim(seed);
        const [p] = letFlat(sim, 1, [['handy', 'messy']]);
        settle(p);
        return { sim, subject: { pawn: p.id, flat: p.life!.flat } };
      },
    },
  ],
};

// ------------------------------------------------------------------ the catalogue

export const TENANT_CARDS: CardDef[] = [haggle, noise, lockout, drill, lodger, paysMore, mumVisit, shouting, upFront, deposit, familyKey, badTurn, parcelGossip, informant, kittens, pet, heating, paint];
