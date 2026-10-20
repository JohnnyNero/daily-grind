// What each room is for, and what kind of flat the rooms add up to. A room takes its purpose
// from what's in it: a bed makes a bedroom, a cooker a kitchen, a sofa or a telly a living
// room, a loo or a shower a bathroom. A bed in a room that's also for something else is a
// bedsit: somewhere to sleep, but not a bedroom. A flat is a studio if nobody has a bedroom
// to themselves, else a one-bed, a two-bed and so on. A bedroom too small to get round the
// bed is a box room: it sleeps someone, but it isn't a bedroom. Worked out from the building, never
// saved (docs/specs/layout.md).

import { furnitureDef } from './defs';
import type { Sim } from './sim';
import type { HouseholdKind } from './state';
import { LAYOUT } from './tuning';

export type RoomUse = 'sleep' | 'cook' | 'sit' | 'wash';

/** The pieces that give a room each purpose. Broken ones still count: a broken bed is still a bed. */
const USES: Record<RoomUse, readonly string[]> = {
  sleep: ['bed', 'doubleBed'],
  cook: ['cooker', 'fridge', 'sink', 'counter', 'dishwasher'],
  sit: ['sofa', 'armchair', 'tv', 'bigTv', 'console', 'diningSet'],
  wash: ['toilet', 'shower', 'bath', 'basin'],
};

/** How many people a bed sleeps. */
const BED_PLACES: Record<string, number> = { bed: 1, doubleBed: 2 };

export interface RoomInfo {
  /** The layout room's id. */
  room: number;
  uses: RoomUse[];
  name: string;
  /** Just for sleeping in. */
  bedroom: boolean;
  /** People its beds sleep. */
  sleeps: number;
  /** A double bed in it. */
  double: boolean;
  /** Floor tiles. */
  area: number;
}

export type FlatType = 'bare' | 'studio' | 'oneBed' | 'twoBed' | 'threeBed' | 'fourBed';

export const FLAT_TYPE_NAMES: Record<FlatType, string> = {
  bare: 'Unfurnished',
  studio: 'Studio',
  oneBed: 'One-bed',
  twoBed: 'Two-bed',
  threeBed: 'Three-bed',
  fourBed: 'Four-bed',
};

export interface FlatKind {
  type: FlatType;
  /** "One-bed", "Studio". */
  name: string;
  bedrooms: number;
  /** People its beds sleep, bedrooms or not. */
  sleeps: number;
  /** A double bed somewhere. */
  double: boolean;
  /** Somewhere to sit that isn't a bedroom. */
  sitting: boolean;
  rooms: RoomInfo[];
}

/** A room's name from its purposes: "Bedroom", "Kitchen and living room", "Bedsit". */
export function roomName(uses: readonly RoomUse[], furnished: boolean): string {
  if (uses.includes('sleep')) return uses.length === 1 ? 'Bedroom' : 'Bedsit';
  const words = uses.map((u) => ({ cook: 'kitchen', sit: 'living room', wash: 'bathroom', sleep: 'bedroom' })[u]);
  if (words.length === 0) return furnished ? 'Spare room' : 'Empty room';
  const text = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const cache = new WeakMap<Sim, { key: string; kinds: Map<string, FlatKind> }>();

/** What kind of flat this is, and what each of its rooms is for. */
export function flatKind(sim: Sim, flatId: string): FlatKind {
  const key = `${sim.version}|${sim.state.furniture.length}`;
  let c = cache.get(sim);
  if (!c || c.key !== key) {
    c = { key, kinds: new Map() };
    cache.set(sim, c);
  }
  let k = c.kinds.get(flatId);
  if (!k) {
    k = workOut(sim, flatId);
    c.kinds.set(flatId, k);
  }
  return k;
}

function workOut(sim: Sim, flatId: string): FlatKind {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  const rooms: RoomInfo[] = [];
  for (const r of flat?.rooms ?? []) {
    const cells = new Set(lay.rooms[r].cells);
    const defs = sim.state.furniture.filter((f) => cells.has(lay.node(f.x, f.s))).map((f) => f.def);
    const uses = (Object.keys(USES) as RoomUse[]).filter((u) => defs.some((d) => USES[u].includes(d)));
    const sleeps = defs.reduce((n, d) => n + (BED_PLACES[d] ?? 0), 0);
    const area = lay.rooms[r].nodes.length;
    // Just for sleeping, and big enough to get round the bed: smaller is a box room.
    const bedroom = uses.length === 1 && uses[0] === 'sleep' && area >= LAYOUT.bedroomTiles;
    const box = uses.length === 1 && uses[0] === 'sleep' && !bedroom;
    rooms.push({
      room: r,
      uses,
      name: box ? 'Box room' : roomName(uses, defs.some((d) => !furnitureDef(d).wall)),
      bedroom,
      sleeps,
      double: defs.includes('doubleBed'),
      area,
    });
  }
  const bedrooms = rooms.filter((r) => r.bedroom).length;
  const sleeps = rooms.reduce((n, r) => n + r.sleeps, 0);
  const type: FlatType = bedrooms === 0 ? (sleeps > 0 ? 'studio' : 'bare') : (['oneBed', 'twoBed', 'threeBed', 'fourBed'] as const)[Math.min(3, bedrooms - 1)];
  return {
    type,
    name: FLAT_TYPE_NAMES[type],
    bedrooms,
    sleeps,
    double: rooms.some((r) => r.double),
    sitting: rooms.some((r) => !r.bedroom && r.uses.includes('sit')),
    rooms,
  };
}

/** "One-bed flat", "Studio flat", "Unfurnished flat". */
export function flatKindName(kind: FlatKind): string {
  return `${kind.name} flat`;
}

/** How many people a flat is scored for when nobody lives there: one a bedroom, at least one. */
export function scoredFor(kind: FlatKind): number {
  return Math.max(1, kind.bedrooms);
}

// ------------------------------------------------------------------ households

export type { HouseholdKind } from './state';

/** Who they are, as the applicant's card says. */
export function householdName(kind: HouseholdKind, size: number): string {
  if (kind === 'single') return 'Lives alone';
  if (kind === 'couple') return 'A couple';
  if (kind === 'sharers') return `${['', '', 'Two', 'Three', 'Four'][size] ?? size} sharers`;
  return `A family of ${['', '', 'two', 'three', 'four'][size] ?? size}`;
}

/** Bedrooms a household needs: sharers one each, a family one for the parents and one for the children. */
export function bedroomsWanted(kind: HouseholdKind, size: number): number {
  if (kind === 'sharers') return size;
  if (kind === 'family') return 2;
  return 0;
}

/**
 * The households a flat could take, with their weights: never more people than its beds
 * sleep, a couple only with a double bed, sharers and families only with the bedrooms.
 */
export function householdsFor(kind: FlatKind, secondChild: boolean): { kind: HouseholdKind; size: number; weight: number }[] {
  const table = kind.bedrooms <= 0 ? LAYOUT.households.studio : kind.bedrooms === 1 ? LAYOUT.households.oneBed : LAYOUT.households.bigger;
  const out: { kind: HouseholdKind; size: number; weight: number }[] = [{ kind: 'single', size: 1, weight: table.single }];
  if (kind.double && kind.sleeps >= 2) out.push({ kind: 'couple', size: 2, weight: table.couple });
  if (kind.bedrooms >= 2) out.push({ kind: 'sharers', size: Math.min(3, kind.bedrooms, kind.sleeps), weight: table.sharers });
  const family = Math.min(secondChild ? 4 : 3, kind.sleeps);
  if (kind.bedrooms >= 2 && kind.double && family >= 3) out.push({ kind: 'family', size: family, weight: table.family });
  return out.filter((o) => o.weight > 0 && o.size <= Math.max(1, kind.sleeps));
}
