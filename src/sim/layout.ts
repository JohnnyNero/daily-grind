// What the building's cells add up to: where people can stand, how they get about, which
// spaces are rooms, which rooms make up each flat and what's shared. Worked out from the
// state whenever the building changes, never saved.
//
// A node is a cell someone can stand in: empty, with a wall under it (or the ground) and
// room for their head above, or a stair. Stairs face away from you, up a single column, so
// people climbing them don't need headroom; they walk sideways between nodes, and straight
// up or down a flight (and off its top onto the floor above). A door's bottom cell is a
// node, but belongs to no room.
//
// Rooms are found from the air: each patch of empty cells closed in by walls, windows and
// doors is a room. A patch that reaches outside the plot is outdoors. The shared parts of
// the building are the rooms reached from the street through the street door and inside
// doors; a flat is the rooms behind a flat's front door.

import { MAX_ROWS, isDoor, isSolid, key, type CellKind, type State } from './state';

export interface Room {
  id: number;
  /** Cells someone can stand in. */
  nodes: number[];
  /** Every empty cell in it. */
  cells: number[];
  /** Part of the street (open to the outside). */
  outdoor: boolean;
  /** Closed in all round: every room that isn't outdoors. */
  enclosed: boolean;
  /** The flat this room belongs to, or null for shared space, the street or a sealed room. */
  flat: string | null;
  shared: boolean;
}

export interface Flat {
  /** The key ("x,s") of its first front door: stable while that door stays. */
  id: string;
  name: string;
  rooms: number[];
  doors: string[];
  /** Floor tiles inside: places to stand. */
  area: number;
  enclosed: boolean;
}

export class Layout {
  readonly w: number;
  readonly rows = MAX_ROWS;
  readonly standable: Uint8Array;
  /** The room each cell's air belongs to (-1 for walls, doors and anything outside the grid). */
  readonly roomOf: Int32Array;
  readonly rooms: Room[] = [];
  readonly flats: Flat[] = [];
  /** The pavement past the front of the building: its two ends. */
  private pavement: [number, number] | null = null;
  /** Indoor rooms nobody can reach: no way in from the street or a flat door. */
  readonly sealed: number[] = [];

  constructor(private readonly state: State) {
    this.w = state.w;
    const n = this.w * this.rows;
    this.standable = new Uint8Array(n);
    this.roomOf = new Int32Array(n).fill(-1);
    for (let s = 0; s < this.rows; s++) {
      for (let x = 0; x < this.w; x++) {
        if (this.canStand(x, s)) this.standable[this.node(x, s)] = 1;
      }
    }
    // The pavement runs past the front of the building, joining the street either side.
    if (state.plot.x0 > 0 && state.plot.x1 < this.w - 1) this.pavement = [this.node(state.plot.x0 - 1, 0), this.node(state.plot.x1 + 1, 0)];
    this.findRooms();
    this.findFlats();
  }

  node(x: number, s: number): number {
    return s * this.w + x;
  }

  xs(n: number): [number, number] {
    return [n % this.w, Math.floor(n / this.w)];
  }

  inPlot(x: number): boolean {
    return x >= this.state.plot.x0 && x <= this.state.plot.x1;
  }

  cell(x: number, s: number): CellKind | undefined {
    return this.state.cells[key(x, s)];
  }

  /** A door's upper cell. */
  doorTop(x: number, s: number): boolean {
    return isDoor(this.cell(x, s - 1));
  }

  /** Walls and windows, and the ground under row 0. */
  solid(x: number, s: number): boolean {
    return s < 0 || isSolid(this.cell(x, s));
  }

  /** Air: an empty cell or a stair (not a wall, window or door). */
  air(x: number, s: number): boolean {
    if (x < 0 || x >= this.w || s < 0 || s >= this.rows) return false;
    const c = this.cell(x, s);
    return (c === undefined || c === 'stair') && !this.doorTop(x, s);
  }

  stair(x: number, s: number): boolean {
    return this.cell(x, s) === 'stair';
  }

  private canStand(x: number, s: number): boolean {
    const c = this.cell(x, s);
    if (isSolid(c) || this.doorTop(x, s)) return false;
    if (!this.inPlot(x)) return s === 0;
    if (c === 'stair') return true;
    const footing = this.solid(x, s - 1) || this.stair(x, s - 1);
    const head = s + 1 >= this.rows || !this.solid(x, s + 1);
    return footing && head;
  }

  isDoorNode(n: number): boolean {
    const [x, s] = this.xs(n);
    return isDoor(this.cell(x, s));
  }

  /** Every node one step from n: along the floor, up or down the stairs, or along the pavement. */
  neighbours(n: number): number[] {
    const [x, s] = this.xs(n);
    const out: number[] = [];
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (nx < 0 || nx >= this.w) continue;
      if (this.standable[n + dx]) out.push(n + dx);
    }
    // Up from a stair (to the next one, or off the top), or down onto one.
    if (this.stair(x, s) && s + 1 < this.rows && this.standable[n + this.w]) out.push(n + this.w);
    if (s > 0 && this.stair(x, s - 1) && this.standable[n - this.w]) out.push(n - this.w);
    if (this.pavement) {
      const [a, b] = this.pavement;
      if (n === a) out.push(b);
      else if (n === b) out.push(a);
    }
    return out;
  }

  /** Is this step the pavement past the front (for drawing people in front of the building)? */
  isPavement(a: number, b: number): boolean {
    return !!this.pavement && ((a === this.pavement[0] && b === this.pavement[1]) || (a === this.pavement[1] && b === this.pavement[0]));
  }

  /** Patches of air between walls and doors, each a room. */
  private findRooms(): void {
    const total = this.w * this.rows;
    for (let start = 0; start < total; start++) {
      const [sx, ss] = this.xs(start);
      if (this.roomOf[start] !== -1 || !this.air(sx, ss)) continue;
      const id = this.rooms.length;
      const cells = [start];
      this.roomOf[start] = id;
      let outdoor = false;
      for (let i = 0; i < cells.length; i++) {
        const [x, s] = this.xs(cells[i]);
        if (!this.inPlot(x) || s === this.rows - 1) outdoor = true;
        for (const [dx, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ns = s + ds;
          if (!this.air(nx, ns)) continue;
          const m = this.node(nx, ns);
          if (this.roomOf[m] !== -1) continue;
          this.roomOf[m] = id;
          cells.push(m);
        }
      }
      const nodes = cells.filter((m) => this.standable[m]);
      this.rooms.push({ id, nodes, cells, outdoor, enclosed: !outdoor, flat: null, shared: false });
    }
  }

  /** The rooms either side of a door node (left, right), where there are rooms. */
  doorSides(n: number): number[] {
    const [x, s] = this.xs(n);
    const out: number[] = [];
    for (const dx of [-1, 1]) {
      for (const ds of [0, 1]) {
        if (x + dx < 0 || x + dx >= this.w) continue;
        const r = this.roomOf[this.node(x + dx, s + ds)];
        if (r !== -1 && !out.includes(r)) out.push(r);
      }
    }
    return out;
  }

  private doorNodes(): { n: number; kind: CellKind; sides: number[] }[] {
    const out: { n: number; kind: CellKind; sides: number[] }[] = [];
    for (const [k, kind] of Object.entries(this.state.cells)) {
      if (!isDoor(kind)) continue;
      const [x, s] = k.split(',').map(Number);
      if (s >= this.rows || x < 0 || x >= this.w) continue;
      const n = this.node(x, s);
      out.push({ n, kind, sides: this.doorSides(n) });
    }
    return out.sort((a, b) => a.n - b.n);
  }

  private findFlats(): void {
    const doors = this.doorNodes();
    // Shared space: everything reached from the street through the street door and inside doors.
    const shared = new Set<number>(this.rooms.filter((r) => r.outdoor).map((r) => r.id));
    const queue = [...shared];
    for (let i = 0; i < queue.length; i++) {
      for (const d of doors) {
        if (d.kind === 'flatDoor' || !d.sides.includes(queue[i])) continue;
        for (const r of d.sides) {
          if (shared.has(r)) continue;
          shared.add(r);
          queue.push(r);
        }
      }
    }
    for (const r of this.rooms) r.shared = shared.has(r.id) && !r.outdoor;
    // Everything else, joined through inside doors, in groups.
    const group = new Map<number, number>();
    for (const r of this.rooms) {
      if (shared.has(r.id) || group.has(r.id)) continue;
      const members = [r.id];
      group.set(r.id, r.id);
      for (let i = 0; i < members.length; i++) {
        for (const d of doors) {
          if (d.kind !== 'door' || !d.sides.includes(members[i])) continue;
          for (const o of d.sides) {
            if (shared.has(o) || group.has(o)) continue;
            group.set(o, r.id);
            members.push(o);
          }
        }
      }
      const fronts = doors.filter((d) => d.kind === 'flatDoor' && d.sides.some((o) => members.includes(o)) && d.sides.some((o) => shared.has(o)));
      const rooms = members.map((id) => this.rooms[id]);
      const nodes = rooms.flatMap((room) => room.nodes);
      if (fronts.length === 0 || nodes.length === 0) {
        this.sealed.push(...members.filter((id) => this.rooms[id].enclosed && this.rooms[id].nodes.length > 0));
        continue;
      }
      const doorKeys = fronts.map((d) => key(...this.xs(d.n)));
      const flat: Flat = { id: doorKeys[0], name: '', rooms: members, doors: doorKeys, area: nodes.length, enclosed: rooms.every((room) => room.enclosed) };
      for (const room of rooms) room.flat = flat.id;
      this.flats.push(flat);
    }
    // Numbered from the ground up, left to right.
    const lowest = (f: Flat) => Math.min(...f.rooms.flatMap((id) => this.rooms[id].nodes));
    this.flats.sort((a, b) => lowest(a) - lowest(b));
    this.flats.forEach((f, i) => {
      f.name = `Flat ${i + 1}`;
    });
  }

  flat(id: string | null): Flat | undefined {
    return id === null ? undefined : this.flats.find((f) => f.id === id);
  }

  /** Every empty cell of a flat. */
  flatCells(f: Flat): number[] {
    return f.rooms.flatMap((r) => this.rooms[r].cells);
  }

  /** Every place to stand in a flat. */
  flatNodes(f: Flat): number[] {
    return f.rooms.flatMap((r) => this.rooms[r].nodes);
  }

  /** The flat a cell is in (a door counts for the flat it opens into). */
  flatAt(x: number, s: number): Flat | undefined {
    if (x < 0 || x >= this.w || s < 0 || s >= this.rows) return undefined;
    const room = this.roomOf[this.node(x, s)];
    if (room !== -1) return this.flat(this.rooms[room].flat);
    const base = this.doorTop(x, s) ? s - 1 : s;
    const n = this.node(x, base);
    if (!this.isDoorNode(n)) return undefined;
    for (const r of this.doorSides(n)) {
      const f = this.flat(this.rooms[r].flat);
      if (f) return f;
    }
    return undefined;
  }
}

/** Who can get through which doors. */
export interface Keys {
  /** Every door in the building (the agent, builders). */
  all?: boolean;
  /** Flats they have keys to; any flat key also opens the street door. */
  flats?: readonly string[];
}

/** Can someone with these keys pass the door at node n? Doors that aren't locked are always fine. */
export function canPass(layout: Layout, n: number, keys: Keys): boolean {
  const [x, s] = layout.xs(n);
  const kind = layout.cell(x, s);
  if (!isDoor(kind) || kind === 'door' || keys.all) return true;
  const mine = keys.flats ?? [];
  if (kind === 'entrance') return mine.length > 0;
  return layout.flatAt(x, s) !== undefined && mine.includes(layout.flatAt(x, s)!.id);
}

/** The shortest walk from one node to another, or null. Excludes the start node. */
export function findPath(layout: Layout, from: number, to: number, keys: Keys): number[] | null {
  if (from === to) return [];
  if (!layout.standable[to]) return null;
  const prev = new Int32Array(layout.standable.length).fill(-1);
  prev[from] = from;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const m of layout.neighbours(n)) {
      if (prev[m] !== -1) continue;
      if (layout.isDoorNode(m) && !canPass(layout, m, keys)) continue;
      prev[m] = n;
      if (m === to) {
        const path = [to];
        for (let p = n; p !== from; p = prev[p]) path.push(p);
        return path.reverse();
      }
      queue.push(m);
    }
  }
  return null;
}
