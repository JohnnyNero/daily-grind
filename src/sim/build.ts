// Changing the building. Every change goes through here so it's checked the same way
// (each check returns a reason in words, or null if it's fine) and can be undone.

import { furnitureDef } from './defs';
import { MAX_STOREYS, ROOM_ROWS, key, type BuildPartsData, type Furniture, type Segment, type Stair, type State } from './state';

export type BuildParts = BuildPartsData;

/** The parts that can change in build mode, as a copy (for undo). */
export function snapshot(s: State): string {
  const parts: BuildParts = { walls: s.walls, slabs: s.slabs, stairs: s.stairs, furniture: s.furniture, insulated: s.insulated };
  return JSON.stringify(parts);
}

export function restore(s: State, json: string): void {
  const parts = JSON.parse(json) as BuildParts;
  s.walls = parts.walls;
  s.slabs = parts.slabs;
  s.stairs = parts.stairs;
  s.furniture = parts.furniture;
  s.insulated = parts.insulated ?? {};
}

// ------------------------------------------------------------------ insulation

/** Wall tiles are "w:x,s", floor tiles "f:x,level" (level 0 is the ground floor's floor). */
export function insulateProblem(st: State, part: string): string | null {
  if (st.insulated[part]) return 'Already insulated';
  const [kind, rest] = part.split(':');
  const [x, n] = rest.split(',').map(Number);
  if (!inPlot(st, x)) return 'Outside your plot';
  if (kind === 'w') {
    const seg = st.walls[key(x, n)];
    if (seg !== 'wall' && seg !== 'window') return 'Insulate a wall, not a door or a gap';
  } else if (n > 0 && st.slabs[key(x, n)] !== true) return 'No floor there';
  return null;
}

export function insulate(st: State, part: string): string | null {
  const problem = insulateProblem(st, part);
  if (problem) return problem;
  st.insulated[part] = true;
  return null;
}

const inPlot = (st: State, x: number) => x >= st.plot.x0 && x <= st.plot.x1;
const hasFloor = (st: State, x: number, s: number) => s === 0 || st.slabs[key(x, s)] === true;

/** Furniture with any part in this column of this storey. */
export function furnitureIn(st: State, x: number, s: number): Furniture[] {
  return st.furniture.filter((f) => f.s === s && x >= f.x && x < f.x + furnitureDef(f.def).w);
}

/** The flight of stairs drawn across this column of this storey, if any. */
export function stairIn(st: State, x: number, s: number): Stair | undefined {
  return st.stairs.find((t) => t.s === s && x >= t.x && x <= t.x + 2);
}

const stairTop = (t: Stair) => (t.dir === 1 ? t.x + 2 : t.x);

// ------------------------------------------------------------------ walls, doors, windows

export function segmentProblem(st: State, x: number, s: number, seg: Segment): string | null {
  if (!inPlot(st, x) || s < 0 || s >= MAX_STOREYS) return 'Outside your plot';
  if (st.walls[key(x, s)] === seg) return null;
  if (!hasFloor(st, x, s)) return 'Needs a floor under it';
  if (seg === 'entrance' && s !== 0) return 'The street door goes on the ground floor';
  if (furnitureIn(st, x, s).length > 0) return 'Furniture in the way';
  if (stairIn(st, x, s)) return 'Stairs in the way';
  if (seg === 'wall' || seg === 'window') {
    if (st.stairs.some((t) => t.s + 1 === s && stairTop(t) === x)) return 'Blocks the top of the stairs';
  }
  return null;
}

export function placeSegment(st: State, x: number, s: number, seg: Segment): string | null {
  const problem = segmentProblem(st, x, s, seg);
  if (problem) return problem;
  st.walls[key(x, s)] = seg;
  return null;
}

export function removeSegment(st: State, x: number, s: number): boolean {
  if (!inPlot(st, x) || st.walls[key(x, s)] === undefined) return false;
  delete st.walls[key(x, s)];
  delete st.insulated[`w:${key(x, s)}`];
  return true;
}

// ------------------------------------------------------------------ floors

/** Level L is the floor of storey L, or the roof over storey L - 1. */
export function slabProblem(st: State, x: number, level: number): string | null {
  if (!inPlot(st, x) || level < 1 || level > MAX_STOREYS) return 'Outside your plot';
  return null;
}

export function placeSlab(st: State, x: number, level: number): string | null {
  const problem = slabProblem(st, x, level);
  if (problem) return problem;
  st.slabs[key(x, level)] = true;
  return null;
}

export function slabRemoveProblem(st: State, x: number, level: number): string | null {
  if (!inPlot(st, x) || st.slabs[key(x, level)] !== true) return 'No floor there';
  if (furnitureIn(st, x, level).length > 0) return 'Furniture is standing on it';
  if (st.walls[key(x, level)] !== undefined) return 'A wall is standing on it';
  if (stairIn(st, x, level)) return 'Stairs are standing on it';
  if (st.stairs.some((t) => t.s + 1 === level && stairTop(t) === x)) return 'The stairs come up here';
  return null;
}

export function removeSlab(st: State, x: number, level: number): string | null {
  const problem = slabRemoveProblem(st, x, level);
  if (problem) return problem;
  delete st.slabs[key(x, level)];
  delete st.insulated[`f:${key(x, level)}`];
  return null;
}

// ------------------------------------------------------------------ stairs

export function stairProblem(st: State, x: number, s: number, dir: 1 | -1): string | null {
  if (!inPlot(st, x) || !inPlot(st, x + 2) || s < 0) return 'Outside your plot';
  if (s + 1 >= MAX_STOREYS) return 'Nowhere to go up to';
  const top = dir === 1 ? x + 2 : x;
  for (let c = x; c <= x + 2; c++) {
    if (!hasFloor(st, c, s)) return 'Needs a floor under it';
    if (st.walls[key(c, s)] !== undefined) return 'A wall or door is in the way';
    if (stairIn(st, c, s)) return 'Other stairs are in the way';
    if (furnitureIn(st, c, s).length > 0) return 'Furniture in the way';
  }
  if (!hasFloor(st, top, s + 1)) return 'Needs a floor at the top';
  const atTop = st.walls[key(top, s + 1)];
  if (atTop === 'wall' || atTop === 'window') return 'A wall is in the way at the top';
  return null;
}

export function placeStair(st: State, x: number, s: number, dir: 1 | -1): string | null {
  const problem = stairProblem(st, x, s, dir);
  if (problem) return problem;
  st.stairs.push({ id: st.nextId++, x, s, dir });
  return null;
}

export function removeStair(st: State, id: number): boolean {
  const i = st.stairs.findIndex((t) => t.id === id);
  if (i < 0) return false;
  st.stairs.splice(i, 1);
  return true;
}

// ------------------------------------------------------------------ rooms

/**
 * A walled, floored and roofed box from column xa to xb and storey sa to sb: walls down
 * both ends, a floor under it and a ceiling over it. Existing doors and windows stay, and
 * any part that's blocked is skipped. Returns how many parts were added.
 */
export function buildRoom(st: State, xa: number, sa: number, xb: number, sb: number): number {
  const [x0, x1] = [Math.min(xa, xb), Math.max(xa, xb)];
  const [s0, s1] = [Math.min(sa, sb), Math.max(sa, sb)];
  let added = 0;
  for (let level = Math.max(1, s0); level <= s1 + 1; level++) {
    for (let x = x0; x <= x1; x++) {
      if (st.slabs[key(x, level)] || slabProblem(st, x, level)) continue;
      st.slabs[key(x, level)] = true;
      added++;
    }
  }
  for (let s = s0; s <= s1; s++) {
    for (const x of [x0, x1]) {
      if (st.walls[key(x, s)] !== undefined || segmentProblem(st, x, s, 'wall')) continue;
      st.walls[key(x, s)] = 'wall';
      added++;
    }
  }
  return added;
}

// ------------------------------------------------------------------ furniture

export function furnitureProblem(st: State, def: string, x: number, s: number, r: number, ignoreId?: number): string | null {
  const d = furnitureDef(def);
  if (s < 0 || s >= MAX_STOREYS) return 'Outside your plot';
  if (d.wall ? r < 1 : r !== 0) return d.wall ? 'Goes on the wall, above the floor' : 'Stands on the floor';
  if (r + d.h > ROOM_ROWS) return 'Too tall to fit';
  for (let c = x; c < x + d.w; c++) {
    if (!inPlot(st, c)) return 'Outside your plot';
    if (!hasFloor(st, c, s)) return 'Needs a floor';
    if (st.walls[key(c, s)] !== undefined) return 'A wall or door is in the way';
    if (stairIn(st, c, s)) return 'Stairs in the way';
  }
  for (const f of st.furniture) {
    if (f.id === ignoreId || f.s !== s) continue;
    const o = furnitureDef(f.def);
    const overlapX = x < f.x + o.w && f.x < x + d.w;
    const overlapR = r < f.r + o.h && f.r < r + d.h;
    if (overlapX && overlapR) return `${o.name} in the way`;
  }
  return null;
}

export function placeFurniture(st: State, def: string, x: number, s: number, r: number, flip = false): Furniture | string {
  const problem = furnitureProblem(st, def, x, s, r);
  if (problem) return problem;
  const f: Furniture = { id: st.nextId++, def, x, s, r, ...(flip ? { flip: true } : {}) };
  st.furniture.push(f);
  return f;
}

export function moveFurniture(st: State, id: number, x: number, s: number, r: number): string | null {
  const f = st.furniture.find((o) => o.id === id);
  if (!f) return 'Gone';
  const problem = furnitureProblem(st, f.def, x, s, r, id);
  if (problem) return problem;
  Object.assign(f, { x, s, r });
  return null;
}

export function removeFurniture(st: State, id: number): boolean {
  const i = st.furniture.findIndex((f) => f.id === id);
  if (i < 0) return false;
  st.furniture.splice(i, 1);
  return true;
}

export function flipFurniture(st: State, id: number): boolean {
  const f = st.furniture.find((o) => o.id === id);
  if (!f) return false;
  if (f.flip) delete f.flip;
  else f.flip = true;
  return true;
}

/** The furniture covering a cell, if any. */
export function furnitureAt(st: State, x: number, s: number, r: number): Furniture | undefined {
  return st.furniture.find((f) => {
    const d = furnitureDef(f.def);
    return f.s === s && x >= f.x && x < f.x + d.w && r >= f.r && r < f.r + d.h;
  });
}
