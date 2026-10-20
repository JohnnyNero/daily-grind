// How impressive a flat is. Eight factors, each 0 to 100: space per person, how well it's
// furnished, the basics (a bed, a loo, somewhere to wash, a kitchen), light, decoration,
// how clean it is, how warm, and how quiet.
// The score is mostly their average, but the weakest one drags it down, and space is a
// ceiling: a tiny flat can't be impressive however nice the sofa. Scores fall into named
// tiers, and the tiers are what tenants notice.

import { furnitureDef } from './defs';
import { furnitureValue } from './grades';
import type { Sim } from './sim';
import { warmthOf } from './environment';
import { dampDrag } from './damp';
import { amenities, hasOwnWasher } from './shared';
import { flatKind, scoredFor } from './rooms';
import { curve } from './stat';
import { AMENITIES, IMPRESSIVE, LAYOUT_L11, TIERS, WARMTH } from './tuning';

export type FactorId = 'space' | 'furnishing' | 'basics' | 'light' | 'decor' | 'clean' | 'warmth' | 'quiet';

export const FACTOR_NAMES: Record<FactorId, string> = {
  space: 'Space',
  furnishing: 'Furnishing',
  basics: 'Basics',
  light: 'Light',
  decor: 'Decoration',
  clean: 'Cleanliness',
  warmth: 'Warmth',
  quiet: 'Quiet',
};

// The tiers and the weights are in tuning.ts.
export { TIERS } from './tuning';

export interface FlatScore {
  score: number;
  tier: string;
  factors: Record<FactorId, number>;
  weakest: FactorId;
  /** Floor tiles per person living there (or for one person, if it's empty). */
  perPerson: number;
  has: { bed: boolean; toilet: boolean; wash: boolean; kitchen: boolean };
}

const cache = new WeakMap<Sim, { key: string; scores: Map<string, FlatScore> }>();

export function occupants(sim: Sim, flatId: string): number {
  return sim.state.pawns.filter((p) => p.life?.flat === flatId && !p.life.leaving).length;
}

export function flatScore(sim: Sim, flatId: string): FlatScore {
  const key = `${sim.version}|${Math.floor(sim.state.tick / 3600)}|${sim.state.pawns.filter((p) => p.life && !p.life.leaving).map((p) => p.life!.flat).join(',')}`;
  let c = cache.get(sim);
  if (!c || c.key !== key) {
    c = { key, scores: new Map() };
    cache.set(sim, c);
  }
  let s = c.scores.get(flatId);
  if (!s) {
    s = computeScore(sim, flatId);
    c.scores.set(flatId, s);
  }
  return s;
}

/** How a flat would score with this many people in it (for applicants). */
export function scoreFor(sim: Sim, flatId: string, people: number): FlatScore {
  return computeScore(sim, flatId, people);
}

/**
 * How good a flat is for its going rate: scored with one person to a bedroom, whoever lives
 * there. Squeezing more people in doesn't make it a worse one-bed; it makes them cramped.
 */
export function rentScore(sim: Sim, flatId: string): FlatScore {
  return scoreFor(sim, flatId, scoredFor(flatKind(sim, flatId)));
}

function computeScore(sim: Sim, flatId: string, peopleOverride?: number): FlatScore {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  const nodes = flat ? flat.rooms.flatMap((r) => lay.rooms[r].nodes) : [];
  const inFlat = new Set(flat ? lay.flatCells(flat) : []);
  const furniture = sim.state.furniture.filter((f) => inFlat.has(lay.node(f.x, f.s)));
  const defs = furniture.map((f) => furnitureDef(f.def));
  // Broken things don't count as having one.
  const working = furniture.filter((f) => f.broken === undefined).map((f) => furnitureDef(f.def));
  // An empty flat is scored as it would be lived in: one to a bedroom.
  const people = Math.max(1, peopleOverride ?? (occupants(sim, flatId) || scoredFor(flatKind(sim, flatId))));
  const perPerson = nodes.length / people;
  const has = {
    bed: working.some((d) => d.id === 'bed' || d.id === 'doubleBed'),
    toilet: working.some((d) => d.id === 'toilet'),
    wash: working.some((d) => d.id === 'shower' || d.id === 'bath'),
    kitchen: working.some((d) => d.id === 'cooker' || d.id === 'fridge'),
  };
  // Windows next to any of the flat's cells.
  let windows = 0;
  const seen = new Set<string>();
  for (const n of inFlat) {
    const [x, s] = lay.xs(n);
    for (const [wx, ws] of [[x - 1, s], [x + 1, s], [x, s - 1], [x, s + 1]]) {
      const k = `${wx},${ws}`;
      if (!seen.has(k) && lay.cell(wx, ws) === 'window') windows++;
      seen.add(k);
    }
  }
  const lamps = defs.filter((d) => d.id === 'lamp').length;
  // Posh things make it look better furnished, cheap ones worse.
  const value = furniture.reduce((n, f) => n + furnitureValue(f), 0);
  const I = IMPRESSIVE;
  const factors: Record<FactorId, number> = {
    space: curve(perPerson, I.space),
    furnishing: Math.min(100, (value / Math.max(1, nodes.length)) * I.furnishing),
    basics: (Number(has.bed) + Number(has.toilet) + Number(has.wash) + Number(has.kitchen)) * 25,
    light: Math.min(100, I.light.base + windows * I.light.window + lamps * I.light.lamp),
    decor: Math.min(100, decorPoints(sim, flat ? flat.rooms : [], furniture) * I.decor),
    // Damp over the line drags it down too (layout L3).
    clean: Math.max(0, 100 * (1 - (sim.state.dirt[flatId] ?? 0)) - dampDrag(sim, flatId)),
    warmth: 100 * warmthOf(sim.state.temps[flatId] ?? WARMTH.start),
    quiet: Math.max(0, 100 - (sim.state.noiseAvg[flatId] ?? 0) * I.quietPerNoise),
  };
  const values = Object.values(factors);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let score = I.meanShare * mean + (1 - I.meanShare) * Math.min(...values);
  const ceiling = factors.space * I.spaceCeiling;
  if (score > ceiling) score = ceiling + (score - ceiling) * I.overCeiling;
  // A garden, a laundry or somewhere for the bikes makes every flat in the building a bit nicer.
  const have = amenities(sim);
  if (have.garden) score += AMENITIES.score.garden;
  if (have.laundry || hasOwnWasher(sim, flatId)) score += AMENITIES.score.laundry;
  if (have.bikes) score += AMENITIES.score.bikes;
  // Missing the basics caps it too: a gutted flat is grim however quiet it is.
  score = Math.min(score, I.basicsCapBase + factors.basics * I.basicsCapShare);
  score = Math.round(Math.max(0, Math.min(100, score)));
  const weakest = (Object.keys(factors) as FactorId[]).reduce((a, b) => (factors[b] < factors[a] ? b : a));
  return { score, tier: tierOf(score), factors, weakest, perPerson, has };
}

/**
 * Decorations counted for what they add: the first of a kind in a room counts whole, the
 * second half, the third a quarter. A skip of pot plants in one room is still one room.
 */
function decorPoints(sim: Sim, rooms: number[], furniture: Sim['state']['furniture']): number {
  const lay = sim.layout;
  const roomOf = new Map<number, number>();
  for (const r of rooms) for (const n of lay.rooms[r].nodes) roomOf.set(n, r);
  const seen = new Map<string, number>();
  let points = 0;
  for (const f of furniture) {
    const d = furnitureDef(f.def);
    if (!d.decor) continue;
    const k = `${roomOf.get(lay.node(f.x, f.s)) ?? -1}|${d.id}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    points += LAYOUT_L11.repeat ** n;
  }
  return points;
}

export function tierOf(score: number): string {
  return TIERS.find((t) => score >= t.min)!.name;
}

/** One line of what a flat needs: done or not, whether people won't live there without it, and the build group that has it. */
export interface Need {
  label: string;
  done: boolean;
  must: boolean;
  group: string;
}

/**
 * What a flat needs before anyone will live there (walls and a ceiling, a bed, a loo,
 * somewhere to wash, a kitchen), then what makes it nicer (warmth, somewhere to sit, light).
 */
export function flatNeeds(sim: Sim, flatId: string): Need[] {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return [];
  const s = scoreFor(sim, flatId, Math.max(1, occupants(sim, flatId)));
  const inFlat = new Set(lay.flatCells(flat));
  const defs = sim.state.furniture.filter((f) => f.broken === undefined && inFlat.has(lay.node(f.x, f.s))).map((f) => f.def);
  const any = (...ids: string[]) => defs.some((d) => ids.includes(d));
  return [
    { label: 'Walls and a ceiling', done: flat.enclosed, must: true, group: 'walls' },
    { label: 'A bed', done: s.has.bed, must: true, group: 'sleep' },
    { label: 'A loo', done: s.has.toilet, must: true, group: 'bathroom' },
    { label: 'A shower or a bath', done: s.has.wash, must: true, group: 'bathroom' },
    { label: 'A cooker or a fridge', done: s.has.kitchen, must: true, group: 'kitchen' },
    { label: 'A smoke alarm (the council checks)', done: any('smokeAlarm'), must: false, group: 'decor' },
    { label: 'A radiator', done: any('radiator'), must: false, group: 'decor' },
    { label: 'Somewhere to sit', done: any('sofa', 'armchair', 'chair'), must: false, group: 'sit' },
    { label: 'A window or a lamp', done: s.factors.light > 15, must: false, group: 'decor' },
    { label: 'Somewhere to do the washing', done: any('washer') || amenities(sim).laundry !== null, must: false, group: 'shared' },
  ];
}
