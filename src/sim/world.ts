// Map construction and spatial queries.

import { footprint, objectDef, rotationOf, spotsAt } from './defs';
import type { PlacedObject } from './venues';
import type { FloorKind, ObjectInst, SimState, Tile } from './state';

const FLOOR_CHARS: Record<string, FloorKind> = { K: 'K', S: 'S', B: 'B', F: 'F', C: 'C', T: 'T', P: 'P', Y: 'Y', R: 'R', X: 'X' };

/** Columns of empty yard added to the side of every venue: room to grow. */
export const PLOT_W = 20;

/** The venue's map with the back plot alongside: yard, edged by wall, pavement along the front. */
export function withPlot(rows: readonly string[]): string[] {
  return rows.map((row, y) => {
    const edge = row[row.length - 1];
    if (edge === 'P') return row + 'P'.repeat(PLOT_W);
    if (y === 0) return row + '#'.repeat(PLOT_W);
    return row + 'Y'.repeat(PLOT_W - 1) + '#';
  });
}

export function parseMap(rows: readonly string[]): { w: number; h: number; tiles: Tile[] } {
  const h = rows.length;
  const w = rows[0].length;
  const tiles: Tile[] = [];
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`Map row ${y} has width ${rows[y].length}, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '#') tiles.push({ floor: 'B', wall: true, door: false });
      else if (c === 'd' || c === 'D') tiles.push({ floor: neighbourFloor(rows, x, y, c === 'D'), wall: false, door: true });
      else if (FLOOR_CHARS[c]) tiles.push({ floor: FLOOR_CHARS[c], wall: false, door: false });
      else throw new Error(`Unknown map char '${c}' at ${x},${y}`);
    }
  }
  return { w, h, tiles };
}

/** A door takes the floor of a room it opens onto, so it blends in (front doors look inward). */
function neighbourFloor(rows: readonly string[], x: number, y: number, front = false): FloorKind {
  const order = front ? [[0, -1], [0, 1], [1, 0], [-1, 0]] : [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (const [dx, dy] of order) {
    const c = rows[y + dy]?.[x + dx];
    if (c && FLOOR_CHARS[c]) return FLOOR_CHARS[c];
  }
  return 'B';
}

/**
 * Saves from before the back plot existed get it added alongside, and saves from when it
 * was narrower get it widened. Coordinates never change: new ground is added on the right.
 */
export function addPlotToSave(s: SimState, venueMap: readonly string[]): void {
  const venueW = venueMap[0].length;
  const target = venueW + PLOT_W;
  if (s.w >= target) return;
  if (s.w === venueW) {
    const plot = parseMap(withPlot(venueMap));
    const tiles: Tile[] = [];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < plot.w; x++) tiles.push(x < venueW ? s.tiles[y * venueW + x] : plot.tiles[y * plot.w + x]);
    }
    s.tiles = tiles;
    s.w = plot.w;
    return;
  }
  // A narrower plot: knock out its old far wall where bare yard was behind it, and extend.
  const oldW = s.w;
  const old = (x: number, y: number) => s.tiles[y * oldW + x];
  const tiles: Tile[] = [];
  for (let y = 0; y < s.h; y++) {
    const pavement = old(oldW - 1, y).floor === 'P';
    for (let x = 0; x < target; x++) {
      if (x < oldW - 1) tiles.push(old(x, y));
      else if (x === oldW - 1) {
        const t = old(x, y);
        const behind = old(x - 1, y);
        const opened = !s.openLot && t.wall && !t.door && y > 0 && behind.floor === 'Y' && !behind.wall;
        tiles.push(opened ? { floor: 'Y', wall: false, door: false } : t);
      } else if (pavement) tiles.push({ floor: 'P', wall: false, door: false });
      else if (!s.openLot && (y === 0 || x === target - 1)) tiles.push({ floor: 'Y', wall: true, door: false });
      else tiles.push({ floor: 'Y', wall: false, door: false });
    }
  }
  s.tiles = tiles;
  s.w = target;
}

export class World {
  private blocked: Uint8Array;

  constructor(private readonly s: SimState) {
    this.blocked = new Uint8Array(s.w * s.h);
    this.rebuild();
  }

  /** Goes up whenever the layout changes, so anything worked out from it knows to look again. */
  version = 0;

  /** Recomputes which tiles furniture blocks; call after objects move, appear or go (or zones change). */
  rebuild(): void {
    this.version++;
    this.blocked.fill(0);
    for (const o of this.s.objects) this.markObject(o);
  }

  isBlockedByObject(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.blocked[y * this.s.w + x] === 1;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.s.w && y < this.s.h;
  }

  tile(x: number, y: number): Tile {
    return this.s.tiles[y * this.s.w + x];
  }

  passable = (x: number, y: number): boolean => {
    if (!this.inBounds(x, y)) return false;
    return !this.tile(x, y).wall && !this.blocked[y * this.s.w + x];
  };

  placeObject(p: PlacedObject): ObjectInst {
    const rot = rotationOf(p);
    for (const [x, y] of footprint(p.def, p.x, p.y, rot)) {
      if (!this.passable(x, y)) throw new Error(`Can't place ${p.def} at ${p.x},${p.y}: tile taken`);
    }
    const inst: ObjectInst = { id: this.s.nextId++, def: p.def, x: p.x, y: p.y };
    if (rot) inst.rot = rot;
    this.s.objects.push(inst);
    this.markObject(inst);
    this.version++;
    return inst;
  }

  objectById(id: number): ObjectInst | undefined {
    return this.s.objects.find((o) => o.id === id);
  }

  /** Spot tiles of an object, in world coordinates. */
  spots(o: ObjectInst): [number, number][] {
    return spotsAt(o.def, o.x, o.y, rotationOf(o));
  }

  /** The tiles it covers. */
  tilesOf(o: ObjectInst): [number, number][] {
    return footprint(o.def, o.x, o.y, rotationOf(o));
  }

  private markObject(o: ObjectInst): void {
    if (!objectDef(o.def).blocks) return;
    for (const [x, y] of this.tilesOf(o)) this.blocked[y * this.s.w + x] = 1;
  }
}
