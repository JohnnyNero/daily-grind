// How the café feels: cleanliness (dirty cups, spills) and looks (plants, comfy seats).
// Guests notice when they judge their visit; staff notice in their mood.

import { random } from './rng';
import type { Sim } from './sim';
import type { Pawn } from './state';

const SPILL_CHANCE_PER_VISIT = 0.06;
const SLIP_CHANCE = 0.08;

/** 0-1: 1 is spotless. */
export function cleanliness(sim: Sim): number {
  const s = sim.state;
  const cups = Object.values(s.dirty).reduce((a, b) => a + b, 0);
  return Math.max(0, 1 - (cups + s.spills.length * 2 + s.sinkDirty / 4) / 14);
}

/** 0-1: how nice the front of house looks. */
export function looks(sim: Sim): number {
  const s = sim.state;
  let score = 0.35;
  for (const o of s.objects) {
    const floor = sim.world.tile(o.x, o.y).floor;
    if (!sim.venue.frontFloors.includes(floor)) continue;
    if (o.def === 'plant') score += 0.1;
    if (o.def === 'armchair') score += 0.06;
    if (o.def === 'poolTable') score += 0.12;
    if (o.def === 'dartboard') score += 0.04;
  }
  return Math.min(1, score);
}

export function ambience(sim: Sim): number {
  return cleanliness(sim) * 0.6 + looks(sim) * 0.4;
}

/** A seated guest might knock their drink over, once per visit. */
export function maybeSpill(sim: Sim, g: Pawn): void {
  const s = sim.state;
  const v = g.visit;
  if (!v || v.spilt || random(s) >= SPILL_CHANCE_PER_VISIT / (20 * 60)) return;
  v.spilt = true;
  spillAt(sim, Math.round(g.x), Math.round(g.y));
  if (random(s) < 0.3) sim.log(`${g.name} knocked their ${v.items[0]} flying.`, 'neutral', g.id, 'spill', 2);
}

export function spillAt(sim: Sim, x: number, y: number): void {
  const s = sim.state;
  if (!sim.world.passable(x, y) || s.spills.some((p) => p.x === x && p.y === y)) return;
  s.spills.push({ x, y });
}

/** Walking through a spill: usually fine, occasionally not. */
export function checkSlip(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (!s.spills.some((sp) => sp.x === x && sp.y === y) || random(s) >= SLIP_CHANCE) return;
  if (p.visit) p.visit.patience = Math.max(0, p.visit.patience - 0.2);
  sim.log(`${p.name} slipped on a spill. Nobody saw. Everybody saw.`, 'bad', p.id, 'slip', 4);
}
