// The overlay bar's reading of the building, room by room: what colour a room goes under
// Noise, Warmth, Damp or Rent, and the two or three facts behind it when you tap the room
// (docs/specs/layout.md 2.5). Read-only; nothing here is saved.
//
// Noise, warmth and damp are worked out per room by other chunks (L2 noise, L3 heat and
// damp). Until they land, the `room*` and `*Why` functions below fall back to today's
// per-flat values, so every room in a flat reads the same. Wire the real ones in at the
// seven stubs marked STUB.

import { flatInfo, goingRate, pounds } from './economy';
import { noiseReasons, roomNoise as noiseInRoom } from './acoustics';
import { flatClimate, tempOf, warmthOf } from './environment';
import { hasFlag } from './flags';
import { flatKind, type RoomInfo } from './rooms';
import type { Sim } from './sim';
import { LENS } from './tuning';

export type Lens = 'none' | 'noise' | 'warmth' | 'damp' | 'rent';
export const LENSES: readonly Lens[] = ['none', 'noise', 'warmth', 'damp', 'rent'];

export interface RoomReading {
  /** 0 (bad) to 1 (good): sets the colour. */
  good: number;
  /** The room's name: "Bedroom", "Kitchen". */
  room: string;
  /** What the lens says about it: "Quiet", "Cold". */
  word: string;
  /** Two or three facts behind the colour. */
  why: string[];
  flat: string;
}

// ------------------------------------------------------------------ STUBS for L2 and L3

/** Noise reaching this room right now, from the rooms round it (acoustics.ts). `made` isn't needed: rooms work out their own. */
export function roomNoise(sim: Sim, _made: Map<string, number>, room: number): number {
  return noiseInRoom(sim, room);
}

/** Up to three plain facts behind a room's noise ("Telly through the wall", "Stairs"). */
export function roomNoiseWhy(sim: Sim, _made: Map<string, number>, room: number): string[] {
  return noiseReasons(sim, room);
}

/** STUB (L3): degrees in this room. Fallback: the flat's. */
export function roomTemp(sim: Sim, room: number): number {
  const flat = sim.layout.rooms[room]?.flat;
  return flat ? tempOf(sim, flat) : 0;
}

/** STUB (L3): up to three plain facts behind a room's warmth ("Cold roof", "Radiator"). */
export function roomTempWhy(sim: Sim, room: number): string[] {
  const flat = sim.layout.rooms[room]?.flat;
  if (!flat) return [];
  const c = flatClimate(sim, flat);
  const out: string[] = [];
  out.push(c.radiators > 0 ? (c.radiators === 1 ? 'One radiator in the flat' : `${c.radiators} radiators in the flat`) : 'No radiators in the flat');
  if (c.outside > 0) out.push(c.insulated >= c.outside * 0.5 ? 'Outside walls are lagged' : 'Outside walls are bare');
  return out;
}

/** STUB (L3): damp in this room, 0 (dry) to 1 (running with it). Fallback: the flat's mould flag. */
export function roomDamp(sim: Sim, room: number): number {
  const flat = sim.layout.rooms[room]?.flat;
  return flat && hasFlag(sim, 'mould', flat) ? 1 : 0;
}

/** STUB (L3): up to three plain facts behind a room's damp ("Leaking shower above", "No extractor"). */
export function roomDampWhy(sim: Sim, room: number): string[] {
  const flat = sim.layout.rooms[room]?.flat;
  return flat && hasFlag(sim, 'mould', flat) ? ['Damp and mould'] : [];
}

// ------------------------------------------------------------------ the readings

function word(good: number, words: readonly [string, string, string, string]): string {
  return good >= 0.6 ? words[0] : good >= 0.4 ? words[1] : good >= 0.25 ? words[2] : words[3];
}

/** The room as the lens sees it, or null for the street, the stairs and sealed rooms. */
export function readRoom(sim: Sim, lens: Lens, room: number, made: Map<string, number> = sim.noise()): RoomReading | null {
  const flatId = sim.layout.rooms[room]?.flat;
  if (lens === 'none' || !flatId) return null;
  const flat = sim.layout.flat(flatId);
  if (!flat) return null;
  const info = flatKind(sim, flatId).rooms.find((r) => r.room === room);
  const name = info?.name ?? 'Room';
  let good: number;
  let w: string;
  let why: string[];
  if (lens === 'noise') {
    good = 1 - Math.min(1, roomNoise(sim, made, room) / LENS.noiseFull);
    w = word(good, ['Quiet', 'Some noise', 'Noisy', 'Loud']);
    why = roomNoiseWhy(sim, made, room);
  } else if (lens === 'warmth') {
    good = warmthOf(roomTemp(sim, room));
    w = word(good, ['Warm', 'Cool', 'Cold', 'Freezing']);
    why = roomTempWhy(sim, room);
  } else if (lens === 'damp') {
    const d = roomDamp(sim, room);
    good = 1 - Math.min(1, d);
    w = word(good, ['Dry', 'A bit damp', 'Damp', 'Mouldy']);
    why = roomDampWhy(sim, room);
  } else {
    const rate = goingRate(sim, flatId);
    good = Math.min(1, rate / LENS.rentFull);
    w = `${pounds(rate)} a week`;
    why = rentWhy(sim, flatId, info);
  }
  return { good, room: name, word: w, why: why.slice(0, 3), flat: flat.name };
}

/** What the rent lens says about a room: the flat's type and rate, and whether this room is what earns it. */
function rentWhy(sim: Sim, flatId: string, room: RoomInfo | undefined): string[] {
  const kind = flatKind(sim, flatId);
  const fi = flatInfo(sim, flatId);
  const out: string[] = [];
  if (room?.bedroom) out.push('A bedroom: counts towards the flat\'s size');
  else if (room?.name === 'Box room') out.push('A box room: too small to count as a bedroom');
  else if (room?.name === 'Bedsit') out.push('A bedsit: somewhere to sleep, not a bedroom');
  out.push(`${kind.name} flat, ${fi.tier.toLowerCase()}`);
  if (fi.lease) out.push(`Let at ${pounds(fi.lease.rent)} a week`);
  else if (fi.listed) out.push(`Asking ${pounds(fi.asking)} a week`);
  return out;
}
