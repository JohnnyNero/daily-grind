// Building cards (spec 1.4, source B): wear and broken things, dirt, the bins, warmth, noise,
// empty flats. About 30% of cards.
//
// Four cards and a follow-up: a drip through the ceiling (#5, and the second drip it
// threads), the bins (#9), the chirping smoke alarm (#19) and the cracked window (#25).
// Each one trades something different on each button (1.0): the building against a
// person, the plain fix against the quick one, and ignoring it is always worse.

import { flatInfo, POUND } from '../economy';
import { waysIn } from '../crime';
import { binsOverflowing, dirtOf, itemsIn, seasonName } from '../environment';
import { furnitureDef } from '../defs';
import { hasFlag } from '../flags';
import { household } from '../leases';
import { opinion } from '../social';
import { STOREY } from '../start';
import { has } from '../traits';
import { OPINION } from '../tuning';
import { repairCost } from '../upkeep';
import type { Sim } from '../sim';
import type { Card, Furniture, Pawn } from '../state';
import { TICKS_PER_DAY } from '../state';
import { fixtureSim, letFlat } from './rule';
import type { CardDef, CardFixture, CardSubject, Outcome } from './types';

// ------------------------------------------------------------------ helpers

const first = (p: Pawn): string => p.name.split(' ')[0];
const flatName = (sim: Sim, id: string | undefined): string => (id ? sim.layout.flat(id)?.name : undefined) ?? 'a flat';
const pawnById = (sim: Sim, id: number | undefined): Pawn | undefined => (id === undefined ? undefined : sim.state.pawns.find((p) => p.id === id));
const thing = (sim: Sim, id: number | undefined): Furniture | undefined => (id === undefined ? undefined : sim.state.furniture.find((f) => f.id === id));
const tenantsIn = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life && !p.life.leaving);
const wearOf = (f: Furniture): number => f.wear ?? 0;

/** The flat's corner: leftmost column and bottom row of its cells. */
function corner(sim: Sim, flatId: string): { x: number; s: number; x1: number } | null {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return null;
  const cells = lay.flatCells(flat);
  if (cells.length === 0) return null;
  const xs = cells.map((c) => c % lay.w);
  const ss = cells.map((c) => Math.floor(c / lay.w));
  return { x: Math.min(...xs), x1: Math.max(...xs), s: Math.min(...ss) };
}

/** The flat one storey down, straight under this one. */
function flatBelow(sim: Sim, flatId: string): string | null {
  const me = corner(sim, flatId);
  if (!me) return null;
  for (const f of sim.layout.flats) {
    const c = corner(sim, f.id);
    if (c && c.s === me.s - STOREY && c.x <= me.x1 && c.x1 >= me.x) return f.id;
  }
  return null;
}

/** Furniture standing in a flat. */
function furnitureIn(sim: Sim, flatId: string): Furniture[] {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return [];
  const cells = new Set(lay.flatCells(flat));
  return sim.state.furniture.filter((f) => cells.has(lay.node(f.x, f.s)));
}

/** The first of a household's traits that you haven't seen yet: [pawn, trait]. */
function hiddenTrait(people: Pawn[]): [Pawn, string] | null {
  for (const p of people) {
    const t = p.life!.traits.find((x) => !p.life!.revealed.includes(x));
    if (t) return [p, t];
  }
  return null;
}

/** Keeps a line inside the card's limit. */
const fit = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}.`);

const mems = (people: Pawn[], id: string): string[] => people.map((p) => `mem:${p.id}:${id}`);

// ------------------------------------------------------------------ #5 drip through the ceiling

const WET = new Set(['bathroom']);

interface Leak {
  thing: Furniture;
  up: Pawn;
  downs: Pawn[];
  above: string;
  below: string;
}

/** Who and what a leak card is about, read from the card. Null if the building's moved on. */
function leakOf(sim: Sim, card: Card): Leak | null {
  const f = thing(sim, card.furniture);
  const up = pawnById(sim, card.pawn);
  if (!f || !up || !card.flat || card.data?.below === undefined) return null;
  const below = String(card.data.below);
  return { thing: f, up, downs: household(sim, below), above: card.flat, below };
}

/** Friends (an opinion over 30) take a leak from you at half strength, and don't hold it against you. */
const notFriends = (sim: Sim, l: Leak): Pawn[] => l.downs.filter((d) => opinion(sim, d, l.up) < OPINION.friend);

/** The next most tired thing in a lived-in flat: what the plumber says is going next. */
function nextToGo(sim: Sim, not: Furniture): Furniture | undefined {
  return sim.state.furniture
    .filter((f) => f.id !== not.id && !f.broken && furnitureDef(f.def).offers && wearOf(f) > 0.5 && !hasFlag(sim, 'tired', String(f.id)))
    .filter((f) => {
      const flat = sim.layout.flatAt(f.x, f.s);
      return flat ? household(sim, flat.id).length > 0 : false;
    })
    .sort((a, b) => wearOf(b) - wearOf(a) || a.id - b.id)[0];
}

/** The most worn thing in the flat below, which takes the water. */
function soaked(sim: Sim, below: string, not: Furniture): Furniture | undefined {
  return furnitureIn(sim, below)
    .filter((f) => f.id !== not.id && !f.broken && furnitureDef(f.def).offers)
    .sort((a, b) => wearOf(b) - wearOf(a) || a.id - b.id)[0];
}

function leaks(sim: Sim): CardSubject[] {
  const out: CardSubject[] = [];
  for (const f of sim.state.furniture) {
    if (f.broken || wearOf(f) <= 0.8 || !WET.has(furnitureDef(f.def).group)) continue;
    const flat = sim.layout.flatAt(f.x, f.s);
    if (!flat) continue;
    const up = household(sim, flat.id);
    const below = flatBelow(sim, flat.id);
    if (up.length === 0 || !below || household(sim, below).length === 0) continue;
    out.push({ pawn: up[0].id, flat: flat.id, furniture: f.id, data: { below }, weight: 1 + (wearOf(f) - 0.8) * 5 + (hasFlag(sim, 'tired', String(f.id)) ? 2 : 0) });
  }
  return out;
}

const ceilingDrip: CardDef = {
  id: 'ceilingDrip',
  source: 'building',
  kind: 'moment',
  cooldownDays: 7,
  turnsOn: ['whoIsBelow', 'friends', 'trait:knowsRights'],
  icon: 'water',
  when: (sim) => leaks(sim),
  hook: (sim, card) => fit(`Water through ${flatName(sim, String(card.data?.below))}'s ceiling.`, 40),
  text: (sim, card) => {
    const l = leakOf(sim, card);
    return fit(`Water's coming through ${flatName(sim, String(card.data?.below))}'s ceiling. It's ${l ? first(l.up) : 'someone'}'s ${l ? furnitureDef(l.thing.def).name.toLowerCase() : 'shower'}.`, 80);
  },
  choices: (sim, card) => [
    { label: 'Plumber', note: `£${(thing(sim, card.furniture) ? repairCost(thing(sim, card.furniture)!) : 80 * POUND) / POUND}. Says what's next` },
    { label: 'Bucket and towel', note: 'Free. It will drip again' },
  ],
  resolve: (sim, card, answer): Outcome => {
    const l = leakOf(sim, card);
    if (!l) return { effects: [], notice: 'The drip had stopped by itself.' };
    const rights = l.downs.some((d) => has(d.life!, 'knowsRights'));
    const sore = notFriends(sim, l);
    const leaked = sore.map((d) => `soc:${d.id}:leakedOnMe:${l.up.id}`);
    const complaint = rights ? ['inspect:5:A tenant has written to us'] : [];
    const damp = soaked(sim, l.below, l.thing);
    if (answer === 0) {
      const next = nextToGo(sim, l.thing);
      return {
        effects: [`mend:${l.thing.id}`, ...mems(l.downs, 'landlordListened'), ...(next ? [`flag:tired:${next.id}:14`] : [])],
        notice: next ? `The plumber sorted it. He says the ${furnitureDef(next.def).name.toLowerCase()} is next to go.` : 'The plumber sorted it. Nothing else looked tired.',
      };
    }
    if (answer === 1) {
      return {
        effects: ['thread:ceilingDripAgain:48', ...leaked, ...complaint],
        notice: sore.length > 0 ? `A bucket and a towel. ${first(sore[0])} is not impressed with ${first(l.up)}.` : 'A bucket and a towel. It will drip again.',
      };
    }
    return {
      effects: [
        ...mems(l.downs, 'leftToIt'),
        ...leaked,
        ...(damp ? [`wear:${damp.id}:${Math.min(0.95, wearOf(damp) + 0.25).toFixed(2)}`] : []),
        `wear:${l.thing.id}:${Math.max(0.95, wearOf(l.thing)).toFixed(2)}`,
        'thread:ceilingDripAgain:24',
        ...complaint,
      ],
      notice: `Nobody came. ${l.downs[0] ? first(l.downs[0]) : 'Downstairs'} has a wet ceiling and a long memory.`,
    };
  },
  fixtures: [],
};

/** Bill's shower (wear 0.85 from the start) over a let Flat 2. */
function leakFixture(name: string, below: (string[] | { traits: string[] })[], friends = false): CardFixture {
  return {
    name,
    build(seed) {
      const sim = fixtureSim(seed);
      const downs = letFlat(sim, 1, below.map((b) => (Array.isArray(b) ? b : b.traits)));
      const bill = sim.state.pawns.find((p) => p.life?.flat === sim.layout.flats[3].id)!;
      if (friends) for (const d of downs) for (let i = 0; i < 3; i++) d.life!.social.push({ id: 'deepTalk', about: bill.id, at: sim.state.tick }, { id: 'favour', about: bill.id, at: sim.state.tick });
      const subject = leaks(sim)[0];
      return { sim, subject };
    },
  };
}
ceilingDrip.fixtures = [leakFixture('a stranger below', [['easyGoing']]), leakFixture('knows their rights', [['knowsRights']]), leakFixture('friends below', [['friendly']], true)];

const ceilingDripAgain: CardDef = {
  id: 'ceilingDripAgain',
  source: 'building',
  kind: 'moment',
  followUp: true,
  cooldownDays: 0,
  turnsOn: ['whoIsBelow', 'friends', 'trait:knowsRights'],
  icon: 'water',
  when: (sim, from) => {
    const f = thing(sim, from?.furniture);
    if (!from || !f || f.broken || !from.flat || from.data?.below === undefined) return [];
    return household(sim, String(from.data.below)).length > 0 && pawnById(sim, from.pawn) ? [from] : [];
  },
  hook: (sim, card) => fit(`Dripping again in ${flatName(sim, String(card.data?.below))}.`, 40),
  text: (sim, card) => {
    const l = leakOf(sim, card);
    return fit(`It's dripping again in ${flatName(sim, String(card.data?.below))}. ${l ? first(l.up) : 'Someone'}'s ${l ? furnitureDef(l.thing.def).name.toLowerCase() : 'shower'}, still.`, 80);
  },
  choices: (sim, card) => [
    { label: 'Plumber, now', note: `£${(thing(sim, card.furniture) ? repairCost(thing(sim, card.furniture)!) : 80 * POUND) / POUND}. Should have done it` },
    { label: 'Another bucket', note: 'Free. It will give up' },
  ],
  resolve: (sim, card, answer): Outcome => {
    const l = leakOf(sim, card);
    if (!l) return { effects: [], notice: 'It had stopped by itself.' };
    const leaked = notFriends(sim, l).map((d) => `soc:${d.id}:leakedOnMe:${l.up.id}`);
    const gone = [`wear:${l.thing.id}:1`, 'tale:leak:' + l.up.id];
    if (answer === 0) return { effects: [`mend:${l.thing.id}`, ...mems(l.downs, 'itsYourJob')], notice: 'The plumber came. Downstairs found something to say about the delay.' };
    if (answer === 1) return { effects: [...gone, ...leaked], notice: `The ${furnitureDef(l.thing.def).name.toLowerCase()} has given up. The bucket was never going to be enough.` };
    return { effects: [...gone, ...leaked, ...mems(l.downs, 'leftToIt'), ...mems(l.downs, 'keptWaiting')], notice: `Nobody came. The ${furnitureDef(l.thing.def).name.toLowerCase()} gave up on its own.` };
  },
  fixtures: [],
};
ceilingDripAgain.fixtures = ceilingDrip.fixtures.map((fx) => ({ name: fx.name, build: fx.build }));

// ------------------------------------------------------------------ #9 the bins

/** The tenant with the messiest habits: messy first, then whoever lives in the dirtiest flat. */
function messiest(sim: Sim): Pawn | undefined {
  return tenantsIn(sim)
    .map((p) => ({ p, n: (has(p.life!, 'messy') ? 10 : 0) + dirtOf(sim, p.life!.flat) }))
    .sort((a, b) => b.n - a.n || a.p.id - b.p.id)[0]?.p;
}

const bins: CardDef = {
  id: 'bins',
  source: 'building',
  kind: 'moment',
  cooldownDays: 4,
  turnsOn: ['trait:messy', 'trait:busybody', 'trait:houseProud'],
  icon: 'bins',
  when: (sim) => (binsOverflowing(sim) && !hasFlag(sim, 'bigBins') ? [{ weight: 1 + (hasFlag(sim, 'dumpingSpot') ? 1 : 0) }] : []),
  hook: () => 'The bins are overflowing.',
  text: () => 'The bins are overflowing. A fox has opinions.',
  name: () => 'The bins · Lobby',
  choices: () => [
    { label: 'Bigger bins', note: '£60. They stay fixed' },
    { label: 'Wait for Thursday', note: 'Free. The fox visits' },
  ],
  resolve: (sim, _card, answer): Outcome => {
    const people = tenantsIn(sim);
    const busy = people.find((p) => has(p.life!, 'busybody'));
    const culprit = busy ? messiest(sim) : undefined;
    // The busybody tells two neighbours whose bags they are.
    const told = busy && culprit ? people.filter((p) => p.id !== culprit.id && p.life!.flat !== culprit.life!.flat).slice(0, 2) : [];
    const gossip = culprit ? told.map((p) => `soc:${p.id}:heardThings:${culprit.id}`) : [];
    if (answer === 0) return { effects: ['pay:-6000:Bigger bins', 'flag:bigBins'], notice: 'Bigger bins. They will take twice the rubbish before the fox gets involved.' };
    if (answer === 1) {
      return {
        effects: ['flag:foxNight::1', ...gossip],
        notice: culprit && busy ? `The fox came. ${first(busy)} has told the stairs whose bags they were: ${first(culprit)}'s.` : 'The fox came. The lobby is a state.',
      };
    }
    const proud = people.filter((p) => has(p.life!, 'houseProud'));
    const rest = people.filter((p) => !has(p.life!, 'houseProud'));
    return {
      effects: ['flag:foxNight::2', 'flag:dumpingSpot::14', ...mems(proud, 'leftToIt'), ...mems(rest, 'brushedOff'), ...gossip],
      notice: 'Two nights of fox. The bins are now where people put things.',
    };
  },
  fixtures: [],
};

function binsFixture(name: string, households: string[][][], tweak?: (sim: Sim) => void): CardFixture {
  return {
    name,
    build(seed) {
      const sim = fixtureSim(seed, 5);
      households.forEach((h, i) => letFlat(sim, i + 1, h));
      tweak?.(sim);
      return { sim, subject: bins.when(sim)[0] };
    },
  };
}
bins.fixtures = [
  binsFixture('messy, with a busybody', [[['busybody'], ['easyGoing'], ['messy']], [['friendly'], ['clumsy'], ['handy']], [['houseProud']]]),
  binsFixture('house-proud, no gossip', [[['houseProud'], ['easyGoing'], ['handy']], [['houseProud'], ['friendly']], [['messy'], ['clumsy']]]),
];

// ------------------------------------------------------------------ #19 chirping

const LEFT_ALONE = ['messy', 'clumsy', 'easyGoing'];

function chirps(sim: Sim): CardSubject[] {
  const out: CardSubject[] = [];
  for (const flat of sim.layout.flats) {
    const people = household(sim, flat.id);
    const lease = flatInfo(sim, flat.id).lease;
    if (people.length === 0 || !lease || itemsIn(sim, flat.id, 'smokeAlarm') === 0) continue;
    if (sim.day - Math.max(lease.startDay, 1) < 21 || hasFlag(sim, 'alarmChecked', flat.id) || hasFlag(sim, 'batteryOut', flat.id)) continue;
    // Likelier with the council coming.
    out.push({ pawn: people[0].id, flat: flat.id, weight: sim.state.council.visitDay !== undefined ? 3 : 1 });
  }
  return out;
}

const chirping: CardDef = {
  id: 'chirping',
  source: 'building',
  kind: 'moment',
  cooldownDays: 7,
  turnsOn: ['trait:messy', 'trait:clumsy', 'trait:easyGoing', 'trait:knowsRights', 'inspection'],
  icon: 'alarm',
  when: (sim) => chirps(sim),
  hook: (sim, card) => fit(`Chirping in ${flatName(sim, card.flat)}.`, 40),
  text: (sim, card) => fit(`Something in ${flatName(sim, card.flat)} is chirping every 40 seconds. Smoke alarm.`, 80),
  choices: () => [
    { label: 'Pop round', note: '£2. You will see inside' },
    { label: 'They can do it', note: 'Most will' },
  ],
  resolve: (sim, card, answer): Outcome => {
    const flat = card.flat ?? '';
    const people = household(sim, flat);
    const checked = `flag:alarmChecked:${flat}:21`;
    if (answer === 0) {
      const seen = hiddenTrait(people);
      return {
        effects: [
          'pay:-200:Smoke alarm battery',
          checked,
          ...(seen ? [`reveal:${seen[0].id}:${seen[1]}`] : []),
          ...people.map((p) => `mem:${p.id}:${has(p.life!, 'knowsRights') ? 'itsYourJob' : 'landlordListened'}`),
        ],
        notice: seen ? `New battery in. You saw enough of ${first(seen[0])}'s flat to learn something.` : 'New battery in. The chirping has stopped.',
      };
    }
    if (answer === 1) {
      const out = people.some((p) => LEFT_ALONE.some((t) => has(p.life!, t)));
      return {
        effects: [checked, ...mems(people, 'landlordShrugged'), ...(out ? [`flag:batteryOut:${flat}:30`] : [])],
        notice: out ? `${flatName(sim, flat)} sorted the chirping by taking the battery out. The council will not love that.` : `${flatName(sim, flat)} found a battery. A bit short with you about it.`,
      };
    }
    return {
      effects: [`flag:batteryOut:${flat}:30`, ...mems(people, 'leftToIt'), ...mems(people, 'keptWaiting')],
      notice: `The chirping went on for a day. Then ${flatName(sim, flat)} took the battery out.`,
    };
  },
  fixtures: [],
};

function chirpFixture(name: string, people: string[][], inspection = false): CardFixture {
  return {
    name,
    build(seed) {
      const sim = fixtureSim(seed, 30);
      const pawns = letFlat(sim, 1, people);
      for (const p of pawns) p.life!.revealed = [];
      flatInfo(sim, sim.layout.flats[1].id).lease!.startDay = sim.day - 30;
      if (inspection) sim.state.council.visitDay = sim.day + 5;
      return { sim, subject: chirps(sim).find((s) => s.flat === sim.layout.flats[1].id)! };
    },
  };
}
chirping.fixtures = [chirpFixture('easy-going', [['easyGoing']]), chirpFixture('house-proud', [['houseProud'], ['handy']]), chirpFixture('knows their rights, inspection due', [['knowsRights']], true)];

// ------------------------------------------------------------------ #25 a window's gone

const POSH_TIERS = new Set(['Nice', 'Smart', 'Impressive']);

function windows(sim: Sim): CardSubject[] {
  const flats = new Set(waysIn(sim).filter((w) => w.entry === 'window' && w.flat).map((w) => w.flat!));
  const out: CardSubject[] = [];
  for (const id of flats) {
    const people = household(sim, id);
    if (people.length === 0 || hasFlag(sim, 'bars', id) || hasFlag(sim, 'tape', id)) continue;
    // Kids with a ball and storms aren't tracked, so it can come any time but is rare; a break-in or an attempt lately makes it likely.
    const lately = sim.state.chronicle.tales.some((t) => (t.kind === 'burglary' || t.kind === 'burglaryFoiled') && sim.state.tick - t.tick < 14 * TICKS_PER_DAY);
    out.push({ pawn: people[0].id, flat: id, weight: lately ? 3 : 0.5 });
  }
  return out;
}

const windowGone: CardDef = {
  id: 'windowGone',
  source: 'building',
  kind: 'moment',
  cooldownDays: 7,
  turnsOn: ['tier', 'season', 'trait:knowsRights'],
  when: (sim) => windows(sim),
  hook: (sim, card) => fit(`${flatName(sim, card.flat)}'s window's gone.`, 40),
  text: (sim, card) => fit(`${flatName(sim, card.flat)}'s window's cracked. A ball, apparently.`, 80),
  choices: () => [
    { label: 'Glazier and bars', note: '£90. Bars for good' },
    { label: 'Tape it', note: 'Free. Cold, and easy to get in' },
  ],
  resolve: (sim, card, answer): Outcome => {
    const flat = card.flat ?? '';
    const people = household(sim, flat);
    const posh = POSH_TIERS.has(flatInfo(sim, flat).tier);
    const winter = seasonName(sim) === 'Winter';
    const complaint = people.some((p) => has(p.life!, 'knowsRights')) ? ['inspect:4:A tenant has written to us'] : [];
    const name = flatName(sim, flat);
    if (answer === 0) {
      return {
        effects: ['pay:-9000:Glazier and window bars', `flag:bars:${flat}`, ...mems(people, 'barsOnWindow'), ...(posh ? mems(people, 'landlordShrugged') : [])],
        notice: posh ? `Bars on ${name}'s window. Not what they paid for, they let you know.` : `Bars on ${name}'s window. Nobody is climbing in there now.`,
      };
    }
    if (answer === 1) {
      return {
        effects: [`flag:tape:${flat}`, ...mems(people, 'tapedWindow'), ...(winter ? mems(people, 'landlordShrugged') : []), ...complaint],
        notice: winter ? `Taped. ${name} is freezing, and it is an easy way in.` : `Taped. ${name} is draughty, and it is an easy way in.`,
      };
    }
    return {
      effects: ['risk:burglary:2:14', ...mems(people, 'crackedWindow'), ...mems(people, 'leftToIt'), ...complaint],
      notice: `Nobody did anything. ${name} has a hole in the window and the street has noticed.`,
    };
  },
  fixtures: [],
};

function windowFixture(name: string, traits: string[], tier: string, day: number): CardFixture {
  return {
    name,
    build(seed) {
      const sim = fixtureSim(seed, day);
      const pawns = sim.state.pawns.filter((p) => p.life?.flat === sim.layout.flats[0].id);
      for (const p of pawns) p.life!.traits = traits;
      flatInfo(sim, sim.layout.flats[0].id).tier = tier;
      return { sim, subject: windows(sim)[0] };
    },
  };
}
windowGone.fixtures = [windowFixture('a Nice flat in autumn', ['easyGoing'], 'Nice', 3), windowFixture('a Grim flat in winter, rights', ['knowsRights'], 'Grim', 36)];

export const BUILDING_CARDS: CardDef[] = [ceilingDrip, ceilingDripAgain, bins, chirping, windowGone];
