// Fitting out: what a place needs before it can open, and what it should have soon after.
// Mostly for the empty-lot start, where you build the whole thing yourself.

import { objectDef } from './defs';
import type { Sim } from './sim';

export interface FitOutItem {
  label: string;
  done: boolean;
  /** Needed to open at all, rather than just a good idea. */
  needed: boolean;
}

export function fitOut(sim: Sim): FitOutItem[] {
  const v = sim.venue;
  const has = (...defs: string[]) => sim.state.objects.some((o) => defs.includes(o.def));
  const seats = sim.state.objects.some((o) => v.guestSeating.includes(o.def));
  return [
    { label: `A ${objectDef(v.counter).label.toLowerCase()}`, done: sim.counter !== undefined, needed: true },
    { label: `${objectDef(v.drinkStation).label}`, done: has(v.drinkStation), needed: true },
    { label: 'A sink for the washing up', done: has('sink'), needed: false },
    { label: 'A toilet', done: has('toilet'), needed: false },
    { label: 'Somewhere to sit', done: seats, needed: false },
    { label: 'A staff room sofa', done: has('staffSofa'), needed: false },
  ];
}

/** What's still missing before the doors can open, as a short sentence (or null when ready). */
export function openingShortfall(sim: Sim): string | null {
  const missing = fitOut(sim).filter((i) => i.needed && !i.done).map((i) => i.label.toLowerCase());
  if (missing.length === 0) return null;
  return `Needs ${missing.join(' and ')} to open.`;
}
