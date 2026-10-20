// Flags: facts about the building a card's choice left behind ("there's a key under the mat",
// "next door are sore with you"), for good or for some days. They're how a choice changes the
// building without a new system each time (spec 1.5).
//
// The systems that a flag can change each call `readFlags` at one hook point, with the value
// they'd use anyway. Every live flag that has a reader for that hook gets to change it. With no
// flags set (or no readers), the value comes back untouched, so the hooks cost nothing and
// change nothing until a card sets a flag.
//
// Chunk 0 laid down the hooks, the flag list and the helpers; chunk 1 (the drip) filled in
// READERS: what each flag does at each hook. A card chunk that needs a
// new flag adds it to FLAGS here, with what reads it, and says so when it hands back.
//
// This file imports only types and tuning.ts (which imports nothing), so any system can
// import it without a cycle.

import type { Sim } from './sim';
import type { Flag, Pawn } from './state';
import { BURGLARY, DRIP, FLAG_EFFECTS as FX } from './tuning';

// ------------------------------------------------------------------ the flags

export interface FlagDef {
  /** What it means, in plain words. */
  about: string;
  /** What its subject is, if it has one. */
  subject?: 'flat' | 'pawn' | 'furniture' | 'card';
  /** Who reads it: hook points (see FlagHooks) and anything else (a card's `when`, the renderer). Never empty. */
  readBy: string[];
  /** A grudge from outside, which counts as a bad lasting mark when a card is ignored (1.6). */
  grudge?: boolean;
}

/** Every flag a card can set (1.4), and who reads it, so none is write-only. */
export const FLAGS: Record<string, FlagDef> = {
  slowLet: { about: 'Nobody answered the door to an applicant: word gets round, and that flat lets slower', subject: 'flat', readBy: ['letting.hours'], grudge: true },
  nextDoorCat: { about: 'The cat you shooed lives next door now: you see it on their wall', readBy: ['render', 'card:cat'] },
  nextDoorFriendly: { about: 'Next door are pleased with you: no objection to your next planning application', readBy: ['planning.chance', 'card:scaffolding'] },
  nextDoorSore: { about: 'Next door are put out: they object to your next planning application', readBy: ['planning.chance'], grudge: true },
  keyUnderMat: { about: 'A key under the mat for a tenant who keeps getting locked out: easy for burglars too', readBy: ['crime.risk', 'card:lockout'] },
  bigBins: { about: 'Bigger bins: they overflow half as often', readBy: ['bins.overflowing'] },
  owes: { about: 'A tenant owes you a good turn: it comes sooner', subject: 'pawn', readBy: ['outcomes.goodDays'] },
  estimated: { about: 'The gas bill is estimated high until the meter reader gets in', readBy: ['bills.gas', 'card:meterReader'] },
  noEarly: { about: 'A tenant has stopped paying early for a fortnight', subject: 'pawn', readBy: ['outcomes.payEarly'] },
  familyKey: { about: 'A tenant\'s family has a key to the street door', readBy: ['crime.risk'] },
  strayKey: { about: 'Someone you don\'t know has a key (until the locks change)', readBy: ['crime.risk'], grudge: true },
  bars: { about: 'Bars on a ground-floor window: no longer a way in', subject: 'flat', readBy: ['crime.ways'] },
  tape: { about: 'A ground-floor window held together with tape: an easy way in until it\'s mended', subject: 'flat', readBy: ['crime.risk'] },
  petPrecedent: { about: 'The cat set a precedent: saying no to pets costs more', readBy: ['card:pet'] },
  informant: { about: 'The busybody tells you things now, and brings you a neighbour\'s hidden trait', subject: 'pawn', readBy: ['card:informant'] },
  dumpingSpot: { about: 'The spot by the bins is a dumping spot: fly-tips likelier', readBy: ['card:mattress'], grudge: true },
  lobbySofa: { about: 'A sofa in the lobby: people sit and meet on the stairs', readBy: ['render', 'moments', 'dirt.shared'] },
  squatter: { about: 'Someone\'s been sleeping in an empty flat: wear and dirt creep up', subject: 'flat', readBy: ['upkeep.wear', 'card:pizza'] },
  // --- added by chunk 7 ---
  lorraine: { about: 'Lorraine does the stairs and lobby every morning, and you pay her for it', readBy: ['handover.hour'] },
  muckyStairs: { about: 'You turned the cleaner down: the stairs and lobby get dirtier, faster', readBy: ['dirt.shared'], grudge: true },
  wrongBin: { about: 'A newcomer was pointed at the bins: the recycling goes in the wrong one and they overflow', readBy: ['bins.overflowing'] },
  cleanWindows: { about: 'A window cleaner comes every month for £15', readBy: ['handover.hour'] },
  grimyWindows: { about: 'You said no to the window cleaner: house-proud tenants notice the windows from week three', readBy: ['handover.hour'], grudge: true },
  boilerServiced: { about: 'The boiler has been seen to: it burns a little less gas', readBy: ['bills.gas'] },
  boilerMoods: { about: 'The boiler is left to its moods: it burns a little more gas', readBy: ['bills.gas'], grudge: true },
  billWantsDown: { about: 'Bill has asked for a ground-floor flat, and you said you would look', readBy: ['card:billStairsAsk'] },
  // --- added by chunk 2c ---
  goodWord: { about: 'Word is out that a flat shows well: it lets a bit faster', subject: 'flat', readBy: ['letting.hours'] },
  scaffolding: { about: 'Next door\'s scaffolding is up on your wall: top-floor windows are an easy way in', readBy: ['crime.risk', 'render'] },
  meterRead: { about: 'The gas meter has been read: the bill is right again', readBy: ['bills.gas'] },
  buildingCat: { about: 'You let the ginger cat stay: the building cat (visitors.ts makes it, state.cat holds it)', readBy: ['visitors.cat', 'card:cat'] },
  // --- added by chunk 2b ---
  tired: { about: 'The plumber said this is next to go: the leak card picks it first', subject: 'furniture', readBy: ['render', 'card:ceilingDrip'] },
  foxNight: { about: 'The fox has been at the bins: more dirt in the lobby and on the stairs', readBy: ['dirt.shared'] },
  alarmChecked: { about: 'Someone has seen to this flat\'s smoke alarm lately', subject: 'flat', readBy: ['card:chirping'] },
  batteryOut: { about: 'A smoke alarm with its battery out: the council counts it as broken', subject: 'flat', readBy: ['council.issues', 'card:chirping'], grudge: true },
  // --- added by chunk 2a ---
  lodger: { about: 'Someone not on the lease is living in a flat: it wears faster, and they count for the council\'s "overcrowded"', subject: 'flat', readBy: ['upkeep.wear', 'council.issues', 'card:lodger'] },
  petWear: { about: 'A pet lives in a flat: it wears faster', subject: 'flat', readBy: ['upkeep.wear'] },
  diyShelf: { about: 'A tenant put a shelf up themselves: no more asking for the drill', subject: 'flat', readBy: ['card:drill'] },
  painted: { about: 'A tenant painted the flat their colour: once they\'ve gone, it lets slower', subject: 'flat', readBy: ['letting.hours', 'card:paint'] },
  // --- added by chunk b2 ---
  oddJobs: { about: 'A tenant does the odd jobs for money off the rent: a handy one keeps things from wearing, anyone keeps the stairs tidier', subject: 'pawn', readBy: ['upkeep.wear', 'dirt.shared', 'card:oddJobs'] },
  extractorFan: { about: 'An extractor fan in a flat: no more cooking smells next door, no more mould', subject: 'flat', readBy: ['card:cookingSmells'] },
  ownWasher: { about: 'A tenant plumbed in their own washing machine: it can leak on the flat below', subject: 'flat', readBy: ['card:washer', 'card:washerLeak'] },
  rota: { about: 'A rota for the stairs on the wall: the stairs stay cleaner', readBy: ['dirt.shared', 'card:rota', 'card:rotaSlips'] },
  smokesIn: { about: 'A smoker told off the step smokes indoors: the flat wears faster', subject: 'flat', readBy: ['upkeep.wear', 'card:smokingOnStep'] },
  boxesIn: { about: 'A tenant\'s boxes in an empty flat: viewers see them, and it lets slower', subject: 'flat', readBy: ['letting.hours', 'card:boxes'] },
  clients: { about: 'A tenant works from the flat: strangers on the stairs, and the flat wears faster', subject: 'flat', readBy: ['crime.risk', 'upkeep.wear', 'card:sideHustle'] },
  radsBled: { about: 'The plumber bled every radiator: the gas goes further', readBy: ['bills.gas'] },
  weepingRad: { about: 'A radiator valve weeping into a bowl: the flat wears faster, and the valve will go', subject: 'flat', readBy: ['upkeep.wear', 'card:radiatorValve', 'card:valveGoes'] },
  doorShuts: { about: 'The street door was planed and shuts properly: a touch harder to get in', readBy: ['crime.risk'] },
  doorSticks: { about: 'The street door sticks and doesn\'t always latch', readBy: ['crime.risk', 'card:doorJams'] },
  doorPropped: { about: 'Someone propped the street door open with a brick', readBy: ['crime.risk'] },
  mould: { about: 'Damp and mould in a flat: it\'s on the council\'s list', subject: 'flat', readBy: ['council.issues', 'card:mould', 'card:mouldBack'] },
  looseSlates: { about: 'Loose slates over a flat: the weather gets in, and things wear faster', subject: 'flat', readBy: ['upkeep.wear'] },
  tapedCarpet: { about: 'The stair carpet is held down with gaffer tape: someone will catch a heel', readBy: ['card:stairCarpet', 'card:stairTrip'] },
  draughtProof: { about: 'Draught strips round a flat\'s windows: the gas goes further', subject: 'flat', readBy: ['bills.gas', 'card:draughtyWindow'] },
};

// ------------------------------------------------------------------ the hooks

/**
 * Where flags are read, and the value each hook hands over. A reader gets the value the system
 * would use and returns the one it should use instead.
 */
export interface FlagHooks {
  /** crime.ts `burglaryRisk`: the risk of a break-in, about 0 to 1, after locks, the alarm and cameras. */
  'crime.risk': number;
  /** crime.ts `waysIn`: the ways a burglar can get in. A reader can take one out (bars) or add one. */
  'crime.ways': { entry: 'door' | 'window'; at: [number, number]; inside?: [number, number]; flat?: string }[];
  /** upkeep.ts `issues`: what a council inspector would write down. */
  'council.issues': string[];
  /** upkeep.ts `useUp`: how much wear one go puts on a thing (ctx.flat is where it is). */
  'upkeep.wear': number;
  /** planning.ts `planningMorning`: the chance the council says yes, 0 to 1. */
  'planning.chance': number;
  /** leases.ts `applicantsHour`: mean hours until the next applicant for a flat (ctx.flat). */
  'letting.hours': number;
  /** outcomes.ts `outcomesHour`: mean days between a happy tenant's good turns (ctx.pawn). */
  'outcomes.goodDays': number;
  /** outcomes.ts `goodTurn`: whether paying a week early is one of the good turns on offer (ctx.pawn). */
  'outcomes.payEarly': boolean;
  /** expectations.ts `expectTarget`: where tenants' expectations are heading, 0 to 100. */
  'expect.target': number;
  /** environment.ts `gasBill`: the weekly gas bill, in pence. */
  'bills.gas': number;
  /** environment.ts `binsOverflowing`: whether the bins are overflowing. */
  'bins.overflowing': boolean;
  /** environment.ts dirt: dirt walked into the stairs and lobby this hour. */
  'dirt.shared': number;
  /** events.ts storyteller: how often each sort of happening gets picked (the `risk` effect's crime weight lives here). */
  'story.weights': { romance: number; crime: number; council: number; repair: number; grant: number };
  /** events.ts `maybeFight`: the chance a row turns into a fight (ctx.pawn and ctx.other). */
  'story.fight': number;
  /** events.ts party evenings: the chance this flat has a party tonight (ctx.flat). */
  'story.party': number;
  /** social.ts `romanceHour`: the chance an hour that a couple who've gone off each other split (ctx.pawn). */
  'story.split': number;
}

export type FlagHook = keyof FlagHooks;

/** Who and what a hook is being asked about. */
export interface FlagContext {
  flat?: string;
  pawn?: Pawn;
  other?: Pawn;
}

export type FlagReader<H extends FlagHook> = (sim: Sim, flag: Flag, value: FlagHooks[H], ctx: FlagContext) => FlagHooks[H];

/**
 * What each flag does at each hook. A flag whose readBy names only a card's `when`, the
 * renderer or moments has no entry here: those read it with `hasFlag`. `risk:<kind>` flags
 * are the `risk` effect's (drip.ts): their subject is the steps, and for a fight or a break-up
 * `<steps>@<pawn>`, so it moves only that person's chances.
 */
export const READERS: Record<string, { [H in FlagHook]?: FlagReader<H> }> = {
  slowLet: { 'letting.hours': (_sim, f, hours, ctx) => (f.subject === undefined || f.subject === ctx.flat ? hours + FX.slowLetHours : hours) },
  nextDoorFriendly: { 'planning.chance': (_sim, _f, chance) => Math.min(1, chance + FX.friendlyPlanning) },
  nextDoorSore: { 'planning.chance': (_sim, _f, chance) => Math.max(0, chance - FX.sorePlanning) },
  // The key's there for anyone: the locks count for nothing, and it's a step easier on top.
  keyUnderMat: { 'crime.risk': (sim, _f, risk) => Math.min(1, (sim.state.security.locks ? risk / BURGLARY.locks : risk) + FX.keyUnderMat * DRIP.riskStep.burglary) },
  bigBins: { 'bins.overflowing': (sim, _f, over) => over && sim.day % 2 === 0 },
  owes: { 'outcomes.goodDays': (_sim, f, days, ctx) => (ctx.pawn && String(ctx.pawn.id) === f.subject ? days * FX.owesSooner : days) },
  estimated: { 'bills.gas': (_sim, _f, pence) => Math.round(pence * FX.estimatedGas) },
  noEarly: { 'outcomes.payEarly': (_sim, f, early, ctx) => (ctx.pawn && String(ctx.pawn.id) === f.subject ? false : early) },
  familyKey: { 'crime.risk': (_sim, _f, risk) => Math.min(1, risk + FX.familyKey * DRIP.riskStep.burglary) },
  strayKey: { 'crime.risk': (_sim, _f, risk) => Math.min(1, risk + FX.strayKey * DRIP.riskStep.burglary) },
  bars: { 'crime.ways': (_sim, f, ways) => ways.filter((w) => !(w.entry === 'window' && (f.subject === undefined || w.flat === f.subject))) },
  tape: { 'crime.risk': (_sim, _f, risk) => Math.min(1, risk + FX.tape * DRIP.riskStep.burglary) },
  lobbySofa: { 'dirt.shared': (_sim, _f, dirt) => dirt * FX.lobbySofaDirt },
  squatter: { 'upkeep.wear': (_sim, f, wear, ctx) => (f.subject === ctx.flat ? wear * FX.squatterWear : wear) },
  // The `risk` effect (drip.ts): a step up (or down) for some days.
  'risk:burglary': { 'crime.risk': (_sim, f, risk) => Math.max(0, Math.min(1, risk + riskSteps(f) * DRIP.riskStep.burglary)) },
  'risk:fight': { 'story.fight': (_sim, f, chance, ctx) => (riskAbout(f, ctx) ? storyStep(chance, riskSteps(f)) : chance) },
  'risk:breakup': { 'story.split': (_sim, f, chance, ctx) => (riskAbout(f, ctx) ? storyStep(chance, riskSteps(f)) : chance) },
  'risk:party': { 'story.party': (_sim, f, chance, ctx) => (riskAbout(f, ctx) ? storyStep(chance, riskSteps(f)) : chance) },
  // --- added by chunk 7 ---
  muckyStairs: { 'dirt.shared': (_sim, _flag, dirt) => dirt * 1.5 },
  wrongBin: { 'bins.overflowing': () => true },
  boilerServiced: { 'bills.gas': (_sim, _flag, bill) => Math.round(bill * 0.9) },
  boilerMoods: { 'bills.gas': (_sim, _flag, bill) => Math.round(bill * 1.15) },
  // --- added by chunk 2a ---
  lodger: {
    'upkeep.wear': (_sim, flag, wear, ctx) => (flag.subject === ctx.flat ? wear * 1.25 : wear),
    // One more person in the flat for the council's "fewer tiles each" check.
    'council.issues': (sim, flag, list) => {
      const flat = sim.layout.flat(flag.subject ?? null);
      if (!flat || !sim.state.flats[flat.id]?.lease) return list;
      const people = sim.state.pawns.filter((p) => p.life?.flat === flat.id && !p.life.leaving).length;
      const line = `${flat.name} is overcrowded`;
      return list.includes(line) || sim.layout.flatNodes(flat).length / (people + 1) >= LODGER_CROWDED ? list : [...list, line];
    },
  },
  petWear: { 'upkeep.wear': (_sim, flag, wear, ctx) => (flag.subject === ctx.flat ? wear * 1.3 : wear) },
  // Half of applicants hate someone else's colours: a slower let while it's empty.
  painted: { 'letting.hours': (sim, flag, hours, ctx) => (flag.subject !== undefined && flag.subject === ctx.flat && !sim.state.flats[flag.subject]?.lease ? hours * 1.5 : hours) },
};

/** The steps in a `risk:` flag's subject ("2", or "1@42"). */
export function riskSteps(f: Flag): number {
  return Number((f.subject ?? '1').split('@')[0]) || 0;
}

/** A `risk:` flag about one person (or one flat) counts only for them; one about nobody counts for everyone. */
function riskAbout(f: Flag, ctx: FlagContext): boolean {
  const who = f.subject?.split('@')[1];
  if (who === undefined) return true;
  return String(ctx.pawn?.id) === who || String(ctx.other?.id) === who || ctx.flat === who;
}

/** A share more (or less) a step, never above certain. */
function storyStep(chance: number, steps: number): number {
  return Math.max(0, Math.min(1, chance * (1 + steps * DRIP.riskStep.story)));
}

/** The hooks a flag says it's read at (the rest of readBy is cards, the renderer and moments). */
export function hooksOf(def: FlagDef): string[] {
  return def.readBy.filter((r) => HOOK_NAMES.includes(r as FlagHook));
}

export const HOOK_NAMES: FlagHook[] = ['crime.risk', 'crime.ways', 'council.issues', 'upkeep.wear', 'planning.chance', 'letting.hours', 'outcomes.goodDays', 'outcomes.payEarly', 'expect.target', 'bills.gas', 'bins.overflowing', 'dirt.shared', 'story.weights', 'story.fight', 'story.party', 'story.split'];

/** COUNCIL.overcrowded, kept here so this file imports only types. */
const LODGER_CROWDED = 3;

/** The value a system should use, after any live flags have had their say. */
export function readFlags<H extends FlagHook>(sim: Sim, hook: H, value: FlagHooks[H], ctx: FlagContext = {}): FlagHooks[H] {
  const flags = sim.state.drip?.flags;
  if (!flags || flags.length === 0) return value;
  let out = value;
  for (const f of flags) {
    if (f.until !== undefined && f.until <= sim.state.tick) continue;
    const read = READERS[f.id]?.[hook] as FlagReader<H> | undefined;
    if (read) out = read(sim, f, out, ctx);
  }
  return out;
}

// ------------------------------------------------------------------ setting and reading

/** Live flags with this id (and subject, if given). */
export function flagsOf(sim: Sim, id: string, subject?: string): Flag[] {
  const now = sim.state.tick;
  return (sim.state.drip?.flags ?? []).filter((f) => f.id === id && (subject === undefined || f.subject === subject) && (f.until === undefined || f.until > now));
}

export function hasFlag(sim: Sim, id: string, subject?: string): boolean {
  return flagsOf(sim, id, subject).length > 0;
}

/**
 * Sets a flag, for good (`until` missing) or until a tick. The same id and subject is replaced,
 * not doubled. Past `most`, the oldest timed flag goes first (then the oldest for good).
 */
export function setFlag(sim: Sim, id: string, subject?: string, until?: number, most = 16): void {
  const flags = sim.state.drip.flags;
  const at = flags.findIndex((f) => f.id === id && f.subject === subject);
  if (at >= 0) flags.splice(at, 1);
  flags.push({ id, ...(subject !== undefined ? { subject } : {}), ...(until !== undefined ? { until } : {}) });
  while (flags.length > most) {
    const timed = flags.findIndex((f) => f.until !== undefined);
    flags.splice(timed >= 0 ? timed : 0, 1);
  }
}

export function clearFlag(sim: Sim, id: string, subject?: string): void {
  const st = sim.state;
  st.drip.flags = st.drip.flags.filter((f) => !(f.id === id && (subject === undefined || f.subject === subject)));
}

/** Drops flags whose time is up. */
export function expireFlags(sim: Sim): void {
  const st = sim.state;
  if (st.drip.flags.some((f) => f.until !== undefined && f.until <= st.tick)) st.drip.flags = st.drip.flags.filter((f) => f.until === undefined || f.until > st.tick);
}

// --- added by chunk 2c ---
// Readers for the flags above that change a number. (The rest are read by cards and the visitors.)
READERS.goodWord = { 'letting.hours': (_sim, flag, hours, ctx) => (ctx.flat === flag.subject ? hours * 0.8 : hours) };
READERS.scaffolding = { 'crime.risk': (_sim, _flag, risk) => Math.min(1, risk * 1.25) };
READERS.meterRead = { 'bills.gas': (sim, _flag, bill) => (hasFlag(sim, 'estimated') ? Math.round(bill / 1.1) : bill) };
// --- added by chunk 2b ---
// The two flags with a reader of their own (the others are read by the cards that set them).
READERS.foxNight = { 'dirt.shared': (_sim, _flag, dirt) => dirt * 3 };
READERS.batteryOut = {
  'council.issues': (sim, flag, issues) => {
    const flat = flag.subject ? sim.layout.flat(flag.subject) : undefined;
    return flat ? [...issues, `${flat.name} has a smoke alarm with no battery`] : issues;
  },
};
// --- added by chunk b2 ---
// What the everyday cards' flags do (cards/everyday.ts). The rest are read by the cards that set them.
const handyHere = (sim: Sim, id: string | undefined): boolean => sim.state.pawns.some((p) => String(p.id) === id && !!p.life && !p.life.leaving && p.life.traits.includes('handy'));
const hereNow = (sim: Sim, id: string | undefined): boolean => sim.state.pawns.some((p) => String(p.id) === id && !!p.life && !p.life.leaving);
READERS.oddJobs = {
  'upkeep.wear': (sim, flag, wear) => (handyHere(sim, flag.subject) ? wear * 0.85 : wear),
  'dirt.shared': (sim, flag, dirt) => (hereNow(sim, flag.subject) ? dirt * 0.85 : dirt),
};
READERS.rota = { 'dirt.shared': (_sim, _flag, dirt) => dirt * 0.8 };
READERS.smokesIn = { 'upkeep.wear': (_sim, flag, wear, ctx) => (ctx.flat === flag.subject ? wear * 1.1 : wear) };
READERS.boxesIn = { 'letting.hours': (_sim, flag, hours, ctx) => (ctx.flat === flag.subject ? hours * 1.3 : hours) };
READERS.clients = {
  'crime.risk': (_sim, _flag, risk) => Math.min(1, risk + 0.03),
  'upkeep.wear': (_sim, flag, wear, ctx) => (ctx.flat === flag.subject ? wear * 1.15 : wear),
};
READERS.radsBled = { 'bills.gas': (_sim, _flag, bill) => Math.round(bill * 0.95) };
READERS.weepingRad = { 'upkeep.wear': (_sim, flag, wear, ctx) => (ctx.flat === flag.subject ? wear * 1.15 : wear) };
READERS.doorShuts = { 'crime.risk': (_sim, _flag, risk) => risk * 0.9 };
READERS.doorSticks = { 'crime.risk': (_sim, _flag, risk) => Math.min(1, risk + 0.04) };
READERS.doorPropped = { 'crime.risk': (_sim, _flag, risk) => Math.min(1, risk + 0.1) };
READERS.mould = {
  'council.issues': (sim, flag, issues) => {
    const flat = flag.subject ? sim.layout.flat(flag.subject) : undefined;
    const line = flat ? `${flat.name} has damp and mould` : '';
    return flat && sim.state.flats[flat.id]?.lease && !issues.includes(line) ? [...issues, line] : issues;
  },
};
READERS.looseSlates = { 'upkeep.wear': (_sim, flag, wear, ctx) => (ctx.flat === flag.subject ? wear * 1.2 : wear) };
READERS.draughtProof = { 'bills.gas': (_sim, _flag, bill) => Math.round(bill * 0.97) };
