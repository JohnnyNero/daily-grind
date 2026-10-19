// Furniture grades. A piece you use comes cheap, standard or posh: cheap saves money now but
// looks it, wears out sooner and gives someone a lumpy night; posh costs twice as much, lasts,
// makes a flat look the part, and tempts burglars. Posh is locked to start with and opens up
// once you've a good name, a smart flat, or have kept at it a month. Upgrading a piece pays
// the difference and swaps it for a new one where it stands.

import { furnitureDef, isGraded } from './defs';
import { book, furniturePrice, pounds } from './economy';
import { flatScore, TIERS } from './impressiveness';
import { landlordRating } from './leases';
import type { Sim } from './sim';
import type { Furniture, Grade } from './state';
import { GRADES, POSH_UNLOCK } from './tuning';

export const GRADE_ORDER: readonly Grade[] = ['cheap', 'standard', 'posh'];
export const GRADE_NAMES: Record<Grade, string> = { cheap: 'Cheap', standard: 'Standard', posh: 'Posh' };

/** A piece's grade (standard for anything that doesn't come in grades). */
export function gradeOf(f: Pick<Furniture, 'def' | 'grade'>): Grade {
  return isGraded(f.def) ? (f.grade ?? 'standard') : 'standard';
}

/** What a piece is worth to how furnished a flat looks, allowing for its grade. */
export function furnitureValue(f: Pick<Furniture, 'def' | 'grade'>): number {
  return furnitureDef(f.def).value * GRADES.value[gradeOf(f)];
}

/** How fast it wears, against a standard one. */
export function wearFactor(f: Pick<Furniture, 'def' | 'grade'>): number {
  return GRADES.wear[gradeOf(f)];
}

/** Its name with its grade in front, if it isn't standard: "Posh sofa", "Cheap single bed". */
export function gradedName(f: Pick<Furniture, 'def' | 'grade'>): string {
  const g = gradeOf(f);
  const name = furnitureDef(f.def).name;
  return g === 'standard' ? name : `${GRADE_NAMES[g]} ${name.toLowerCase()}`;
}

/** The groups (kitchen, bathroom and so on) a flat has a working posh piece in. */
export function poshGroups(sim: Sim, flatId: string): Set<string> {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  const out = new Set<string>();
  if (!flat) return out;
  const cells = new Set(lay.flatCells(flat));
  for (const f of sim.state.furniture) {
    if (f.grade === 'posh' && f.broken === undefined && isGraded(f.def) && cells.has(lay.node(f.x, f.s))) out.add(furnitureDef(f.def).group);
  }
  return out;
}

// ------------------------------------------------------------------ the posh ladder

/** What would open up posh right now, in words, or null. */
function poshReason(sim: Sim): string | null {
  const rating = landlordRating(sim);
  if (rating !== null && rating >= POSH_UNLOCK.stars) return `Tenants rate you ${rating.toFixed(1)} stars`;
  const line = TIERS.findIndex((t) => t.name === POSH_UNLOCK.tier);
  const smart = sim.layout.flats.find((f) => TIERS.findIndex((t) => t.name === flatScore(sim, f.id).tier) <= line);
  if (smart) return `${smart.name} is ${flatScore(sim, smart.id).tier.toLowerCase()}`;
  if (sim.day >= POSH_UNLOCK.day) return `You've kept at it for ${POSH_UNLOCK.day} days`;
  return null;
}

/** Can you buy posh yet? Once it's open it stays open. */
export function poshUnlocked(sim: Sim): boolean {
  return sim.state.poshFrom !== undefined || poshReason(sim) !== null;
}

/** What it takes to open up posh, for the build bar. */
export function poshLockedWhy(): string {
  return `Posh opens up at ${POSH_UNLOCK.stars} stars, a ${POSH_UNLOCK.tier.toLowerCase()} flat, or day ${POSH_UNLOCK.day}`;
}

/** Every morning: has posh opened up? Says so the once. */
export function gradesMorning(sim: Sim): void {
  if (sim.state.poshFrom !== undefined) return;
  const why = poshReason(sim);
  if (!why) return;
  sim.state.poshFrom = sim.day;
  sim.notify(`${why}: posh furniture is open to you now. It's in build mode.`);
}

/** Why a piece can't be bought at a grade, or null. */
export function gradeProblem(sim: Sim, def: string, grade: Grade): string | null {
  if (grade === 'standard') return null;
  if (!isGraded(def)) return `A ${furnitureDef(def).name.toLowerCase()} only comes in one grade`;
  if (grade === 'posh' && !poshUnlocked(sim)) return poshLockedWhy();
  return null;
}

/** What it costs to take a piece up to a grade: the difference between new prices. */
export function upgradeCost(f: Pick<Furniture, 'def' | 'grade'>, to: Grade): number {
  return Math.max(0, furniturePrice(f.def, to) - furniturePrice(f.def, gradeOf(f)));
}

/** The grades a piece can go up to. */
export function upgradesFor(f: Pick<Furniture, 'def' | 'grade'>): Grade[] {
  if (!isGraded(f.def)) return [];
  return GRADE_ORDER.slice(GRADE_ORDER.indexOf(gradeOf(f)) + 1);
}

/**
 * Swaps a piece for a better one where it stands, paying the difference. It comes new (no
 * wear, not broken). Returns why not, or null.
 */
export function upgradeFurniture(sim: Sim, id: number, to: Grade): string | null {
  const f = sim.state.furniture.find((o) => o.id === id);
  if (!f) return 'Gone';
  if (!upgradesFor(f).includes(to)) return `It's already ${GRADE_NAMES[gradeOf(f)].toLowerCase()}`;
  const why = gradeProblem(sim, f.def, to);
  if (why) return why;
  const cost = upgradeCost(f, to);
  if (sim.state.money < cost) return `Can't afford it: it's ${pounds(cost)} and you have ${pounds(sim.state.money)}`;
  book(sim, `Upgraded the ${furnitureDef(f.def).name.toLowerCase()} to ${GRADE_NAMES[to].toLowerCase()}`, -cost);
  if (to === 'standard') delete f.grade;
  else f.grade = to;
  delete f.wear;
  delete f.broken;
  delete f.reported;
  sim.changed();
  return null;
}
