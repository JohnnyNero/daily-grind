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

import { happeningNoise } from './events';
import type { Flat, Layout } from './layout';
import type { Sim } from './sim';
import { TICKS_PER_DAY, isDoor, key, type Pawn } from './state';
import { has } from './traits';
import { BUILDER_NOISE, currentPiece, whereIs } from './works';
import { DIRT, GAS_PER_RADIATOR, NOISE, WARMTH } from './tuning';

// Heat, noise and dirt rates are in tuning.ts.
export { CLEANER_WEEKLY, GAS_PER_RADIATOR } from './tuning';

export const SHARED = 'shared';

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

/** Who an air cell belongs to: a flat, SHARED, OUTSIDE, or null (a sealed room, or not air). */
const OUTSIDE = 'outside';
function ownerOf(lay: Layout, x: number, s: number): string | null {
  if (x < 0 || x >= lay.w || s >= lay.rows) return OUTSIDE;
  if (s < 0) return null;
  const room = lay.roomOf[lay.node(x, s)];
  if (room === -1) return null;
  const r = lay.rooms[room];
  if (r.outdoor) return OUTSIDE;
  return r.flat ?? (r.shared ? SHARED : null);
}

/** The most wall cells we look through for what's on the other side. */
const THICKEST = 4;

function shapesOf(sim: Sim) {
  const st = sim.state;
  const ins = Object.keys(st.insulated).length;
  const cached = shapes.get(sim);
  if (cached && cached.version === sim.version && cached.insulation === ins) return cached;
  const lay = sim.layout;
  const through = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, amount: number) => {
    const m = through.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + amount);
    through.set(a, m);
  };
  const byFlat = new Map<string, Shape>();
  for (const f of lay.flats) byFlat.set(f.id, { area: f.area, outside: 0, insulated: 0, through });
  // From every cell of every flat (and the shared parts), look through the walls in each
  // direction to see what's on the other side: another flat, the outside, or the ground.
  // Thicker walls let less through; doors and windows let more.
  for (let s = 0; s < lay.rows; s++) {
    for (let x = 0; x < lay.w; x++) {
      const me = ownerOf(lay, x, s);
      if (!me || me === OUTSIDE) continue;
      const shape = byFlat.get(me);
      for (const [dx, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let t = 0;
        let leak = 1;
        let lagged = false;
        let other: string | null = null;
        for (let i = 1; i <= THICKEST + 1; i++) {
          const nx = x + dx * i;
          const ns = s + ds * i;
          if (ns < 0) {
            other = 'ground';
            break;
          }
          const o = lay.air(nx, ns) || nx < 0 || nx >= lay.w || ns >= lay.rows ? ownerOf(lay, nx, ns) : undefined;
          if (o !== undefined) {
            other = o;
            break;
          }
          t++;
          const c = lay.cell(nx, ns);
          if (st.insulated[key(nx, ns)]) lagged = true;
          if (isDoor(c) || lay.doorTop(nx, ns)) leak = Math.max(leak, NOISE.door);
          else if (c === 'window') leak = Math.max(leak, NOISE.window);
        }
        if (t === 0 && other !== 'ground') continue;
        const thick = Math.max(1, t);
        const weight = ds === 0 ? 1 / 3 : 1;
        if (other === OUTSIDE || other === 'ground') {
          if (shape) {
            shape.outside += weight / thick;
            if (lagged) shape.insulated += weight / thick;
          }
        } else if (other && other !== me) {
          add(me, other, ((ds === 0 ? NOISE.wall : NOISE.floor) * leak * (lagged ? NOISE.insulated : 1)) / (thick * thick));
        }
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
  const nodes = new Set(lay.flatCells(flat));
  return sim.state.furniture.filter((f) => f.def === 'radiator' && nodes.has(lay.node(f.x, f.s))).length;
}

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
    const W = WARMTH;
    const heat = (radiators(sim, f) * st.boiler * W.perRadiator) / Math.max(1, f.area / W.radiatorTiles) + W.base + people * W.perPerson;
    const target = outside + heat * (1 + ins);
    const rate = (W.rate * Math.min(W.mostExposure, exposure + W.exposureBase) * (1 - W.insulationKeeps * ins)) / (1 + f.area / W.sizeTiles);
    const now = st.temps[f.id] ?? target;
    st.temps[f.id] = now + (target - now) * Math.min(1, rate);
  }
}

export function tempOf(sim: Sim, flatId: string): number {
  return sim.state.temps[flatId] ?? WARMTH.start;
}

/** Warmth as a need: 0 at 10° or below, full at 19° and up. */
export function warmthOf(temp: number): number {
  return Math.max(0, Math.min(1, (temp - WARMTH.cold) / WARMTH.range));
}

// ------------------------------------------------------------------ noise

/** How much noise someone's making right now, by what they're doing. */
export function noiseOf(p: Pawn): number {
  const d = p.doing;
  if (d === 'Watching telly') return NOISE.telly;
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
  happeningNoise(sim, made);
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
  return m >= NOISE.nightFrom * 60 || m < NOISE.nightTo * 60;
}

// ------------------------------------------------------------------ dirt and bins

/** Dirt in a flat or the shared parts, 0 to 1. */
export function dirtOf(sim: Sim, id: string): number {
  return sim.state.dirt[id] ?? 0;
}

export function addDirt(sim: Sim, id: string, amount: number): void {
  sim.state.dirt[id] = Math.max(0, Math.min(1, dirtOf(sim, id) + amount));
}

/** Too many people for the bins in the shared parts, and it's late in the week. */
export function binsOverflowing(sim: Sim): boolean {
  const lay = sim.layout;
  const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.cells));
  const bins = sim.state.furniture.filter((f) => f.def === 'bins' && shared.has(lay.node(f.x, f.s))).length;
  const people = sim.state.pawns.filter((p) => p.life && !p.life.leaving).length;
  const weekday = (sim.day - 1) % 7;
  return people > 0 && (bins === 0 || (people > bins * DIRT.binPeople && weekday >= 3));
}

function dirtHour(sim: Sim): void {
  const st = sim.state;
  const lay = sim.layout;
  const tenants = st.pawns.filter((p) => p.life && !p.life.leaving);
  // People walk dirt in from the street; a doormat in the lobby halves it.
  const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.cells));
  const mat = st.furniture.some((f) => f.def === 'doormat' && shared.has(lay.node(f.x, f.s)));
  addDirt(sim, SHARED, DIRT.shared * tenants.length * (mat ? DIRT.doormat : 1));
  for (const f of lay.flats) {
    const people = tenants.filter((p) => p.life!.flat === f.id && !p.life!.away);
    if (people.length === 0) continue;
    const messy = people.filter((p) => has(p.life!, 'messy')).length;
    addDirt(sim, f.id, DIRT.flat * (people.length + messy * DIRT.messyExtra));
  }
}

/** Every morning: the cleaner (if you pay for one) does the stairs and the lobby. */
function dirtMorning(sim: Sim): void {
  if (sim.state.cleaner) sim.state.dirt[SHARED] = 0;
}

/** Once a game hour. */
export function environmentHour(sim: Sim): void {
  warmthHour(sim);
  dirtHour(sim);
  if (Math.floor(sim.minuteOfDay / 60) === DIRT.cleanerHour) dirtMorning(sim);
  // A rolling average of how noisy each flat has been, for how impressive it is.
  const made = noiseMade(sim);
  for (const f of sim.layout.flats) {
    const got = noiseReaching(sim, made, f.id).amount;
    const avg = sim.state.noiseAvg[f.id] ?? 0;
    sim.state.noiseAvg[f.id] = avg + (got - avg) * NOISE.averageRate;
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
