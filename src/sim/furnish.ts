// Furniture isn't building work: it's bought, moved, turned round and sold on the spot,
// with no builders and no waiting. Building work you've planned but not finished still
// counts, so a sofa can't go where a planned wall will stand (pass the plans as `plan`).

import { furnitureProblem, moveFurniture, placeFurniture, removeFurniture, flipFurniture } from './build';
import { furnitureDef, isGraded } from './defs';
import { POUND, RESALE, book, furniturePrice, pounds } from './economy';
import { gradeOf, gradeProblem, gradedName } from './grades';
import type { Sim } from './sim';
import type { Furniture, Grade, State } from './state';
import { disturb } from './tenants';

/** Why a piece can't go here, now or once the plans are built. */
function problem(sim: Sim, plan: State | undefined, def: string, x: number, s: number, ignoreId?: number): string | null {
  return furnitureProblem(sim.state, def, x, s, ignoreId) ?? (plan ? furnitureProblem(plan, def, x, s, ignoreId) : null);
}

/** Buys a piece (at a grade, for the pieces that come in grades) and puts it in. Returns it, or why not. */
export function buyFurniture(sim: Sim, def: string, x: number, s: number, flip: boolean, plan?: State, grade: Grade = 'standard'): Furniture | string {
  const st = sim.state;
  const g = isGraded(def) ? grade : 'standard';
  const locked = gradeProblem(sim, def, g);
  if (locked) return locked;
  const price = furniturePrice(def, g);
  if (st.money < price) return `Can't afford it: it's ${pounds(price)} and you have ${pounds(st.money)}`;
  const why = problem(sim, plan, def, x, s);
  if (why) return why;
  const f = placeFurniture(st, def, x, s, flip, g);
  if (typeof f === 'string') return f;
  book(sim, `Bought a ${g === 'standard' ? '' : `${g} `}${furnitureDef(def).name.toLowerCase()}`, -price);
  sim.changed();
  return f;
}

/** Moves a piece. Returns why not, if it can't go there. */
export function shiftFurniture(sim: Sim, id: number, x: number, s: number, plan?: State): string | null {
  const f = sim.state.furniture.find((o) => o.id === id);
  if (!f) return 'Gone';
  if (f.x === x && f.s === s) return null;
  const why = problem(sim, plan, f.def, x, s, id) ?? moveFurniture(sim.state, id, x, s);
  if (why) return why;
  disturb(sim, id);
  sim.changed();
  return null;
}

export function turnFurniture(sim: Sim, id: number): void {
  if (!flipFurniture(sim.state, id)) return;
  disturb(sim, id);
  sim.changed();
}

/** What you get back for a piece (at its grade). */
export function resaleOf(def: string, grade: Grade = 'standard'): number {
  return Math.round((furniturePrice(def, grade) * RESALE) / POUND) * POUND;
}

/** Sells a piece off for a fraction of what it cost. */
export function sellFurniture(sim: Sim, id: number): void {
  const f = sim.state.furniture.find((o) => o.id === id);
  if (!f) return;
  disturb(sim, id);
  removeFurniture(sim.state, id);
  book(sim, `Sold a ${gradedName(f).toLowerCase()}`, resaleOf(f.def, gradeOf(f)));
  sim.changed();
}
