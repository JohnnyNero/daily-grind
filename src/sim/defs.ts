// Furniture. Sizes are in tiles: w columns wide, h rows tall. Floor items stand on the
// floor (row 0); wall items hang on the back wall above row 0.

export type FurnitureGroup = 'sleep' | 'sit' | 'kitchen' | 'bathroom' | 'storage' | 'decor';

export interface FurnitureDef {
  id: string;
  name: string;
  w: number;
  h: number;
  wall?: boolean;
  group: FurnitureGroup;
}

export const FURNITURE: readonly FurnitureDef[] = [
  { id: 'bed', name: 'Single bed', w: 2, h: 1, group: 'sleep' },
  { id: 'doubleBed', name: 'Double bed', w: 3, h: 1, group: 'sleep' },
  { id: 'wardrobe', name: 'Wardrobe', w: 2, h: 2, group: 'storage' },
  { id: 'drawers', name: 'Chest of drawers', w: 1, h: 1, group: 'storage' },
  { id: 'sofa', name: 'Sofa', w: 3, h: 1, group: 'sit' },
  { id: 'armchair', name: 'Armchair', w: 1, h: 1, group: 'sit' },
  { id: 'table', name: 'Table', w: 2, h: 1, group: 'sit' },
  { id: 'chair', name: 'Chair', w: 1, h: 1, group: 'sit' },
  { id: 'desk', name: 'Desk', w: 2, h: 1, group: 'sit' },
  { id: 'tv', name: 'Telly', w: 2, h: 1, group: 'sit' },
  { id: 'counter', name: 'Kitchen counter', w: 1, h: 1, group: 'kitchen' },
  { id: 'sink', name: 'Kitchen sink', w: 1, h: 1, group: 'kitchen' },
  { id: 'cooker', name: 'Cooker', w: 1, h: 1, group: 'kitchen' },
  { id: 'fridge', name: 'Fridge', w: 1, h: 2, group: 'kitchen' },
  { id: 'toilet', name: 'Toilet', w: 1, h: 1, group: 'bathroom' },
  { id: 'basin', name: 'Basin', w: 1, h: 1, group: 'bathroom' },
  { id: 'shower', name: 'Shower', w: 1, h: 2, group: 'bathroom' },
  { id: 'bath', name: 'Bath', w: 2, h: 1, group: 'bathroom' },
  { id: 'radiator', name: 'Radiator', w: 1, h: 1, group: 'decor' },
  { id: 'lamp', name: 'Floor lamp', w: 1, h: 2, group: 'decor' },
  { id: 'plant', name: 'Pot plant', w: 1, h: 1, group: 'decor' },
  { id: 'bins', name: 'Wheelie bins', w: 2, h: 1, group: 'storage' },
  { id: 'shelf', name: 'Wall shelf', w: 2, h: 1, wall: true, group: 'storage' },
  { id: 'cupboard', name: 'Wall cupboard', w: 1, h: 1, wall: true, group: 'kitchen' },
  { id: 'picture', name: 'Picture', w: 1, h: 1, wall: true, group: 'decor' },
  { id: 'mirror', name: 'Mirror', w: 1, h: 1, wall: true, group: 'bathroom' },
  { id: 'clock', name: 'Wall clock', w: 1, h: 1, wall: true, group: 'decor' },
];

const byId = new Map(FURNITURE.map((d) => [d.id, d]));

export function furnitureDef(id: string): FurnitureDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown furniture ${id}`);
  return d;
}

export function isFurniture(id: string): boolean {
  return byId.has(id);
}
