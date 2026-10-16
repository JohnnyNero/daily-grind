// Map construction and spatial queries.

import { objectDef } from './defs';
import type { PlacedObject } from './venues';
import type { FloorKind, ObjectInst, SimState, Tile } from './state';

const FLOOR_CHARS: Record<string, FloorKind> = { K: 'K', S: 'S', B: 'B', F: 'F', C: 'C', T: 'T', P: 'P' };

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

export class World {
  private blocked: Uint8Array;

  constructor(private readonly s: SimState) {
    this.blocked = new Uint8Array(s.w * s.h);
    this.rebuild();
  }

  /** Recomputes which tiles furniture blocks; call after objects move, appear or go. */
  rebuild(): void {
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
    const def = objectDef(p.def);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        if (!this.passable(p.x + dx, p.y + dy)) throw new Error(`Can't place ${p.def} at ${p.x},${p.y}: tile taken`);
      }
    }
    const inst: ObjectInst = { id: this.s.nextId++, def: p.def, x: p.x, y: p.y };
    this.s.objects.push(inst);
    this.markObject(inst);
    return inst;
  }

  objectById(id: number): ObjectInst | undefined {
    return this.s.objects.find((o) => o.id === id);
  }

  /** Spot tiles of an object, in world coordinates. */
  spots(o: ObjectInst): [number, number][] {
    return objectDef(o.def).spots.map(([dx, dy]) => [o.x + dx, o.y + dy]);
  }

  private markObject(o: ObjectInst): void {
    const def = objectDef(o.def);
    if (!def.blocks) return;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) this.blocked[(o.y + dy) * this.s.w + (o.x + dx)] = 1;
    }
  }
}
