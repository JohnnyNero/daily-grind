// Where service happens. The till, the pickup counter and the food counter are pieces of
// furniture with a staff side and a customer side; the queue and the pickup waiting area
// are floor zones the manager paints. Everything here is worked out from those, so moving
// a till or repainting the queue changes where people stand.

import { objectDef, rotationOf, serviceAt } from './defs';
import type { Sim } from './sim';
import type { SimState, Zones } from './state';
import { LEGACY_COUNTER_W, counterPieces, type ServicePositions } from './venues';

type Tile = readonly [number, number];

/** The longest queue anyone will join, however much floor is marked for it. */
export const MAX_QUEUE = 16;

export type ZoneKind = keyof Zones;
export type ZoneTool = ZoneKind | 'clear';

export const ZONE_TOOLS: readonly { id: ZoneTool; label: string; hint: string }[] = [
  { id: 'queue', label: 'Queue', hint: 'Mark where the queue runs back from the till. It has to join the spot in front of the till.' },
  { id: 'pickup', label: 'Pickup area', hint: 'Mark where customers wait for their order, near the pickup counter.' },
  { id: 'clear', label: 'Clear', hint: 'Unmark queue and pickup floor.' },
];

/** The service pieces, by role. One of each per place. */
export const SERVICE_DEFS = { till: 'till', pickup: 'pickup', food: 'foodCounter' } as const;

/** Tiles of every service piece's staff and customer spots. */
function pieceSpots(sim: Sim): Tile[] {
  const out: Tile[] = [];
  for (const o of sim.state.objects) {
    const at = serviceAt(o.def, o.x, o.y, rotationOf(o));
    if (!at) continue;
    out.push(at.staff);
    if (at.guest) out.push(at.guest);
  }
  return out;
}

function zoneTiles(s: SimState, kind: ZoneKind): Tile[] {
  return s.zones[kind].map((i) => [i % s.w, Math.floor(i / s.w)] as const);
}

/** Everything furniture and walls must leave clear: service spots, both zones and the way in. */
export function reservedTiles(sim: Sim): Tile[] {
  return [...pieceSpots(sim), ...zoneTiles(sim.state, 'queue'), ...zoneTiles(sim.state, 'pickup'), ...sim.venue.entry];
}

/** Service spots that must stay reachable from the door. */
export function serviceSpots(sim: Sim): Tile[] {
  return pieceSpots(sim);
}

/** Tiles reachable on foot from the entrance right now. */
function reachable(sim: Sim): Uint8Array {
  const s = sim.state;
  const seen = new Uint8Array(s.w * s.h);
  const stack: Tile[] = [];
  for (const [x, y] of sim.venue.entry) {
    if (!sim.world.passable(x, y) || seen[y * s.w + x]) continue;
    seen[y * s.w + x] = 1;
    stack.push([x, y]);
  }
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.world.passable(nx, ny) || seen[ny * s.w + nx]) continue;
      seen[ny * s.w + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * Works out where everyone stands from the pieces and zones. The queue starts at the
 * till's customer spot and runs back along connected queue floor, nearest first; the
 * waiting spots are the reachable pickup floor, nearest the pickup first.
 */
export function computePositions(sim: Sim): ServicePositions {
  const s = sim.state;
  const entry = sim.venue.entry;
  const find = (def: string) => {
    const o = s.objects.find((x) => x.def === def);
    return o ? serviceAt(o.def, o.x, o.y, rotationOf(o)) : null;
  };
  const till = find(SERVICE_DEFS.till);
  const pickup = find(SERVICE_DEFS.pickup);
  const food = find(SERVICE_DEFS.food);
  // Without a till or pickup nothing is served, so these are never walked to.
  const nowhere = entry[0];
  const tillGuest = till?.guest ?? nowhere;
  const pickupGuest = pickup?.guest ?? nowhere;

  const reach = reachable(sim);
  const idx = ([x, y]: Tile) => y * s.w + x;
  const open = (t: Tile) => sim.world.inBounds(t[0], t[1]) && reach[idx(t)] === 1;

  const queue: Tile[] = [tillGuest];
  if (till) {
    const marked = new Set(s.zones.queue);
    const seen = new Set([idx(tillGuest)]);
    let frontier: Tile[] = [tillGuest];
    while (frontier.length > 0 && queue.length < MAX_QUEUE) {
      const next: Tile[] = [];
      for (const [x, y] of frontier) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t: Tile = [x + dx, y + dy];
          if (!sim.world.inBounds(t[0], t[1]) || seen.has(idx(t)) || !marked.has(idx(t)) || !open(t)) continue;
          seen.add(idx(t));
          next.push(t);
        }
      }
      for (const t of next) if (queue.length < MAX_QUEUE) queue.push(t);
      frontier = next;
    }
  }

  const taken = new Set([...queue, ...pieceSpots(sim)].map(idx));
  const wait = zoneTiles(s, 'pickup')
    .filter((t) => open(t) && !taken.has(idx(t)))
    .sort((a, b) => Math.abs(a[0] - pickupGuest[0]) + Math.abs(a[1] - pickupGuest[1]) - (Math.abs(b[0] - pickupGuest[0]) + Math.abs(b[1] - pickupGuest[1])));

  const pickupStaff = pickup?.staff ?? nowhere;
  return {
    entry,
    tillStaff: till?.staff ?? nowhere,
    queue,
    // No food counter: food gets plated at the pickup.
    foodStaff: food?.staff ?? pickupStaff,
    pickupStaff,
    pickupGuest,
    wait,
  };
}

/** Painted queue floor that the queue can't use (not joined up to the till, or cut off). */
export function strayQueueTiles(sim: Sim): number {
  const used = new Set(sim.positions.queue.map(([x, y]) => y * sim.state.w + x));
  return sim.state.zones.queue.filter((i) => !used.has(i)).length;
}

// ------------------------------------------------------------------ painting zones

/** Null if this tile can be marked as `tool`; otherwise why not. */
export function zoneProblem(sim: Sim, x: number, y: number, tool: ZoneTool): string | null {
  const w = sim.world;
  if (!w.inBounds(x, y)) return "That's off the edge.";
  if (tool === 'clear') return null;
  const t = w.tile(x, y);
  if (t.wall || t.door) return 'Zones go on open floor.';
  if (t.floor === 'P' || t.floor === 'Y') return 'Zones go inside.';
  if (sim.state.objects.some((o) => w.tilesOf(o).some(([ox, oy]) => ox === x && oy === y))) return 'Something is standing there.';
  if (pieceSpots(sim).some(([sx, sy]) => sx === x && sy === y)) return "That's where staff or customers stand to be served.";
  return null;
}

/** Marks (or clears) one tile. Free. */
export function paintZone(sim: Sim, x: number, y: number, tool: ZoneTool): string | null {
  const problem = zoneProblem(sim, x, y, tool);
  if (problem) return problem;
  const s = sim.state;
  const i = y * s.w + x;
  const had = s.zones.queue.includes(i) || s.zones.pickup.includes(i);
  if (tool !== 'clear' && s.zones[tool].includes(i)) return null;
  s.zones.queue = s.zones.queue.filter((n) => n !== i);
  s.zones.pickup = s.zones.pickup.filter((n) => n !== i);
  if (tool !== 'clear') s.zones[tool].push(i);
  if (had || tool !== 'clear') sim.world.rebuild();
  return null;
}

export function zoneAt(s: SimState, x: number, y: number): ZoneKind | null {
  const i = y * s.w + x;
  if (s.zones.queue.includes(i)) return 'queue';
  if (s.zones.pickup.includes(i)) return 'pickup';
  return null;
}

// ------------------------------------------------------------------ new games and old saves

export function zonesFrom(s: SimState, zones: { queue: readonly Tile[]; pickup: readonly Tile[] }, dx = 0, dy = 0): Zones {
  const at = ([x, y]: Tile) => (y + dy) * s.w + (x + dx);
  return { queue: zones.queue.map(at), pickup: zones.pickup.map(at) };
}

/**
 * Saves from before the counter came in pieces have one 9-wide counter and fixed service
 * spots around it. Swap it for pieces in the same places and mark the zones it used.
 */
export function migrateCounter(sim: Sim): void {
  const s = sim.state;
  if (s.zones) return;
  const v = sim.venue;
  const old = s.objects.find((o) => o.def === v.counter && objectDef(o.def).counterSection);
  if (!old || s.objects.some((o) => o.def === SERVICE_DEFS.till)) {
    s.zones = { queue: [], pickup: [] };
    return;
  }
  s.objects = s.objects.filter((o) => o !== old);
  const dx = old.x - 1;
  const dy = old.y - 9;
  for (const piece of counterPieces(v.counter).slice(0, LEGACY_COUNTER_W)) {
    s.objects.push({ id: s.nextId++, def: piece.def, x: piece.x + dx, y: piece.y + dy });
  }
  s.zones = zonesFrom(s, v.zones, dx, dy);
  sim.world.rebuild();
}
