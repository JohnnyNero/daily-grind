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
