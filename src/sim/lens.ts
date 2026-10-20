// The overlay bar's reading of the building, room by room: what colour a room goes under
// Noise, Warmth, Damp or Rent, and the two or three facts behind it when you tap the room
// (docs/specs/layout.md 2.5). Read-only; nothing here is saved.
//
// Noise, warmth and damp are worked out per room by other chunks (L2 noise, L3 heat and
// damp). Until they land, the `room*` and `*Why` functions below fall back to today's
// per-flat values, so every room in a flat reads the same. Wire the real ones in at the
// seven stubs marked STUB (L3 has filled its four).

import { flatInfo, goingRate, pounds } from './economy';
import { noiseReaching, warmthOf } from './environment';
import { flatKind, type RoomInfo } from './rooms';
import type { Sim } from './sim';
import { DAMP, LENS } from './tuning';
import { roomTemp as heatRoomTemp, warmthReasons } from './heat';
import { dampReasons, roomDamp as dampRoomDamp } from './damp';

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

/**
 * STUB (L2): noise heard in this room right now, in the units of environment.ts's
 * noiseReaching().amount (per minute). `made` is sim.noise(). Fallback: the flat's figure.
 */
export function roomNoise(sim: Sim, made: Map<string, number>, room: number): number {
  const flat = sim.layout.rooms[room]?.flat;
  return flat ? noiseReaching(sim, made, flat).amount : 0;
}

/** STUB (L2): up to three plain facts behind a room's noise ("Telly through the wall", "Stairs"). */
export function roomNoiseWhy(sim: Sim, made: Map<string, number>, room: number): string[] {
  const flat = sim.layout.rooms[room]?.flat;
  if (!flat) return [];
  const { amount, loudest } = noiseReaching(sim, made, flat);
  if (amount < 0.1 || !loudest) return [];
  const from = sim.layout.flat(loudest);
  return from ? [`Noise from ${from.name}`] : [];
}

/** Layout L3: degrees in this room (heat.ts). */
export function roomTemp(sim: Sim, room: number): number {
  return heatRoomTemp(sim, room);
}

/** Layout L3: up to three plain facts behind a room's warmth ("Cold roof", "Radiator"). */
export function roomTempWhy(sim: Sim, room: number): string[] {
  return warmthReasons(sim, room);
}

/** Layout L3: damp in this room, 0 (dry) to 1, scaled so the mould line reads as "Damp" and over it "Mouldy". */
export function roomDamp(sim: Sim, room: number): number {
  return Math.min(1, (dampRoomDamp(sim, room) * LENS_MOULD) / DAMP.mould);
}
/** Where the mould line sits on the lens's 0 to 1. */
const LENS_MOULD = 0.75;

/** Layout L3: up to three plain facts behind a room's damp ("No window or fan", "Leak from above"). */
export function roomDampWhy(sim: Sim, room: number): string[] {
  return dampReasons(sim, room);
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
