// Building work. In build mode you draw plans, which cost nothing and change nothing. When
// you sign them off, the builders (Bodge & Sons) come in working hours and do the job a
// piece at a time, taking the money for each piece as they finish it. They're noisy, and
// the tenants of a flat they're working in aren't keen, but a flat that's been done up
// is a pleasure.
//
// A plan and a job are both the building as it will be. What's left to do is the
// difference between that and the building as it is now, worked out fresh each time, so
// there's no list of orders to keep in step.

import type { BuildParts } from './build';
import { CELL_PRICE, DEMOLISH_PRICE, INSULATE_PRICE, book, pounds } from './economy';
import { SHARED } from './environment';
import type { Sim } from './sim';
import { isDoor, key, type CellKind, type State } from './state';
import { remember } from './thoughts';
import { riserPrice, risersOf, storeysOf, unapproved, wetOf } from './risers';

export const BUILDERS = 'Bodge & Sons';

/** Builders work 8 till 5, Monday to Saturday. */
const START_MINUTE = 8 * 60;
const END_MINUTE = 17 * 60;
export const WORK_MINUTES_A_DAY = END_MINUTE - START_MINUTE;

/** How loud the builders are where they're working. */
export const BUILDER_NOISE = 5;

/** Minutes of work for each kind of cell. */
const CELL_MINUTES: Record<CellKind, number> = { wall: 20, window: 45, door: 60, flatDoor: 90, entrance: 120, stair: 45 };
const MINUTES = { knockDown: 15, insulate: 20, riserStorey: 240 };

/** One thing to do: what, where (for drawing it and the noise), what it costs and how long. */
export interface Piece {
  label: string;
  /** Pence. */
  cost: number;
  minutes: number;
  /** The cell. */
  x: number;
  s: number;
  /** Takes something away (drawn crossed out) rather than adding it. */
  removes: boolean;
  /** For drawing it: a cell (what goes in, or null for knocking out what's there) or insulation. */
  part: { kind: 'cell'; cell: CellKind | null; was?: CellKind } | { kind: 'insulate' } | { kind: 'riser' };
  apply(st: State): void;
}

export function partsOf(st: State): BuildParts {
  return { cells: st.cells, furniture: st.furniture, insulated: st.insulated, risers: risersOf(st) };
}

export function copyParts(p: BuildParts): BuildParts {
  return JSON.parse(JSON.stringify(p)) as BuildParts;
}

const NAME: Record<CellKind, string> = { wall: 'wall', window: 'window', door: 'door', flatDoor: 'front door', entrance: 'street door', stair: 'stair' };

/**
 * What it takes to turn `now` into `target`, in the order it's done: things come out
 * first (top down), then new cells go in from the bottom up, then the insulation.
 * Furniture isn't building work: it goes in straight away (see furnish.ts).
 */
export function piecesBetween(now: BuildParts, target: BuildParts): Piece[] {
  const out: Piece[] = [];
  const at = (k: string) => k.split(',').map(Number) as [number, number];
  const byRow = (dir: 1 | -1) => (a: string, b: string) => dir * (at(a)[1] - at(b)[1]) || at(a)[0] - at(b)[0];
  const gone = Object.keys(now.cells).filter((k) => target.cells[k] === undefined).sort(byRow(-1));
  for (const k of gone) {
    const [x, s] = at(k);
    const was = now.cells[k];
    out.push({
      label: `Knocked out a ${NAME[was]}`,
      cost: DEMOLISH_PRICE,
      minutes: MINUTES.knockDown,
      x,
      s,
      removes: true,
      part: { kind: 'cell', cell: null, was },
      apply: (st) => {
        delete st.cells[k];
        delete st.insulated[k];
      },
    });
  }
  const added = Object.keys(target.cells).filter((k) => now.cells[k] !== target.cells[k]).sort(byRow(1));
  for (const k of added) {
    const [x, s] = at(k);
    const cell = target.cells[k];
    out.push({
      label: `Put in a ${NAME[cell]}`,
      cost: CELL_PRICE[cell],
      minutes: CELL_MINUTES[cell],
      x,
      s,
      removes: false,
      part: { kind: 'cell', cell, was: now.cells[k] },
      apply: (st) => {
        st.cells[k] = cell;
        if (isDoor(cell)) delete st.cells[key(x, s + 1)];
      },
    });
  }
  for (const k of Object.keys(target.insulated ?? {})) {
    if (now.insulated?.[k]) continue;
    const [x, s] = at(k);
    out.push({
      label: 'Insulated a wall',
      cost: INSULATE_PRICE,
      minutes: MINUTES.insulate,
      x,
      s,
      removes: false,
      part: { kind: 'insulate' },
      apply: (st) => {
        st.insulated[k] = true;
      },
    });
  }
  // Insulation the plan drops from a wall that stays (it's free, and instant).
  for (const k of Object.keys(now.insulated ?? {})) {
    if (target.insulated?.[k] || target.cells[k] === undefined) continue;
    const [x, s] = at(k);
    out.push({
      label: 'Stripped out insulation',
      cost: 0,
      minutes: 0,
      x,
      s,
      removes: true,
      part: { kind: 'insulate' },
      apply: (st) => {
        delete st.insulated[k];
      },
    });
  }
  // New risers, last: up every storey, from the ground. (Risers don't come out.)
  for (const x of target.risers ?? []) {
    if ((now.risers ?? target.risers ?? []).includes(x)) continue;
    out.push({
      label: 'Put in a riser',
      cost: riserPrice(target.cells),
      minutes: MINUTES.riserStorey * storeysOf(target.cells),
      x,
      s: 1,
      removes: false,
      part: { kind: 'riser' },
      apply: (st) => {
        const w = wetOf(st);
        if (!w.risers.includes(x)) w.risers = [...w.risers, x].sort((a, b) => a - b);
      },
    });
  }
  return out;
}

export interface Quote {
  cost: number;
  minutes: number;
  pieces: number;
}

export function quote(pieces: readonly Piece[]): Quote {
  return {
    cost: pieces.reduce((n, p) => n + p.cost, 0),
    minutes: pieces.reduce((n, p) => n + p.minutes, 0),
    pieces: pieces.length,
  };
}

/** "about 2 days", in builders' working days. */
export function howLong(minutes: number): string {
  if (minutes <= 0) return 'no time';
  if (minutes < 60) return 'under an hour';
  if (minutes < WORK_MINUTES_A_DAY) {
    const h = Math.round(minutes / 60);
    return `about ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round((minutes / WORK_MINUTES_A_DAY) * 2) / 2;
  return `about ${d} working day${d === 1 ? '' : 's'}`;
}

const jobCache = new WeakMap<Sim, { version: number; job: BuildParts; pieces: Piece[] }>();

/** What the builders have left to do (worked out again only when the building or the job changes). */
export function jobPieces(sim: Sim): Piece[] {
  const job = sim.state.works.job;
  if (!job) return [];
  const c = jobCache.get(sim);
  if (c && c.version === sim.version && c.job === job) return c.pieces;
  const pieces = piecesBetween(partsOf(sim.state), job);
  jobCache.set(sim, { version: sim.version, job, pieces });
  return pieces;
}

/** The building as you've planned it: your plans, or else the job underway, or else as it is. */
export function plannedParts(st: State): BuildParts {
  return st.works.plan ?? st.works.job ?? partsOf(st);
}

/**
 * Hands your plans to the builders. They're checked against what you can pay for the lot,
 * though they only take the money a piece at a time. Returns why not, if not.
 */
export function signOff(sim: Sim): string | null {
  const st = sim.state;
  const plan = st.works.plan;
  if (!plan) return 'Nothing planned';
  const q = quote(piecesBetween(partsOf(st), plan));
  if (q.pieces === 0) {
    st.works.plan = null;
    st.works.job = null;
    return null;
  }
  if (q.cost > st.money) return `It comes to ${pounds(q.cost)} and you have ${pounds(st.money)}`;
  if (unapproved(st, plan.risers).length > 0) return 'Building control haven\'t approved the riser yet';
  const starting = !st.works.job;
  st.works.job = plan;
  st.works.plan = null;
  st.works.waiting = false;
  if (starting) {
    st.works.progress = 0;
    sim.notify(`${BUILDERS} have the job: ${pounds(q.cost)}, ${howLong(q.minutes)}. ${onSiteNow(sim) ? 'They start now.' : 'They work 8 till 5, not Sundays.'}`);
  } else sim.notify(`${BUILDERS} have the changes: ${pounds(q.cost)} left to pay, ${howLong(q.minutes)}.`);
  return null;
}

/** Throws your plans away (the job underway carries on). */
export function discardPlans(st: State): void {
  st.works.plan = null;
}

/** Stops the builders: what's done is done, the rest is forgotten. */
export function stopJob(sim: Sim): void {
  const st = sim.state;
  if (!st.works.job) return;
  st.works.job = null;
  st.works.plan = null;
  st.works.progress = 0;
  sim.notify(`${BUILDERS} have packed up. What's done is done.`);
}

function onSiteNow(sim: Sim): boolean {
  const weekday = (sim.day - 1) % 7;
  const m = sim.minuteOfDay;
  return weekday !== 6 && m >= START_MINUTE && m < END_MINUTE;
}

/** The piece the builders are on right now (for the noise, and drawing them), if they're working. */
export function currentPiece(sim: Sim): Piece | null {
  const st = sim.state;
  if (!st.works.job || st.works.waiting || !onSiteNow(sim)) return null;
  return jobPieces(sim).find((p) => p.minutes > 0) ?? null;
}

/** Which flat (or the shared parts) a piece of work is in. */
export function whereIs(sim: Sim, p: Piece): string {
  // A cell belongs to the room it's in, or else whatever's next to it: above first (a floor
  // belongs to the room on it), then either side, then below.
  const lay = sim.layout;
  const spots: [number, number][] = [[p.x, p.s], [p.x, p.s + 1], [p.x - 1, p.s], [p.x + 1, p.s], [p.x, p.s - 1]];
  for (const [x, s] of spots) {
    const flat = lay.flatAt(x, s);
    if (flat) return flat.id;
  }
  return SHARED;
}

/** Every game minute: the builders get on with it. */
export function worksMinute(sim: Sim): void {
  const st = sim.state;
  const w = st.works;
  if (!w.job) return;
  let pieces = jobPieces(sim);
  // Free, instant bits (stripping insulation that's going anyway) just happen.
  if (pieces.some((x) => x.minutes === 0)) {
    for (const p of pieces.filter((x) => x.minutes === 0)) p.apply(st);
    sim.changed();
    pieces = jobPieces(sim);
  }
  if (pieces.length === 0) {
    finish(sim);
    return;
  }
  if (!onSiteNow(sim)) return;
  const next = pieces[0];
  if (w.progress < next.minutes) w.progress++;
  if (w.progress < next.minutes) return;
  if (next.cost > 0 && st.money < next.cost) {
    if (!w.waiting) sim.notify(`${BUILDERS} have stopped: they want ${pounds(next.cost)} before they'll carry on.`);
    w.waiting = true;
    return;
  }
  w.waiting = false;
  const flat = whereIs(sim, next);
  if (flat !== SHARED && !w.flats.includes(flat)) w.flats.push(flat);
  next.apply(st);
  if (next.cost !== 0) book(sim, `${BUILDERS}: ${next.label.toLowerCase()}`, -next.cost);
  w.progress = 0;
  sim.changed();
  if (pieces.length === 1) finish(sim);
}

function finish(sim: Sim): void {
  const st = sim.state;
  const w = st.works;
  w.job = null;
  w.progress = 0;
  w.waiting = false;
  for (const p of st.pawns) {
    if (p.life && !p.life.leaving && w.flats.includes(p.life.flat)) remember(sim, p.life, 'doneUp');
  }
  w.flats = [];
  sim.notify(`${BUILDERS} have finished and left the place more or less tidy.`);
}

/** Once an hour: tenants in a flat the builders are in aren't pleased about it. */
export function worksHour(sim: Sim): void {
  const p = currentPiece(sim);
  if (!p) return;
  const flat = whereIs(sim, p);
  if (flat === SHARED) return;
  for (const t of sim.state.pawns) {
    if (t.life?.flat === flat && !t.life.away && !t.life.leaving) remember(sim, t.life, 'buildersIn');
  }
}

/** For the save: an empty works record. */
export function noWorks(): State['works'] {
  return { plan: null, job: null, progress: 0, waiting: false, flats: [] };
}
