// What the building's parts add up to: where people can stand, how they get about, which
// spaces are rooms, which rooms make up each flat and what's shared. Worked out from the
// state whenever the building changes, never saved.
//
// A node is a place to stand: one column of one storey. Walls and windows fill their node;
// doors are nodes you can stand in but that belong to no room. Rooms are the nodes joined
// without passing a door (stairs join the storeys they link). The street is outdoors. The
// shared parts of the building are the rooms reached from the street through the street
// door and inside doors; a flat is the rooms behind a flat's front door.

import { MAX_STOREYS, isDoor, key, type Segment, type State } from './state';

export interface Room {
  id: number;
  nodes: number[];
  /** Part of the street. */
  outdoor: boolean;
  /** Walled and roofed all round (only matters inside the plot). */
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
  /** Floor tiles inside. */
  area: number;
  storeys: number[];
  enclosed: boolean;
}

/** A link that isn't a step along the floor: a flight of stairs, or the pavement past the front (stairId -1). */
interface StairLink {
  from: number;
  to: number;
  stairId: number;
}

export class Layout {
  readonly w: number;
  readonly storeys = MAX_STOREYS;
  readonly standable: Uint8Array;
  readonly roomOf: Int32Array;
  readonly rooms: Room[] = [];
  readonly flats: Flat[] = [];
  /** Stair links out of each node (both directions). */
  private links = new Map<number, StairLink[]>();
  /** Indoor rooms nobody can reach: no way in from the street or a flat door. (The bare roof doesn't count.) */
  readonly sealed: number[] = [];

  constructor(private readonly state: State) {
    this.w = state.w;
    const n = this.w * this.storeys;
    this.standable = new Uint8Array(n);
    this.roomOf = new Int32Array(n).fill(-1);
    for (let s = 0; s < this.storeys; s++) {
      for (let x = 0; x < this.w; x++) {
        if (this.canStand(x, s)) this.standable[this.node(x, s)] = 1;
      }
    }
    // The pavement runs past the front of the building, joining the street either side.
    const left = this.node(state.plot.x0 - 1, 0);
    const right = this.node(state.plot.x1 + 1, 0);
    if (state.plot.x0 > 0 && state.plot.x1 < this.w - 1) {
      this.addLink({ from: left, to: right, stairId: -1 });
      this.addLink({ from: right, to: left, stairId: -1 });
    }
    for (const st of state.stairs) {
      const foot = this.node(st.dir === 1 ? st.x : st.x + 2, st.s);
      const top = this.node(st.dir === 1 ? st.x + 2 : st.x, st.s + 1);
      if (!this.standable[foot] || !this.standable[top]) continue;
      this.addLink({ from: foot, to: top, stairId: st.id });
      this.addLink({ from: top, to: foot, stairId: st.id });
    }
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

  segment(x: number, s: number): Segment | undefined {
    return this.state.walls[key(x, s)];
  }

  slab(x: number, level: number): boolean {
    return this.state.slabs[key(x, level)] === true;
  }

  private canStand(x: number, s: number): boolean {
    const seg = this.segment(x, s);
    if (seg === 'wall' || seg === 'window') return false;
    if (s === 0) return true;
    return this.inPlot(x) && this.slab(x, s);
  }

  isDoorNode(n: number): boolean {
    const [x, s] = this.xs(n);
    return isDoor(this.segment(x, s));
  }

  private addLink(l: StairLink): void {
    const list = this.links.get(l.from) ?? [];
    list.push(l);
    this.links.set(l.from, list);
  }

  stairLinks(n: number): readonly StairLink[] {
    return this.links.get(n) ?? [];
  }

  /** Every node one step from n: along the floor, or up or down a flight of stairs. */
  neighbours(n: number): number[] {
    const x = n % this.w;
    const out: number[] = [];
    if (x > 0 && this.standable[n - 1]) out.push(n - 1);
    if (x < this.w - 1 && this.standable[n + 1]) out.push(n + 1);
    for (const l of this.stairLinks(n)) out.push(l.to);
    return out;
  }

  private findRooms(): void {
    const total = this.standable.length;
    for (let start = 0; start < total; start++) {
      if (!this.standable[start] || this.roomOf[start] !== -1 || this.isDoorNode(start)) continue;
      const id = this.rooms.length;
      const nodes = [start];
      this.roomOf[start] = id;
      for (let i = 0; i < nodes.length; i++) {
        for (const m of this.neighbours(nodes[i])) {
          if (this.roomOf[m] !== -1 || this.isDoorNode(m)) continue;
          this.roomOf[m] = id;
          nodes.push(m);
        }
      }
      const outdoor = nodes.some((m) => !this.inPlot(this.xs(m)[0]));
      this.rooms.push({ id, nodes, outdoor, enclosed: !outdoor && this.isEnclosed(nodes), flat: null, shared: false });
    }
  }

  /** Walls at both ends of every storey it spans, and a ceiling over every tile. */
  private isEnclosed(nodes: number[]): boolean {
    const set = new Set(nodes);
    for (const m of nodes) {
      const [x, s] = this.xs(m);
      if (!this.slab(x, s + 1)) return false;
      for (const dx of [-1, 1]) {
        const nx = x + dx;
        if (set.has(m + dx)) continue;
        const seg = this.segment(nx, s);
        if (seg === undefined || !this.inPlot(nx)) return false;
      }
    }
    return true;
  }

  /** The rooms either side of a door node (left, right), where there are rooms. */
  doorSides(n: number): number[] {
    const [x] = this.xs(n);
    const out: number[] = [];
    if (x > 0 && this.roomOf[n - 1] !== -1) out.push(this.roomOf[n - 1]);
    if (x < this.w - 1 && this.roomOf[n + 1] !== -1) out.push(this.roomOf[n + 1]);
    return out;
  }

  private doorNodes(): { n: number; seg: Segment; sides: number[] }[] {
    const out: { n: number; seg: Segment; sides: number[] }[] = [];
    for (const [k, seg] of Object.entries(this.state.walls)) {
      if (!isDoor(seg)) continue;
      const [x, s] = k.split(',').map(Number);
      if (s >= this.storeys || x < 0 || x >= this.w) continue;
      const n = this.node(x, s);
      if (!this.standable[n]) continue;
      out.push({ n, seg, sides: this.doorSides(n) });
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
        if (d.seg === 'flatDoor' || !d.sides.includes(queue[i])) continue;
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
          if (d.seg !== 'door' || !d.sides.includes(members[i])) continue;
          for (const o of d.sides) {
            if (shared.has(o) || group.has(o)) continue;
            group.set(o, r.id);
            members.push(o);
          }
        }
      }
      const fronts = doors.filter((d) => d.seg === 'flatDoor' && d.sides.some((o) => members.includes(o)) && d.sides.some((o) => shared.has(o)));
      if (fronts.length === 0) {
        this.sealed.push(...members.filter((id) => this.rooms[id].enclosed));
        continue;
      }
      const rooms = members.map((id) => this.rooms[id]);
      const nodes = rooms.flatMap((room) => room.nodes);
      const storeys = [...new Set(nodes.map((m) => this.xs(m)[1]))].sort((a, b) => a - b);
      const doorKeys = fronts.map((d) => key(...this.xs(d.n)));
      const flat: Flat = { id: doorKeys[0], name: '', rooms: members, doors: doorKeys, area: nodes.length, storeys, enclosed: rooms.every((room) => room.enclosed) };
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

  /** The flat at a node (a door counts for the flat it opens into). */
  flatAt(x: number, s: number): Flat | undefined {
    if (x < 0 || x >= this.w || s < 0 || s >= this.storeys) return undefined;
    const n = this.node(x, s);
    const room = this.roomOf[n];
    if (room !== -1) return this.flat(this.rooms[room].flat);
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
  const seg = layout.segment(x, s);
  if (!isDoor(seg) || seg === 'door' || keys.all) return true;
  const mine = keys.flats ?? [];
  if (seg === 'entrance') return mine.length > 0;
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
