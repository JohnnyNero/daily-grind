// Mood as a ledger of named reasons.
//
// Mood target = 45 + the sum of every active reason. Reasons are either situational
// (re-checked from the world: "Feet are killing me") or memories (events that fade:
// "Insulted by Priya"). Repeats of the same memory stack with diminishing effect.
// Mood itself drifts toward the target, so one bad moment doesn't flip it instantly.

import { ambience, cleanliness } from './ambience';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, type Memory, type Pawn } from './state';

export interface MemoryDef {
  id: string;
  /** "{other}" is replaced with the other person's name. */
  label: string;
  mood: number;
  hours: number;
  /** Opinion change toward `other`, for social memories. */
  opinion?: number;
  /** Max instances counted (per other person for social memories). */
  stack?: number;
}

const MEMORIES: readonly MemoryDef[] = [
  { id: 'decentTip', label: 'Got a decent tip', mood: 2, hours: 4, stack: 2 },
  { id: 'massiveTip', label: 'Got a massive tip', mood: 4, hours: 6, stack: 1 },
  { id: 'stormedOut', label: 'A customer stormed out on me', mood: -4, hours: 6, stack: 4 },
  { id: 'madeTheirDay', label: "Made someone's day", mood: 2, hours: 4, stack: 3 },
  { id: 'properLunch', label: 'Proper lunch break', mood: 4, hours: 6, stack: 1 },
  { id: 'sneakyCoffee', label: 'Sneaky coffee', mood: 1, hours: 2, stack: 2 },
  { id: 'sneakyLemonade', label: 'A crafty lemonade', mood: 1, hours: 2, stack: 2 },
  { id: 'snobCoffee', label: 'A properly good coffee', mood: 4, hours: 3, stack: 2 },
  { id: 'feetUp', label: 'Put my feet up', mood: 2, hours: 3, stack: 1 },
  { id: 'passedInspection', label: 'Passed the inspection', mood: 4, hours: 12, stack: 1 },
  { id: 'failedInspection', label: 'Inspection disaster', mood: -4, hours: 12, stack: 1 },
  { id: 'niceMusic', label: 'Nice music outside', mood: 2, hours: 2, stack: 1 },
  { id: 'freePastries', label: 'Free pastries', mood: 4, hours: 6, stack: 1 },
  { id: 'quietAfternoon', label: 'Lovely quiet spell', mood: 3, hours: 3, stack: 1 },
  { id: 'favouriteRegular', label: 'Served my favourite regular', mood: 2, hours: 4, stack: 2 },
  { id: 'favouriteRegularPP', label: 'Served my favourite regular', mood: 3, hours: 4, stack: 2 },
  { id: 'regularBiscuits', label: 'A regular brought biscuits', mood: 3, hours: 8, stack: 1 },
  { id: 'birthdaySong', label: 'Sang happy birthday to a regular', mood: 3, hours: 6, stack: 1 },
  { id: 'gotWant', label: 'Got what I wanted', mood: 6, hours: 24, stack: 2 },
  { id: 'rudeCustomer', label: 'Rude customer', mood: -4, hours: 4, stack: 3 },
  { id: 'droppedSomething', label: 'Dropped something. Again.', mood: -3, hours: 4, stack: 3 },
  { id: 'meltdown', label: 'Got it out of my system', mood: 8, hours: 12, stack: 1 },
  { id: 'walkedOut', label: 'Walked out yesterday. Awkward.', mood: -4, hours: 24, stack: 1 },
  // Social
  { id: 'niceChat', label: 'Had a nice chat with {other}', mood: 1, hours: 4, opinion: 3, stack: 2 },
  { id: 'banter', label: 'Banter with {other}', mood: 2, hours: 4, opinion: 4, stack: 2 },
  { id: 'ventedTo', label: '{other} vented at me', mood: -1, hours: 4, opinion: 1, stack: 2 },
  { id: 'gotItOffChest', label: 'Got it off my chest', mood: 4, hours: 4, stack: 1 },
  { id: 'complimented', label: '{other} said something nice', mood: 4, hours: 8, opinion: 6, stack: 3 },
  { id: 'insulted', label: 'Insulted by {other}', mood: -5, hours: 12, opinion: -12, stack: 4 },
  { id: 'row', label: 'Had a row with {other}', mood: -8, hours: 16, opinion: -15, stack: 3 },
  { id: 'flirted', label: 'Flirted with {other}', mood: 4, hours: 8, opinion: 5, stack: 4 },
  { id: 'rebuffed', label: 'Rebuffed by {other}', mood: -6, hours: 12, opinion: -5, stack: 2 },
  { id: 'triedItOn', label: '{other} tried it on with me', mood: -2, hours: 8, opinion: -4, stack: 3 },
  { id: 'flirtedWithPartner', label: '{other} flirted with my partner', mood: -8, hours: 24, opinion: -20, stack: 2 },
  { id: 'letOffEarly', label: 'Let off early', mood: 3, hours: 16, stack: 1 },
  { id: 'colleagueFired', label: '{other} got the sack', mood: -2, hours: 24, stack: 2 },
  { id: 'colleagueQuit', label: '{other} quit', mood: -3, hours: 24, stack: 2 },
  { id: 'friendQuit', label: 'My mate {other} quit', mood: -6, hours: 48, stack: 2 },
  { id: 'goodRiddance', label: 'Good riddance, {other}', mood: 4, hours: 24, stack: 2 },
];

const MEMORY_DEFS: Readonly<Record<string, MemoryDef>> = Object.fromEntries(MEMORIES.map((m) => [m.id, m]));

/** Each extra stacked instance counts for this fraction of the previous one. */
const STACK_FALLOFF = 0.6;
/** Mood with no reasons at all. */
const MOOD_BASELINE = 45;
/** Mood points per in-game hour that mood can move toward its target. */
const MOOD_DRIFT_PER_HOUR = 12;

export interface Reason {
  label: string;
  value: number;
}

export function memoryDef(id: string): MemoryDef {
  const def = MEMORY_DEFS[id];
  if (!def) throw new Error(`Unknown memory: ${id}`);
  return def;
}

export function hasTrait(p: Pawn, trait: string): boolean {
  return p.staff?.traits.includes(trait as never) === true;
}

export function addMemory(sim: Sim, p: Pawn, id: string, other: Pawn | null = null): void {
  const staff = p.staff;
  if (!staff) return;
  const def = memoryDef(id);
  staff.memories.push({
    def: id,
    other: other?.id ?? null,
    otherName: other?.name ?? null,
    expires: sim.state.tick + def.hours * TICKS_PER_HOUR,
  });
}

export function expireMemories(sim: Sim, p: Pawn): void {
  if (p.staff) p.staff.memories = p.staff.memories.filter((m) => m.expires > sim.state.tick);
}

function memoryLabel(m: Memory): string {
  return memoryDef(m.def).label.replace('{other}', m.otherName ?? 'someone');
}

/** Memories grouped by kind and person, with diminishing returns for repeats. */
function memoryReasons(p: Pawn): Reason[] {
  const groups = new Map<string, Memory[]>();
  for (const m of p.staff!.memories) {
    const key = `${m.def}:${m.other ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const out: Reason[] = [];
  for (const list of groups.values()) {
    const def = memoryDef(list[0].def);
    const n = Math.min(list.length, def.stack ?? 1);
    let total = 0;
    for (let i = 0; i < n; i++) total += def.mood * STACK_FALLOFF ** i;
    const label = memoryLabel(list[0]) + (n > 1 ? ` (×${n})` : '');
    out.push({ label, value: Math.round(total * 10) / 10 });
  }
  return out;
}

/** Reasons re-read from the world right now. */
function situationalReasons(sim: Sim, p: Pawn): Reason[] {
  const s = sim.state;
  const out: Reason[] = [];
  const add = (label: string, value: number) => out.push({ label, value });
  const n = p.needs;
  if (n.hunger < 0.1) add('Starving', -12);
  else if (n.hunger < 0.3) add('Hungry', -6);
  if (n.energy < 0.1) add('Running on fumes', -14);
  else if (n.energy < 0.3) add('Tired', -6);
  if (n.bladder < 0.25) add('Desperate for the loo', -8);
  if (n.comfort < 0.3) add('Feet are killing me', -5);

  const m = sim.minuteOfDay;
  if (hasTrait(p, 'nightOwl') && m < 10 * 60) add('Too early for this', -4);
  if (hasTrait(p, 'earlyBird') && m < 11 * 60) add('Morning person', 3);
  if (hasTrait(p, 'earlyBird') && m >= 15 * 60) add('Flagging', -3);

  const onShiftHours = (m - p.shift.start) / 60;
  if (onShiftHours > 7) add('Long shift', -6);
  else if (onShiftHours > 5) add('Long shift', -3);

  const sinceBreak = (s.tick - p.staff!.lastBreak) / TICKS_PER_HOUR;
  if (sinceBreak > 6) add('No break all shift', -10);
  else if (sinceBreak > 4) add('Overdue a break', -5);

  if (s.queue.length >= 6 && !hasTrait(p, 'calm')) add('Slammed', hasTrait(p, 'hardWorker') ? -1 : -3);

  const busy = s.queue.length >= 5;
  if (busy && hasTrait(p, 'introvert')) add('Too many people', -4);
  if (busy && hasTrait(p, 'lazy')) add('Run off my feet', -3);

  const clean = cleanliness(sim);
  if (clean < 0.45) add('This place is a tip', hasTrait(p, 'perfectionist') ? -6 : -3);
  else if (ambience(sim) > 0.8) add('Lovely place to work', hasTrait(p, 'perfectionist') ? 3 : 2);
  if (s.money < 0) add('Will I even get paid?', -6);

  for (const other of s.pawns) {
    if (other.id === p.id || !other.staff || !other.onMap) continue;
    const rel = sim.relation(p.id, other.id);
    const op = sim.opinion(p, other);
    if (rel.together) add(`On shift with my partner ${other.name}`, 6);
    else if (op >= 40) add(`Working with my mate ${other.name}`, 3);
    else if (op <= -30) add(`Stuck on shift with ${other.name}`, -5);
  }

  const insp = p.staff!.inspiration;
  if (insp) add(insp.kind === 'latteArt' ? 'Inspired: latte art streak' : 'Inspired: charm offensive', 6);
  return out;
}

export function moodReasons(sim: Sim, p: Pawn): Reason[] {
  if (!p.staff) return [];
  return [...situationalReasons(sim, p), ...memoryReasons(p)].sort((a, b) => a.value - b.value);
}

export function moodTarget(sim: Sim, p: Pawn): number {
  const total = moodReasons(sim, p).reduce((sum, r) => sum + r.value, 0);
  return Math.max(0, Math.min(100, MOOD_BASELINE + total));
}

/** Called once per in-game minute for staff on site. */
export function driftMood(sim: Sim, p: Pawn): void {
  const staff = p.staff!;
  const target = moodTarget(sim, p);
  const step = MOOD_DRIFT_PER_HOUR / 60;
  staff.mood += Math.max(-step, Math.min(step, target - staff.mood));
}

/** The worst current reason, quoted as the "final straw" when someone snaps. */
export function finalStraw(sim: Sim, p: Pawn): string {
  const worst = moodReasons(sim, p)[0];
  return worst && worst.value < 0 ? worst.label : 'Everything, honestly';
}

/** Opinion of `of` about `about`: remembered interactions plus how well they naturally click. */
export function opinionFromMemories(of: Pawn, aboutId: number): number {
  let total = 0;
  const counts = new Map<string, number>();
  for (const m of of.staff?.memories ?? []) {
    if (m.other !== aboutId) continue;
    const def = memoryDef(m.def);
    if (!def.opinion) continue;
    const n = (counts.get(m.def) ?? 0) + 1;
    counts.set(m.def, n);
    if (n > (def.stack ?? 1)) continue;
    total += def.opinion * STACK_FALLOFF ** (n - 1);
  }
  return total;
}
