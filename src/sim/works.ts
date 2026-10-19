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
import { furnitureDef } from './defs';
import { DEMOLISH_PRICE, FLOOR_PRICE, INSULATE_PRICE, RESALE, SEGMENT_PRICE, STAIRS_PRICE, book, furniturePrice, pounds } from './economy';
import { SHARED } from './environment';
import type { Sim } from './sim';
import { type Furniture, type Segment, type Stair, type State } from './state';
import { remember } from './thoughts';

export const BUILDERS = 'Bodge & Sons';

/** Builders work 8 till 5, Monday to Saturday. */
const START_MINUTE = 8 * 60;
const END_MINUTE = 17 * 60;
export const WORK_MINUTES_A_DAY = END_MINUTE - START_MINUTE;

/** How loud the builders are where they're working. */
export const BUILDER_NOISE = 5;

/** Minutes of work for each kind of piece. */
const SEGMENT_MINUTES: Record<Segment, number> = { wall: 60, window: 90, door: 60, flatDoor: 90, entrance: 120 };
const MINUTES = { knockDown: 30, floor: 20, stairs: 360, insulate: 45, furniture: 15, shift: 10 };

/** One thing to do: what, where (for drawing it and the noise), what it costs and how long. */
export interface Piece {
  label: string;
  /** Pence; negative for furniture sold off. */
  cost: number;
  minutes: number;
  /** Where the work is: a column and storey. */
  x: number;
  s: number;
  /** Takes something away (drawn crossed out) rather than adding it. */
  removes: boolean;
  /** For drawing it: a wall segment, a floor slab, stairs, furniture (and where it was, if it's moving) or insulation. */
  part:
    | { kind: 'segment'; seg: Segment | null }
    | { kind: 'slab'; level: number }
    | { kind: 'stair'; stair: Stair }
    | { kind: 'furniture'; f: Furniture; from?: Furniture }
    | { kind: 'insulate'; key: string };
  apply(st: State): void;
}

export function partsOf(st: State): BuildParts {
  return { walls: st.walls, slabs: st.slabs, stairs: st.stairs, furniture: st.furniture, insulated: st.insulated };
}

export function copyParts(p: BuildParts): BuildParts {
  return JSON.parse(JSON.stringify(p)) as BuildParts;
}

/**
 * What it takes to turn `now` into `target`, in the order it's done: things come out
 * before new things go in, floors before walls, walls before stairs, furniture last.
 */
export function piecesBetween(now: BuildParts, target: BuildParts): Piece[] {
  const out: Piece[] = [];
  const cols = (k: string) => k.split(',').map(Number) as [number, number];
  const furnAfter = new Map(target.furniture.map((f) => [f.id, f]));
  const furnBefore = new Map(now.furniture.map((f) => [f.id, f]));
  const stairsAfter = new Set(target.stairs.map((t) => t.id));
  const stairsBefore = new Set(now.stairs.map((t) => t.id));

  for (const f of now.furniture) {
    if (furnAfter.has(f.id)) continue;
    const name = furnitureDef(f.def).name;
    out.push({
      label: `Took out the ${name.toLowerCase()}`,
      cost: -Math.round(furniturePrice(f.def) * RESALE),
      minutes: MINUTES.shift,
      x: f.x,
      s: f.s,
      removes: true,
      part: { kind: 'furniture', f },
      apply: (st) => {
        st.furniture = st.furniture.filter((o) => o.id !== f.id);
      },
    });
  }
  for (const t of now.stairs) {
    if (stairsAfter.has(t.id)) continue;
    out.push({
      label: 'Took out the stairs',
      cost: DEMOLISH_PRICE,
      minutes: MINUTES.knockDown * 2,
      x: t.x + 1,
      s: t.s,
      removes: true,
      part: { kind: 'stair', stair: t },
      apply: (st) => {
        st.stairs = st.stairs.filter((o) => o.id !== t.id);
      },
    });
  }
  for (const k of Object.keys(now.walls)) {
    if (k in target.walls) continue;
    const [x, s] = cols(k);
    out.push({
      label: `Knocked out a ${segmentName(now.walls[k])}`,
      cost: DEMOLISH_PRICE,
      minutes: MINUTES.knockDown,
      x,
      s,
      removes: true,
      part: { kind: 'segment', seg: null },
      apply: (st) => {
        delete st.walls[k];
        delete st.insulated[`w:${k}`];
      },
    });
  }
  for (const k of Object.keys(now.slabs)) {
    if (target.slabs[k]) continue;
    const [x, level] = cols(k);
    out.push({
      label: 'Took up a floor',
      cost: DEMOLISH_PRICE,
      minutes: MINUTES.floor,
      x,
      s: level - 1,
      removes: true,
      part: { kind: 'slab', level },
      apply: (st) => {
        delete st.slabs[k];
        delete st.insulated[`f:${k}`];
      },
    });
  }
  for (const k of Object.keys(target.slabs)) {
    if (now.slabs[k]) continue;
    const [x, level] = cols(k);
    out.push({
      label: 'Laid a floor',
      cost: FLOOR_PRICE,
      minutes: MINUTES.floor,
      x,
      s: level - 1,
      removes: false,
      part: { kind: 'slab', level },
      apply: (st) => {
        st.slabs[k] = true;
      },
    });
  }
  for (const [k, seg] of Object.entries(target.walls)) {
    if (now.walls[k] === seg) continue;
    const [x, s] = cols(k);
    out.push({
      label: `Put in a ${segmentName(seg)}`,
      cost: SEGMENT_PRICE[seg],
      minutes: SEGMENT_MINUTES[seg],
      x,
      s,
      removes: false,
      part: { kind: 'segment', seg },
      apply: (st) => {
        st.walls[k] = seg;
      },
    });
  }
  for (const t of target.stairs) {
    if (stairsBefore.has(t.id)) continue;
    out.push({
      label: 'Built the stairs',
      cost: STAIRS_PRICE,
      minutes: MINUTES.stairs,
      x: t.x + 1,
      s: t.s,
      removes: false,
      part: { kind: 'stair', stair: t },
      apply: (st) => {
        st.stairs.push({ ...t });
      },
    });
  }
  for (const k of Object.keys(target.insulated ?? {})) {
    if (now.insulated?.[k]) continue;
    const [kind, rest] = k.split(':');
    const [x, n] = cols(rest);
    out.push({
      label: kind === 'w' ? 'Insulated a wall' : 'Insulated a floor',
      cost: INSULATE_PRICE,
      minutes: MINUTES.insulate,
      x,
      s: kind === 'w' ? n : n - 1,
      removes: false,
      part: { kind: 'insulate', key: k },
      apply: (st) => {
        st.insulated[k] = true;
      },
    });
  }
  // Insulation the plan drops without taking out its wall (it went with a wall that's coming back).
  for (const k of Object.keys(now.insulated ?? {})) {
    if (target.insulated?.[k]) continue;
    const [kind, rest] = k.split(':');
    const stays = kind === 'w' ? rest in target.walls : target.slabs[rest];
    if (!stays) continue;
    const [x, n] = cols(rest);
    out.push({
      label: 'Stripped out insulation',
      cost: 0,
      minutes: 0,
      x,
      s: kind === 'w' ? n : n - 1,
      removes: true,
      part: { kind: 'insulate', key: k },
      apply: (st) => {
        delete st.insulated[k];
      },
    });
  }
  for (const f of target.furniture) {
    const was = furnBefore.get(f.id);
    const name = furnitureDef(f.def).name.toLowerCase();
    if (!was) {
      out.push({
        label: `Delivered a ${name}`,
        cost: furniturePrice(f.def),
        minutes: MINUTES.furniture,
        x: f.x,
        s: f.s,
        removes: false,
        part: { kind: 'furniture', f },
        apply: (st) => {
          st.furniture.push({ ...f });
        },
      });
    } else if (was.x !== f.x || was.s !== f.s || was.r !== f.r || !!was.flip !== !!f.flip) {
      const moved = was.x !== f.x || was.s !== f.s || was.r !== f.r;
      out.push({
        label: moved ? `Moved the ${name}` : `Turned the ${name} round`,
        cost: 0,
        minutes: moved ? MINUTES.shift : 0,
        x: f.x,
        s: f.s,
        removes: false,
        part: { kind: 'furniture', f, from: was },
        apply: (st) => {
          const o = st.furniture.find((x) => x.id === f.id);
          if (!o) return;
          Object.assign(o, { x: f.x, s: f.s, r: f.r });
          if (f.flip) o.flip = true;
          else delete o.flip;
        },
      });
    }
  }
  return out;
}

function segmentName(seg: Segment): string {
  return { wall: 'wall', window: 'window', door: 'door', flatDoor: 'front door', entrance: 'street door' }[seg];
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
  // A floor belongs to the storey on it, or else the one under it; a wall to either side.
  const lay = sim.layout;
  const spots: [number, number][] = p.part.kind === 'slab' ? [[p.x, p.s + 1], [p.x, p.s]] : [[p.x, p.s], [p.x - 1, p.s], [p.x + 1, p.s]];
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
  // Free, instant bits (turning furniture round) just happen.
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
