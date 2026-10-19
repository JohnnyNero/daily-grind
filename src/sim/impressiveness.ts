// How impressive a flat is. Eight factors, each 0 to 100: space per person, how well it's
// furnished, the basics (a bed, a loo, somewhere to wash, a kitchen), light, decoration,
// how clean it is, how warm, and how quiet.
// The score is mostly their average, but the weakest one drags it down, and space is a
// ceiling: a tiny flat can't be impressive however nice the sofa. Scores fall into named
// tiers, and the tiers are what tenants notice.

import { furnitureDef } from './defs';
import type { Sim } from './sim';
import { warmthOf } from './environment';

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

export const TIERS: readonly { min: number; name: string }[] = [
  { min: 90, name: 'Impressive' },
  { min: 78, name: 'Smart' },
  { min: 65, name: 'Nice' },
  { min: 50, name: 'Decent' },
  { min: 35, name: 'Plain' },
  { min: 20, name: 'Shabby' },
  { min: 0, name: 'Grim' },
];

export interface FlatScore {
  score: number;
  tier: string;
  factors: Record<FactorId, number>;
  weakest: FactorId;
  /** Floor tiles per person living there (or for one person, if it's empty). */
  perPerson: number;
  has: { bed: boolean; toilet: boolean; wash: boolean; kitchen: boolean };
}

const MEAN_SHARE = 0.65;

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

function computeScore(sim: Sim, flatId: string, peopleOverride?: number): FlatScore {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  const nodes = flat ? flat.rooms.flatMap((r) => lay.rooms[r].nodes) : [];
  const inFlat = new Set(flat ? lay.flatCells(flat) : []);
  const furniture = sim.state.furniture.filter((f) => inFlat.has(lay.node(f.x, f.s)));
  const defs = furniture.map((f) => furnitureDef(f.def));
  // Broken things don't count as having one.
  const working = furniture.filter((f) => f.broken === undefined).map((f) => furnitureDef(f.def));
  const people = Math.max(1, peopleOverride ?? occupants(sim, flatId));
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
  const value = defs.reduce((n, d) => n + d.value, 0);
  const factors: Record<FactorId, number> = {
    space: curve(perPerson, [[3, 15], [6, 45], [10, 70], [16, 90], [24, 100]]),
    furnishing: Math.min(100, (value / Math.max(1, nodes.length)) * 4.5),
    basics: (Number(has.bed) + Number(has.toilet) + Number(has.wash) + Number(has.kitchen)) * 25,
    light: Math.min(100, 15 + windows * 30 + lamps * 20),
    decor: Math.min(100, defs.filter((d) => d.decor).length * 20),
    clean: 100 * (1 - (sim.state.dirt[flatId] ?? 0)),
    warmth: 100 * warmthOf(sim.state.temps[flatId] ?? 18),
    quiet: Math.max(0, 100 - (sim.state.noiseAvg[flatId] ?? 0) * 30),
  };
  const values = Object.values(factors);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let score = MEAN_SHARE * mean + (1 - MEAN_SHARE) * Math.min(...values);
  const ceiling = factors.space * 1.4;
  if (score > ceiling) score = ceiling + (score - ceiling) * 0.25;
  // Missing the basics caps it too: a gutted flat is grim however quiet it is.
  score = Math.min(score, 19 + factors.basics * 0.6);
  score = Math.round(Math.max(0, Math.min(100, score)));
  const weakest = (Object.keys(factors) as FactorId[]).reduce((a, b) => (factors[b] < factors[a] ? b : a));
  return { score, tier: tierOf(score), factors, weakest, perPerson, has };
}

export function tierOf(score: number): string {
  return TIERS.find((t) => score >= t.min)!.name;
}

/** Straight lines between points. */
function curve(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1] * (x / points[0][0]);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}
