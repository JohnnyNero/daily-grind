// The first week (spec 3): the scripted cards only the handover's week brings (Bill's
// shopping, the cleaner's card, the bins question, the window cleaner, Bill's shower, a few
// people round...), and the script that times them, two a day. They're all `followUp: true`,
// so the ordinary drip never draws them; the drip plays FIRST_WEEK_SCRIPT in days 1 to 7
// instead of the daily budget, unless the handover was skipped.
//
// Every card obeys the consequence rule (1.0): two choices that differ in kind, each leaving
// something you can find again, and ignoring it worst. Money from cards in this week is
// capped at DRIP.firstWeekIncome (£150): the only money in is the scaffolding (£80) and a
// week's rent up front (£70 at most).

import { furnitureDef } from '../defs';
import { POUND, flatInfo } from '../economy';
import { skipHandover } from '../handover';
import { household, makePerson } from '../leases';
import { Sim as SimClass } from '../sim';
import type { Sim } from '../sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Card, type Pawn, type Person } from '../state';
import { moveIn } from '../tenants';
import { TIER_THOUGHTS } from '../tuning';
import { STOREY } from '../start';
import { repairCost } from '../upkeep';
import type { CardChoice, CardDef, CardFixture, CardSubject, Outcome, ScriptBeat } from './types';

// ------------------------------------------------------------------ finding people

const first = (p: Pawn) => p.name.split(' ')[0];
const pawnOf = (sim: Sim, id: number | undefined): Pawn | undefined => (id === undefined ? undefined : sim.state.pawns.find((p) => p.id === id));
const tenants = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life && !p.life.leaving);
const homeNow = (sim: Sim): Pawn[] => tenants(sim).filter((p) => !p.life!.away);
const isBill = (p: Pawn) => p.name.startsWith('Bill ');
const has = (p: Pawn, trait: string) => p.life!.traits.includes(trait);

/** Bill, if he's in. */
const billHome = (sim: Sim): Pawn | undefined => homeNow(sim).find(isBill);

/** Whoever's been here least time (the newest tenant), else whoever's home. */
function newest(sim: Sim): Pawn | undefined {
  return [...homeNow(sim)].sort((a, b) => b.life!.since - a.life!.since || b.id - a.id)[0];
}

/** Everyone else in the building, at home or not. */
const others = (sim: Sim, p: Pawn): Pawn[] => tenants(sim).filter((o) => o.id !== p.id);

/** A trait of theirs you haven't seen yet: the first one, or none. */
const hiddenOf = (p: Pawn): string | undefined => p.life!.traits.find((t) => !p.life!.revealed.includes(t));
const revealFx = (p: Pawn): string[] => {
  const t = hiddenOf(p);
  return t ? [`reveal:${p.id}:${t}`] : [];
};

function subjectOf(sim: Sim, card: Card): Pawn {
  const p = pawnOf(sim, card.pawn);
  if (!p) throw new Error(`Card ${card.def} has no one to be about`);
  return p;
}

const one = (p: Pawn | undefined): CardSubject[] => (p ? [{ pawn: p.id }] : []);

/** Bill's shower, and who lives under it. */
function showerOf(sim: Sim, bill: Pawn): { shower: ReturnType<typeof findShower>; below: Pawn[] } {
  const shower = findShower(sim, bill);
  const below = shower ? sim.layout.flatAt(shower.x, shower.s - STOREY) : undefined;
  return { shower, below: below ? household(sim, below.id) : [] };
}

function findShower(sim: Sim, bill: Pawn) {
  const lay = sim.layout;
  return sim.state.furniture.find((f) => f.def === 'shower' && lay.flatAt(f.x, f.s)?.id === bill.life!.flat);
}

/** The usual three: A, B, and what the world does with no answer. */
const outcome = (effects: string[], notice: string): Outcome => ({ effects, notice });

// Fixture builders. rule.ts has the same three, but it imports the catalogue, which imports
// this file, so these are copied rather than imported.

/** The starting building at a day and hour, handover out of the way. */
function fixtureSim(seed: number, day: number, hour: number): Sim {
  const sim = SimClass.create(seed);
  skipHandover(sim);
  sim.state.pawns = sim.state.pawns.filter((p) => p.life);
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  return sim;
}

/** The sitting tenants: [Flat 1's, Bill]. */
const sitting = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life?.flat && flatInfo(sim, p.life.flat).lease?.sitting);

/** Lets a flat (by its place in the layout) to one person per entry, with these traits. */
function letFlat(sim: Sim, flatIndex: number, people: string[][], rent = 100 * POUND): Pawn[] {
  const f = sim.layout.flats[flatIndex];
  const info = flatInfo(sim, f.id);
  info.lease = { rent, startDay: sim.day, endDay: sim.day + 42, deposit: rent * 4, owed: 0, paid: 0, late: 0 };
  info.listed = false;
  const persons: Person[] = people.map((traits) => ({ ...makePerson(sim.state, undefined, false), traits }));
  return moveIn(sim, f.id, persons, persons[0]?.traits ?? []);
}

/** A fixture on the starting building: tweak it, and say who the card is about. */
function fx(name: string, day: number, hour: number, build: (sim: Sim) => CardSubject): CardFixture {
  return {
    name,
    build(seed) {
      const sim = fixtureSim(seed, day, hour);
      return { sim, subject: build(sim) };
    },
  };
}

/** Flat 1's tenant, and Bill. */
const flatOne = (sim: Sim): Pawn => sitting(sim).find((p) => !isBill(p))!;
const bill = (sim: Sim): Pawn => sitting(sim).find(isBill)!;

/** Makes a trait known or not, so a fixture can vary what a card can show. */
function setTraits(p: Pawn, traits: string[], revealed: string[] = []): void {
  p.life!.traits = traits;
  p.life!.revealed = revealed;
}

const mem = (p: Pawn | number, id: string) => `mem:${typeof p === 'number' ? p : p.id}:${id}`;

// ================================================================== day 1

const billsShopping: CardDef = {
  id: 'billsShopping',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['hiddenTraits'],
  when: (sim) => one(billHome(sim)),
  hook: () => 'Bill and his shopping.',
  text: () => "Bill's on the stairs with two bags and one good knee. He's not asking.",
  choices: () => [
    { label: 'Carry it up', note: '' },
    { label: "He'll manage", note: '' },
  ],
  resolve(sim, card, answer) {
    const b = subjectOf(sim, card);
    if (answer === 0) return outcome([mem(b, 'landlordListened'), ...revealFx(b)], "You carried Bill's bags up. He told you about his knee, and a few other things.");
    if (answer === 1) return outcome([mem(b, 'brushedOff'), 'thread:billStairsAsk:336'], 'Bill managed. It took a while, and he noticed you watching.');
    return outcome([mem(b, 'leftToIt'), 'thread:billStairsAsk:336'], 'Bill got his shopping up by himself, a stair at a time.');
  },
  fixtures: [
    fx('a trait to show', 1, 11, (sim) => ({ pawn: bill(sim).id })),
    fx('known already', 1, 11, (sim) => {
      const b = bill(sim);
      setTraits(b, b.life!.traits, [...b.life!.traits]);
      return { pawn: b.id };
    }),
  ],
};

/** Three weeks on: Bill and the stairs. Only ever comes from `billsShopping`. */
const billStairsAsk: CardDef = {
  id: 'billStairsAsk',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['emptyFlat'],
  when: (sim, from) => one(pawnOf(sim, from?.pawn ?? billHome(sim)?.id)),
  hook: () => 'Bill asks about downstairs.',
  text: () => "Bill: 'The stairs are getting me. Any chance of a ground-floor flat?'",
  choices: () => [
    { label: "I'll look into it", note: '' },
    { label: 'Stairs keep you fit', note: 'Free' },
  ],
  resolve(sim, card, answer) {
    const b = subjectOf(sim, card);
    const room = sim.layout.flats.some((f) => !flatInfo(sim, f.id).lease);
    if (answer === 0) {
      // With an empty flat to put him in it's a real plan; without, it's only a promise to keep in mind.
      return room ? outcome([mem(b, 'landlordListened'), 'flag:billWantsDown'], "You told Bill you'd look into it. He's holding you to that.") : outcome([mem(b, 'waitedForRepair')], "There's nowhere to put him yet. Bill said that was fine. His face said otherwise.");
    }
    if (answer === 1) return outcome([mem(b, 'landlordShrugged')], 'You told Bill the stairs would keep him fit. He went quiet.');
    return outcome([mem(b, 'ignored'), mem(b, 'leftToIt')], "Bill stopped asking. That isn't the same as being satisfied.");
  },
  fixtures: [
    { name: 'empty flats', build: (seed) => { const sim = fixtureSim(seed, 15, 10); return { sim, subject: { pawn: bill(sim).id } }; } },
    {
      name: 'building full',
      build(seed) {
        const sim = fixtureSim(seed, 15, 10);
        for (const i of [1, 2, 4]) letFlat(sim, i, [['easyGoing']]);
        return { sim, subject: { pawn: bill(sim).id } };
      },
    },
  ],
};

const keysOnMat: CardDef = {
  id: 'keysOnMat',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['locks'],
  when: (sim) => one(homeNow(sim)[0]),
  hook: () => 'Spare keys on the mat.',
  text: () => "Mr Pritchard (the old owner) posted his spare keys back. Who else has a set?",
  choices: (sim) => [
    { label: 'Change the locks', note: sim.state.security.locks ? 'Already done' : '£60' },
    { label: 'Post them back', note: 'Free' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const locked = sim.state.security.locks;
    if (answer === 0) return outcome([...(locked ? [] : ['pay:-6000:Locksmith']), mem(p, 'itsYourJob')], locked ? 'The locks are new already. You binned the old keys.' : 'You had the locks changed. Pritchard can keep his set.');
    if (answer === 1) {
      return locked
        ? outcome([mem(p, 'itsYourJob'), `tale:pritchard:${p.id}`], 'You posted Pritchard his keys. They are no use to anyone now, which is how you like it.')
        : outcome([mem(p, 'landlordShrugged'), 'flag:strayKey', 'risk:burglary:1:3', `tale:pritchard:${p.id}`], 'You posted the keys back. Whoever has the other set can still let themselves in.');
    }
    return locked ? outcome([mem(p, 'leftToIt'), `tale:pritchard:${p.id}`], 'The keys sat on the mat until someone moved them.') : outcome([mem(p, 'leftToIt'), 'flag:strayKey', 'risk:burglary:2:3', `tale:pritchard:${p.id}`], 'The keys sat on the mat all night. Someone tidied them away. Not a tenant.');
  },
  fixtures: [
    fx('old locks', 1, 20, (sim) => ({ pawn: flatOne(sim).id })),
    fx('new locks', 1, 20, (sim) => {
      sim.state.security.locks = true;
      return { pawn: flatOne(sim).id };
    }),
  ],
};

// ================================================================== day 2

const cleanerCard: CardDef = {
  id: 'cleanerCard',
  source: 'street',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:houseProud', 'hiddenTraits'],
  when: (sim) => (sim.state.cleaner ? [] : one(homeNow(sim).find((p) => has(p, 'houseProud')) ?? homeNow(sim)[0])),
  hook: () => "A cleaner's card on the mat.",
  text: () => "Lorraine: stairs done every morning, £30 a week. She hears everything.",
  choices: () => [
    { label: 'Take her on', note: '£30 a week' },
    { label: 'Not yet', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const proud = has(p, 'houseProud');
    if (answer === 0) return outcome([mem(p, 'stairsDone'), 'flag:lorraine', ...revealFx(p)], 'Lorraine starts tomorrow. By the end of the week she will know more about the building than you.');
    if (answer === 1) return outcome([mem(p, proud ? 'landlordShrugged' : 'brushedOff'), 'flag:muckyStairs::7'], 'You said not yet. The stairs said nothing, but they were thinking it.');
    return outcome([mem(p, 'leftToIt'), ...(proud ? [mem(p, 'ignored')] : []), 'flag:muckyStairs::14'], 'The card sat on the mat and got trodden on. So did the stairs.');
  },
  fixtures: [
    fx('house-proud', 2, 8, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['houseProud', 'paysEarly']);
      return { pawn: p.id };
    }),
    fx('easy-going', 2, 8, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['easyGoing', 'paysEarly'], ['easyGoing', 'paysEarly']);
      return { pawn: p.id };
    }),
  ],
};

const binsQuestion: CardDef = {
  id: 'binsQuestion',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:friendly', 'newest tenant'],
  when(sim) {
    const p = newest(sim);
    const o = p ? (others(sim, p).find(isBill) ?? others(sim, p)[0]) : undefined;
    return p && o ? [{ pawn: p.id, data: { other: o.id } }] : [];
  },
  hook: (sim, card) => `${first(subjectOf(sim, card))} can't find the bins.`,
  text: (sim, card) => `${first(subjectOf(sim, card))} is stood in the lobby with a bag of rubbish and no idea.`,
  choices: () => [
    { label: 'Show them', note: '' },
    { label: 'Point', note: 'Out the back, left' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const o = Number(card.data?.other);
    if (answer === 0) return outcome([mem(p, 'landlordListened'), `soc:${p.id}:chat:${o}`, ...(has(p, 'friendly') ? [`soc:${o}:chat:${p.id}`] : [])], 'You walked them out to the bins. They met Bill on the way, and Bill had views on recycling.');
    if (answer === 1) return outcome([mem(p, 'brushedOff'), `soc:${o}:slight:${p.id}`, 'flag:wrongBin::7'], 'You pointed. Their recycling went in the wrong bin all week, and Bill noticed.');
    return outcome([mem(p, 'leftToIt'), `soc:${o}:slight:${p.id}`, `soc:${p.id}:slight:${o}`, 'flag:wrongBin::7'], 'Nobody told them. The bags went in the wrong bin, and two people have opinions about it.');
  },
  fixtures: [
    fx('friendly newcomer', 2, 19, (sim) => {
      const [n] = letFlat(sim, 1, [['friendly', 'easyGoing']]);
      return { pawn: n.id, data: { other: bill(sim).id } };
    }),
    fx('easy-going newcomer', 2, 19, (sim) => {
      const [n] = letFlat(sim, 1, [['easyGoing', 'keenCook']]);
      return { pawn: n.id, data: { other: bill(sim).id } };
    }),
  ],
};

// ================================================================== day 3

/** The shower's repair, as pounds in a button's note. */
const quote = (sim: Sim, shower: { wear?: number; def: string; id: number } | undefined): string => {
  const f = sim.state.furniture.find((x) => x.id === shower?.id);
  return f ? `£${Math.round(repairCost(f) / POUND)}` : '£80';
};

const billsShower: CardDef = {
  id: 'billsShower',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['who is below'],
  when(sim, from) {
    const b = pawnOf(sim, from?.pawn) ?? billHome(sim);
    if (!b || b.life!.away) return [];
    const { shower, below } = showerOf(sim, b);
    if (!shower || shower.broken !== undefined || (shower.wear ?? 0) < 0.8) return [];
    return [{ pawn: b.id, furniture: shower.id, flat: b.life!.flat, ...(below[0] ? { data: { below: below[0].id } } : {}) }];
  },
  hook: () => "Bill's shower is dripping through.",
  text: (sim, card) => (card.data?.below ? `Water through ${sim.layout.flat(belowFlat(sim, card))?.name ?? 'the flat below'}'s ceiling. It's Bill's shower.` : "Bill's shower is dripping onto the floor. The floor has noticed."),
  choices: (sim, card): [CardChoice, CardChoice] => [
    { label: 'Plumber', note: quote(sim, sim.state.furniture.find((f) => f.id === card.furniture)) },
    { label: 'Bucket and towel', note: 'Free' },
  ],
  resolve(sim, card, answer) {
    const b = subjectOf(sim, card);
    const under = pawnOf(sim, Number(card.data?.below) || undefined);
    const f = card.furniture!;
    if (answer === 0) return outcome([`mend:${f}`, mem(b, 'landlordListened'), ...(under ? [mem(under, 'landlordListened')] : [])], 'The plumber came. He tutted at the pipes and said the rest of the building was probably the same.');
    if (answer === 1) return outcome([mem(b, 'waitedForRepair'), `thread:showerAgain:48`, `tale:leak:${b.id}`, ...(under ? [`soc:${under.id}:leakedOnMe:${b.id}`] : [])], 'A bucket under the shower, and a towel over the problem. It will drip again.');
    return outcome([mem(b, 'leftToIt'), `wear:${f}:1`, `tale:leak:${b.id}`, ...(under ? [mem(under, 'leftToIt'), `soc:${under.id}:leakedOnMe:${b.id}`] : [])], 'Nobody came. The shower gave up in the night, and the ceiling below gave up with it.');
  },
  fixtures: [
    {
      name: 'flat below let',
      build(seed) {
        const sim = fixtureSim(seed, 3, 10);
        const b = bill(sim);
        const { shower } = showerOf(sim, b);
        const below = sim.layout.flatAt(shower!.x, shower!.s - STOREY)!;
        const idx = sim.layout.flats.findIndex((f) => f.id === below.id);
        const [n] = letFlat(sim, idx, [['easyGoing']]);
        return { sim, subject: { pawn: b.id, furniture: shower!.id, flat: b.life!.flat, data: { below: n.id } } };
      },
    },
    {
      name: 'flat below empty',
      build(seed) {
        const sim = fixtureSim(seed, 3, 10);
        const b = bill(sim);
        const { shower } = showerOf(sim, b);
        return { sim, subject: { pawn: b.id, furniture: shower!.id, flat: b.life!.flat } };
      },
    },
  ],
};

function belowFlat(sim: Sim, card: Card): string {
  return pawnOf(sim, Number(card.data?.below))?.life?.flat ?? '';
}

/** Two days after the bucket: it's back. */
const showerAgain: CardDef = {
  id: 'showerAgain',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['who is below'],
  when(sim, from) {
    const b = pawnOf(sim, from?.pawn) ?? billHome(sim);
    if (!b) return [];
    const { shower, below } = showerOf(sim, b);
    if (!shower || shower.broken !== undefined || (shower.wear ?? 0) < 0.8) return [];
    return [{ pawn: b.id, furniture: shower.id, flat: b.life!.flat, ...(below[0] ? { data: { below: below[0].id } } : {}) }];
  },
  hook: () => "The shower's dripping again.",
  text: () => "Bill's shower again. The bucket's full and so is Bill's patience.",
  choices: (sim, card): [CardChoice, CardChoice] => [
    { label: 'Plumber now', note: quote(sim, sim.state.furniture.find((f) => f.id === card.furniture)) },
    { label: 'One more week', note: 'Free' },
  ],
  resolve(sim, card, answer) {
    const b = subjectOf(sim, card);
    const under = pawnOf(sim, Number(card.data?.below) || undefined);
    const f = card.furniture!;
    if (answer === 0) return outcome([`mend:${f}`, mem(b, 'keptPromise'), ...(under ? [mem(under, 'landlordListened')] : [])], 'The plumber came at last. Bill gave him a biscuit.');
    if (answer === 1) return outcome([`wear:${f}:0.97`, mem(b, 'waitedForRepair'), ...(under ? [`soc:${under.id}:leakedOnMe:${b.id}`] : [])], 'Another week of bucket. The shower is hanging on by a washer.');
    return outcome([`wear:${f}:1`, mem(b, 'leftToIt'), ...(under ? [mem(under, 'leftToIt')] : [])], 'The shower broke for good, which at least stopped the dripping.');
  },
  fixtures: billsShower.fixtures,
};

const windowMan: CardDef = {
  id: 'windowMan',
  source: 'street',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:houseProud'],
  when: (sim) => one(homeNow(sim).find((p) => has(p, 'houseProud')) ?? homeNow(sim)[0]),
  hook: () => 'Window cleaner at the door.',
  text: () => 'A man with a ladder: £15 a month, windows done. Says he is cheaper than rain.',
  choices: () => [
    { label: '£15 a month', note: '' },
    { label: 'No ta', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const proud = has(p, 'houseProud');
    if (answer === 0) return outcome(['pay:-1500:Window cleaner', 'flag:cleanWindows', mem(p, 'landlordListened')], 'The windows are done. The light in the flats is a touch better, and the house-proud have noticed.');
    if (answer === 1) return outcome([mem(p, proud ? 'landlordShrugged' : 'brushedOff'), 'flag:grimyWindows::56'], 'You said no. The windows will get on with being grimy.');
    return outcome([mem(p, 'leftToIt'), ...(proud ? [mem(p, 'ignored')] : []), 'flag:grimyWindows::56'], 'The man with the ladder went next door. The windows stayed as they were.');
  },
  fixtures: [
    fx('house-proud', 3, 15, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['houseProud', 'paysEarly']);
      return { pawn: p.id };
    }),
    fx('easy-going', 3, 15, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['easyGoing', 'paysEarly']);
      return { pawn: p.id };
    }),
  ],
};

// ================================================================== day 4

const gasMeterFirst: CardDef = {
  id: 'gasMeterFirst',
  source: 'street',
  kind: 'door',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['locks', 'who is home'],
  when: (sim) => one(homeNow(sim).find((p) => has(p, 'busybody')) ?? homeNow(sim)[0]),
  hook: () => 'Gas man at the door.',
  text: () => 'The man from the gas wants to read the meter. He has a lanyard.',
  choices: () => [
    { label: 'Let him in', note: '' },
    { label: 'Appointment first', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const locked = sim.state.security.locks;
    if (answer === 0) return outcome([mem(p, 'keptAnEye'), ...(locked ? [] : ['risk:burglary:1:3'])], locked ? `${first(p)} followed him round. The meter was read, the lanyard was real.` : `${first(p)} followed him round. Nothing went missing, but the door was open to anyone with a lanyard.`);
    if (answer === 1) return outcome([mem(p, 'keptMyBusiness'), 'flag:estimated::14'], 'He went away. The next bill will be an estimate, and a high one.');
    return outcome([mem(p, 'leftToIt'), 'flag:estimated::14', `risk:burglary:${locked ? 1 : 2}:3`], 'Someone buzzed him in and nobody watched. Whether he was from the gas is anyone\'s guess.');
  },
  fixtures: [
    fx('no locks', 4, 9, (sim) => ({ pawn: bill(sim).id })),
    fx('locks', 4, 9, (sim) => {
      sim.state.security.locks = true;
      return { pawn: bill(sim).id };
    }),
  ],
};

const scaffoldNextDoor: CardDef = {
  id: 'scaffoldNextDoor',
  source: 'street',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['alarm', 'top floor'],
  when: (sim) => one(billHome(sim) ?? homeNow(sim)[0]),
  hook: () => 'Next door want to scaffold.',
  text: () => "Next door's builders want to scaffold your wall for a fortnight. £80.",
  choices: () => [
    { label: 'Take the £80', note: '' },
    { label: 'No', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const alarmed = sim.state.security.alarm;
    const up = [mem(p, 'scaffolding'), ...(alarmed ? [] : ['risk:burglary:1:14'])];
    if (answer === 0) return outcome(['pay:8000:Next door\'s builders', ...up, 'flag:nextDoorFriendly'], 'Up it goes. Next door are pleased, and the top-floor windows have a new neighbour.');
    if (answer === 1) return outcome(['flag:nextDoorSore', mem(p, 'keptMyBusiness')], 'You said no. Next door are put out, and their builders start at seven anyway.');
    return outcome([mem(p, 'leftToIt'), ...up], 'Silence counted as yes. The scaffolding is up, and you did not get the £80.');
  },
  fixtures: [
    fx('no alarm', 4, 19, (sim) => ({ pawn: bill(sim).id })),
    fx('alarm', 4, 19, (sim) => {
      sim.state.security.alarm = true;
      return { pawn: bill(sim).id };
    }),
  ],
};

// ================================================================== day 5

const newcomerAsks: CardDef = {
  id: 'newcomerAsks',
  source: 'tenant',
  kind: 'ask',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:handy', 'neighbours'],
  when: (sim) => one(newest(sim)),
  hook: (sim, card) => `${first(subjectOf(sim, card))} wants a shelf up.`,
  text: (sim, card) => `${first(subjectOf(sim, card))} wants to put shelves up. With a drill. Today.`,
  choices: () => [
    { label: 'Go on then', note: 'Drilling, daytime' },
    { label: 'Not in the walls', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const next = others(sim, p).find((o) => !o.life!.away);
    if (answer === 0) {
      // A handy tenant does it quietly and well; anyone else makes a racket.
      return has(p, 'handy')
        ? outcome([mem(p, 'landlordListened'), ...revealFx(p)], `${first(p)} put the shelves up in ten minutes flat. Dead straight, too.`)
        : outcome([mem(p, 'landlordListened'), ...(next ? [`soc:${next.id}:noise:${p.id}`] : [])], `${first(p)} drilled for an hour. Most of it went in the wall.`);
    }
    if (answer === 1) return outcome([mem(p, 'notTrusted')], `${first(p)} will keep the shelves on the floor. They said nothing, loudly.`);
    return outcome([mem(p, 'ignored'), mem(p, 'leftToIt')], `${first(p)} put them up anyway. You'll be hearing about the hole.`);
  },
  fixtures: [
    fx('handy', 5, 14, (sim) => {
      const [n] = letFlat(sim, 1, [['handy', 'easyGoing']]);
      return { pawn: n.id };
    }),
    fx('not handy', 5, 14, (sim) => {
      const [n] = letFlat(sim, 1, [['clumsy', 'easyGoing']]);
      return { pawn: n.id };
    }),
  ],
};

const friendsRound: CardDef = {
  id: 'friendsRound',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:lightSleeper'],
  when(sim) {
    const p = newest(sim);
    return p && others(sim, p).length > 0 ? one(p) : [];
  },
  hook: (sim, card) => `${first(subjectOf(sim, card))} has people coming.`,
  text: (sim, card) => `${first(subjectOf(sim, card))} is having a few people round tonight. All right?`,
  choices: () => [
    { label: 'Fine', note: '' },
    { label: 'Keep it down', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const rest = others(sim, p);
    const light = rest.filter((o) => has(o, 'lightSleeper'));
    if (answer === 0) return outcome([mem(p, 'threwParty'), ...light.map((o) => mem(o, 'keptAwake')), 'risk:party:1:7'], `${first(p)}'s friends came. A good night for them, and ${light.length ? 'not for the light sleepers' : 'nobody complained'}.`);
    if (answer === 1) return outcome([mem(p, 'toldOff'), ...rest.map((o) => mem(o, 'landlordListened'))], `${first(p)} kept it down. The neighbours slept, and ${first(p)} remembers who made it so.`);
    return outcome([mem(p, 'leftToIt'), ...rest.map((o) => mem(o, 'keptAwake')), 'risk:party:1:7'], 'Nobody said anything, so it went on. Everyone in the building heard it.');
  },
  fixtures: [
    fx('a light sleeper below', 5, 19, (sim) => {
      const [n] = letFlat(sim, 1, [['partyAnimal', 'friendly']]);
      setTraits(bill(sim), ['lightSleeper', 'easyGoing']);
      return { pawn: n.id };
    }),
    fx('sound sleepers', 5, 19, (sim) => {
      const [n] = letFlat(sim, 1, [['partyAnimal', 'friendly']]);
      setTraits(bill(sim), ['easyGoing', 'keenCook']);
      return { pawn: n.id };
    }),
  ],
};

// ================================================================== day 6

/** The worst-worn thing in Bill's flat, for a promise. */
function wornThing(sim: Sim, b: Pawn): number | undefined {
  const lay = sim.layout;
  const worn = sim.state.furniture
    .filter((f) => lay.flatAt(f.x, f.s)?.id === b.life!.flat && f.broken === undefined && !furnitureDef(f.def).decor)
    .sort((x, y) => (y.wear ?? 0) - (x.wear ?? 0))[0];
  return worn?.id;
}

const tierOk = (sim: Sim, b: Pawn): boolean => (TIER_THOUGHTS[flatInfo(sim, b.life!.flat).tier] ?? 0) >= 0;

const billsDaughter: CardDef = {
  id: 'billsDaughter',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['flat tier'],
  when: (sim) => one(billHome(sim)),
  hook: () => "Bill's daughter wants a word.",
  text: () => "Bill's daughter is on the stairs, looking at the damp and then at you.",
  choices: () => [
    { label: 'Say hello', note: '' },
    { label: 'Send up biscuits', note: '£5' },
  ],
  resolve(sim, card, answer) {
    const b = subjectOf(sim, card);
    const ok = tierOk(sim, b);
    const thing = wornThing(sim, b);
    if (answer === 0) {
      return ok
        ? outcome([mem(b, 'mumApproved'), mem(b, 'landlordListened')], "You said hello. She looked round Bill's flat and nodded, which from her is a lot.")
        : outcome([mem(b, 'mumWorried'), mem(b, 'landlordListened'), ...(thing !== undefined ? [`promise:mend:${thing}:7`] : [])], "She made a list of what's wrong with Bill's flat. You said you'd see to the worst of it.");
    }
    if (answer === 1) return outcome(['pay:-500:Biscuits', mem(b, 'landlordListened'), ...(ok ? [] : [mem(b, 'mumWorried')])], ok ? 'Biscuits went up. She was impressed anyway.' : 'Biscuits went up. She ate them and worked on her dad all the same.');
    return outcome([mem(b, 'ignored'), mem(b, 'leftToIt'), ...(ok ? [] : [mem(b, 'mumWorried')])], 'She left a note: "Called. Nobody about." Bill read it twice.');
  },
  fixtures: [
    fx('a decent flat', 6, 11, (sim) => {
      const b = bill(sim);
      flatInfo(sim, b.life!.flat).tier = 'Nice';
      return { pawn: b.id };
    }),
    fx('a grim flat', 6, 11, (sim) => {
      const b = bill(sim);
      flatInfo(sim, b.life!.flat).tier = 'Grim';
      return { pawn: b.id };
    }),
  ],
};

const lockedOutFirst: CardDef = {
  id: 'lockedOutFirst',
  source: 'tenant',
  kind: 'moment',
  night: true,
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:lightSleeper', 'who is awake'],
  when: (sim) => one(tenants(sim).find((p) => has(p, 'clumsy')) ?? flatOne(sim)),
  hook: (sim, card) => `${first(subjectOf(sim, card))}'s locked out.`,
  text: (sim, card) => `${first(subjectOf(sim, card))} is locked out and sat on the step in the rain.`,
  choices: () => [
    { label: 'Let them in', note: '' },
    { label: 'Key under the mat', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const light = others(sim, p).filter((o) => has(o, 'lightSleeper'));
    if (answer === 0) return outcome([mem(p, 'helpedLockout'), `flag:owes:${p.id}:30`, ...light.map((o) => mem(o, 'keptAwake'))], `You let ${first(p)} in. They clattered up the stairs, grateful and not quiet.`);
    if (answer === 1) return outcome([mem(p, 'itsYourJob'), 'flag:keyUnderMat'], `${first(p)} found the key. It's under the mat now for good, and so is the street door's dignity.`);
    return outcome([mem(p, 'leftToIt'), `tale:lockout:${p.id}`], `${first(p)} sat in the rain until a neighbour let them in. They remember who didn't.`);
  },
  fixtures: [
    fx('a light sleeper upstairs', 6, 23, (sim) => {
      setTraits(bill(sim), ['lightSleeper', 'easyGoing']);
      return { pawn: flatOne(sim).id };
    }),
    fx('sound sleepers', 6, 23, (sim) => {
      setTraits(bill(sim), ['easyGoing', 'keenCook']);
      return { pawn: flatOne(sim).id };
    }),
  ],
};

// ================================================================== day 7

const monthUpFront: CardDef = {
  id: 'monthUpFront',
  source: 'tenant',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:haggler', 'trait:paysEarly'],
  when: (sim) => one(homeNow(sim).find((p) => flatInfo(sim, p.life!.flat).lease) ?? undefined),
  hook: (sim, card) => `${first(subjectOf(sim, card))} offers rent up front.`,
  text: (sim, card) => `${first(subjectOf(sim, card))} wants to pay a week ahead, for a fiver a week off from now on.`,
  choices: () => [
    { label: 'Take it', note: '' },
    { label: 'Rent as it is', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const lease = flatInfo(sim, p.life!.flat).lease;
    const week = Math.min(lease?.rent ?? 0, 70 * POUND);
    if (answer === 0) return outcome([`pay:${week}:Rent in advance`, `rent:${p.life!.flat}:${has(p, 'haggler') ? -1000 : -500}`, mem(p, 'agreedHaggle')], `${first(p)} paid a week ahead. Their rent is a little lower from now on.`);
    if (answer === 1) return outcome([mem(p, 'brushedOff'), `flag:noEarly:${p.id}:14`, ...(has(p, 'haggler') ? [mem(p, 'refusedHaggle')] : [])], `${first(p)} will pay on the day, not before, for a while.`);
    return outcome([mem(p, 'leftToIt'), `flag:noEarly:${p.id}:14`, ...(has(p, 'haggler') ? [mem(p, 'refusedHaggle')] : [])], `The offer lapsed. ${first(p)} took it as an answer.`);
  },
  fixtures: [
    fx('a haggler', 7, 10, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['haggler', 'paysEarly']);
      return { pawn: p.id };
    }),
    fx('pays early', 7, 10, (sim) => {
      const p = flatOne(sim);
      setTraits(p, ['paysEarly', 'easyGoing']);
      return { pawn: p.id };
    }),
  ],
};

const boilerMoods: CardDef = {
  id: 'boilerMoods',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 30,
  turnsOn: ['trait:complainer'],
  when: (sim) => one(billHome(sim) ?? homeNow(sim)[0]),
  hook: () => 'The boiler is making a noise.',
  text: () => "The boiler sounds like a man falling downstairs. Pritchard did say it had moods.",
  choices: () => [
    { label: 'Call the engineer', note: '£60' },
    { label: 'Give it a thump', note: 'Free' },
  ],
  resolve(sim, card, answer) {
    const p = subjectOf(sim, card);
    const grump = has(p, 'complainer');
    if (answer === 0) return outcome(['pay:-6000:Boiler engineer', mem(p, 'landlordListened'), 'flag:boilerServiced::60'], 'The engineer came, listened, and said it was only a little bit broken. It burns a bit less now.');
    if (answer === 1) return outcome([mem(p, grump ? 'landlordShrugged' : 'waitedForRepair'), 'flag:boilerMoods::7'], 'You thumped it. It stopped, then started again. The gas bill will say how it feels.');
    return outcome([mem(p, 'leftToIt'), ...(grump ? [mem(p, 'ignored')] : []), 'flag:boilerMoods::14'], 'Nobody did anything about the noise. The boiler is taking it as encouragement.');
  },
  fixtures: [
    fx('a complainer', 7, 17, (sim) => {
      const b = bill(sim);
      setTraits(b, ['complainer', 'easyGoing']);
      return { pawn: b.id };
    }),
    fx('easy-going', 7, 17, (sim) => {
      const b = bill(sim);
      setTraits(b, ['easyGoing', 'keenCook']);
      return { pawn: b.id };
    }),
  ],
};

// ================================================================== the catalogue and the script

/** Cards only the first week brings (all `followUp: true`, so the ordinary drip never draws them). */
export const FIRST_WEEK_CARDS: CardDef[] = [
  billsShopping,
  billStairsAsk,
  keysOnMat,
  cleanerCard,
  binsQuestion,
  billsShower,
  showerAgain,
  windowMan,
  gasMeterFirst,
  scaffoldNextDoor,
  newcomerAsks,
  friendsRound,
  billsDaughter,
  lockedOutFirst,
  monthUpFront,
  boilerMoods,
];

const at = (day: number, hour: number, minute: number, card: string): ScriptBeat => ({ day, minute: hour * 60 + minute, card });

/**
 * When each scripted card is due: two a day, at least four game hours apart (DRIP.minGap). A
 * beat whose card's `when` is false when it's due is skipped. Day 1 is a Monday and starts
 * at 08:00; the storyteller wakes on day 8.
 */
export const FIRST_WEEK_SCRIPT: ScriptBeat[] = [
  at(1, 11, 0, 'billsShopping'),
  at(1, 20, 0, 'keysOnMat'),
  at(2, 8, 0, 'cleanerCard'),
  at(2, 19, 0, 'binsQuestion'),
  at(3, 10, 0, 'billsShower'),
  at(3, 15, 0, 'windowMan'),
  at(4, 9, 0, 'gasMeterFirst'),
  at(4, 19, 0, 'scaffoldNextDoor'),
  at(5, 14, 0, 'newcomerAsks'),
  at(5, 19, 0, 'friendsRound'),
  at(6, 11, 0, 'billsDaughter'),
  at(6, 23, 30, 'lockedOutFirst'),
  at(7, 10, 0, 'monthUpFront'),
  at(7, 17, 0, 'boilerMoods'),
];
