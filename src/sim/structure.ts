// Building work: walls, doors and floors. The outside of the building (the outer
// walls, the shop front and the pavement) stays put; everything inside can change,
// as long as everyone can still reach the counter and every piece of furniture.

import { objectDef } from './defs';
import { canSpend } from './business';
import { footprint, keepClear, reachProblem } from './manage';
import type { Sim } from './sim';
import type { FloorKind, Tile } from './state';

export type StructureTool = 'wall' | 'door' | 'remove' | { floor: FloorKind };

/** Pence per tile. Knocking things down is free. */
export const BUILD_PRICES = { wall: 2500, door: 6000, floor: 500 } as const;

export const PAINTABLE_FLOORS: readonly { kind: FloorKind; label: string }[] = [
  { kind: 'F', label: 'Wood' },
  { kind: 'C', label: 'Carpet' },
  { kind: 'B', label: 'Counter' },
  { kind: 'K', label: 'Kitchen' },
  { kind: 'S', label: 'Staff room' },
  { kind: 'T', label: 'Toilets' },
  { kind: 'R', label: 'Staff flat' },
];

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The building's shell: the map edge, the pavement and the shop front. Can't be changed. */
export function isShell(sim: Sim, x: number, y: number): boolean {
  const w = sim.world;
  if (!w.inBounds(x, y)) return true;
  const s = sim.state;
  if (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) return true;
  if (w.tile(x, y).floor === 'P') return true;
  return SIDES.some(([dx, dy]) => w.inBounds(x + dx, y + dy) && w.tile(x + dx, y + dy).floor === 'P');
}

function isWall(sim: Sim, x: number, y: number): boolean {
  return !sim.world.inBounds(x, y) || sim.world.tile(x, y).wall;
}

/** The floor a newly opened tile should get: whatever most of its neighbours have. */
function neighbourFloor(sim: Sim, x: number, y: number): FloorKind {
  const counts = new Map<FloorKind, number>();
  for (const [dx, dy] of SIDES) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.world.inBounds(nx, ny)) continue;
    const t = sim.world.tile(nx, ny);
    if (t.wall || t.floor === 'P') continue;
    counts.set(t.floor, (counts.get(t.floor) ?? 0) + 1);
  }
  let best: FloorKind = 'F';
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function someoneOn(sim: Sim, x: number, y: number): boolean {
  return sim.state.pawns.some((p) => p.onMap && Math.abs(p.x - x) < 0.9 && Math.abs(p.y - y) < 0.9);
}

/** What the tile would become, or why it can't. Null tile means "no change needed". */
function plan(sim: Sim, x: number, y: number, tool: StructureTool): { tile: Tile | null; cost: number } | string {
  if (isShell(sim, x, y)) return "That's the outside of the building.";
  const t = sim.world.tile(x, y);
  const objects = sim.state.objects.filter((o) => footprint(o.def, o.x, o.y).some(([ox, oy]) => ox === x && oy === y));

  if (tool === 'wall' || tool === 'door') {
    if (tool === 'wall' && t.wall && !t.door) return { tile: null, cost: 0 };
    if (tool === 'door' && t.door) return { tile: null, cost: 0 };
    if (objects.length > 0) return `Move the ${objectDef(objects[0].def).label.toLowerCase()} first.`;
    if (keepClear(sim).some(([kx, ky]) => kx === x && ky === y)) return 'That spot has to stay clear for service.';
    const user = sim.state.objects.find((o) => sim.world.spots(o).some(([sx, sy]) => sx === x && sy === y));
    if (user && tool === 'wall') return `Leave room to use the ${objectDef(user.def).label.toLowerCase()}.`;
    if (someoneOn(sim, x, y)) return 'Someone is standing there.';
    if (tool === 'wall') return { tile: { floor: t.floor, wall: true, door: false }, cost: BUILD_PRICES.wall };
    const across = !isWall(sim, x - 1, y) && !isWall(sim, x + 1, y) && isWall(sim, x, y - 1) && isWall(sim, x, y + 1);
    const down = !isWall(sim, x, y - 1) && !isWall(sim, x, y + 1) && isWall(sim, x - 1, y) && isWall(sim, x + 1, y);
    if (!across && !down) return 'Doors go in a straight wall, with room on both sides.';
    const floor = t.wall ? neighbourFloor(sim, x, y) : t.floor;
    return { tile: { floor, wall: false, door: true }, cost: BUILD_PRICES.door };
  }

  if (tool === 'remove') {
    if (!t.wall && !t.door) return { tile: null, cost: 0 };
    return { tile: { floor: t.wall ? neighbourFloor(sim, x, y) : t.floor, wall: false, door: false }, cost: 0 };
  }

  if (t.wall || t.door || t.floor === tool.floor) return { tile: null, cost: 0 };
  for (const o of objects) {
    const d = objectDef(o.def);
    if (d.floors && !d.floors.includes(tool.floor)) return `The ${d.label.toLowerCase()} can't stand on that floor.`;
  }
  return { tile: { ...t, floor: tool.floor }, cost: BUILD_PRICES.floor };
}

/**
 * Changes one tile, or says why not. Charges for it, and adds the cost to `ledger`
 * (a snapshot taken before the work) so undoing refunds exactly what was spent.
 */
export function buildAt(sim: Sim, x: number, y: number, tool: StructureTool, ledger?: LayoutSnapshot): string | null {
  const p = plan(sim, x, y, tool);
  if (typeof p === 'string') return p;
  if (!p.tile) return null;
  if (p.cost > 0 && !canSpend(sim, p.cost)) return "The bank won't lend any more. Get back in the black first.";
  const s = sim.state;
  const i = y * s.w + x;
  const before = s.tiles[i];
  s.tiles[i] = p.tile;
  const blocked = reachProblem(sim);
  if (blocked) {
    s.tiles[i] = before;
    return blocked;
  }
  s.money -= p.cost;
  if (ledger) ledger.spent += p.cost;
  sim.reroute();
  return null;
}

/** What `buildAt` would say, without changing anything. */
export function buildProblem(sim: Sim, x: number, y: number, tool: StructureTool): string | null {
  const p = plan(sim, x, y, tool);
  return typeof p === 'string' ? p : null;
}

export interface LayoutSnapshot {
  tiles: Tile[];
  /** Spent on building since the snapshot (when passed to buildAt as its ledger). */
  spent: number;
}

export function snapshotLayout(sim: Sim): LayoutSnapshot {
  return { tiles: sim.state.tiles.map((t) => ({ ...t })), spent: 0 };
}

/** Puts the walls and floors back as they were (and the money spent on them), if it's still possible. */
export function restoreLayout(sim: Sim, snap: LayoutSnapshot): string | null {
  const s = sim.state;
  const current = s.tiles;
  for (let i = 0; i < current.length; i++) {
    const was = snap.tiles[i];
    if (!was.wall || current[i].wall) continue;
    const x = i % s.w;
    const y = Math.floor(i / s.w);
    if (someoneOn(sim, x, y)) return 'Someone is standing in the way.';
    if (s.objects.some((o) => footprint(o.def, o.x, o.y).some(([ox, oy]) => ox === x && oy === y))) return 'Furniture is in the way.';
  }
  s.tiles = snap.tiles.map((t) => ({ ...t }));
  const blocked = reachProblem(sim);
  if (blocked) {
    s.tiles = current;
    return blocked;
  }
  s.money += snap.spent;
  snap.spent = 0;
  sim.reroute();
  return null;
}
