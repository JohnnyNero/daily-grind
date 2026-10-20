// Heat by room (docs/specs/layout.md 2.2). One temperature per room, not per flat. Heat
// leaks out through outside walls, the roof and the ground; passes through inside walls to
// the room next door (doors at twice a wall); and rises, so a room gets a good share of the
// warmth of the room below and a little of the room above. Radiators heat their own room. A
// flat's warmth (`st.temps`, what everything else reads) is the average of its bedrooms and
// living rooms.
//
// Rooms are found afresh whenever the building changes, so each room's temperature is kept
// against its first cell ("x,s"). When the walls move, a new room starts from the average of
// the old rooms it took cells from.

import { outdoorTemp } from './environment';
import type { Layout } from './layout';
import { flatKind } from './rooms';
import type { Sim } from './sim';
import { isDoor, key } from './state';
import { HEAT, WARMTH } from './tuning';

// ------------------------------------------------------------------ the shape of each room

/** One room's walls, as heat (and damp) sees them. */
export interface RoomShape {
  /** The layout room. */
  room: number;
  /** "x,s" of its first cell: what its temperature and damp are kept against. */
  key: string;
  flat: string | null;
  /** Places to stand (at least 1). */
  area: number;
  /** Outside wall, roof and ground, weighted by tile and thinned by thickness; and how much is insulated. */
  outside: number;
  insulated: number;
  /** The roof over it, and the ground (the plinth) under it, of `outside`: and how much of each is insulated. */
  roof: number;
  roofInsulated: number;
  ground: number;
  groundInsulated: number;
  /** A window in an outside wall. */
  window: boolean;
  /** Other rooms through the walls: how much passes, and which way. */
  links: { to: number; amount: number; dir: 'side' | 'below' | 'above' }[];
}

const shapes = new WeakMap<Sim, { version: number; insulation: number; rooms: Map<number, RoomShape> }>();

/** The most wall cells looked through for what's on the other side. */
const THICKEST = 4;

/** Every indoor room's shape (outdoor rooms are the weather). */
export function roomShapes(sim: Sim): Map<number, RoomShape> {
  const st = sim.state;
  const ins = Object.keys(st.insulated).length;
  const cached = shapes.get(sim);
  if (cached && cached.version === sim.version && cached.insulation === ins) return cached.rooms;
  const lay = sim.layout;
  const rooms = new Map<number, RoomShape>();
  for (const r of lay.rooms) {
    if (r.outdoor) continue;
    rooms.set(r.id, {
      room: r.id,
      key: key(...lay.xs(r.cells[0])),
      flat: r.flat,
      area: Math.max(1, r.nodes.length),
      outside: 0,
      insulated: 0,
      roof: 0,
      roofInsulated: 0,
      ground: 0,
      groundInsulated: 0,
      window: false,
      links: [],
    });
  }
  const link = (from: RoomShape, to: number, amount: number, dir: 'side' | 'below' | 'above') => {
    const l = from.links.find((x) => x.to === to && x.dir === dir);
    if (l) l.amount += amount;
    else from.links.push({ to, amount, dir });
  };
  for (const shape of rooms.values()) {
    for (const n of lay.rooms[shape.room].cells) {
      const [x, s] = lay.xs(n);
      for (const [dx, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let t = 0;
        let leak = 1;
        let lagged = false;
        let window = false;
        let other: number | 'outside' | 'ground' | null = null;
        for (let i = 1; i <= THICKEST + 1; i++) {
          const nx = x + dx * i;
          const ns = s + ds * i;
          if (ns < 0) {
            other = 'ground';
            break;
          }
          if (nx < 0 || nx >= lay.w || ns >= lay.rows) {
            other = 'outside';
            break;
          }
          if (lay.air(nx, ns)) {
            const r = lay.roomOf[lay.node(nx, ns)];
            other = r === -1 || lay.rooms[r].outdoor ? 'outside' : r;
            break;
          }
          t++;
          const c = lay.cell(nx, ns);
          if (st.insulated[key(nx, ns)]) lagged = true;
          if (isDoor(c) || lay.doorTop(nx, ns)) leak = Math.max(leak, HEAT.door);
          else if (c === 'window') window = true;
        }
        if (other === null || other === shape.room || (t === 0 && other !== 'ground')) continue;
        const thick = Math.max(1, t);
        const weight = (ds === 0 ? 1 / 3 : 1) / thick;
        if (other === 'outside' || other === 'ground') {
          shape.outside += weight;
          if (lagged) shape.insulated += weight;
          if (window && other === 'outside') shape.window = true;
          if (ds === 1) {
            shape.roof += weight;
            if (lagged) shape.roofInsulated += weight;
          }
          if (other === 'ground') {
            shape.ground += weight;
            if (lagged) shape.groundInsulated += weight;
          }
        } else {
          link(shape, other, (weight * leak * (lagged ? HEAT.insulated : 1)) / thick, ds === 0 ? 'side' : ds === 1 ? 'above' : 'below');
        }
      }
    }
  }
  shapes.set(sim, { version: sim.version, insulation: ins, rooms });
  return rooms;
}

// ------------------------------------------------------------------ keeping values against rooms

const anchors = new WeakMap<Sim, { version: number; keyOf: Map<number, string> }>();

/**
 * Before an hour's heat or damp: if the walls have moved since last time, carry each kept
 * value over to the new rooms (a new room starts from the average of the old rooms it took
 * cells from) and drop the rooms that have gone. Only the hourly passes call this.
 */
export function syncRooms(sim: Sim): void {
  const st = sim.state;
  st.roomTemps ??= {};
  st.damp ??= {};
  const lay = sim.layout;
  const was = anchors.get(sim);
  if (was?.version === sim.version) return;
  const keyOf = new Map<number, string>();
  const keys = new Set<string>();
  for (const shape of roomShapes(sim).values()) {
    keys.add(shape.key);
    for (const n of lay.rooms[shape.room].cells) keyOf.set(n, shape.key);
  }
  if (was) {
    for (const rec of [st.roomTemps, st.damp]) {
      const old = { ...rec };
      for (const shape of roomShapes(sim).values()) {
        if (rec[shape.key] !== undefined && was.keyOf.get(lay.rooms[shape.room].cells[0]) === shape.key) continue;
        const from = lay.rooms[shape.room].cells.map((n) => old[was.keyOf.get(n) ?? '']).filter((v): v is number => v !== undefined);
        if (from.length > 0) rec[shape.key] = from.reduce((a, b) => a + b, 0) / from.length;
        else delete rec[shape.key];
      }
      for (const k of Object.keys(rec)) if (!keys.has(k)) delete rec[k];
    }
  }
  anchors.set(sim, { version: sim.version, keyOf });
}

// ------------------------------------------------------------------ heat

/** The room's temperature (a room never worked out yet is as warm as its flat). */
export function roomTemp(sim: Sim, room: number): number {
  const shape = roomShapes(sim).get(room);
  if (!shape) return outdoorTemp(sim);
  return sim.state.roomTemps?.[shape.key] ?? (shape.flat ? sim.state.temps[shape.flat] : undefined) ?? WARMTH.start;
}

/** The rooms that make a flat's warmth: its bedrooms and living rooms, or all of them if it has neither. */
export function livingRooms(sim: Sim, flatId: string): number[] {
  const kind = flatKind(sim, flatId);
  const living = kind.rooms.filter((r) => r.uses.includes('sleep') || r.uses.includes('sit')).map((r) => r.room);
  if (living.length > 0) return living;
  const flat = sim.layout.flat(flatId);
  const rooms = flat?.rooms ?? [];
  const stood = rooms.filter((r) => sim.layout.rooms[r].nodes.length > 0);
  return stood.length > 0 ? stood : rooms;
}

function average(rooms: number[], temp: (room: number) => number): number | undefined {
  if (rooms.length === 0) return undefined;
  return rooms.reduce((n, r) => n + temp(r), 0) / rooms.length;
}

/** Radiators on each room's walls. */
function radiatorsByRoom(sim: Sim, lay: Layout): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of sim.state.furniture) {
    if (f.def !== 'radiator') continue;
    const r = lay.roomOf[lay.node(f.x, f.s)];
    if (r !== -1) out.set(r, (out.get(r) ?? 0) + 1);
  }
  return out;
}

/** What one room would settle at on its own, and how fast it gets there. */
function ownHeat(sim: Sim, shape: RoomShape, outside: number, rads: number, people: number): { target: number; rate: number } {
  const W = WARMTH;
  const H = HEAT;
  const ins = shape.outside ? shape.insulated / shape.outside : 0;
  const exposure = shape.outside / Math.max(1, shape.area * 2);
  const heat = (rads * sim.state.boiler * H.perRadiator) / Math.max(1, shape.area / H.radiatorTiles) + W.base + people * W.perPerson;
  const target = outside + heat * (1 + ins);
  const rate = (W.rate * Math.min(W.mostExposure, exposure + W.exposureBase) * (1 - W.insulationKeeps * ins)) / (1 + shape.area / W.sizeTiles);
  return { target, rate: Math.min(1, rate) };
}

/** How much of each neighbour's difference a room takes in an hour. */
function pull(shape: RoomShape, l: RoomShape['links'][number]): number {
  const k = l.dir === 'side' ? HEAT.side : l.dir === 'below' ? HEAT.fromBelow : HEAT.fromAbove;
  return (k * l.amount) / shape.area;
}

/**
 * One hour of heat in a set of rooms: each drifts towards what its own walls and radiators
 * allow, then takes in some of the difference from the rooms through its walls. Pure: hands
 * back the new temperatures.
 */
function step(sim: Sim, temps: Map<number, number>, outside: number, rads: Map<number, number>, people: Map<number, number>): Map<number, number> {
  const shapes = roomShapes(sim);
  const next = new Map<number, number>();
  for (const [id, shape] of shapes) {
    const now = temps.get(id)!;
    const own = ownHeat(sim, shape, outside, rads.get(id) ?? 0, people.get(id) ?? 0);
    let t = now + (own.target - now) * own.rate;
    const pulls = shape.links.map((l) => ({ l, k: pull(shape, l) }));
    const total = pulls.reduce((n, p) => n + p.k, 0);
    const scale = total > HEAT.most ? HEAT.most / total : 1;
    for (const { l, k } of pulls) t += ((temps.get(l.to) ?? now) - now) * k * scale;
    next.set(id, t);
  }
  return next;
}

/** Every game hour: each room's temperature moves on, and each flat's warmth follows its rooms. */
export function heatHour(sim: Sim): void {
  syncRooms(sim);
  const st = sim.state;
  const lay = sim.layout;
  const temps = st.roomTemps!;
  const shapes = roomShapes(sim);
  // A card can set a flat's temperature (a broken boiler, a heater lent): the rooms follow it.
  for (const f of lay.flats) {
    const set = st.temps[f.id];
    const now = average(livingRooms(sim, f.id), (r) => roomTemp(sim, r));
    if (set === undefined || now === undefined || Math.abs(set - now) < 0.01) continue;
    for (const r of f.rooms) {
      const shape = shapes.get(r);
      if (shape) temps[shape.key] = roomTemp(sim, r) + (set - now);
    }
  }
  const before = new Map<number, number>();
  for (const id of shapes.keys()) before.set(id, roomTemp(sim, id));
  const people = new Map<number, number>();
  for (const p of st.pawns) {
    if (!p.life || p.life.away) continue;
    const x = Math.round(p.x);
    const s = Math.round(p.s);
    if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) continue;
    const r = lay.roomOf[lay.node(x, s)];
    if (r !== -1) people.set(r, (people.get(r) ?? 0) + 1);
  }
  const after = step(sim, before, outdoorTemp(sim), radiatorsByRoom(sim, lay), people);
  for (const [id, t] of after) temps[shapes.get(id)!.key] = t;
  for (const f of lay.flats) {
    const t = average(livingRooms(sim, f.id), (r) => roomTemp(sim, r));
    if (t !== undefined) st.temps[f.id] = t;
  }
}

/**
 * What each room would settle at with the boiler as it is, a cold day outside and nobody in:
 * for the building preview, which compares two versions of the building. Pure.
 */
export function settledTemps(sim: Sim, outside = HEAT.previewOutside): Map<number, number> {
  const lay = sim.layout;
  const rads = radiatorsByRoom(sim, lay);
  let temps = new Map<number, number>();
  for (const id of roomShapes(sim).keys()) temps.set(id, outside + WARMTH.base);
  for (let i = 0; i < HEAT.previewHours; i++) temps = step(sim, temps, outside, rads, new Map());
  return temps;
}

// ------------------------------------------------------------------ why

/** The two or three things behind a room's warmth, in plain words ("Cold roof", "Radiator"). */
export function warmthReasons(sim: Sim, room: number): string[] {
  const shape = roomShapes(sim).get(room);
  if (!shape) return [];
  const out: string[] = [];
  const rads = radiatorsByRoom(sim, sim.layout).get(room) ?? 0;
  out.push(rads === 0 ? 'No radiator' : rads === 1 ? 'Radiator' : `${rads} radiators`);
  if (shape.roof > 0) out.push(shape.roofInsulated >= shape.roof / 2 ? 'Insulated roof' : 'Cold roof');
  const walls = shape.outside - shape.roof - shape.ground;
  if (walls > 0.5) out.push(shape.insulated - shape.roofInsulated - shape.groundInsulated >= walls / 2 ? 'Insulated outside wall' : 'Outside wall');
  const t = roomTemp(sim, room);
  const below = shape.links.filter((l) => l.dir === 'below').map((l) => roomTemp(sim, l.to));
  if (below.some((b) => b > t + 1)) out.push('Warm from below');
  if (shape.ground > 0 && out.length < 3) out.push('Cold from the ground');
  return out.slice(0, 3);
}
