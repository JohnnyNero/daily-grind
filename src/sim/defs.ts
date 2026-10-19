// Furniture. Sizes are in tiles: w columns wide, h rows tall. Floor items stand on the
// floor (row 0); wall items hang on the back wall above row 0.

import type { NeedId } from './state';

export type FurnitureGroup = 'sleep' | 'sit' | 'kitchen' | 'bathroom' | 'storage' | 'decor' | 'shared';

/** The shared spaces a piece can make: a laundry room, a bike store, a garden or roof terrace. */
export type SpaceKind = 'laundry' | 'bikes' | 'garden';

/**
 * Something a piece of furniture lets you do: which need it meets, how fast (per game hour),
 * how long a go lasts, and how you're posed doing it. `also` tops up other needs at the same
 * time; `needsNearby` means it only works with that piece in the same room (a sofa is only
 * for telly if there's a telly).
 */
export interface Offer {
  need: NeedId;
  rate: number;
  minutes: [number, number];
  pose: 'stand' | 'sit' | 'sleep';
  also?: Partial<Record<NeedId, number>>;
  needsNearby?: string;
  /** What they're doing, for the info panel. */
  doing: string;
  /** A memory left when they finish. */
  memory?: string;
  /** Not for a need: tenants go when they feel like it (the washing, the garden, the bike), not when they must. */
  errand?: boolean;
  /** Only works while someone is cooking at the grill in the same room: for guests. */
  join?: boolean;
}

export interface FurnitureDef {
  id: string;
  name: string;
  w: number;
  h: number;
  wall?: boolean;
  group: FurnitureGroup;
  /** Rough worth, for how impressive a flat is. */
  value: number;
  /** Counts as decoration (pictures, plants and so on). */
  decor?: boolean;
  /** Worth a burglar's while. */
  valuable?: boolean;
  /** The kind of shared space this piece makes when it's in a shared room (or, for garden things, outdoors). */
  space?: SpaceKind;
  /** Columns people use it from, counted from the left. */
  spots?: number[];
  offers?: Offer[];
  /** Comes cheap, standard or posh. Left out, it does if it's a floor piece you use (see isGraded). */
  graded?: boolean;
  /** Counts as this other piece for `needsNearby` (a big telly is a telly). */
  as?: string;
  /** Lies on the floor under other things (a rug): it may share a cell with floor furniture. */
  underfoot?: boolean;
}

export const FURNITURE: readonly FurnitureDef[] = [
  { id: 'bed', name: 'Single bed', w: 2, h: 1, group: 'sleep', value: 30, spots: [1], offers: [{ need: 'sleep', rate: 1 / 7, minutes: [420, 540], pose: 'sleep', also: { comfort: 0.4 }, doing: 'Asleep' }] },
  { id: 'doubleBed', name: 'Double bed', w: 3, h: 1, group: 'sleep', value: 45, spots: [1, 2], offers: [{ need: 'sleep', rate: 1 / 7, minutes: [420, 540], pose: 'sleep', also: { comfort: 0.4 }, doing: 'Asleep' }] },
  { id: 'wardrobe', name: 'Wardrobe', w: 2, h: 2, group: 'storage', value: 25 },
  { id: 'drawers', name: 'Chest of drawers', w: 1, h: 1, group: 'storage', value: 12 },
  { id: 'sofa', name: 'Sofa', w: 3, h: 1, group: 'sit', value: 40, spots: [0, 1, 2], offers: [{ need: 'fun', rate: 0.6, minutes: [40, 120], pose: 'sit', also: { comfort: 0.6 }, needsNearby: 'tv', doing: 'Watching telly' }, { need: 'comfort', rate: 0.8, minutes: [20, 60], pose: 'sit', doing: 'Sitting on the sofa' }] },
  { id: 'armchair', name: 'Armchair', w: 1, h: 1, group: 'sit', value: 20, offers: [{ need: 'comfort', rate: 0.8, minutes: [20, 60], pose: 'sit', doing: 'Sitting in the armchair' }, { need: 'fun', rate: 0.5, minutes: [40, 90], pose: 'sit', also: { comfort: 0.6 }, needsNearby: 'tv', doing: 'Watching telly' }] },
  { id: 'table', name: 'Table', w: 2, h: 1, group: 'sit', value: 15 },
  { id: 'chair', name: 'Chair', w: 1, h: 1, group: 'sit', value: 8, offers: [{ need: 'comfort', rate: 0.4, minutes: [15, 40], pose: 'sit', doing: 'Sitting down' }] },
  { id: 'desk', name: 'Desk', w: 2, h: 1, group: 'sit', value: 20, valuable: true, offers: [{ need: 'fun', rate: 0.45, minutes: [40, 120], pose: 'sit', also: { comfort: 0.2 }, doing: 'On the laptop' }] },
  { id: 'tv', name: 'Telly', w: 2, h: 1, group: 'sit', value: 30, valuable: true },
  { id: 'counter', name: 'Kitchen counter', w: 1, h: 1, group: 'kitchen', value: 10 },
  { id: 'sink', name: 'Kitchen sink', w: 1, h: 1, group: 'kitchen', value: 15 },
  { id: 'cooker', name: 'Cooker', w: 1, h: 1, group: 'kitchen', value: 30, offers: [{ need: 'food', rate: 0, minutes: [20, 35], pose: 'stand', doing: 'Cooking' }] },
  { id: 'fridge', name: 'Fridge', w: 1, h: 2, group: 'kitchen', value: 30, offers: [{ need: 'food', rate: 2.5, minutes: [4, 8], pose: 'stand', doing: 'Eating out of the fridge', memory: 'fridgeDinner' }] },
  { id: 'toilet', name: 'Toilet', w: 1, h: 1, group: 'bathroom', value: 15, offers: [{ need: 'bladder', rate: 12, minutes: [3, 6], pose: 'sit', doing: 'On the loo' }] },
  { id: 'basin', name: 'Basin', w: 1, h: 1, group: 'bathroom', value: 8, offers: [{ need: 'hygiene', rate: 2, minutes: [4, 8], pose: 'stand', doing: 'Washing at the basin' }] },
  { id: 'shower', name: 'Shower', w: 1, h: 2, group: 'bathroom', value: 30, offers: [{ need: 'hygiene', rate: 6, minutes: [8, 15], pose: 'stand', doing: 'In the shower' }] },
  { id: 'bath', name: 'Bath', w: 2, h: 1, group: 'bathroom', value: 40, spots: [0], offers: [{ need: 'hygiene', rate: 3, minutes: [25, 45], pose: 'sit', also: { comfort: 1 }, doing: 'In the bath', memory: 'longBath' }] },
  { id: 'radiator', name: 'Radiator', w: 1, h: 1, wall: true, group: 'decor', value: 10 },
  { id: 'lamp', name: 'Floor lamp', w: 1, h: 2, group: 'decor', value: 15, decor: true },
  { id: 'plant', name: 'Pot plant', w: 1, h: 1, group: 'decor', value: 8, decor: true },
  { id: 'doormat', name: 'Doormat', w: 1, h: 1, group: 'decor', value: 4 },
  { id: 'bins', name: 'Wheelie bins', w: 2, h: 1, group: 'storage', value: 0 },
  { id: 'shelf', name: 'Wall shelf', w: 2, h: 1, wall: true, group: 'storage', value: 10, decor: true },
  { id: 'cupboard', name: 'Wall cupboard', w: 1, h: 1, wall: true, group: 'kitchen', value: 10 },
  { id: 'picture', name: 'Picture', w: 1, h: 1, wall: true, group: 'decor', value: 12, decor: true },
  { id: 'mirror', name: 'Mirror', w: 1, h: 1, wall: true, group: 'bathroom', value: 8, decor: true },
  { id: 'clock', name: 'Wall clock', w: 1, h: 1, wall: true, group: 'decor', value: 6, decor: true },
  // Shared spaces
  { id: 'washer', name: 'Washing machine', w: 1, h: 1, group: 'shared', value: 30, space: 'laundry', offers: [{ need: 'hygiene', rate: 0.3, minutes: [40, 60], pose: 'stand', errand: true, doing: 'Doing the washing', memory: 'didWashing' }] },
  { id: 'bikeRack', name: 'Bike rack', w: 2, h: 1, group: 'shared', value: 12, space: 'bikes', spots: [0, 1], offers: [{ need: 'fun', rate: 0, minutes: [2, 4], pose: 'stand', errand: true, doing: 'Getting the bike out' }] },
  { id: 'bench', name: 'Garden bench', w: 2, h: 1, group: 'shared', value: 14, space: 'garden', spots: [0, 1], offers: [{ need: 'comfort', rate: 0.9, minutes: [30, 90], pose: 'sit', also: { fun: 0.5 }, errand: true, doing: 'Sitting out on the bench', memory: 'satOut' }] },
  { id: 'planter', name: 'Planter', w: 1, h: 1, group: 'shared', value: 10, space: 'garden', decor: true },
  { id: 'bbq', name: 'BBQ grill', w: 2, h: 1, group: 'shared', value: 25, space: 'garden', spots: [0, 1], offers: [{ need: 'fun', rate: 0.9, minutes: [30, 50], pose: 'stand', errand: true, doing: 'Firing up the barbecue', memory: 'firedUpBbq' }, { need: 'fun', rate: 0.8, minutes: [25, 45], pose: 'stand', errand: true, join: true, doing: 'At the barbecue', memory: 'gotBarbecue' }] },
  { id: 'parasolTable', name: 'Table and parasol', w: 2, h: 2, group: 'shared', value: 25, space: 'garden', spots: [0, 1], offers: [{ need: 'comfort', rate: 0.7, minutes: [30, 60], pose: 'sit', also: { fun: 0.4 }, errand: true, doing: 'Sitting out at the table', memory: 'satOut' }, { need: 'fun', rate: 0.8, minutes: [25, 45], pose: 'sit', errand: true, join: true, doing: 'At the barbecue', memory: 'gotBarbecue' }] },
  // New in-flat items: each one touches a system (dirt, noise, sleep, the council, burglars).
  { id: 'dishwasher', name: 'Dishwasher', w: 1, h: 1, group: 'kitchen', value: 30 },
  { id: 'console', name: 'Games console', w: 1, h: 1, group: 'sit', value: 40, valuable: true, spots: [0], offers: [{ need: 'fun', rate: 0.9, minutes: [40, 120], pose: 'sit', also: { comfort: 0.3 }, needsNearby: 'tv', doing: 'Playing on the console' }] },
  { id: 'bigTv', name: 'Big telly', w: 3, h: 1, group: 'sit', value: 70, valuable: true, as: 'tv' },
  { id: 'bookshelf', name: 'Bookshelf', w: 2, h: 2, group: 'storage', value: 25, decor: true, spots: [0], offers: [{ need: 'fun', rate: 0.3, minutes: [30, 90], pose: 'stand', also: { comfort: 0.1 }, doing: 'Reading', memory: 'goodRead' }] },
  { id: 'diningSet', name: 'Dining set', w: 3, h: 1, group: 'sit', value: 28, spots: [0, 2], offers: [{ need: 'comfort', rate: 0.4, minutes: [15, 40], pose: 'sit', doing: 'Sitting down' }] },
  { id: 'rug', name: 'Rug', w: 2, h: 1, group: 'decor', value: 8, decor: true, underfoot: true },
  { id: 'curtains', name: 'Curtains', w: 1, h: 2, wall: true, group: 'decor', value: 10, decor: true },
  { id: 'smokeAlarm', name: 'Smoke alarm', w: 1, h: 1, wall: true, group: 'decor', value: 0 },
  { id: 'cctv', name: 'CCTV camera', w: 1, h: 1, wall: true, group: 'decor', value: 20 },
  { id: 'intercom', name: 'Door intercom', w: 1, h: 1, wall: true, group: 'decor', value: 15 },
];

const byId = new Map(FURNITURE.map((d) => [d.id, d]));

export function furnitureDef(id: string): FurnitureDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown furniture ${id}`);
  return d;
}

/** The columns (absolute) people use a piece from, allowing for it being turned round. */
export function spotColumns(def: FurnitureDef, x: number, flip?: boolean): number[] {
  return (def.spots ?? [0]).map((o) => x + (flip ? def.w - 1 - o : o));
}

export function isFurniture(id: string): boolean {
  return byId.has(id);
}

/** Pieces that come cheap, standard or posh: beds, seats, kitchen and bathroom things. Not ornaments, storage or wall pieces. */
export function isGraded(id: string): boolean {
  const d = furnitureDef(id);
  return d.graded ?? (['sleep', 'sit', 'kitchen', 'bathroom'].includes(d.group) && !d.wall && !d.decor);
}
