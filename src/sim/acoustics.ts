// Noise by room (docs/specs/layout.md, 2.1). Every room is somewhere noise is made and
// somewhere it's heard. What people are doing makes it (the telly, practising, a row), and
// so does the building: feet on the stairs, the street door, a flat's front door, the street
// past the ground floor, a washing machine going. It passes from a room to the rooms next to
// it, above and below, through each wall and floor tile they share (insulated, about a
// sixth; thicker walls less; doors and windows more). It goes one room and no further, so a
// bathroom or an empty room between two flats takes it.
//
// How much it matters depends on the room it's heard in: a bedroom at night most, a
// bathroom hardly at all. Within a flat it passes at half, and not at all between a couple.
// Everyone shrugs off a little whatever their nature, and noise from a neighbour you like
// bothers you half as much. A flat's Quiet is its bedrooms', at night.

import { happeningNoise } from './events';
import { flatKind, type RoomUse } from './rooms';
import type { Sim } from './sim';
import { opinion } from './social';
import { isDoor, key, type Pawn } from './state';
import { has } from './traits';
import { BUILDER_NOISE, currentPiece } from './works';
import { ACOUSTICS, ITEMS, NEEDS, NOISE } from './tuning';

/** Who a piece of noise belongs to: a flat's id, the shared parts (environment's SHARED), or the street. */
const SHARED_PARTS = 'shared';
export const STREET = 'street';

/** One thing making noise this minute, in one room (or the street, room -1). */
export interface Source {
  room: number;
  amount: number;
  /** The flat whose room it's in, the shared parts or the street. */
  owner: string;
  /** Who's making it, if anyone: nobody hears their own feet. */
  pawn?: number;
  /** What it is, for saying why a room's loud: "Telly", "Stairs". */
  what: string;
}

// ------------------------------------------------------------------ how rooms carry it

interface Carry {
  key: string;
  /** How much of a room's noise reaches each other room, 0 to `mostThrough`. */
  through: Map<number, Map<number, number>>;
  /** Ground-floor rooms, which hear the street. */
  street: Set<number>;
  /** Each room's middle row, for saying "upstairs". */
  row: Map<number, number>;
  /** The room people live in most in each flat, where a party's music is; the biggest shared room. */
  main: Map<string, number>;
}

const carries = new WeakMap<Sim, Carry>();

/** The most wall cells we look through for what's on the other side. */
const THICKEST = 4;
/** Rows of the ground floor (the plinth is row 0, each storey 4 rows). */
const GROUND_TOP = 3;

function carryOf(sim: Sim): Carry {
  const st = sim.state;
  const k = `${sim.version}|${Object.keys(st.insulated).length}`;
  const cached = carries.get(sim);
  if (cached && cached.key === k) return cached;
  const lay = sim.layout;
  // What would get through bare, and what does: the most that gets through caps the first,
  // and insulation takes its share off what's left, so lagging a wall always tells.
  const through = new Map<number, Map<number, number>>();
  const bare = new Map<number, Map<number, number>>();
  const add = (into: Map<number, Map<number, number>>, a: number, b: number, amount: number) => {
    const m = into.get(a) ?? new Map<number, number>();
    m.set(b, (m.get(b) ?? 0) + amount);
    into.set(a, m);
  };
  // From every cell of every indoor room, look through the walls each way to the room on the
  // other side. What passes from it to us passes from us to it, so each look adds one way.
  for (const room of lay.rooms) {
    if (room.outdoor) continue;
    for (const n of room.cells) {
      const [x, s] = lay.xs(n);
      for (const [dx, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let t = 0;
        let leak = 1;
        let lagged = false;
        let other = -1;
        for (let i = 1; i <= THICKEST + 1; i++) {
          const nx = x + dx * i;
          const ns = s + ds * i;
          if (ns < 0 || nx < 0 || nx >= lay.w || ns >= lay.rows) break;
          if (lay.air(nx, ns)) {
            other = lay.roomOf[lay.node(nx, ns)];
            break;
          }
          t++;
          const c = lay.cell(nx, ns);
          if (st.insulated[key(nx, ns)]) lagged = true;
          if (isDoor(c) || lay.doorTop(nx, ns)) leak = Math.max(leak, NOISE.door);
          else if (c === 'window') leak = Math.max(leak, NOISE.window);
        }
        if (other === -1 || other === room.id || t === 0 || lay.rooms[other].outdoor) continue;
        const per = ((ds === 0 ? NOISE.wall : NOISE.floor) * leak * ACOUSTICS.roomScale) / (t * t);
        add(bare, other, room.id, per);
        add(through, other, room.id, per * (lagged ? NOISE.insulated : 1));
      }
    }
  }
  for (const [a, m] of through) for (const [b, v] of m) {
    const raw = bare.get(a)!.get(b)!;
    m.set(b, (Math.min(ACOUSTICS.mostThrough, raw) * v) / raw);
  }
  const street = new Set<number>();
  const row = new Map<number, number>();
  for (const room of lay.rooms) {
    if (room.outdoor || room.cells.length === 0) continue;
    const rows = room.cells.map((n) => lay.xs(n)[1]);
    row.set(room.id, rows.reduce((a, b) => a + b, 0) / rows.length);
    if (Math.min(...rows) <= GROUND_TOP) street.add(room.id);
  }
  const main = new Map<string, number>();
  for (const f of lay.flats) {
    const rooms = flatKind(sim, f.id).rooms;
    const sit = rooms.find((r) => r.uses.includes('sit'));
    const biggest = [...rooms].sort((a, b) => b.area - a.area)[0];
    const r = sit ?? biggest;
    if (r) main.set(f.id, r.room);
  }
  const shared = lay.rooms.filter((r) => r.shared).sort((a, b) => b.cells.length - a.cells.length)[0];
  if (shared) main.set(SHARED_PARTS, shared.id);
  const out = { key: k, through, street, row, main };
  carries.set(sim, out);
  return out;
}

/** How much of the noise in one room reaches another next to it (1 within a room; rugs soak up what goes down). */
export function roomThrough(sim: Sim, from: number, to: number): number {
  if (from === to) return 1;
  const c = carryOf(sim);
  if (from === -1) return c.street.has(to) ? 1 : 0;
  const base = c.through.get(from)?.get(to) ?? 0;
  if (base === 0) return 0;
  const below = (c.row.get(to) ?? 0) < (c.row.get(from) ?? 0) - 1;
  const rugs = below ? Math.min(ITEMS.mostRugs, rugsIn(sim, from)) : 0;
  return base * ITEMS.rugBelow ** rugs;
}

/** The rooms next to this one that noise passes to or from. */
export function roomsNextTo(sim: Sim, room: number): number[] {
  return [...(carryOf(sim).through.get(room)?.keys() ?? [])];
}

function rugsIn(sim: Sim, room: number): number {
  const lay = sim.layout;
  return sim.state.furniture.filter((f) => f.def === 'rug' && f.broken === undefined && lay.roomOf[lay.node(f.x, f.s)] === room).length;
}

// ------------------------------------------------------------------ what's making it

/** How much noise someone's making right now, by what they're doing. */
export function noiseOf(p: Pawn): number {
  const d = p.doing;
  if (d === 'Watching telly') return NOISE.telly;
  if (d === 'Playing on the console') return ITEMS.consoleNoise;
  if (d === 'Practising') return NOISE.practising;
  if (d.startsWith('Having a row')) return NOISE.row;
  if (d.startsWith('Fighting')) return NOISE.fighting;
  if (d === 'At the party') return NOISE.party;
  if (d === 'Dancing at the party') return NOISE.dancing;
  if (d === 'Mingling at the party' || d === 'Hosting the party' || d === 'Out on the landing') return NOISE.mingling;
  if (d === 'Winding down at the party') return NOISE.windingDown;
  if (d.startsWith('Chatting') || d.startsWith('Gossiping') || d.startsWith('Flirting')) return NOISE.chatting;
  if (d === 'Cooking') return NOISE.cooking;
  if (d === 'Slamming doors') return NOISE.slammingDoors;
  if (d === 'Having a tantrum') return NOISE.tantrum;
  if (d === 'Blasting music out of spite') return NOISE.spite;
  if (d === 'Kicking the bins') return NOISE.kickingBins;
  if (d === 'Carrying boxes out') return NOISE.carryingBoxes;
  if (d === 'At the barbecue') return NOISE.barbecue;
  return 0;
}

export function nightNow(sim: Sim): boolean {
  const m = sim.minuteOfDay;
  return m >= NOISE.nightFrom * 60 || m < NOISE.nightTo * 60;
}

/** What someone's noise is, in a word or two. */
function whatOf(doing: string): string {
  if (doing === 'Watching telly') return 'Telly';
  if (doing === 'Playing on the console') return 'The console';
  if (doing === 'Practising') return 'Practising';
  if (doing.startsWith('Having a row')) return 'A row';
  if (doing.startsWith('Fighting')) return 'A fight';
  if (doing.includes('party') || doing === 'Out on the landing') return 'A party';
  if (doing.startsWith('Chatting') || doing.startsWith('Gossiping') || doing.startsWith('Flirting')) return 'Talking';
  if (doing === 'Cooking') return 'Cooking';
  if (doing === 'Slamming doors') return 'Doors slamming';
  if (doing === 'Having a tantrum') return 'A tantrum';
  if (doing === 'Blasting music out of spite') return 'Music';
  if (doing === 'Kicking the bins') return 'The bins';
  if (doing === 'Carrying boxes out') return 'Boxes';
  if (doing === 'At the barbecue') return 'A barbecue';
  return 'Noise';
}

/** Everything making noise this minute, room by room. */
export function sources(sim: Sim): Source[] {
  const lay = sim.layout;
  const st = sim.state;
  const A = ACOUSTICS;
  const out: Source[] = [];
  const ownerOfRoom = (r: number) => lay.rooms[r].flat ?? SHARED_PARTS;
  const night = nightNow(sim);
  const bigTv = new Set<number>();
  for (const f of st.furniture) if (f.def === 'bigTv' && f.broken === undefined) bigTv.add(lay.roomOf[lay.node(f.x, f.s)]);
  for (const p of st.pawns) {
    if (p.life?.away) continue;
    const x = Math.round(p.x);
    const s = Math.round(p.s);
    if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) continue;
    const n = lay.node(x, s);
    const room = lay.roomOf[n];
    const indoor = room !== -1 && !lay.rooms[room].outdoor;
    // What they're doing.
    let amount = noiseOf(p);
    if (indoor && amount > 0 && (p.doing === 'Watching telly' || p.doing === 'Playing on the console') && bigTv.has(room)) amount *= ITEMS.bigTellyNoise;
    if (indoor && p.doing === 'Doing the washing') {
      out.push({ room, amount: A.washer, owner: ownerOfRoom(room), pawn: p.id, what: 'The washing machine' });
    }
    if (indoor && amount > 0) out.push({ room, amount, owner: ownerOfRoom(room), pawn: p.id, what: whatOf(p.doing) });
    // Feet on the stairs.
    if (indoor && lay.stair(x, s)) out.push({ room, amount: A.stair * (night ? A.stairNight : 1), owner: SHARED_PARTS, pawn: p.id, what: 'Stairs' });
    // Going through the street door or a front door: keys, the latch, the bang.
    if (p.path.length > 0) {
      for (const dx of [0, -1, 1]) {
        if (x + dx < 0 || x + dx >= lay.w) continue;
        const d = lay.cell(x + dx, s);
        if (d !== 'entrance' && d !== 'flatDoor') continue;
        for (const side of lay.doorSides(lay.node(x + dx, s))) {
          if (lay.rooms[side].outdoor) continue;
          out.push({ room: side, amount: d === 'entrance' ? A.streetDoor : A.flatDoor, owner: ownerOfRoom(side), pawn: p.id, what: d === 'entrance' ? 'The street door' : 'A front door' });
        }
        break;
      }
    }
  }
  // Dishwashers run after tea, in flats with someone home.
  const m = sim.minuteOfDay;
  if (m >= ITEMS.dishwasherFrom && m < ITEMS.dishwasherTo) {
    for (const f of st.furniture) {
      if (f.def !== 'dishwasher' || f.broken !== undefined) continue;
      const room = lay.roomOf[lay.node(f.x, f.s)];
      if (room === -1) continue;
      const flat = lay.rooms[room].flat;
      if (flat && st.pawns.some((p) => p.life?.flat === flat && !p.life.away)) out.push({ room, amount: ITEMS.dishwasherNoise, owner: flat, what: 'The dishwasher' });
    }
  }
  // The builders.
  const work = currentPiece(sim);
  if (work) {
    for (const [x, s] of [[work.x, work.s], [work.x, work.s + 1], [work.x - 1, work.s], [work.x + 1, work.s], [work.x, work.s - 1]]) {
      if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) continue;
      const room = lay.roomOf[lay.node(x, s)];
      if (room === -1 || lay.rooms[room].outdoor) continue;
      out.push({ room, amount: BUILDER_NOISE, owner: ownerOfRoom(room), what: 'Builders' });
      break;
    }
  }
  // Parties' music and the burglar alarm, in the room people live in.
  const happening = new Map<string, number>();
  happeningNoise(sim, happening);
  const c = carryOf(sim);
  for (const [owner, amount] of happening) {
    const room = c.main.get(owner);
    if (room !== undefined && amount > 0) out.push({ room, amount, owner, what: owner === SHARED_PARTS ? 'An alarm' : 'A party' });
  }
  // The street, past the ground floor.
  out.push({ room: -1, amount: night ? A.streetNight : A.street, owner: STREET, what: 'The street' });
  return out;
}

// ------------------------------------------------------------------ hearing it

/** How much noise in a room matters, by what the room's for. */
export function listening(uses: readonly RoomUse[], night: boolean, nightWorker = false): number {
  const L = ACOUSTICS.listen;
  let w = 0;
  if (uses.includes('sleep')) w = Math.max(w, night || nightWorker ? L.bedroomNight : L.bedroomDay);
  if (uses.includes('sit')) w = Math.max(w, L.sit);
  if (uses.includes('cook')) w = Math.max(w, L.cook);
  if (uses.includes('wash')) w = Math.max(w, L.wash);
  return w;
}

/** What a room in a flat is for (none for the shared parts). */
function usesOf(sim: Sim, room: number): RoomUse[] {
  const flat = sim.layout.rooms[room]?.flat;
  if (!flat) return [];
  return flatKind(sim, flat).rooms.find((r) => r.room === room)?.uses ?? [];
}

export interface Heard {
  /** Noise reaching the room. */
  amount: number;
  /** Whose noise it mostly is: a flat's id, SHARED_PARTS or STREET. */
  loudest: string | null;
  /** What's behind it, loudest first. */
  parts: { source: Source; amount: number }[];
}

/**
 * Noise reaching a room this minute from everywhere else. A listener (a tenant) doesn't hear
 * themselves or their partner, and hears a neighbour they like at half. Noise from inside
 * the room's own flat passes at half; `outsideOnly` leaves it out altogether.
 */
export function heardIn(sim: Sim, room: number, listener?: Pawn, outsideOnly = false): Heard {
  const lay = sim.layout;
  const home = lay.rooms[room]?.flat ?? null;
  const life = listener?.life;
  const couple = life?.household === 'couple';
  const parts: { source: Source; amount: number }[] = [];
  const byOwner = new Map<string, number>();
  let amount = 0;
  for (const src of sources(sim)) {
    if (listener && src.pawn === listener.id) continue;
    if (life && src.pawn !== undefined && src.pawn === life.partner) continue;
    let got = src.amount * roomThrough(sim, src.room, room);
    if (got <= 0) continue;
    const inside = src.room !== -1 && home !== null && lay.rooms[src.room].flat === home;
    if (inside) {
      if (outsideOnly) continue;
      // A couple don't mind each other; anyone else in the flat, at half.
      const housemate = src.pawn !== undefined ? sim.state.pawns.find((o) => o.id === src.pawn) : undefined;
      if (couple && housemate?.life?.flat === life!.flat) continue;
      got *= ACOUSTICS.withinFlat;
    } else if (listener && src.pawn !== undefined && src.owner !== STREET) {
      const other = sim.state.pawns.find((o) => o.id === src.pawn);
      if (other?.life && other.life.flat !== life?.flat && opinion(sim, listener, other) >= ACOUSTICS.liked) got *= ACOUSTICS.likedHalves;
    }
    amount += got;
    parts.push({ source: src, amount: got });
    byOwner.set(src.owner, (byOwner.get(src.owner) ?? 0) + got);
  }
  parts.sort((a, b) => b.amount - a.amount);
  let loudest: string | null = null;
  let most = 0;
  for (const [o, n] of byOwner) {
    if (n > most) {
      most = n;
      loudest = o;
    }
  }
  return { amount, loudest, parts };
}

/**
 * The noise a tenant feels where they are, this minute: what reaches the room they're in,
 * by what the room's for, more for a light sleeper, less the first bit everyone shrugs off.
 * Out of their own flat, nothing.
 */
export function noiseFelt(sim: Sim, p: Pawn): { felt: number; loudest: string | null } {
  const life = p.life!;
  const lay = sim.layout;
  const x = Math.round(p.x);
  const s = Math.round(p.s);
  if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) return { felt: 0, loudest: null };
  const room = lay.roomOf[lay.node(x, s)];
  if (room === -1 || lay.rooms[room].flat !== life.flat) return { felt: 0, loudest: null };
  const weight = listening(usesOf(sim, room), nightNow(sim), life.schedule === 'nights');
  if (weight === 0) return { felt: 0, loudest: null };
  const heard = heardIn(sim, room, p);
  const felt = Math.max(0, heard.amount * weight * ACOUSTICS.loudness * (has(life, 'lightSleeper') ? NEEDS.lightSleeper : 1) - ACOUSTICS.tolerance);
  return { felt, loudest: heard.loudest };
}

// ------------------------------------------------------------------ a flat's quiet

/** The rooms a flat sleeps in (every room, if it has no bed). */
export function sleepingRooms(sim: Sim, flatId: string): number[] {
  const rooms = flatKind(sim, flatId).rooms;
  const sleep = rooms.filter((r) => r.uses.includes('sleep'));
  return (sleep.length > 0 ? sleep : rooms).map((r) => r.room);
}

/** Noise from outside the flat reaching its bedrooms now, on average. */
export function bedroomNoise(sim: Sim, flatId: string): number {
  const rooms = sleepingRooms(sim, flatId);
  if (rooms.length === 0) return 0;
  return rooms.reduce((n, r) => n + heardIn(sim, r, undefined, true).amount, 0) / rooms.length;
}

/** Every hour at night: each flat's rolling average of its bedrooms' noise, for its Quiet. */
export function quietHour(sim: Sim): void {
  if (!nightNow(sim)) return;
  for (const f of sim.layout.flats) {
    const got = bedroomNoise(sim, f.id) * ACOUSTICS.listen.bedroomNight;
    const avg = sim.state.noiseAvg[f.id] ?? 0;
    sim.state.noiseAvg[f.id] = avg + (got - avg) * ACOUSTICS.averageRate;
  }
}

// ------------------------------------------------------------------ saying why

/** How noisy a room is now, 0 (silent) and up; for the Noise overlay. */
export function roomNoise(sim: Sim, room: number): number {
  return heardIn(sim, room).amount;
}

/** The two or three things behind a room's noise, loudest first: "Telly through the wall", "Stairs". */
export function noiseReasons(sim: Sim, room: number): string[] {
  const c = carryOf(sim);
  const here = c.row.get(room) ?? 0;
  const out: string[] = [];
  for (const { source } of heardIn(sim, room).parts) {
    let text = source.what;
    if (source.room !== room && source.room !== -1 && source.owner !== SHARED_PARTS) {
      const there = c.row.get(source.room) ?? here;
      const where = there > here + 1 ? 'upstairs' : there < here - 1 ? 'downstairs' : 'through the wall';
      text = `${source.what} ${where}`;
    }
    if (!out.includes(text)) out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * How exposed a room is to noise, as built, whoever's in: what the rooms next to it tend to
 * make (a living room a telly, the stairwell feet, a bathroom little), by how much gets
 * through. For the building preview, where nobody's doing anything yet.
 */
export function exposure(sim: Sim, room: number): number {
  const lay = sim.layout;
  const T = ACOUSTICS.typical;
  const home = lay.rooms[room]?.flat ?? null;
  let total = carryOf(sim).street.has(room) ? T.street : 0;
  for (const other of roomsNextTo(sim, room)) {
    const r = lay.rooms[other];
    let makes: number;
    if (r.flat === null) makes = r.cells.some((n) => lay.stair(...lay.xs(n))) ? T.stairs : T.shared;
    else {
      const uses = usesOf(sim, other);
      makes = Math.max(0, ...uses.map((u) => T[u]));
    }
    total += makes * roomThrough(sim, other, room) * (r.flat !== null && r.flat === home ? ACOUSTICS.withinFlat : 1);
  }
  // The front door, if it opens into this room.
  for (const d of lay.flat(home)?.doors ?? []) {
    const [x, s] = d.split(',').map(Number);
    if (lay.doorSides(lay.node(x, s)).includes(room)) total += T.frontDoor;
  }
  return total;
}

/** The loudest of a flat's bedrooms, as built. */
export function bedroomExposure(sim: Sim, flatId: string): number {
  const kind = flatKind(sim, flatId);
  const beds = kind.rooms.filter((r) => r.uses.includes('sleep'));
  return beds.length === 0 ? 0 : Math.max(...beds.map((r) => exposure(sim, r.room)));
}
