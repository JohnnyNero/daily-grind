// The building as a place to live: how warm each flat is, how much noise gets through
// from the neighbours, how dirty things get, and the bins.
//
// Warmth is one temperature per flat. It drifts towards the outside temperature through
// its outside walls, roof and floor, and the central boiler pushes it back up through the
// radiators. Insulating the outside walls and floors keeps the heat in.
//
// Noise is made by what people are doing (the telly, practising, a row) and passes to the
// flats next door, above and below, through each wall and floor tile they share. How much
// gets through each pair of flats is worked out once when the building changes. Insulated
// walls and floors let through about a sixth. Noise at night counts for more.

import type { Flat, Layout } from './layout';
import type { Sim } from './sim';
import { TICKS_PER_DAY, isDoor, key, type Pawn } from './state';
import { has } from './traits';
import { BUILDER_NOISE, currentPiece, whereIs } from './works';

/** Where heat and noise get through: a wall tile or a floor tile. */
export const wallKey = (x: number, s: number) => `w:${key(x, s)}`;
export const floorKey = (x: number, level: number) => `f:${key(x, level)}`;

export const SHARED = 'shared';

/** How much noise an insulated wall or floor lets through, against a bare one. */
const INSULATED = 0.15;

// ------------------------------------------------------------------ weather

/** Degrees outside. The seasons turn every 16 weeks; the game starts in autumn. */
export function outdoorTemp(sim: Sim): number {
  const day = sim.state.tick / TICKS_PER_DAY;
  const season = 9 + 7 * Math.cos((2 * Math.PI * (day + 20)) / 112);
  const hour = sim.minuteOfDay / 60;
  const daily = 2 * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  return season + daily;
}

export function seasonName(sim: Sim): string {
  const t = 9 + 7 * Math.cos((2 * Math.PI * (sim.day + 20)) / 112);
  const rising = Math.sin((2 * Math.PI * (sim.day + 20)) / 112) < 0;
  if (t < 5) return 'Winter';
  if (t > 13) return 'Summer';
  return rising ? 'Spring' : 'Autumn';
}

// ------------------------------------------------------------------ the shape of each flat

interface Shape {
  /** Floor tiles in the flat. */
  area: number;
  /** Outside wall, roof and ground tiles, and how many of them are insulated. */
  outside: number;
  insulated: number;
  /** How much noise passes from one flat (or the shared parts) to another, 0 to 1. */
  through: Map<string, Map<string, number>>;
}

const shapes = new WeakMap<Sim, { version: number; insulation: number; byFlat: Map<string, Shape>; through: Map<string, Map<string, number>> }>();

function ownerOf(lay: Layout, x: number, s: number): string | null {
  if (x < 0 || x >= lay.w || s < 0 || s >= lay.storeys) return null;
  const n = lay.node(x, s);
  const room = lay.roomOf[n];
  if (room !== -1) {
    const r = lay.rooms[room];
    return r.flat ?? (r.shared ? SHARED : null);
  }
  return lay.flatAt(x, s)?.id ?? null;
}

function shapesOf(sim: Sim) {
  const st = sim.state;
  const ins = Object.keys(st.insulated).length;
  const cached = shapes.get(sim);
  if (cached && cached.version === sim.version && cached.insulation === ins) return cached;
  const lay = sim.layout;
  const through = new Map<string, Map<string, number>>();
  const add = (a: string | null, b: string | null, amount: number) => {
    if (!a || !b || a === b) return;
    for (const [p, q] of [[a, b], [b, a]]) {
      const m = through.get(p) ?? new Map<string, number>();
      m.set(q, (m.get(q) ?? 0) + amount);
      through.set(p, m);
    }
  };
  const byFlat = new Map<string, Shape>();
  for (const f of lay.flats) byFlat.set(f.id, { area: f.area, outside: 0, insulated: 0, through });
  const ownOutside = (id: string | null, insulated: boolean) => {
    const s = id ? byFlat.get(id) : undefined;
    if (!s) return;
    s.outside++;
    if (insulated) s.insulated++;
  };
  for (let s = 0; s < lay.storeys; s++) {
    for (let x = 0; x < lay.w; x++) {
      // Walls (and doors and windows) between the tile to the left and the one to the right.
      const seg = lay.segment(x, s);
      if (seg) {
        const left = ownerOf(lay, x - 1, s);
        const right = ownerOf(lay, x + 1, s);
        const ins = !!st.insulated[wallKey(x, s)];
        const leak = (isDoor(seg) ? 1.5 : seg === 'window' ? 1.2 : 1) * (ins ? INSULATED : 1);
        if (left && right) add(left, right, leak * 0.1);
        else if (left && !right) ownOutside(left, ins);
        else if (right && !left) ownOutside(right, ins);
      }
      // Floors: between this storey and the one above.
      const here = ownerOf(lay, x, s);
      if (here && !lay.isDoorNode(lay.node(x, s))) {
        const above = s + 1 < lay.storeys && lay.slab(x, s + 1) ? ownerOf(lay, x, s + 1) : null;
        const ins = !!st.insulated[floorKey(x, s + 1)];
        if (above) add(here, above, (ins ? INSULATED : 1) * 0.08);
        if (!lay.slab(x, s + 1)) ownOutside(here, false);
        else if (!above) ownOutside(here, ins); // the roof
        if (s === 0) ownOutside(here, !!st.insulated[floorKey(x, 0)]);
      }
    }
  }
  const out = { version: sim.version, insulation: ins, byFlat, through };
  shapes.set(sim, out);
  return out;
}

/** How much noise from one flat (or SHARED) reaches another. */
export function noiseThrough(sim: Sim, from: string, to: string): number {
  return Math.min(1, shapesOf(sim).through.get(from)?.get(to) ?? 0);
}

/** The flats and shared parts next to this one, for noise. */
export function neighboursOf(sim: Sim, id: string): string[] {
  return [...(shapesOf(sim).through.get(id)?.keys() ?? [])];
}

// ------------------------------------------------------------------ warmth

export function radiators(sim: Sim, flat: Flat): number {
  const lay = sim.layout;
  const nodes = new Set(flat.rooms.flatMap((r) => lay.rooms[r].nodes));
  return sim.state.furniture.filter((f) => f.def === 'radiator' && nodes.has(lay.node(f.x, f.s))).length;
}

/** Weekly gas for the central boiler: per radiator, per setting. */
export const GAS_PER_RADIATOR = 300;

export function gasBill(sim: Sim): number {
  const all = sim.state.furniture.filter((f) => f.def === 'radiator').length;
  return all * sim.state.boiler * GAS_PER_RADIATOR;
}

/** Every game hour: each flat's temperature drifts towards what its walls and radiators allow. */
function warmthHour(sim: Sim): void {
  const st = sim.state;
  const outside = outdoorTemp(sim);
  const { byFlat } = shapesOf(sim);
  for (const f of sim.layout.flats) {
    const shape = byFlat.get(f.id)!;
    const ins = shape.outside ? shape.insulated / shape.outside : 0;
    const exposure = shape.outside / Math.max(1, shape.area * 2);
    const people = sim.state.pawns.filter((p) => p.life?.flat === f.id && !p.life.away).length;
    const heat = (radiators(sim, f) * st.boiler * 3.5) / Math.max(1, f.area / 8) + 4 + people * 0.8;
    const target = outside + heat * (1 + ins);
    const rate = (0.25 * Math.min(1.5, exposure + 0.3) * (1 - 0.6 * ins)) / (1 + f.area / 15);
    const now = st.temps[f.id] ?? target;
    st.temps[f.id] = now + (target - now) * Math.min(1, rate);
  }
}

export function tempOf(sim: Sim, flatId: string): number {
  return sim.state.temps[flatId] ?? 18;
}

/** Warmth as a need: 0 at 10° or below, full at 19° and up. */
export function warmthOf(temp: number): number {
  return Math.max(0, Math.min(1, (temp - 10) / 9));
}

// ------------------------------------------------------------------ noise

/** How much noise someone's making right now, by what they're doing. */
export function noiseOf(p: Pawn): number {
  const d = p.doing;
  if (d === 'Watching telly') return 2;
  if (d === 'Practising') return 6;
  if (d.startsWith('Having a row')) return 8;
  if (d.startsWith('Chatting') || d.startsWith('Gossiping') || d.startsWith('Flirting')) return 1;
  if (d === 'Cooking') return 0.5;
  return 0;
}

/** Noise made in each flat (and the shared parts) this minute. */
export function noiseMade(sim: Sim): Map<string, number> {
  const made = new Map<string, number>();
  for (const p of sim.state.pawns) {
    if (p.life?.away) continue;
    const n = noiseOf(p);
    if (!n) continue;
    const where = ownerOf(sim.layout, Math.round(p.x), Math.round(p.s));
    if (where) made.set(where, (made.get(where) ?? 0) + n);
  }
  const work = currentPiece(sim);
  if (work) {
    const where = whereIs(sim, work);
    made.set(where, (made.get(where) ?? 0) + BUILDER_NOISE);
  }
  return made;
}

/** Noise reaching a flat from next door, and where the most of it comes from. */
export function noiseReaching(sim: Sim, made: Map<string, number>, flatId: string): { amount: number; loudest: string | null } {
  let amount = 0;
  let loudest: string | null = null;
  let most = 0;
  for (const [from, n] of made) {
    if (from === flatId) continue;
    const got = n * noiseThrough(sim, from, flatId);
    amount += got;
    if (got > most) {
      most = got;
      loudest = from;
    }
  }
  return { amount, loudest };
}

export function isNight(sim: Sim): boolean {
  const m = sim.minuteOfDay;
  return m >= 22 * 60 || m < 7 * 60;
}

// ------------------------------------------------------------------ dirt and bins

/** Dirt in a flat or the shared parts, 0 to 1. */
export function dirtOf(sim: Sim, id: string): number {
  return sim.state.dirt[id] ?? 0;
}

function addDirt(sim: Sim, id: string, amount: number): void {
  sim.state.dirt[id] = Math.max(0, Math.min(1, dirtOf(sim, id) + amount));
}

/** People bin about this much a week each; a set of wheelie bins takes six people's worth. */
const BIN_PEOPLE = 6;

/** Too many people for the bins in the shared parts, and it's late in the week. */
export function binsOverflowing(sim: Sim): boolean {
  const lay = sim.layout;
  const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.nodes));
  const bins = sim.state.furniture.filter((f) => f.def === 'bins' && shared.has(lay.node(f.x, f.s))).length;
  const people = sim.state.pawns.filter((p) => p.life && !p.life.leaving).length;
  const weekday = (sim.day - 1) % 7;
  return people > 0 && (bins === 0 || (people > bins * BIN_PEOPLE && weekday >= 3));
}

function dirtHour(sim: Sim): void {
  const st = sim.state;
  const lay = sim.layout;
  const tenants = st.pawns.filter((p) => p.life && !p.life.leaving);
  // People walk dirt in from the street; a doormat in the lobby halves it.
  const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.nodes));
  const mat = st.furniture.some((f) => f.def === 'doormat' && shared.has(lay.node(f.x, f.s)));
  addDirt(sim, SHARED, 0.0025 * tenants.length * (mat ? 0.5 : 1));
  for (const f of lay.flats) {
    const people = tenants.filter((p) => p.life!.flat === f.id && !p.life!.away);
    if (people.length === 0) continue;
    const messy = people.filter((p) => has(p.life!, 'messy')).length;
    addDirt(sim, f.id, 0.004 * (people.length + messy * 2));
  }
}

/** Every morning: the cleaner (if you pay for one) does the stairs and the lobby. */
function dirtMorning(sim: Sim): void {
  if (sim.state.cleaner) sim.state.dirt[SHARED] = 0;
}

export const CLEANER_WEEKLY = 3000;

/** Once a game hour. */
export function environmentHour(sim: Sim): void {
  warmthHour(sim);
  dirtHour(sim);
  if (Math.floor(sim.minuteOfDay / 60) === 10) dirtMorning(sim);
  // A rolling average of how noisy each flat has been, for how impressive it is.
  const made = noiseMade(sim);
  for (const f of sim.layout.flats) {
    const got = noiseReaching(sim, made, f.id).amount;
    const avg = sim.state.noiseAvg[f.id] ?? 0;
    sim.state.noiseAvg[f.id] = avg + (got - avg) * 0.08;
  }
}

/** A tenant tidies up: their flat gets cleaner. */
export function tidy(sim: Sim, flatId: string, amount: number): void {
  addDirt(sim, flatId, -amount);
}

/** For the flat panel. */
export function flatClimate(sim: Sim, flatId: string): { temp: number; noise: number; dirt: number; radiators: number; insulated: number; outside: number } {
  const flat = sim.layout.flat(flatId);
  const shape = shapesOf(sim).byFlat.get(flatId);
  return {
    temp: tempOf(sim, flatId),
    noise: sim.state.noiseAvg[flatId] ?? 0,
    dirt: dirtOf(sim, flatId),
    radiators: flat ? radiators(sim, flat) : 0,
    insulated: shape?.insulated ?? 0,
    outside: shape?.outside ?? 0,
  };
}
