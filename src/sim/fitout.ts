// Fitting out: what a place needs before it can open, and what it should have soon after.
// Mostly for the empty-lot start, where you build the whole thing yourself.

import { objectDef } from './defs';
import { canCook } from './kitchen';
import { SERVICE_DEFS } from './service';
import type { Sim } from './sim';

export interface FitOutItem {
  label: string;
  done: boolean;
  /** Needed to open at all, rather than just a good idea. */
  needed: boolean;
}

export function fitOut(sim: Sim): FitOutItem[] {
  const v = sim.venue;
  const s = sim.state;
  const has = (...defs: string[]) => s.objects.some((o) => defs.includes(o.def));
  const seats = s.objects.some((o) => v.guestSeating.includes(o.def));
  const hasTill = has(SERVICE_DEFS.till);
  return [
    { label: 'A till', done: hasTill, needed: true },
    { label: 'A pickup counter', done: has(SERVICE_DEFS.pickup), needed: true },
    { label: objectDef(v.drinkStation).label, done: has(v.drinkStation), needed: true },
    // Only counts once it joins up to the till.
    { label: 'A queue area', done: hasTill && sim.positions.queue.length > 1, needed: false },
    { label: 'A pickup area', done: sim.positions.wait.length > 0, needed: false },
    { label: 'A food counter', done: has(SERVICE_DEFS.food), needed: false },
    { label: 'An oven and prep counter for hot food', done: canCook(sim), needed: false },
    { label: 'A sink for the washing up', done: has('sink'), needed: false },
    { label: 'A toilet', done: has('toilet'), needed: false },
    { label: 'Somewhere to sit', done: seats, needed: false },
    { label: 'A staff sofa', done: has('staffSofa'), needed: false },
  ];
}

/** What's still missing before the doors can open, as a short sentence (or null when ready). */
export function openingShortfall(sim: Sim): string | null {
  const missing = fitOut(sim).filter((i) => i.needed && !i.done).map((i) => i.label.toLowerCase());
  if (missing.length === 0) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Needs ${list} to open.`;
}
