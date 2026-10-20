// The wet stack. Water comes up and goes down a riser: a column of pipes up the back wall,
// through every floor. Kitchens and bathrooms connect to the nearest one by themselves (no
// pipes are drawn, ever). Near is cheap; far costs more to plumb in and wears faster, so it
// leaks more. The building comes with one riser, by the stairs. You can put in more: a
// building job a storey at a time, once building control have said yes. More risers, more
// freedom; dear, and one more thing that can leak.

import { furnitureDef } from './defs';
import { book, letter, pounds } from './economy';
import { pick, random } from './rng';
import type { Sim } from './sim';
import type { Furniture, State, Wet } from './state';
import { remember } from './thoughts';
import { RISERS } from './tuning';

/** Pieces that need the water: a sink, a cooker, a loo, a shower, a bath, a basin, a washing machine, a dishwasher. */
const WET = new Set(['sink', 'cooker', 'toilet', 'shower', 'bath', 'basin', 'washer', 'dishwasher']);

export function isWet(def: string): boolean {
  return WET.has(def);
}

/** Each storey is 4 rows (3 of room and 1 of floor) on a plinth 1 row high (as start.ts). */
const STOREY = 4;
const BASE = 1;

/** The risers' own dice: from the seed, so the rest of the game's dice never move. */
const RISER_DICE = 0x5e7a11;

/** The columns with a riser in. A building with none written down has the one it came with. */
export function risersOf(st: Pick<State, 'wet' | 'plot'>): number[] {
  return st.wet?.risers ?? [st.plot.x0 + RISERS.startColumn];
}

/** The wet stack's record, made the first time something's written to it. */
export function wetOf(st: State): Wet {
  st.wet ??= { risers: risersOf(st), approved: [], rng: (st.seed ^ RISER_DICE) | 0 };
  st.wet.approved ??= [];
  return st.wet;
}

/** Cells from the nearest riser to the nearest column of a piece `w` wide at `x`. */
export function pipeDistance(risers: readonly number[], x: number, w = 1): number {
  let best = Infinity;
  for (const r of risers) best = Math.min(best, r < x ? x - r : r > x + w - 1 ? r - (x + w - 1) : 0);
  return best;
}

/** How many cells further than the free reach a piece is from the pipes (0 if it doesn't need water). */
export function farCells(risers: readonly number[], def: string, x: number): number {
  if (!isWet(def)) return 0;
  const d = pipeDistance(risers, x, furnitureDef(def).w);
  return Math.min(RISERS.mostCells, Math.max(0, d - RISERS.freeReach));
}

/** What plumbing a piece in at `x` costs on top of its price. */
export function pipeCost(st: Pick<State, 'wet' | 'plot'>, def: string, x: number): number {
  return farCells(risersOf(st), def, x) * RISERS.perCell;
}

/** How much faster a piece wears for being far from the pipes (1 if it's near, or dry). */
export function pipeWear(st: State, f: Furniture): number {
  return 1 + farCells(risersOf(st), f.def, f.x) * RISERS.wearPerCell;
}

/** How many storeys a building has, from its top row. */
export function storeysOf(cells: Record<string, unknown>): number {
  let top = 0;
  for (const k of Object.keys(cells)) top = Math.max(top, Number(k.split(',')[1]));
  return Math.max(1, Math.ceil((top - BASE + 1) / STOREY));
}

/** A new riser, up every storey of this building. */
export function riserPrice(cells: Record<string, unknown>): number {
  return RISERS.perStorey * storeysOf(cells);
}

/** Risers in a plan that the building hasn't got yet. */
export function newRisers(st: State, planned: readonly number[] | undefined): number[] {
  const now = risersOf(st);
  return (planned ?? now).filter((x) => !now.includes(x));
}

/** New risers in a plan that building control haven't said yes to. */
export function unapproved(st: State, planned: readonly number[] | undefined): number[] {
  const ok = st.wet?.approved ?? [];
  return newRisers(st, planned).filter((x) => !ok.includes(x));
}

/** Why a riser can't go up this column (in a plan that already has `planned`), or null. */
export function riserProblem(st: State, planned: readonly number[], x: number): string | null {
  if (x < st.plot.x0 || x > st.plot.x1) return 'Outside your plot';
  if (risersOf(st).includes(x)) return 'There\'s a riser there already';
  if (planned.includes(x)) return 'A riser is planned there already';
  return null;
}

/** Puts the risers in (signing off a plan). */
export function setRisers(sim: Sim, risers: readonly number[] | undefined): void {
  if (!risers) return;
  const now = risersOf(sim.state);
  if (risers.length === now.length && risers.every((x) => now.includes(x))) return;
  wetOf(sim.state).risers = [...new Set([...now, ...risers])].sort((a, b) => a - b);
  sim.changed();
}

// ------------------------------------------------------------------ building control

const CONTROL = 'Harrowgate City Council, Building Control';

export function controlProblem(sim: Sim, cols: readonly number[]): string | null {
  const st = sim.state;
  if (st.wet?.applied) return `Waiting on building control (they decide on day ${st.wet.applied.decideDay})`;
  if (cols.length === 0) return 'Nothing for them to look at';
  if (st.money < RISERS.controlFee) return `The fee is ${pounds(RISERS.controlFee)}`;
  return null;
}

/** Asks building control to approve new risers up these columns. */
export function applyForRisers(sim: Sim, cols: readonly number[]): string | null {
  const problem = controlProblem(sim, cols);
  if (problem) return problem;
  const w = wetOf(sim.state);
  book(sim, 'Building control fee', -RISERS.controlFee);
  const decideDay = sim.day + RISERS.controlDays;
  w.applied = { cols: [...cols], decideDay };
  letter(sim, {
    from: CONTROL,
    title: 'Application received',
    body: `We have your application for ${cols.length === 1 ? 'a new riser' : `${cols.length} new risers`}. An officer will look at the drawings, and at the drains. You will have our decision on day ${decideDay}.`,
  });
  return null;
}

const REFUSALS = [
  'The drawings show the soil pipe going uphill.',
  'The officer could not find the drains, and was not prepared to look further.',
  'The application was made on the back of a takeaway menu.',
];

/** Every morning: building control's decision, if it's due, and now and then a riser leaks. */
export function risersMorning(sim: Sim): void {
  const st = sim.state;
  const w = wetOf(st);
  if (w.applied && sim.day >= w.applied.decideDay) {
    const { cols } = w.applied;
    delete w.applied;
    if (random(w) < RISERS.approve) {
      w.approved = [...new Set([...w.approved, ...cols])];
      letter(sim, { from: CONTROL, title: 'Approved', body: `The ${cols.length === 1 ? 'riser is' : 'risers are'} approved. Your builder may start when ready. Please tell them the stopcock is not optional.` });
    } else {
      letter(sim, { from: CONTROL, title: 'Not approved', body: `${pick(w, REFUSALS)} You may apply again.` });
    }
  }
  for (const x of risersOf(st)) if (random(w) < RISERS.leakChance) riserLeak(sim, x);
}

// ------------------------------------------------------------------ leaks

/** The rooms (by id) a riser runs through, from the ground up to this storey. */
export function wetRooms(sim: Sim, x: number, storey: number): number[] {
  const lay = sim.layout;
  const out: number[] = [];
  for (let k = 0; k <= storey; k++) {
    const row = BASE + k * STOREY;
    // A riser in a wall wets the room either side; one in a room wets that room.
    for (const cx of [x, x - 1, x + 1]) {
      if (cx < 0 || cx >= lay.w) continue;
      const r = lay.roomOf[lay.node(cx, row)];
      if (r < 0 || lay.rooms[r].outdoor || out.includes(r)) continue;
      out.push(r);
      if (cx === x) break;
    }
  }
  return out;
}

/**
 * A riser leaks: the water runs down it, wetting the room it's in on that floor and every
 * floor below. The most worn thing in each room takes the water; whoever lives there
 * remembers it; the plumber is on you.
 */
export function riserLeak(sim: Sim, x: number): void {
  const st = sim.state;
  const w = wetOf(st);
  const storey = Math.floor(random(w) * storeysOf(st.cells));
  w.leak = { x, storey, day: sim.day };
  const lay = sim.layout;
  const rooms = wetRooms(sim, x, storey);
  const flats = new Set<string>();
  for (const r of rooms) {
    const room = lay.rooms[r];
    if (room.flat) flats.add(room.flat);
    const cells = new Set(room.cells);
    const soaked = st.furniture
      .filter((f) => f.broken === undefined && furnitureDef(f.def).offers && cells.has(lay.node(f.x, f.s)))
      .sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0) || a.id - b.id)[0];
    if (soaked) soaked.wear = Math.min(0.95, (soaked.wear ?? 0) + RISERS.leakWear);
  }
  for (const p of st.pawns) if (p.life && !p.life.leaving && flats.has(p.life.flat)) remember(sim, p.life, 'riserLeak');
  book(sim, 'Plumber: the riser', -RISERS.leakPlumber);
  const names = [...flats].map((id) => lay.flat(id)?.name).filter(Boolean) as string[];
  const where = names.length === 0 ? 'the stairwell' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  sim.notify(`The riser sprang a leak. Water down the wall in ${where}. The plumber's been: ${pounds(RISERS.leakPlumber)}.`);
}
