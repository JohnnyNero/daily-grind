// Damp by room (docs/specs/layout.md 2.3 and 2.4). Damp moves slowly, over days. It comes
// from a bathroom or kitchen people use (a window lets some of it out, an extractor fan all
// of it), up from the ground where the plinth has no damp course (insulating the plinth is
// the damp course), and from a leak. It spreads to the room next door, drips down to the room
// below, and dries out, faster with a window, a fan or warmth. Damp over a line is mould: the
// `mould` flag, so the council hears of it. A leaking shower over a bedroom is the classic.
//
// Smells are a flavour, not a system: a kitchen with no fan sends tea through the wall into
// a bedroom next door or above, and bins in the lobby smell to the flat through the wall.

import { SHARED, binsOverflowing, itemsIn, warmthOf } from './environment';
import { flagsOf, hasFlag, setFlag } from './flags';
import { roomShapes, roomTemp, syncRooms } from './heat';
import { flatKind, type RoomUse } from './rooms';
import type { Sim } from './sim';
import { TICKS_PER_DAY, type Life } from './state';
import { has } from './traits';
import { remember, type Thought } from './thoughts';
import { riserLeakRooms } from './risers';
import { DAMP, SMELL } from './tuning';

/** Pieces that leak when they're broken. */
const WET = ['shower', 'bath', 'washer', 'dishwasher'];

/** What each room is for, by layout room. */
function usesByRoom(sim: Sim): Map<number, RoomUse[]> {
  const out = new Map<number, RoomUse[]>();
  for (const f of sim.layout.flats) for (const r of flatKind(sim, f.id).rooms) out.set(r.room, r.uses);
  return out;
}

/** Fans, and broken wet pieces, by layout room. */
function piecesByRoom(sim: Sim): { fans: Map<number, number>; leaks: Map<number, number> } {
  const lay = sim.layout;
  const fans = new Map<number, number>();
  const leaks = new Map<number, number>();
  for (const f of sim.state.furniture) {
    const r = lay.roomOf[lay.node(f.x, f.s)];
    if (r === -1) continue;
    if (f.def === 'extractorFan' && f.broken === undefined) fans.set(r, (fans.get(r) ?? 0) + 1);
    if (f.broken !== undefined && WET.includes(f.def)) leaks.set(r, (leaks.get(r) ?? 0) + 1);
  }
  return { fans, leaks };
}

/** A room's damp, 0 to 1. */
export function roomDamp(sim: Sim, room: number): number {
  const shape = roomShapes(sim).get(room);
  return shape ? (sim.state.damp?.[shape.key] ?? 0) : 0;
}

/** The wettest room in a flat. */
export function flatDamp(sim: Sim, flatId: string): number {
  const flat = sim.layout.flat(flatId);
  return Math.max(0, ...(flat?.rooms ?? []).map((r) => roomDamp(sim, r)));
}

/** Cleanliness points a flat's damp takes off its impressiveness. */
export function dampDrag(sim: Sim, flatId: string): number {
  return Math.max(0, flatDamp(sim, flatId) - DAMP.damp) * DAMP.cleanDrag;
}

interface Source {
  /** Damp made in a day, and the share of it that dries in a day. */
  made: number;
  dries: number;
  reasons: string[];
}

/**
 * What each room makes and dries in a day. `people` is how many use each flat's kitchen and
 * bathroom (the preview assumes one).
 */
function sources(sim: Sim, people: (flat: string) => number, warmth: (room: number) => number): Map<number, Source> {
  const uses = usesByRoom(sim);
  const { fans, leaks } = piecesByRoom(sim);
  const out = new Map<number, Source>();
  const shapes = roomShapes(sim);
  // A riser leak (risers.ts) runs down the wall: each room it passes through has a leak of its own for a while.
  const wetByRiser = new Set(riserLeakRooms(sim));
  for (const [id, shape] of shapes) {
    const reasons: string[] = [];
    const use = uses.get(id) ?? [];
    const fan = (fans.get(id) ?? 0) > 0 || (shape.flat !== null && hasFlag(sim, 'extractorFan', shape.flat));
    let made = 0;
    const n = shape.flat ? Math.min(DAMP.mostPeople, people(shape.flat)) : 0;
    const wet = (use.includes('wash') ? DAMP.bathroom : 0) + (use.includes('cook') ? DAMP.kitchen : 0);
    if (wet > 0 && n > 0 && !fan) {
      made += wet * n * (shape.window ? DAMP.windowLets : 1);
      if (!shape.window) reasons.push('No window or fan');
    }
    if (shape.ground > 0) {
      const bare = 1 - shape.groundInsulated / shape.ground;
      if (bare > 0) {
        made += DAMP.ground * bare;
        reasons.push('Damp from the ground');
      }
    }
    // A leak wets its own floor a little and comes through the ceiling below (or, on the
    // ground floor with nothing below, stays put).
    const leak = leaks.get(id) ?? 0;
    if (leak > 0) {
      made += DAMP.leak * leak * (shape.links.some((l) => l.dir === 'below') ? DAMP.leakStays : 1);
      reasons.push('A leak');
    }
    // Water down the wall from the riser wets every room it passes, all the way down.
    if (wetByRiser.has(id)) {
      made += DAMP.leak;
      reasons.push('The riser leaked');
    }
    for (const l of shape.links) {
      if (l.dir !== 'above' || !leaks.get(l.to)) continue;
      const over = shapes.get(l.to)!;
      const share = l.amount / Math.max(1, over.links.filter((o) => o.dir === 'below').reduce((n, o) => n + o.amount, 0));
      made += DAMP.leak * leaks.get(l.to)! * (1 - DAMP.leakStays) * share;
      if (!reasons.includes('Leak from above')) reasons.push('Leak from above');
    }
    const dries = DAMP.dry + (shape.window ? DAMP.windowDry : 0) + (fan ? DAMP.fanDry : 0) + DAMP.warmDry * warmth(id);
    out.set(id, { made, dries, reasons });
  }
  return out;
}

/** People living in a flat who are in (not at work or out). */
function living(sim: Sim, flat: string): number {
  return sim.state.pawns.filter((p) => p.life?.flat === flat && !p.life.leaving && !p.life.away).length;
}

/** One stretch of damp, `days` long (an hour is 1/24). Pure: hands back the new damp. */
function step(sim: Sim, damp: Map<number, number>, src: Map<number, Source>, days: number): Map<number, number> {
  const shapes = roomShapes(sim);
  const next = new Map<number, number>();
  for (const [id, shape] of shapes) {
    const d = damp.get(id) ?? 0;
    const s = src.get(id)!;
    let change = s.made - s.dries * d;
    for (const l of shape.links) {
      const o = damp.get(l.to) ?? 0;
      if (l.dir === 'side') change += DAMP.spread * Math.min(1, l.amount) * (o - d);
      // Water runs down: a wet room above (over the line where the tenants notice) drips into this one.
      else if (l.dir === 'above') change += DAMP.dripDown * Math.min(1, l.amount / shape.area) * Math.max(0, o - Math.max(d, DAMP.damp));
      else if (l.dir === 'below') change -= DAMP.dripDown * Math.min(1, l.amount / (shapes.get(l.to)?.area ?? 1)) * Math.max(0, d - Math.max(o, DAMP.damp));
    }
    next.set(id, Math.max(0, Math.min(1, d + change * days)));
  }
  return next;
}

/** Every game hour: damp moves on; mould where it's over the line; and the smells. */
export function dampHour(sim: Sim): void {
  syncRooms(sim);
  const st = sim.state;
  const rec = st.damp!;
  const shapes = roomShapes(sim);
  const now = new Map<number, number>();
  for (const [id, shape] of shapes) now.set(id, rec[shape.key] ?? 0);
  const src = sources(sim, (f) => living(sim, f), (r) => warmthOf(roomTemp(sim, r)));
  for (const [id, d] of step(sim, now, src, 1 / 24)) {
    const k = shapes.get(id)!.key;
    if (d > 0.001) rec[k] = Math.round(d * 10000) / 10000;
    else delete rec[k];
  }
  // Mould: the flag lasts while it's over the line, and a few days after.
  for (const f of sim.layout.flats) {
    if (flatDamp(sim, f.id) < DAMP.mould) continue;
    const until = st.tick + DAMP.mouldDays * TICKS_PER_DAY;
    const had = flagsOf(sim, 'mould', f.id)[0];
    // Topped up a day at a time, so it doesn't jostle the cards' flags every hour.
    if (!had || (had.until !== undefined && had.until < until - TICKS_PER_DAY)) setFlag(sim, 'mould', f.id, until);
  }
  smellsHour(sim);
}

/** Damp after a month, as the building stands with one person a flat: for the preview. Pure. */
export function settledDamp(sim: Sim, days = 30): Map<number, number> {
  const src = sources(sim, () => 1, () => 0.5);
  let damp = new Map<number, number>();
  for (const id of roomShapes(sim).keys()) damp.set(id, 0);
  for (let i = 0; i < days * 4; i++) damp = step(sim, damp, src, 1 / 4);
  return damp;
}

/** The things behind a room's damp, in plain words ("No window or fan", "Dripping from above"). */
export function dampReasons(sim: Sim, room: number): string[] {
  const src = sources(sim, (f) => living(sim, f), (r) => warmthOf(roomTemp(sim, r)));
  const out = [...(src.get(room)?.reasons ?? [])];
  const shape = roomShapes(sim).get(room);
  const d = roomDamp(sim, room);
  for (const l of shape?.links ?? []) {
    const o = roomDamp(sim, l.to);
    if (l.dir === 'above' && o > d + 0.05 && !out.includes('Dripping from above')) out.push('Dripping from above');
    if (l.dir === 'side' && o > d + 0.1 && !out.includes('Damp next door')) out.push('Damp next door');
  }
  if (out.length === 0 && d < 0.1) out.push('Dry');
  return out.slice(0, 3);
}

/** For the flat panel: how damp the wettest room is, in a word, and which room and why. */
export function dampLine(sim: Sim, flatId: string): { word: string; where: string | null } {
  const kind = flatKind(sim, flatId);
  let worst: { room: number; name: string; d: number } | null = null;
  for (const r of kind.rooms) {
    const d = roomDamp(sim, r.room);
    if (!worst || d > worst.d) worst = { room: r.room, name: r.name, d };
  }
  if (!worst || worst.d < DAMP.damp / 2) return { word: 'Dry', where: null };
  const word = worst.d >= DAMP.mould ? 'Mould' : worst.d >= DAMP.damp ? 'Damp' : 'A bit damp';
  const why = dampReasons(sim, worst.room).filter((w) => w !== 'Dry');
  return { word, where: `${worst.name}${why.length > 0 ? `: ${why[0].charAt(0).toLowerCase()}${why[0].slice(1)}` : ''}` };
}

// ------------------------------------------------------------------ what tenants make of it

/** Live thoughts about damp and smells in someone's flat. */
export function dampThoughts(sim: Sim, life: Life, flatId: string): Thought[] {
  const out: Thought[] = [];
  const d = flatDamp(sim, flatId);
  if (d >= DAMP.mould) out.push({ label: 'Mould on the walls', value: DAMP.mouldy });
  else if (d >= DAMP.damp && !has(life, 'messy')) out.push({ label: 'Flat smells damp', value: DAMP.smellsDamp });
  const bins = binsThroughWall(sim, flatId);
  if (bins) out.push(binsOverflowing(sim) ? { label: 'Overflowing bins through the wall', value: SMELL.binsOverflowing } : { label: 'Bins through the wall', value: SMELL.bins });
  return out;
}

/** A shared room with the bins in it, through the wall from one of this flat's rooms. */
function binsThroughWall(sim: Sim, flatId: string): boolean {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat || itemsIn(sim, SHARED, 'bins') === 0) return false;
  const shapes = roomShapes(sim);
  const binRooms = new Set(sim.state.furniture.filter((f) => f.def === 'bins').map((f) => lay.roomOf[lay.node(f.x, f.s)]).filter((r) => r !== -1 && lay.rooms[r].shared));
  return flat.rooms.some((r) => shapes.get(r)?.links.some((l) => l.dir === 'side' && binRooms.has(l.to)));
}

/** Someone cooking in a kitchen with no fan: the bedroom through the wall, or over it, smells their tea. */
function smellsHour(sim: Sim): void {
  const lay = sim.layout;
  const shapes = roomShapes(sim);
  const uses = usesByRoom(sim);
  const { fans } = piecesByRoom(sim);
  const smelly = new Set<number>();
  for (const p of sim.state.pawns) {
    if (p.doing !== 'Cooking') continue;
    const x = Math.round(p.x);
    const s = Math.round(p.s);
    if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) continue;
    const r = lay.roomOf[lay.node(x, s)];
    const flat = r === -1 ? null : lay.rooms[r].flat;
    if (r === -1 || !flat || (fans.get(r) ?? 0) > 0 || hasFlag(sim, 'extractorFan', flat)) continue;
    smelly.add(r);
  }
  if (smelly.size === 0) return;
  for (const [id, shape] of shapes) {
    if (!shape.flat || !(uses.get(id) ?? []).includes('sleep')) continue;
    const from = shape.links.find((l) => (l.dir === 'side' || l.dir === 'below') && smelly.has(l.to) && lay.rooms[l.to].flat !== shape.flat);
    if (!from) continue;
    for (const p of sim.state.pawns) {
      if (p.life?.flat !== shape.flat || p.life.away || p.life.leaving) continue;
      // Only if they're in to smell it.
      const at = lay.node(Math.round(p.x), Math.round(p.s));
      if (Math.round(p.x) < 0 || Math.round(p.x) >= lay.w || lay.roomOf[at] === undefined || lay.roomOf[at] === -1 || lay.rooms[lay.roomOf[at]].flat !== shape.flat) continue;
      if (has(p.life, 'keenCook') || p.life.memories.some((m) => m.id === 'smeltCooking')) continue;
      remember(sim, p.life, 'smeltCooking');
    }
  }
}
