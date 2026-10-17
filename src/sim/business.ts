// The business side: how known the place is (fame), its star rating, how many people it
// can hold, what people will pay, and what it costs to run. Success should bring trade
// until the layout and the team become the limit, and growth should cost money.

import { OBJECT_DEFS, WORK_TYPES, objectDef, type Skills } from './defs';
import type { Sim } from './sim';
import type { DayStats, WeeklyReport } from './state';

// ------------------------------------------------------------------ fame and stars

/** Fame a brand-new place starts with: the neighbours have noticed, nobody else. */
export const STARTING_FAME = 10;
/** Share of fame forgotten each night: word of mouth needs feeding. */
const FAME_FADE = 0.03;

/** One guest's experience spreads (or doesn't). */
export function noteVisit(sim: Sim, mood: 'happy' | 'fine' | 'annoyed' | 'furious' | 'walkout' | 'turnedAway', weight = 1): void {
  const delta = { happy: 0.07, fine: 0.015, annoyed: -0.05, furious: -0.1, walkout: -0.09, turnedAway: -0.02 }[mood];
  addFame(sim, delta * weight);
}

export function addFame(sim: Sim, delta: number): void {
  sim.state.fame = Math.max(0, sim.state.fame + delta);
}

export function fadeFame(sim: Sim): void {
  const s = sim.state;
  s.fame = Math.max(0, s.fame - Math.max(0, s.fame - STARTING_FAME) * FAME_FADE);
}

/** Fame weighted by how good the place actually is: what the star rating is built from. */
export function standing(sim: Sim): number {
  return sim.state.fame * (0.4 + sim.state.reputation / 80);
}

const STAR_STEPS = [0, 18, 40, 75, 130] as const;

/** 1 to 5 stars. */
export function stars(sim: Sim): number {
  const v = standing(sim);
  let n = 1;
  for (let i = 1; i < STAR_STEPS.length; i++) if (v >= STAR_STEPS[i]) n = i + 1;
  return n;
}

/** How far to the next star, 0-1 (1 at five stars). */
export function starProgress(sim: Sim): number {
  const n = stars(sim);
  if (n >= 5) return 1;
  const lo = STAR_STEPS[n - 1];
  const hi = STAR_STEPS[n];
  return Math.max(0, Math.min(1, (standing(sim) - lo) / (hi - lo)));
}

export function starText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// ------------------------------------------------------------------ demand

/** Guests per hour, before the time of day: fame brings people, quality keeps them coming. */
export function demandFactor(sim: Sim): number {
  const s = sim.state;
  const known = 0.7 + s.fame / 60;
  const liked = 0.6 + s.reputation / 125;
  // A bigger menu (items unlocked with the stars) draws a few more people in.
  const variety = 1 + 0.04 * Math.max(0, s.menu.filter((m) => m.enabled).length - sim.venue.menu.length);
  return known * liked * variety * priceDraw(sim);
}

/** Guest seats on the floor right now. */
export function seatCount(sim: Sim): number {
  return sim.state.objects
    .filter((o) => sim.venue.guestSeating.includes(o.def))
    .reduce((n, o) => n + objectDef(o.def).spots.length, 0);
}

/** How many guests fit at once: the queue, the seats and a few standing. More tables, more trade. */
export function guestCapacity(sim: Sim): number {
  return sim.positions.queue.length + seatCount(sim) + 3;
}

/** What people will happily pay, as a multiple of the usual price. Grows with the stars. */
export function priceTolerance(sim: Sim): number {
  return 1 + (stars(sim) - 1) * 0.08;
}

/** Average menu price against the usual price, across what's on the menu (1 = normal). */
export function priceRatio(sim: Sim): number {
  const on = sim.state.menu.filter((m) => m.enabled);
  if (on.length === 0) return 1;
  return on.reduce((sum, m) => sum + m.price / m.basePrice, 0) / on.length;
}

/** How prices pull people in or put them off. Within what they'll pay, cheaper helps a little. */
export function priceDraw(sim: Sim): number {
  const over = priceRatio(sim) - priceTolerance(sim);
  return over <= 0 ? Math.min(1.25, 1 - over * 0.6) : Math.max(0.25, 1 - over * 1.6);
}

// ------------------------------------------------------------------ costs

/** Share of an item's usual price that goes on ingredients. */
export const INGREDIENT_SHARE = 0.18;

export function chargeIngredients(sim: Sim, basePrice: number): void {
  const cost = Math.round(basePrice * INGREDIENT_SHARE);
  sim.state.money -= cost;
  sim.state.today.ingredients += cost;
}

/** Wear added per drink made, out of 100. A machine lasts a few busy weeks between services. */
const WEAR_PER_DRINK = 0.12;
export const SERVICE_COST = 6000;

export function machineWear(sim: Sim, objectId: number): number {
  return sim.state.wear[objectId] ?? 0;
}

export function wearMachine(sim: Sim, objectId: number): void {
  const s = sim.state;
  s.wear[objectId] = Math.min(100, (s.wear[objectId] ?? 0) + WEAR_PER_DRINK);
}

/** Worst wear across the drinks machines: drives breakdowns. */
export function worstWear(sim: Sim): number {
  return Math.max(0, ...sim.state.objects.filter((o) => o.def === sim.venue.drinkStation).map((o) => machineWear(sim, o.id)));
}

/** Pays an engineer to service a machine: good as new. */
export function serviceMachine(sim: Sim, objectId: number): string | null {
  const o = sim.world.objectById(objectId);
  if (!o || o.def !== sim.venue.drinkStation) return 'That machine is gone.';
  if (machineWear(sim, objectId) < 5) return "It's practically new.";
  if (sim.state.money - SERVICE_COST < DEBT_LIMIT) return "The bank won't cover that.";
  sim.state.wear[objectId] = 0;
  sim.state.money -= SERVICE_COST;
  sim.state.today.repairs += SERVICE_COST;
  return null;
}

/** Business rates: a daily charge on the value of the fit-out, so a bigger place costs more. */
export function dailyRates(sim: Sim): number {
  const value = sim.state.objects.reduce((sum, o) => sum + (OBJECT_DEFS[o.def]?.price ?? 0), 0);
  return Math.round(value * 0.002);
}

export function dailyRent(sim: Sim): number {
  return sim.venue.rentPerDay + dailyRates(sim);
}

/** Pay someone would ask for with these skills, pence per hour. */
export function askingWage(skills: Skills): number {
  const avg = WORK_TYPES.reduce((n, w) => n + skills[w.id], 0) / WORK_TYPES.length;
  return Math.round((750 + avg * 40) / 5) * 5;
}

/** Below this, the bank stops lending: no buying, no building. */
export const DEBT_LIMIT = -50000;

export function canSpend(sim: Sim, pence: number): boolean {
  return sim.state.money - pence >= DEBT_LIMIT;
}

// ------------------------------------------------------------------ books

export function emptyDay(): DayStats {
  return { reviews: [], served: 0, walkouts: 0, turnedAway: 0, takings: 0, wages: 0, tips: 0, ingredients: 0, rent: 0, repairs: 0, other: 0 };
}

export function emptyWeek(sim: Sim, week: number, firstDay: number): WeeklyReport {
  const n = stars(sim);
  return {
    week, firstDay, takings: 0, wages: 0, ingredients: 0, rent: 0, repairs: 0, other: 0, served: 0, walkouts: 0,
    fameStart: sim.state.fame, fameEnd: sim.state.fame, starsStart: n, starsEnd: n, notes: [],
  };
}

/** Adds a finished day to the week's running totals. */
export function addDayToWeek(week: WeeklyReport, d: DayStats): void {
  week.takings += d.takings;
  week.wages += d.wages;
  week.ingredients += d.ingredients;
  week.rent += d.rent;
  week.repairs += d.repairs;
  week.other += d.other;
  week.served += d.served;
  week.walkouts += d.walkouts;
}
