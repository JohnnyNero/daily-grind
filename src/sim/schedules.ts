// Who's home when (spec 2.1): each tenant has a schedule (office hours, an early or late
// shift, nights, working from home, a student's odd hours, retired), and one or two habits
// that replace some of their pottering at about the same time each day, so you get to know
// them. Habits meet no needs and cost nothing.
//
// Nothing about a habit is stored but its id. A habit is due in a window after its time
// (HABITS.window), and whatever it has them do runs past the end of that window, so it
// happens once a slot without anyone keeping count. Walking somewhere for a habit says so in
// `doing` (its `going` words); arriving there is `habitStep`.

import { outdoorsOk } from './shared';
import { outdoorTemp } from './environment';
import type { Flat } from './layout';
import { findPath } from './layout';
import { keysOf, setGoal } from './pawns';
import { pick, randInt, random, type RngHolder } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, key, seconds, type Life, type Pawn, type Person, type Pose, type Schedule } from './state';
import { choices } from './tenants';
import { has } from './traits';
import { HABITS, SCHEDULES as S } from './tuning';

export type { Schedule } from './state';

/** Schedules with hours away on weekdays, and a job title to go with them. */
const WORKING: Schedule[] = ['office', 'early', 'late', 'nights'];

const TITLES: Record<string, string[]> = {
  office: ['Office manager', 'Civil servant', 'Software tester', 'Estate agent', 'Junior solicitor', 'Insurance clerk', 'Recruiter'],
  early: ['Nurse', 'Barista', 'Postie', 'Baker', 'Bus driver'],
  late: ['Barman', 'Care worker', 'Line cook', 'Cinema usher'],
  nights: ['Security guard', 'A&E nurse', 'Night porter', 'Warehouse picker'],
};
const HOME_NOTES = ['Works from home', 'Translator, works from home', 'Bookkeeper, works from home', 'Freelance designer', 'Copywriter, works from home'];

/** For a tenant with no schedule (an old save, or someone made before schedules): from their job. */
export function scheduleFromJob(job: Person['job']): Schedule {
  return job ? 'office' : 'retired';
}

/**
 * A new person's schedule, in SCHEDULES.share. `working` true keeps to people with work
 * (shifts, office hours or working from home); false means retired.
 */
export function rollSchedule(rng: RngHolder, working?: boolean): Schedule {
  if (working === false) return 'retired';
  const allowed = (Object.entries(S.share) as [Schedule, number][]).filter(([s]) => !working || (s !== 'student' && s !== 'retired'));
  const total = allowed.reduce((n, [, w]) => n + w, 0);
  let r = random(rng) * total;
  for (const [s, w] of allowed) if ((r -= w) < 0) return s;
  return allowed[allowed.length - 1][0];
}

/** The job that goes with a schedule (null for home, student, retired: they keep no hours), and how they describe themselves. */
export function jobFor(rng: RngHolder, schedule: Schedule): { job: Person['job']; note: string } {
  if (WORKING.includes(schedule)) {
    const hours = S.away[schedule];
    // Not everyone starts on the hour: up to half an hour either way.
    const shift = randInt(rng, -2, 2) * 15;
    const title = pick(rng, TITLES[schedule]);
    return { job: { title, leave: hours.leave + shift, back: (hours.back + shift + 24 * 60) % (24 * 60) }, note: title };
  }
  if (schedule === 'home') return { job: null, note: pick(rng, HOME_NOTES) };
  return { job: null, note: schedule === 'student' ? 'Student' : 'Retired' };
}

// ------------------------------------------------------------------ the day

/** Monday is 0. */
const weekday = (day: number) => (((day - 1) % 7) + 7) % 7;

/** Hours away on a given day, in minutes of that day (`back` past 24 * 60 for nights), or null for a day in. */
function awayOn(day: number, life: Life): { leave: number; back: number } | null {
  const wd = weekday(day);
  const schedule = life.schedule ?? scheduleFromJob(life.job);
  if (schedule === 'home' || schedule === 'retired') return null;
  if (schedule === 'student') return S.studentDays.includes(wd) ? { ...S.away.student } : null;
  if (wd >= 5) return null;
  const hours = life.job ?? S.away[schedule];
  return { leave: hours.leave, back: hours.back <= hours.leave ? hours.back + 24 * 60 : hours.back };
}

/** Today's hours away, in minutes of the day (`back` past 24 * 60 for nights), or null for a day in. */
export function awayToday(sim: Sim, life: Life): { leave: number; back: number } | null {
  return awayOn(sim.day, life);
}

/** Roughly when they set off for their hours (for when to get up): the walk from the top floor, and a bit. */
export function setOffAt(hours: { leave: number }): number {
  return hours.leave - S.setOff;
}

/** Ticks a step takes (pawns.ts walks 0.08 of a tile a tick, and climbs 0.05). */
const TICKS_ALONG = 1 / 0.08;
const TICKS_UP = 1 / 0.05;

/** Game minutes from where they stand to the end of the street they leave by. */
function walkOut(sim: Sim, p: Pawn): number {
  const lay = sim.layout;
  const edge = p.exit === 0 ? 0 : sim.state.w - 1;
  const path = findPath(lay, lay.node(Math.round(p.x), Math.round(p.s)), lay.node(edge, 0), keysOf(p));
  if (!path) return S.setOff;
  let ticks = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, as] = lay.xs(path[i - 1]);
    const [bx, bs] = lay.xs(path[i]);
    ticks += as !== bs ? Math.abs(bs - as) * TICKS_UP : Math.abs(bx - ax) * TICKS_ALONG;
  }
  return Math.ceil(ticks / TICKS_PER_MINUTE);
}

/** Nothing to set off for in the next so many game minutes (so an hour at the pub doesn't make them late for work). */
export function freeFor(sim: Sim, p: Pawn, minutes: number): boolean {
  const life = p.life!;
  const hours = awayToday(sim, life);
  const m = sim.minuteOfDay;
  if (!hours || life.workedDay === sim.day || m >= hours.leave) return true;
  return m + minutes < hours.leave - S.setOff;
}

/**
 * Time to go to work (or lectures): their hours today, if it's time they set off so as to be
 * off the street when they start (the walk, and SCHEDULES.spare for a word on the stairs).
 */
export function dueOut(sim: Sim, p: Pawn): { leave: number; back: number } | null {
  const life = p.life!;
  const hours = awayToday(sim, life);
  const m = sim.minuteOfDay;
  if (!hours || life.workedDay === sim.day || m >= hours.back - 60 || m < hours.leave - S.longestWalk) return null;
  return m >= hours.leave - walkOut(sim, p) - S.spare ? hours : null;
}

/**
 * Whatever they've stopped to do (pottering, tidying), they look at the clock: a wait that
 * would run past the time they set off is cut short. Called after every decision.
 */
export function keepTime(sim: Sim, p: Pawn): void {
  const life = p.life;
  if (!life || life.away || p.task === 'leave' || life.using) return;
  const hours = awayToday(sim, life);
  const m = sim.minuteOfDay;
  if (!hours || life.workedDay === sim.day || m >= hours.leave || m < hours.leave - S.longestWalk - 30) return;
  const dayStart = Math.floor(sim.state.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  const go = dayStart + (hours.leave - walkOut(sim, p) - S.spare) * TICKS_PER_MINUTE;
  if (p.waitUntil > go) p.waitUntil = Math.max(sim.state.tick + 1, go);
}

/** When they get up on a given day, in minutes of the day. */
function wakeOn(day: number, life: Life): number {
  const schedule = life.schedule ?? scheduleFromJob(life.job);
  // Back from a night shift: asleep till the afternoon.
  if (schedule === 'nights' && awayOn(day - 1, life)) return S.nightsWake;
  let wake = S.wake[schedule];
  if (has(life, 'nightOwl')) wake = Math.max(wake, 10 * 60 + 30);
  // A working day: up in time to wash and eat before setting off.
  const hours = awayOn(day, life);
  return hours ? Math.min(wake, setOffAt(hours) - S.upBefore) : wake;
}

/** Bedtime on the evening of a given day, in minutes of that day (past 24 * 60 is after midnight). */
function bedOn(day: number, life: Life): number {
  const schedule = life.schedule ?? scheduleFromJob(life.job);
  // Off to a night shift: bed is when they're back in the morning.
  if (schedule === 'nights' && awayOn(day, life)) return 24 * 60 + S.nightsWake - 6 * 60;
  // Early to bed, whatever else: you could set a watch by it.
  if (life.habits?.includes('earlyNight')) return S.earlyNight;
  // Night owls stay up two hours later, whatever it does to them in the morning.
  const owl = has(life, 'nightOwl') ? 120 : 0;
  // Up for an early shift tomorrow: an early night.
  if (schedule === 'early' && awayOn(day + 1, life)) return S.earlyBed + owl;
  let bed = S.bed[schedule];
  // Friday and Saturday nights run later.
  if (schedule !== 'nights' && (weekday(day) === 4 || weekday(day) === 5)) bed += 60;
  return bed + owl;
}

/** When they wake up today, in minutes of the day. */
export function wakeAt(sim: Sim, life: Life): number {
  return wakeOn(sim.day, life);
}

/** When they go to bed tonight, in minutes of the day (past 24 * 60 is after midnight). */
export function bedtime(sim: Sim, life: Life): number {
  return bedOn(sim.day, life);
}

/** The hours they ought to be asleep: from tonight's bedtime, and from last night's (if it ran past midnight) until they wake. */
export function asleepHours(sim: Sim, life: Life): boolean {
  const m = sim.minuteOfDay;
  if (m >= bedOn(sim.day, life)) return true;
  const lastNight = bedOn(sim.day - 1, life) - 24 * 60;
  return m < wakeOn(sim.day, life) && m >= Math.max(0, lastNight);
}

/** In the building, awake and on the map: what moments and visitors look for. */
export function homeAndAwake(_sim: Sim, p: Pawn): boolean {
  return !!p.life && !p.life.away && !p.life.leaving && p.pose !== 'sleep';
}

// ------------------------------------------------------------------ habits

/** Where a habit takes them. */
type Where =
  | 'out' // off the map for a bit (the corner shop, a run)
  | 'step' // the street outside the front door
  | 'plant' // the plant in the lobby
  | 'landing' // just outside their own front door
  | 'window' // at a window in their flat
  | 'seat' // somewhere to sit in their flat
  | 'cat' // wherever the building cat is
  | 'here'; // where they stand

export interface HabitDef {
  id: string;
  /** Minutes of the day it's due (each tenant's slot is within HABITS.slack of these). None for a habit that only changes their hours. */
  at: number[];
  /** How likely it is to be one of a tenant's, by their schedule and traits (0 for never). */
  weight: (life: Pick<Life, 'schedule' | 'traits'>) => number;
  /** Rolled on its own for everyone, before the rest (a smoke: one in five). */
  chance?: number;
  /** Whether it can happen today, now: the weather, the day, a cat to feed. */
  ok?: (sim: Sim, p: Pawn) => boolean;
  where: Where;
  /** On the way: the info panel's words (each habit's own, so you can tell). */
  going: string;
  /** When they're there. */
  doing: string;
  /** How long they're there (or away), in game minutes. */
  minutes: [number, number];
  pose?: Pose;
  /** A pixel icon in the bubble (art.ts: 'music', 'cup', 'phone', 'paw', 'fork'), and the words if it can't draw one. */
  icon?: string;
  bubble?: string;
}

const trait = (life: Pick<Life, 'traits'>, id: string) => has(life, id);
const fineOut = (sim: Sim) => outdoorsOk(sim);
const isFriday = (sim: Sim) => weekday(sim.day) === 4;
const workday = (sim: Sim) => weekday(sim.day) < 5;

export const HABIT_DEFS: Record<string, HabitDef> = {
  paper: {
    id: 'paper', at: [8 * 60 + 30], where: 'out', minutes: [8, 12],
    weight: (l) => (l.schedule === 'retired' ? 3 : l.schedule === 'early' ? 2 : l.schedule === 'late' ? 1 : 0),
    going: 'Off for the paper', doing: 'At the corner shop',
  },
  shops: {
    id: 'shops', at: [11 * 60], where: 'out', minutes: [30, 45],
    weight: (l) => (l.schedule === 'retired' ? 1 : 0),
    going: 'Off to the shops', doing: 'At the shops',
  },
  smoke: {
    id: 'smoke', at: [9 * 60, 13 * 60 + 30, 19 * 60 + 45], where: 'step', minutes: [6, 10], chance: 0.2,
    weight: () => 0,
    going: 'Out for a smoke', doing: 'Having a smoke on the step', bubble: '...',
  },
  runMorning: {
    id: 'runMorning', at: [7 * 60 + 15], where: 'out', minutes: [25, 35],
    weight: (l) => (l.schedule === 'student' ? 2 : l.schedule === 'home' || l.schedule === 'late' ? 1 : 0),
    going: 'Off for a run', doing: 'Out for a run',
  },
  runEvening: {
    id: 'runEvening', at: [18 * 60 + 30], where: 'out', minutes: [25, 35],
    weight: (l) => (l.schedule === 'office' ? 3 : l.schedule === 'student' || l.schedule === 'early' ? 1 : 0),
    going: 'Off for an evening run', doing: 'Out for an evening run',
  },
  plant: {
    id: 'plant', at: [9 * 60 + 45], where: 'plant', minutes: [6, 10],
    weight: (l) => (trait(l, 'houseProud') ? 4 : 0),
    going: 'Off to water the plant', doing: 'Watering the lobby plant',
  },
  laptop: {
    id: 'laptop', at: [9 * 60, 10 * 60 + 15, 11 * 60 + 30, 14 * 60, 15 * 60 + 15, 16 * 60 + 30], where: 'seat', minutes: [35, 45], ok: workday,
    weight: () => 0,
    going: 'Sitting down to work', doing: 'Working on the laptop', pose: 'sit',
  },
  calls: {
    id: 'calls', at: [12 * 60 + 15, 13 * 60 + 45], where: 'landing', minutes: [10, 15], ok: workday,
    weight: (l) => (l.schedule === 'home' ? 3 : 0),
    going: 'Taking a call outside', doing: 'On a call on the landing', pose: 'phone', icon: 'phone', bubble: 'Hello?',
  },
  tea: {
    id: 'tea', at: [15 * 60 + 30], where: 'step', minutes: [20, 30], ok: fineOut,
    weight: (l) => (l.schedule === 'retired' || l.schedule === 'nights' ? 2 : 0),
    going: 'Taking a cup of tea out', doing: 'Tea on the step in the sun', pose: 'sit', icon: 'cup', bubble: 'Tea',
  },
  cat: {
    id: 'cat', at: [8 * 60, 17 * 60], where: 'cat', minutes: [5, 8],
    ok: (sim) => !!sim.state.cat && sim.state.pawns.some((o) => o.id === sim.state.cat!.pawn),
    weight: (l) => (trait(l, 'petOwner') ? 2 : trait(l, 'friendly') ? 1 : 0),
    going: 'Off to feed the cat', doing: 'Feeding the cat', icon: 'paw', bubble: 'Puss puss',
  },
  takeaway: {
    id: 'takeaway', at: [19 * 60 + 30], where: 'landing', minutes: [15, 20], ok: isFriday,
    weight: (l) => (trait(l, 'keenCook') ? 0 : 1),
    going: 'Off to meet the takeaway', doing: 'Waiting for the takeaway', icon: 'fork', bubble: 'Chips',
  },
  windows: {
    id: 'windows', at: [14 * 60 + 30], where: 'window', minutes: [20, 30], ok: (sim) => outdoorTemp(sim) < 8,
    weight: (l) => (l.schedule === 'retired' || trait(l, 'busybody') ? 2 : 0),
    going: 'Off to the window', doing: 'Watching the street from the window',
  },
  practise: {
    id: 'practise', at: [18 * 60 + 45], where: 'step', minutes: [20, 30], ok: fineOut,
    weight: (l) => (trait(l, 'musician') ? 3 : 0),
    going: 'Taking the guitar out', doing: 'Practising on the step', icon: 'music', bubble: '♪',
  },
  // Bill's, mostly: the telly up loud at two, tea at half five, bed at ten.
  telly: {
    id: 'telly', at: [14 * 60], where: 'here', minutes: [40, 45],
    weight: () => 0,
    going: 'Putting the racing on', doing: 'The racing on loud', icon: 'music', bubble: '♪♪',
  },
  cuppa: {
    id: 'cuppa', at: [17 * 60 + 30], where: 'here', minutes: [15, 20],
    weight: (l) => (l.schedule === 'retired' ? 1 : 0),
    going: 'Putting the kettle on', doing: 'Tea at half five', icon: 'cup', bubble: 'Tea',
  },
  earlyNight: { id: 'earlyNight', at: [], where: 'here', minutes: [0, 0], weight: (l) => (l.schedule === 'retired' ? 1 : 0), going: '', doing: '' },
};

/** One or two habits for a tenant, by id, picked by schedule and traits (HABITS). */
export function rollHabits(rng: RngHolder, life: Pick<Life, 'schedule' | 'traits'>): string[] {
  const out: string[] = [];
  // Working from home means the laptop, whatever else.
  if (life.schedule === 'home') out.push('laptop');
  for (const def of Object.values(HABIT_DEFS)) if (def.chance && out.length < HABITS.most && random(rng) < def.chance) out.push(def.id);
  const want = out.length === 0 ? (random(rng) < HABITS.second ? 2 : 1) : out.length < HABITS.most && random(rng) < HABITS.second ? out.length + 1 : out.length;
  while (out.length < Math.min(want, HABITS.most)) {
    const pool = Object.values(HABIT_DEFS).filter((d) => !out.includes(d.id) && d.weight(life) > 0);
    const total = pool.reduce((n, d) => n + d.weight(life), 0);
    if (total <= 0) break;
    let r = random(rng) * total;
    const next = pool.find((d) => (r -= d.weight(life)) < 0) ?? pool[pool.length - 1];
    out.push(next.id);
  }
  return out;
}

/** 07:00: tenants without habits (new, or from an old save) get theirs. */
export function schedulesMorning(sim: Sim): void {
  for (const p of sim.state.pawns) {
    const life = p.life;
    if (!life || life.leaving || life.habits.length > 0) continue;
    life.habits = rollHabits(sim.state, life);
  }
}

/** A tenant's own slot for a habit: within HABITS.slack of its time, the same each day give or take. */
function slotOf(p: Pawn, def: HabitDef, at: number, day: number): number {
  let h = p.id * 31 + at;
  for (const c of def.id) h = (h * 33 + c.charCodeAt(0)) | 0;
  const own = (Math.abs(h) % (HABITS.slack + 1)) - HABITS.slack / 2;
  const today = ((day * 7 + p.id) % 5) - 2;
  return at + Math.round(own) + today;
}

/** The slot a habit is due in now, as [start, end] minutes of the day, or null. */
function dueSlot(sim: Sim, p: Pawn, def: HabitDef): [number, number] | null {
  const m = sim.minuteOfDay;
  for (const at of def.at) {
    const start = slotOf(p, def, at, sim.day);
    if (m >= start && m < start + HABITS.window) return [start, start + HABITS.window];
  }
  return null;
}

/** The street just outside the front door. */
function frontStep(sim: Sim): [number, number] | null {
  const { x0, x1 } = sim.state.plot;
  for (const [x, cell] of [[x0, 'entrance'], [x1, 'entrance']] as const) {
    if (sim.state.cells[key(x, 1)] !== cell) continue;
    const out = x === x0 ? x0 - 1 : x1 + 1;
    if (out >= 0 && out < sim.state.w) return [out, 0];
  }
  return x0 > 0 ? [x0 - 1, 0] : null;
}

/** Where a habit takes them, or null if there's nowhere to do it. */
function spotFor(sim: Sim, p: Pawn, flat: Flat, def: HabitDef): [number, number] | null {
  const lay = sim.layout;
  const st = sim.state;
  switch (def.where) {
    case 'step':
      return frontStep(sim);
    case 'plant': {
      const plant = st.furniture.find((f) => f.def === 'plant' && f.broken === undefined && (() => {
        const room = lay.roomOf[lay.node(f.x, f.s)];
        return room !== -1 && lay.rooms[room].shared && !lay.rooms[room].outdoor;
      })());
      return plant ? [plant.x, plant.s] : null;
    }
    case 'landing': {
      const door = flat.doors[0].split(',').map(Number);
      const outside = [door[0] - 1, door[0] + 1].map((x) => lay.node(x, door[1])).find((n) => lay.roomOf[n] !== -1 && lay.rooms[lay.roomOf[n]].shared && lay.standable[n]);
      return outside === undefined ? null : lay.xs(outside);
    }
    case 'window': {
      for (const n of lay.flatCells(flat)) {
        if (!lay.standable[n] || lay.isDoorNode(n)) continue;
        const [x, s] = lay.xs(n);
        if (st.cells[key(x - 1, s + 1)] === 'window' || st.cells[key(x + 1, s + 1)] === 'window') return [x, s];
      }
      return null;
    }
    case 'seat': {
      const seat = choices(sim, p, flat, (o, f) => o.pose === 'sit' && o.need === 'comfort' && !o.errand && f.def !== 'bed' && f.def !== 'doubleBed')[0];
      return seat ? seat.at : [Math.round(p.x), Math.round(p.s)];
    }
    case 'cat': {
      const cat = st.pawns.find((o) => o.id === st.cat?.pawn);
      if (!cat) return null;
      const n = lay.node(Math.round(cat.x), Math.round(cat.s));
      return lay.standable[n] ? [Math.round(cat.x), Math.round(cat.s)] : null;
    }
    default:
      return [Math.round(p.x), Math.round(p.s)];
  }
}

/** There: the pose, the bubble, and long enough that the slot's over by the time they're done. */
function arrive(sim: Sim, p: Pawn, def: HabitDef, slotEnd: number): void {
  const st = sim.state;
  const dayStart = Math.floor(st.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  p.doing = def.doing;
  if (def.pose) p.pose = def.pose;
  if (def.bubble) p.bubble = { text: def.bubble, icon: def.icon, until: st.tick + seconds(4), kind: 'habit' };
  const minutes = randInt(st, def.minutes[0], def.minutes[1]);
  p.waitUntil = Math.max(st.tick + minutes * TICKS_PER_MINUTE, dayStart + slotEnd * TICKS_PER_MINUTE);
}

/**
 * Tried just before a tenant potters about (tenants.ts): if one of their habits is due, they
 * start it (walk somewhere, set `doing`, a pose, a bubble, a wait) and this says true.
 */
export function habitThink(sim: Sim, p: Pawn, flat: Flat): boolean {
  const life = p.life!;
  const st = sim.state;
  for (const id of life.habits) {
    const def = HABIT_DEFS[id];
    if (!def || def.at.length === 0) continue;
    const slot = dueSlot(sim, p, def);
    // Not if it would make them late: there and back is up to an hour of stairs and street.
    if (!slot || (def.ok && !def.ok(sim, p)) || !freeFor(sim, p, def.minutes[1] + 60)) continue;
    if (def.where === 'out') {
      // Off the map for a bit, back once the slot's over: tenants.ts walks them to the end of the street.
      const dayStart = Math.floor(st.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
      const minutes = randInt(st, def.minutes[0], def.minutes[1]);
      life.outing = { why: def.doing, until: Math.max(st.tick + minutes * TICKS_PER_MINUTE, dayStart + slot[1] * TICKS_PER_MINUTE) };
      p.task = 'leave';
      p.doing = def.going;
      return true;
    }
    const spot = spotFor(sim, p, flat, def);
    if (!spot) continue;
    if (spot[0] === Math.round(p.x) && spot[1] === Math.round(p.s)) {
      arrive(sim, p, def, slot[1]);
      return true;
    }
    if (!setGoal(sim, p, spot)) continue;
    p.doing = def.going;
    // Walking there; habitStep picks it up on arrival.
    p.waitUntil = 0;
    return true;
  }
  return false;
}

/**
 * Called early in tenantThink: on their way to a habit and now standing still (they've got
 * there), they do it. True if it had them do something.
 */
export function habitStep(sim: Sim, p: Pawn): boolean {
  const life = p.life!;
  if (p.path.length > 0 || p.task === 'leave') return false;
  for (const id of life.habits) {
    const def = HABIT_DEFS[id];
    if (!def || def.where === 'out' || def.going !== p.doing || def.going === def.doing) continue;
    const slot = dueSlot(sim, p, def);
    arrive(sim, p, def, slot ? slot[1] : sim.minuteOfDay);
    return true;
  }
  return false;
}
