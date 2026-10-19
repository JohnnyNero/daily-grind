// The cinema. A screen is a room marked as a Screen zone with a cinema screen in it; the rows of
// seats in that room are its audience. Each screen runs films back to back on a timetable,
// with a gap between for the audience to leave and the staff to clear up. People arrive in
// a swell before each start (most of them in the last quarter of an hour), buy a ticket and
// maybe snacks, wait in the lobby until the doors open, watch, and all leave together.

import { demandFactor } from './business';
import { objectDef, rotationOf } from './defs';
import { random } from './rng';
import { zoneOf } from './service';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type FilmTicket, type ObjectInst, type Pawn } from './state';

export interface CinemaDef {
  /** The menu item that is a ticket. */
  ticket: string;
  films: readonly { title: string; minutes: number; draw: number }[];
  /** Minutes between one film ending and the next starting on the same screen. */
  turnaround: number;
  /** Minute of the day the first film starts on Screen 1; later screens start a little after. */
  firstShow: number;
  stagger: number;
  /** Doors open this long before the start (once the last audience is out). */
  doorsOpen: number;
  /** Share of the ticket price the film's distributor takes. */
  hireShare: number;
}

export interface Screen {
  /** Stable while the room doesn't change: the lowest tile index in it. */
  key: number;
  name: string;
  seats: ObjectInst[];
  capacity: number;
  /** The cinema screen object, for drawing what's on. */
  screen: ObjectInst;
}

export interface Showing {
  screen: number;
  screenName: string;
  title: string;
  /** Minutes of the day. */
  start: number;
  end: number;
  capacity: number;
}

/** People start turning up this many minutes before a film, and the latest ones a few minutes after. */
const ARRIVE_FROM = 50;
const ARRIVE_UNTIL = -6;
/** Busiest this many minutes before the start. */
const PEAK = 10;
/** Still not through the door this long after the start: they give up on it. */
export const MISSED_AFTER = 10;

function density(minutesToStart: number): number {
  const m = minutesToStart;
  if (m > ARRIVE_FROM || m < ARRIVE_UNTIL) return 0;
  return m >= PEAK ? (ARRIVE_FROM - m) / (ARRIVE_FROM - PEAK) : (m - ARRIVE_UNTIL) / (PEAK - ARRIVE_UNTIL);
}
const DENSITY_TOTAL = (() => {
  let n = 0;
  for (let m = ARRIVE_UNTIL; m <= ARRIVE_FROM; m++) n += density(m);
  return n;
})();

// ------------------------------------------------------------------ screens

const screenCache = new WeakMap<Sim, { version: number; screens: Screen[] }>();

/** Every working screen: a connected Screen zone that has a cinema screen in it. */
export function screens(sim: Sim): Screen[] {
  const cached = screenCache.get(sim);
  if (cached && cached.version === sim.world.version) return cached.screens;
  const s = sim.state;
  const region = new Int32Array(s.w * s.h).fill(-1);
  // A screen room is connected Screen zone (walls built over it don't count).
  const inScreen = (i: number) => !s.tiles[i].wall && zoneOf(sim, i % s.w, Math.floor(i / s.w)) === 'screen';
  const found: { key: number; tiles: Set<number> }[] = [];
  for (let i = 0; i < s.tiles.length; i++) {
    if (region[i] !== -1 || !inScreen(i)) continue;
    const tiles = new Set<number>([i]);
    region[i] = found.length;
    const stack = [i];
    while (stack.length > 0) {
      const j = stack.pop()!;
      const x = j % s.w;
      const y = Math.floor(j / s.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!sim.world.inBounds(nx, ny)) continue;
        const k = ny * s.w + nx;
        if (region[k] !== -1 || !inScreen(k)) continue;
        region[k] = found.length;
        tiles.add(k);
        stack.push(k);
      }
    }
    found.push({ key: i, tiles });
  }
  const inRoom = (o: ObjectInst, n: number) => sim.world.tilesOf(o).some(([x, y]) => region[y * s.w + x] === n);
  const out: Screen[] = [];
  found.forEach((room, n) => {
    const screen = s.objects.find((o) => o.def === 'screen' && inRoom(o, n));
    if (!screen) return;
    const seats = s.objects.filter((o) => o.def === 'cinemaSeats' && inRoom(o, n));
    out.push({ key: room.key, name: '', seats, capacity: seats.reduce((c, o) => c + objectDef(o.def).spots.length, 0), screen });
  });
  out.sort((a, b) => a.key - b.key).forEach((sc, i) => { sc.name = `Screen ${i + 1}`; });
  screenCache.set(sim, { version: sim.world.version, screens: out });
  return out;
}

export function seatTotal(sim: Sim): number {
  return screens(sim).reduce((n, sc) => n + sc.capacity, 0);
}

// ------------------------------------------------------------------ the timetable

function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Today's films, every screen, in start order. Worked out from the day, so nothing to save. */
const showingCache = new WeakMap<Sim, { day: number; version: number; list: Showing[] }>();

export function showingsToday(sim: Sim): Showing[] {
  const c = sim.venue.cinema;
  if (!c) return [];
  const hit = showingCache.get(sim);
  if (hit && hit.day === sim.day && hit.version === sim.world.version) return hit.list;
  const close = sim.venue.hours.close;
  const out: Showing[] = [];
  screens(sim).forEach((sc, k) => {
    let start = c.firstShow + k * c.stagger;
    for (let n = 0; n < 12; n++) {
      const film = c.films[Math.floor(hash(sim.day, k, n) * c.films.length)];
      const end = start + film.minutes;
      if (end > close - 5) break;
      out.push({ screen: sc.key, screenName: sc.name, title: film.title, start, end, capacity: sc.capacity });
      start = end + c.turnaround;
    }
  });
  out.sort((a, b) => a.start - b.start);
  showingCache.set(sim, { day: sim.day, version: sim.world.version, list: out });
  return out;
}

function dayStart(sim: Sim): number {
  return Math.floor(sim.state.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
}

export function ticketFor(sim: Sim, sh: Showing): FilmTicket {
  const base = dayStart(sim);
  return { screen: sh.screen, title: sh.title, start: base + sh.start * TICKS_PER_MINUTE, end: base + sh.end * TICKS_PER_MINUTE };
}

/** Everyone on site holding a ticket for this showing. */
export function booked(sim: Sim, t: FilmTicket): number {
  return sim.state.pawns.filter((p) => p.visit?.film && p.visit.film.screen === t.screen && p.visit.film.start === t.start).length;
}

/** The doors open once the last audience has had time to get out, and not too early. */
export function doorsOpen(sim: Sim, t: FilmTicket): boolean {
  const c = sim.venue.cinema;
  if (!c) return true;
  const now = sim.state.tick;
  if (now < t.start - c.doorsOpen * TICKS_PER_MINUTE) return false;
  const before = showingsToday(sim).filter((sh) => sh.screen === t.screen && ticketFor(sim, sh).end <= t.start);
  const last = before[before.length - 1];
  return !last || now >= ticketFor(sim, last).end + 2 * TICKS_PER_MINUTE;
}

/** A free seat in this film's screen, nearest the door end first. Dirty rows still get sat in. */
export function findScreenSeat(sim: Sim, p: Pawn, t: FilmTicket): { key: string; objectId: number; x: number; y: number; dirty: boolean } | null {
  const sc = screens(sim).find((x) => x.key === t.screen);
  if (!sc) return null;
  const s = sim.state;
  let best: { key: string; objectId: number; x: number; y: number; dirty: boolean } | null = null;
  let bestD = Infinity;
  for (const o of sc.seats) {
    sim.world.spots(o).forEach(([x, y], i) => {
      const key = `obj:${o.id}:${i}`;
      if (s.reservations[key] !== undefined) return;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { key, objectId: o.id, x, y, dirty: (s.dirty[o.id] ?? 0) > 0 };
      }
    });
  }
  return best;
}

/** What's on each screen now, for drawing titles on the screens. */
export function nowShowing(sim: Sim): { screen: Screen; title: string; rot: number }[] {
  const m = sim.minuteOfDay;
  const list = showingsToday(sim);
  return screens(sim).flatMap((sc) => {
    const on = list.find((sh) => sh.screen === sc.key && sh.start <= m && m < sh.end);
    return on ? [{ screen: sc, title: on.title, rot: rotationOf(sc.screen) }] : [];
  });
}

// ------------------------------------------------------------------ arrivals

/** How full a film gets: fame and reputation bring people, and some films draw better. */
export function expectedAudience(sim: Sim, sh: Showing): number {
  const c = sim.venue.cinema!;
  const draw = c.films.find((f) => f.title === sh.title)?.draw ?? 1;
  const fill = Math.max(0.1, Math.min(1, (0.15 + 0.5 * demandFactor(sim)) * draw));
  return sh.capacity * fill;
}

/**
 * Once a minute: film-goers for every showing coming up, in a swell before the start.
 * `arrive` lets one in (it says no if the queue is out the door).
 */
export function filmArrivals(sim: Sim, arrive: (t: FilmTicket) => void): void {
  const c = sim.venue.cinema;
  if (!c || !sim.state.menu.some((m) => m.name === c.ticket && m.enabled)) return;
  const s = sim.state;
  const now = sim.minuteOfDay;
  for (const sh of showingsToday(sim)) {
    const d = density(sh.start - now);
    if (d <= 0 || sh.capacity === 0) continue;
    const lambda = (expectedAudience(sim, sh) * d) / DENSITY_TOTAL;
    let n = Math.floor(lambda) + (random(s) < lambda % 1 ? 1 : 0);
    const t = ticketFor(sim, sh);
    while (n-- > 0 && booked(sim, t) < sh.capacity) arrive(t);
  }
}
