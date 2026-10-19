// Shared spaces: what the parts of the building that aren't flats are for. A room in the
// shared parts with a washing machine in it is a laundry room; with bike racks, a bike
// store; and garden furniture out in the open (on the roof, say) makes a garden or roof
// terrace. Worked out from the furniture whenever the building changes, never saved.
//
// What the building has (a garden, a laundry, somewhere for the bikes) is what tenants
// think well of and what adds a little to every flat's score. Only things that work and
// that people can get to from the street count.

import { furnitureDef, type SpaceKind } from './defs';
import { findPath } from './layout';
import { outdoorTemp } from './environment';
import type { Sim } from './sim';
import { isSolid, type Furniture } from './state';
import { SHARED_USE } from './tuning';

export interface Space {
  kind: SpaceKind;
  /** "Laundry room", "Bike store", "Roof terrace" or "Garden". */
  name: string;
  /** The room it's in (for outdoor spaces, the open air round it). */
  room: number;
  outdoor: boolean;
  /** Everything in it that makes it what it is. */
  furniture: number[];
  /** Columns it covers, and the floor row people stand on. */
  x0: number;
  x1: number;
  s: number;
  /** At least one of the defining pieces works, and people can walk there from the street. */
  working: boolean;
}

export const SPACE_NAMES: Record<SpaceKind, string> = { laundry: 'Laundry room', bikes: 'Bike store', garden: 'Garden' };

const cache = new WeakMap<Sim, { version: number; spaces: Space[] }>();

/** Every shared space in the building. */
export function spacesOf(sim: Sim): Space[] {
  const hit = cache.get(sim);
  if (hit && hit.version === sim.version) return hit.spaces;
  const spaces = findSpaces(sim);
  cache.set(sim, { version: sim.version, spaces });
  return spaces;
}

function findSpaces(sim: Sim): Space[] {
  const lay = sim.layout;
  const out: Space[] = [];
  const pieces = sim.state.furniture
    .map((f) => ({ f, def: furnitureDef(f.def), room: lay.roomOf[lay.node(f.x, f.s)] }))
    .filter((p) => p.def.space && p.room !== -1);
  const reachable = (f: Furniture) => findPath(lay, lay.node(0, 0), lay.node(f.x, f.s), { flats: ['*'] }) !== null;
  // Indoors: the shared rooms. A room with both is a laundry room first (and still keeps bikes).
  for (const room of new Set(pieces.filter((p) => lay.rooms[p.room].shared).map((p) => p.room))) {
    const here = pieces.filter((p) => p.room === room && p.def.space !== 'garden');
    const xs = lay.rooms[room].nodes.map((n) => lay.xs(n));
    for (const kind of ['laundry', 'bikes'] as const) {
      const defining = here.filter((p) => p.def.space === kind);
      if (defining.length === 0) continue;
      out.push({
        kind,
        name: SPACE_NAMES[kind],
        room,
        outdoor: false,
        furniture: here.map((p) => p.f.id),
        x0: Math.min(...xs.map(([x]) => x)),
        x1: Math.max(...xs.map(([x]) => x)),
        s: defining[0].f.s,
        working: defining.some((p) => p.f.broken === undefined && reachable(p.f)),
      });
    }
  }
  // Outdoors: garden things in the open, in a group when they're on the same floor and close together.
  const garden = pieces.filter((p) => lay.rooms[p.room].outdoor && p.def.space === 'garden').sort((a, b) => a.f.s - b.f.s || a.f.x - b.f.x);
  let group: typeof garden = [];
  const close = () => {
    if (group.length === 0) return;
    const f = group[0].f;
    const x0 = Math.min(...group.map((p) => p.f.x));
    const x1 = Math.max(...group.map((p) => p.f.x + p.def.w - 1));
    // Open to the sky above a roof; a garden anywhere else.
    const roof = f.s > 1 && ![...Array(lay.rows - f.s).keys()].some((r) => isSolid(lay.cell(f.x, f.s + r)));
    out.push({
      kind: 'garden',
      name: roof ? 'Roof terrace' : 'Garden',
      room: group[0].room,
      outdoor: true,
      furniture: group.map((p) => p.f.id),
      x0,
      x1,
      s: f.s,
      // A bench or a table to sit at is what makes it a place to be.
      working: group.some((p) => p.f.broken === undefined && (p.f.def === 'bench' || p.f.def === 'parasolTable') && reachable(p.f)),
    });
    group = [];
  };
  for (const p of garden) {
    const last = group[group.length - 1];
    if (last && (last.f.s !== p.f.s || p.f.x - (last.f.x + last.def.w) > 2)) close();
    group.push(p);
  }
  close();
  return out;
}

/** What the building has to offer, for the thoughts and the flats' scores. */
export interface Amenities {
  garden: Space | null;
  laundry: Space | null;
  bikes: Space | null;
}

export function amenities(sim: Sim): Amenities {
  const spaces = spacesOf(sim).filter((s) => s.working);
  const find = (kind: SpaceKind) => spaces.find((s) => s.kind === kind) ?? null;
  return { garden: find('garden'), laundry: find('laundry'), bikes: find('bikes') };
}

/** Does this flat have a working washing machine of its own? */
export function hasOwnWasher(sim: Sim, flatId: string): boolean {
  const lay = sim.layout;
  return sim.state.furniture.some((f) => f.def === 'washer' && f.broken === undefined && lay.rooms[lay.roomOf[lay.node(f.x, f.s)]]?.flat === flatId);
}

/** The shared space at a cell, if there is one (for tapping the map). */
export function spaceAt(sim: Sim, x: number, s: number): Space | undefined {
  const lay = sim.layout;
  const room = x >= 0 && x < lay.w && s >= 0 && s < lay.rows ? lay.roomOf[lay.node(x, s)] : -1;
  if (room === -1) return undefined;
  return spacesOf(sim).find((sp) => (sp.outdoor ? sp.room === room && s >= sp.s && s < sp.s + 3 && x >= sp.x0 - 1 && x <= sp.x1 + 1 : sp.room === room));
}

/** Daylight and decent weather: fit for sitting out. */
export function outdoorsOk(sim: Sim): boolean {
  const m = sim.minuteOfDay;
  const t = outdoorTemp(sim);
  return m >= SHARED_USE.outdoorFrom && m < SHARED_USE.outdoorTo && t >= SHARED_USE.mildest && t <= SHARED_USE.hottest;
}
