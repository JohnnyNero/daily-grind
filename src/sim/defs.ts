// Furniture. Sizes are in tiles: w columns wide, h rows tall. Floor items stand on the
// floor (row 0); wall items hang on the back wall above row 0.

import type { NeedId } from './state';

export type FurnitureGroup = 'sleep' | 'sit' | 'kitchen' | 'bathroom' | 'storage' | 'decor';

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
  /** Columns people use it from, counted from the left. */
  spots?: number[];
  offers?: Offer[];
  /** Comes cheap, standard or posh. Left out, it does if it's a floor piece you use (see isGraded). */
  graded?: boolean;
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
