// Changing the building. Every change goes through here so it's checked the same way
// (each check returns a reason in words, or null if it's fine) and can be undone.
//
// The building is cells. Walls go anywhere, as long as they're held up: a cell standing on
// something that's held up (or on the ground) is held up, and from there a ledge can go
// MAX_OVERHANG cells sideways; the next one along isn't. Windows fill a one-cell gap and doors a
// two-cell one (or replace the wall that's there). Stairs face away from you, up a single
// column: a flight is FLIGHT cells tall, from one floor up through the floor above.

import { furnitureDef } from './defs';
import { DOOR_ROWS, MAX_ROWS, isDoor, isSolid, key, type BuildPartsData, type CellKind, type Furniture, type State } from './state';

export type BuildParts = BuildPartsData;

/** How far a ledge can stick out from whatever's holding it up. */
export const MAX_OVERHANG = 4;

/** The parts that can change in build mode, as a copy (for undo). */
export function snapshot(s: State): string {
  const parts: BuildParts = { cells: s.cells, furniture: s.furniture, insulated: s.insulated };
  return JSON.stringify(parts);
}

export function restore(s: State, json: string): void {
  const parts = JSON.parse(json) as BuildParts;
  s.cells = parts.cells;
  s.furniture = parts.furniture;
  s.insulated = parts.insulated ?? {};
}

const inPlot = (st: State, x: number) => x >= st.plot.x0 && x <= st.plot.x1;

export function cellOf(st: State, x: number, s: number): CellKind | undefined {
  return st.cells[key(x, s)];
}

/** The upper cell of a door (left empty in the cells, but taken). */
export function isDoorTop(st: State, x: number, s: number): boolean {
  return isDoor(cellOf(st, x, s - 1));
}

/** Something's in this cell: a wall, window, stair, or either half of a door. */
export function taken(st: State, x: number, s: number): boolean {
  return cellOf(st, x, s) !== undefined || isDoorTop(st, x, s);
}

// ------------------------------------------------------------------ holding things up

/**
 * The first cell that isn't held up, or null if everything is. A cell on the ground, or
 * standing on a cell that's held up, is fully held up (0); each step sideways from there
 * counts one, and so does hanging under a cell (it keeps that cell's count). Up to
 * MAX_OVERHANG is held up.
 */
export function unsupported(cells: Record<string, CellKind>): string | null {
  return unsupportedCells(cells)[0] ?? null;
}

/** Every cell that isn't held up (a door counts as its bottom cell). */
export function unsupportedCells(cells: Record<string, CellKind>): string[] {
  const dist = new Map<string, number>();
  const occupied = new Map<string, CellKind | 'top'>();
  for (const [k, c] of Object.entries(cells)) {
    occupied.set(k, c);
    if (isDoor(c)) {
      const [x, s] = k.split(',').map(Number);
      occupied.set(key(x, s + 1), 'top');
    }
  }
  const deque: string[] = [];
  for (const k of occupied.keys()) {
    if (Number(k.split(',')[1]) === 0) {
      dist.set(k, 0);
      deque.push(k);
    }
  }
  // Distances only ever go down as cells are re-queued, so this settles.
  for (let i = 0; i < deque.length; i++) {
    const k = deque[i];
    const d = dist.get(k)!;
    const [x, s] = k.split(',').map(Number);
    const steps: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, ds] of steps) {
      const n = key(x + dx, s + ds);
      const kind = occupied.get(n);
      if (kind === undefined) continue;
      // Standing on it: fully held. Hanging under it: as held as it is. Beside it: one more.
      const nd = ds === 1 ? 0 : ds === -1 ? d : d + 1;
      if (nd > MAX_OVERHANG || (dist.get(n) ?? Infinity) <= nd) continue;
      dist.set(n, nd);
      // Re-queuing at the end is fine at this size: distances only ever go down.
      deque.push(n);
    }
  }
  const out: string[] = [];
  for (const [k, kind] of occupied) {
    if (dist.has(k)) continue;
    if (kind === 'top') {
      const [x, s] = k.split(',').map(Number);
      const bottom = key(x, s - 1);
      if (!out.includes(bottom)) out.push(bottom);
    } else if (!out.includes(k)) out.push(k);
  }
  return out;
}

const NOT_HELD = `Nothing holding it up: a ledge can stick out ${MAX_OVERHANG} cells at most`;

/** Runs a change on a copy of the cells and says whether everything's still held up. */
function stillHeld(st: State, change: (cells: Record<string, CellKind>) => void): boolean {
  const cells = { ...st.cells };
  change(cells);
  return unsupported(cells) === null;
}

// ------------------------------------------------------------------ cells

/** Furniture with any part in this cell. */
export function furnitureAt(st: State, x: number, s: number): Furniture | undefined {
  return st.furniture.find((f) => {
    const d = furnitureDef(f.def);
    return x >= f.x && x < f.x + d.w && s >= f.s && s < f.s + d.h;
  });
}

/** Furniture standing on this cell. */
function standingOn(st: State, x: number, s: number): Furniture | undefined {
  return st.furniture.find((f) => !furnitureDef(f.def).wall && f.s === s + 1 && x >= f.x && x < f.x + furnitureDef(f.def).w);
}

/**
 * Why a cell can't go in. `held` false skips the check that it's held up (when drawing
 * plans, which can be anything until they're signed off).
 */
export function cellProblem(st: State, x: number, s: number, kind: CellKind, held = true): string | null {
  const rows = isDoor(kind) ? DOOR_ROWS : 1;
  if (!inPlot(st, x) || s < 0 || s + rows > MAX_ROWS) return 'Outside your plot';
  const here = cellOf(st, x, s);
  if (here === kind) return null;
  if (kind === 'entrance' && s !== 0) return 'The street door goes on the ground';
  for (let r = 0; r < rows; r++) {
    const c = cellOf(st, x, s + r);
    if (isDoorTop(st, x, s + r) || isDoor(c)) return 'A door is in the way: knock it out first';
    // Walls, windows and doors can replace a wall or a window; stairs need an empty cell.
    if (c === 'stair') return 'Stairs in the way';
    if (c !== undefined && kind === 'stair') return 'Something is in the way';
    if (furnitureAt(st, x, s + r)) return 'Furniture in the way';
  }
  if (isDoor(kind) && s > 0 && !isSolid(cellOf(st, x, s - 1)) && cellOf(st, x, s - 1) !== 'stair') return 'A door needs something to stand on';
  if (held && !stillHeld(st, (cells) => setCell(cells, x, s, kind))) return NOT_HELD;
  return null;
}

/** Puts a cell in, without checking (doors clear the cell above them). */
function setCell(cells: Record<string, CellKind>, x: number, s: number, kind: CellKind): void {
  cells[key(x, s)] = kind;
  if (isDoor(kind)) delete cells[key(x, s + 1)];
}

export function placeCell(st: State, x: number, s: number, kind: CellKind, held = true): string | null {
  const problem = cellProblem(st, x, s, kind, held);
  if (problem) return problem;
  if (cellOf(st, x, s) === kind) return null;
  setCell(st.cells, x, s, kind);
  if (!isSolid(kind)) delete st.insulated[key(x, s)];
  if (isDoor(kind)) delete st.insulated[key(x, s + 1)];
  return null;
}

/** Why a cell can't be knocked out (a door's upper half means the door). */
export function removeProblem(st: State, x: number, s: number, held = true): string | null {
  if (!inPlot(st, x)) return 'Outside your plot';
  const at = isDoorTop(st, x, s) ? s - 1 : s;
  if (cellOf(st, x, at) === undefined) return 'Nothing to knock down there';
  const rows = cellOf(st, x, at) === 'stair' ? flightOf(st, x, at) : [at];
  if (rows.some((r) => standingOn(st, x, r))) return 'Furniture is standing on it';
  if (held && !stillHeld(st, (cells) => rows.forEach((r) => delete cells[key(x, r)]))) return "It's holding other bits up";
  return null;
}

export function removeCell(st: State, x: number, s: number, held = true): string | null {
  const problem = removeProblem(st, x, s, held);
  if (problem) return problem;
  const at = isDoorTop(st, x, s) ? s - 1 : s;
  // A stair takes the whole flight with it.
  for (const r of cellOf(st, x, at) === 'stair' ? flightOf(st, x, at) : [at]) {
    delete st.cells[key(x, r)];
    delete st.insulated[key(x, r)];
  }
  return null;
}

/** How tall a flight of stairs is: one floor (three rows of room and the floor above). */
export const FLIGHT = 4;

/**
 * Why a flight of stairs can't go up from this cell: it climbs FLIGHT cells straight up
 * (away from you), through the floor above, which it replaces. It needs a floor (or the top
 * of another flight) to start from, and room for itself.
 */
export function stairsProblem(st: State, x: number, s: number, held = true): string | null {
  if (!inPlot(st, x) || s < 0 || s + FLIGHT > MAX_ROWS) return 'Outside your plot';
  const below = cellOf(st, x, s - 1);
  if (s > 0 && !isSolid(below) && below !== 'stair') return 'Stairs need a floor to start from';
  for (let r = 0; r < FLIGHT; r++) {
    const c = cellOf(st, x, s + r);
    if (isDoor(c) || isDoorTop(st, x, s + r)) return 'A door is in the way';
    if (c === 'stair') return 'Stairs are already there';
    // The top cell can cut through a floor; the rest need clear space.
    if (c !== undefined && r < FLIGHT - 1) return 'A wall is in the way';
    if (furnitureAt(st, x, s + r)) return 'Furniture in the way';
  }
  if (standingOn(st, x, s + FLIGHT - 1)) return 'Furniture is standing where the stairs come up';
  if (held && !stillHeld(st, (cells) => {
    for (let r = 0; r < FLIGHT; r++) cells[key(x, s + r)] = 'stair';
  })) return NOT_HELD;
  return null;
}

export function placeStairs(st: State, x: number, s: number, held = true): string | null {
  const problem = stairsProblem(st, x, s, held);
  if (problem) return problem;
  for (let r = 0; r < FLIGHT; r++) {
    st.cells[key(x, s + r)] = 'stair';
    delete st.insulated[key(x, s + r)];
  }
  return null;
}

/** The cells of the flight of stairs a stair cell is part of. */
export function flightOf(st: State, x: number, s: number): number[] {
  let bottom = s;
  while (cellOf(st, x, bottom - 1) === 'stair') bottom--;
  const rows: number[] = [];
  for (let r = bottom; cellOf(st, x, r) === 'stair'; r++) rows.push(r);
  return rows;
}

/**
 * A box of walls from column xa to xb and row sa to sb: the walls round the edge, with
 * the room inside. Walls already there stay, and any cell that can't go in is skipped.
 * Returns how many cells went in.
 */
export function buildRoom(st: State, xa: number, sa: number, xb: number, sb: number): number {
  const [x0, x1] = [Math.min(xa, xb), Math.max(xa, xb)];
  const [s0, s1] = [Math.min(sa, sb), Math.max(sa, sb)];
  const edge: [number, number][] = [];
  for (let x = x0; x <= x1; x++) edge.push([x, s0], [x, s1]);
  for (let s = s0 + 1; s < s1; s++) edge.push([x0, s], [x1, s]);
  // Bottom up, and round again while anything else goes in: a cell can need the corner
  // beyond it to be up first.
  edge.sort((a, b) => a[1] - b[1]);
  let added = 0;
  for (let progress = true; progress; ) {
    progress = false;
    for (const [x, s] of edge) {
      if (taken(st, x, s) || placeCell(st, x, s, 'wall')) continue;
      added++;
      progress = true;
    }
  }
  return added;
}

// ------------------------------------------------------------------ insulation

/** Insulation goes in wall and window cells, by "x,s". */
export function insulateProblem(st: State, k: string): string | null {
  if (st.insulated[k]) return 'Already insulated';
  const [x] = k.split(',').map(Number);
  if (!inPlot(st, x)) return 'Outside your plot';
  if (!isSolid(st.cells[k])) return 'Insulate a wall';
  return null;
}

export function insulate(st: State, k: string): string | null {
  const problem = insulateProblem(st, k);
  if (problem) return problem;
  st.insulated[k] = true;
  return null;
}

// ------------------------------------------------------------------ furniture

/**
 * Floor furniture stands on walls (a wall cell under every column of it); wall furniture
 * hangs anywhere there's room. Nothing goes in a wall, a door or on the stairs.
 */
export function furnitureProblem(st: State, def: string, x: number, s: number, ignoreId?: number): string | null {
  const d = furnitureDef(def);
  if (s < 0 || s + d.h > MAX_ROWS) return 'Outside your plot';
  for (let c = x; c < x + d.w; c++) {
    if (!inPlot(st, c)) return 'Outside your plot';
    for (let r = s; r < s + d.h; r++) {
      const cell = cellOf(st, c, r);
      if (isSolid(cell)) return 'A wall is in the way';
      if (isDoor(cell) || isDoorTop(st, c, r)) return 'A door is in the way';
      if (cell === 'stair') return 'Stairs in the way';
    }
    if (!d.wall && s > 0 && !isSolid(cellOf(st, c, s - 1))) return 'Needs a floor under it';
  }
  for (const f of st.furniture) {
    if (f.id === ignoreId) continue;
    const o = furnitureDef(f.def);
    const overlapX = x < f.x + o.w && f.x < x + d.w;
    const overlapS = s < f.s + o.h && f.s < s + d.h;
    if (overlapX && overlapS) return `${o.name} in the way`;
  }
  return null;
}

export function placeFurniture(st: State, def: string, x: number, s: number, flip = false): Furniture | string {
  const problem = furnitureProblem(st, def, x, s);
  if (problem) return problem;
  const f: Furniture = { id: st.nextId++, def, x, s, ...(flip ? { flip: true } : {}) };
  st.furniture.push(f);
  return f;
}

export function moveFurniture(st: State, id: number, x: number, s: number): string | null {
  const f = st.furniture.find((o) => o.id === id);
  if (!f) return 'Gone';
  const problem = furnitureProblem(st, f.def, x, s, id);
  if (problem) return problem;
  Object.assign(f, { x, s });
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
