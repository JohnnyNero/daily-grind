// How a character picks what to do next.
//
// Objects advertise offers. A character scores each reachable offer by how much it
// would lift their mood, attenuated by distance, then picks at random among the
// top few. The more desperate their worst need, the fewer options they consider,
// so comfortable characters are quirky and stressed ones are rational.

import { NEEDS, objectDef, type NeedValues, type OfferDef } from './defs';
import { clamp01, moodFromNeeds, worstNeed } from './mood';
import { random } from './rng';
import type { ObjectInst, Pawn, SimState } from './state';
import type { World } from './world';

export interface Candidate {
  object: ObjectInst;
  offer: OfferDef;
  spotIndex: number;
  spot: [number, number];
  score: number;
}

/** Below this projected mood gain an offer isn't worth walking to. */
const MIN_GAIN = 0.015;
/** Distance (in tiles) at which an offer's appeal halves. */
const DISTANCE_HALVING = 10;

export function choiceBreadth(worst: number): number {
  if (worst < 0.12) return 1;
  if (worst < 0.25) return 2;
  if (worst < 0.4) return 3;
  return 5;
}

export function projectNeeds(needs: NeedValues, offer: OfferDef): NeedValues {
  const out = { ...needs };
  for (const def of NEEDS) {
    const d = offer.deltas[def.id];
    if (d !== undefined) out[def.id] = clamp01(out[def.id] + d);
  }
  return out;
}

/** Offers worth taking up right now. `ignoreThresholds` lists everything usable (for ordered breaks). */
export function scoreCandidates(s: SimState, world: World, p: Pawn, ignoreThresholds = false): Candidate[] {
  const base = moodFromNeeds(p.needs);
  // Beds and the telly in the flat are for after work, not for breaks.
  const minute = Math.floor(s.tick / 60) % (24 * 60);
  const day = Math.floor(s.tick / (24 * 60 * 60)) + 1;
  const offToday = p.staff ? p.staff.daysOff.includes((day - 1) % 7) || p.staff.sickDay === day || p.staff.homeEarlyDay === day : false;
  const atWork = !p.staff || (!offToday && minute >= p.shift.start && minute < p.shift.end);
  const out: Candidate[] = [];
  for (const o of s.objects) {
    const def = objectDef(o.def);
    if (def.offers.length === 0) continue;
    const spots = world.spots(o);
    // Nearest free spot on this object.
    let spotIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const key = reservationKey(o.id, i);
      const holder = s.reservations[key];
      if (holder !== undefined && holder !== p.id) continue;
      const [sx, sy] = spots[i];
      if (!world.passable(sx, sy)) continue;
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d < bestDist) {
        bestDist = d;
        spotIndex = i;
      }
    }
    if (spotIndex < 0) continue;
    for (const offer of def.offers) {
      if (!offer.usableBy.includes(p.kind)) continue;
      if (offer.offShiftOnly && atWork) continue;
      if (!ignoreThresholds && p.needs[offer.whenBelow.need] >= offer.whenBelow.value) continue;
      const gain = moodFromNeeds(projectNeeds(p.needs, offer)) - base;
      if (!ignoreThresholds && gain < MIN_GAIN) continue;
      out.push({
        object: o,
        offer,
        spotIndex,
        spot: spots[spotIndex],
        score: gain / (1 + bestDist / DISTANCE_HALVING),
      });
    }
  }
  // Stable order before sorting keeps choices deterministic across engines.
  out.sort((a, b) => b.score - a.score || a.object.id - b.object.id || a.offer.id.localeCompare(b.offer.id));
  return out;
}

export function pickCandidate(s: SimState, p: Pawn, candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const n = Math.min(choiceBreadth(worstNeed(p.needs)), candidates.length);
  return candidates[Math.floor(random(s) * n)];
}

export function reservationKey(objectId: number, spotIndex: number): string {
  return `obj:${objectId}:${spotIndex}`;
}
