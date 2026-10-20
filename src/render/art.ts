// The art, in the "Lamplight" style: warm colours, soft edges and flat bands of
// shading, drawn in world pixels (16 to a tile) and scaled up without smoothing.

import { furnitureDef } from '../sim/defs';
import type { Grade, Pawn } from '../sim/state';
import { TILE } from '../sim/state';

type Ctx = CanvasRenderingContext2D;

// ------------------------------------------------------------------ palette

export const PAL = {
  sky: '#9cc6d8',
  skyNight: '#1c2140',
  brick: '#a2553d',
  mortar: '#8a4532',
  slab: '#5d4a40',
  floor: '#8a5532',
  floorLine: '#6e4126',
  shared: '#b9a58a',
  skirting: '#6b4a32',
  wood: '#9b6a42',
  woodDark: '#6b4a32',
  fabricA: '#4f7aa8',
  fabricB: '#5f8a5a',
  fabricC: '#c9583f',
  white: '#efe7da',
  metal: '#9aa0a6',
  screen: '#2b3a5a',
  plant: '#4f944a',
  pot: '#b5653f',
  door: '#6b4a32',
  glass: '#bfe3f0',
  pave: '#a59d92',
  road: '#3b3a3f',
  outline: '#2e1d16',
  poster: '#e0b24a',
  damp: '#8e8a5a',
};

/** Back-wall colours for flats, in turn. */
export const FLAT_WALLS = ['#e8c48e', '#c7a6c9', '#b9c8a0', '#e3b49a', '#a9c0cf', '#d9c27a', '#c9b49a', '#b8a8d0'];

const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86b47', '#7d4d31', '#5a3825'];
const HAIR = ['#3a2418', '#5a3a28', '#7a4b2a', '#c48a3a', '#d8b36a', '#8a8a8a', '#1a1a1a', '#a2412e'];
const TOPS = ['#c9583f', '#4f7aa8', '#5f8a5a', '#d9a03a', '#7a4b9a', '#3a3a44', '#e7dccb', '#3a9090', '#b5543f', '#56606d'];
const LEGS = ['#2d3a55', '#2f2f35', '#5b4a3a', '#56606d', '#3a5530', '#7a6a55'];

// ------------------------------------------------------------------ colour and blocks

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const A = hex(a);
  const B = hex(b);
  return `#${A.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (B[i] - v) * t))).toString(16).padStart(2, '0')).join('')}`;
}
export const light = (c: string, t: number) => mix(c, '#ffffff', t);
export const dark = (c: string, t: number) => mix(c, '#000000', t);
/** The edge of a block: its own colour, darkened and warmed towards the old outline brown. */
export const edge = (c: string) => mix(dark(c, 0.38), PAL.outline, 0.25);

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * A block with an edge in a darker shade of its own colour (a black outline everywhere was
 * too busy), a highlight along the top and a band of shade at the bottom.
 */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  if (w <= 2 || h <= 2) {
    rect(ctx, x, y, w, h, c);
    return;
  }
  rect(ctx, x, y, w, h, edge(c));
  const ix = x + 1;
  const iy = y + 1;
  const iw = w - 2;
  const ih = h - 2;
  rect(ctx, ix, iy, iw, ih, c);
  if (iw < 2 || ih < 2) return;
  rect(ctx, ix, iy, iw, 1, light(c, 0.22));
  rect(ctx, ix, iy + ih - Math.min(2, ih - 1), iw, Math.min(2, ih - 1), dark(c, 0.12));
  rect(ctx, ix + iw - 1, iy + 1, 1, ih - 1, dark(c, 0.12));
}

// ------------------------------------------------------------------ furniture

type Draw = (ctx: Ctx, W: number) => void;

/** Each piece draws with the floor (or the bottom of its wall spot) at y = 0, from x = 0 to W. */
const PIECES: Record<string, Draw> = {
  bed: (c, W) => bed(c, W, PAL.fabricA),
  doubleBed: (c, W) => bed(c, W, PAL.fabricC),
  wardrobe(c) {
    box(c, 2, -31, 28, 30, PAL.wood);
    rect(c, 16, -29, 1, 27, dark(PAL.wood, 0.3));
    rect(c, 13, -18, 1, 4, PAL.poster);
    rect(c, 18, -18, 1, 4, PAL.poster);
    rect(c, 4, -2, 3, 2, PAL.woodDark);
    rect(c, 25, -2, 3, 2, PAL.woodDark);
  },
  drawers(c) {
    box(c, 1, -13, 14, 12, PAL.wood);
    for (let i = 0; i < 3; i++) {
      rect(c, 2, -11 + i * 3.5, 12, 1, dark(PAL.wood, 0.3));
      rect(c, 7, -10 + i * 3.5, 2, 1, PAL.poster);
    }
    rect(c, 2, -1, 2, 1, PAL.woodDark);
    rect(c, 12, -1, 2, 1, PAL.woodDark);
  },
  sofa(c, W) {
    box(c, 1, -14, W - 2, 7, PAL.fabricB);
    box(c, 0, -10, 5, 8, dark(PAL.fabricB, 0.12));
    box(c, W - 5, -10, 5, 8, dark(PAL.fabricB, 0.12));
    const seat = (W - 10) / 2;
    box(c, 5, -8, seat, 5, light(PAL.fabricB, 0.08));
    box(c, 5 + seat, -8, seat, 5, light(PAL.fabricB, 0.08));
    box(c, 7, -13, 6, 5, PAL.fabricC);
    rect(c, 3, -2, 2, 2, PAL.woodDark);
    rect(c, W - 5, -2, 2, 2, PAL.woodDark);
  },
  armchair(c) {
    box(c, 2, -14, 12, 7, PAL.fabricC);
    box(c, 0, -10, 4, 8, dark(PAL.fabricC, 0.12));
    box(c, 12, -10, 4, 8, dark(PAL.fabricC, 0.12));
    box(c, 4, -8, 8, 5, light(PAL.fabricC, 0.08));
    rect(c, 2, -2, 2, 2, PAL.woodDark);
    rect(c, 12, -2, 2, 2, PAL.woodDark);
  },
  table(c, W) {
    box(c, 1, -12, W - 2, 3, PAL.wood);
    box(c, 3, -9, 3, 9, PAL.woodDark);
    box(c, W - 6, -9, 3, 9, PAL.woodDark);
    box(c, 11, -16, 4, 4, PAL.white);
  },
  chair(c) {
    box(c, 3, -18, 3, 18, PAL.woodDark);
    box(c, 3, -9, 10, 3, PAL.wood);
    rect(c, 11, -6, 2, 6, PAL.woodDark);
  },
  desk(c, W) {
    box(c, 1, -12, W - 2, 3, PAL.wood);
    box(c, 2, -9, 3, 9, PAL.woodDark);
    box(c, W - 12, -9, 10, 9, PAL.wood);
    rect(c, W - 8, -6, 3, 1, PAL.poster);
    box(c, 7, -19, 10, 7, '#2e3138');
    rect(c, 8, -18, 8, 5, PAL.screen);
    rect(c, 5, -13, 14, 1, PAL.metal);
    box(c, 21, -16, 4, 4, PAL.white);
  },
  tv(c, W) {
    box(c, 2, -7, W - 4, 7, PAL.woodDark);
    box(c, 5, -21, W - 10, 13, '#25262b');
    rect(c, 6, -20, W - 12, 11, PAL.screen);
    rect(c, 7, -19, 5, 2, light(PAL.screen, 0.3));
  },
  counter(c) {
    box(c, 0, -16, 16, 16, PAL.wood);
    rect(c, 1, -16, 14, 2, light(PAL.wood, 0.3));
    rect(c, 7, -9, 1, 2, PAL.metal);
    box(c, 3, -21, 5, 5, PAL.white); // bread bin
  },
  sink(c) {
    box(c, 0, -16, 16, 16, PAL.wood);
    rect(c, 1, -16, 14, 2, light(PAL.wood, 0.3));
    rect(c, 7, -9, 1, 2, PAL.metal);
    box(c, 6, -22, 2, 6, PAL.metal);
    rect(c, 6, -22, 5, 2, PAL.metal);
    box(c, 10, -21, 5, 5, PAL.fabricC); // kettle
  },
  cooker(c) {
    box(c, 0, -16, 16, 16, PAL.white);
    box(c, 0, -17, 16, 3, '#2e2e2e');
    box(c, 2, -12, 12, 9, '#3a3330');
    rect(c, 3, -11, 10, 2, '#5a4a3a');
  },
  fridge(c) {
    box(c, 1, -31, 14, 31, PAL.white);
    rect(c, 2, -19, 12, 1, dark(PAL.white, 0.2));
    rect(c, 12, -28, 1, 6, PAL.metal);
    rect(c, 12, -16, 1, 7, PAL.metal);
    rect(c, 4, -27, 3, 3, PAL.fabricC);
    rect(c, 4, -15, 4, 5, PAL.poster);
  },
  toilet(c) {
    box(c, 8, -16, 6, 9, PAL.white);
    box(c, 2, -9, 12, 4, PAL.white);
    box(c, 4, -6, 7, 6, PAL.white);
  },
  basin(c) {
    box(c, 2, -14, 12, 4, PAL.white);
    box(c, 6, -11, 4, 11, PAL.white);
    box(c, 7, -17, 2, 3, PAL.metal);
  },
  shower(c) {
    rect(c, 0, -32, 16, 32, `${PAL.glass}66`);
    box(c, 0, -3, 16, 3, PAL.white);
    rect(c, 0, -32, 1, 32, PAL.metal);
    rect(c, 15, -32, 1, 32, PAL.metal);
    box(c, 3, -31, 6, 2, PAL.metal);
    for (let i = 0; i < 3; i++) rect(c, 4 + i * 2, -26 + i * 3, 1, 3, light(PAL.fabricA, 0.3));
  },
  bath(c, W) {
    box(c, 1, -11, W - 2, 9, PAL.white);
    rect(c, 3, -10, W - 6, 2, light(PAL.glass, 0.2));
    box(c, 3, -2, 3, 2, PAL.metal);
    box(c, W - 6, -2, 3, 2, PAL.metal);
    box(c, W - 6, -16, 2, 5, PAL.metal);
  },
  radiator(c) {
    box(c, 0, -13, 16, 9, PAL.white);
    for (let i = 0; i < 4; i++) rect(c, 3 + i * 3, -12, 1, 7, dark(PAL.white, 0.18));
    rect(c, 2, -4, 2, 4, PAL.metal);
    rect(c, 12, -4, 2, 4, PAL.metal);
  },
  lamp(c) {
    rect(c, 7, -22, 2, 21, '#3a3330');
    box(c, 4, -2, 8, 2, '#3a3330');
    box(c, 3, -30, 10, 8, light(PAL.poster, 0.35));
  },
  plant(c) {
    box(c, 3, -7, 9, 7, PAL.pot);
    rect(c, 7, -13, 1, 6, dark(PAL.plant, 0.3));
    box(c, 2, -15, 6, 4, PAL.plant);
    box(c, 7, -17, 6, 5, light(PAL.plant, 0.1));
  },
  bins(c) {
    box(c, 2, -15, 12, 15, '#2f4b3a');
    box(c, 1, -17, 14, 3, '#253b2e');
    box(c, 17, -15, 12, 15, '#3a3f4b');
    box(c, 16, -17, 14, 3, '#2e323c');
    box(c, 18, -20, 6, 4, '#e8e0d0');
  },
  shelf(c, W) {
    box(c, 1, -5, W - 2, 3, PAL.wood);
    box(c, 3, -13, 3, 8, PAL.fabricC);
    box(c, 6, -12, 3, 7, PAL.fabricA);
    box(c, 9, -11, 2, 6, PAL.poster);
    box(c, W - 10, -10, 7, 5, PAL.plant);
  },
  cupboard(c) {
    box(c, 1, -15, 14, 13, PAL.wood);
    rect(c, 8, -14, 1, 11, dark(PAL.wood, 0.3));
    rect(c, 6, -7, 1, 2, PAL.poster);
    rect(c, 10, -7, 1, 2, PAL.poster);
  },
  picture(c) {
    box(c, 2, -13, 12, 10, PAL.woodDark);
    rect(c, 3, -12, 10, 8, light(PAL.fabricA, 0.4));
    rect(c, 3, -8, 10, 4, PAL.plant);
    rect(c, 9, -11, 2, 2, PAL.poster);
  },
  mirror(c) {
    box(c, 4, -15, 8, 13, PAL.metal);
    rect(c, 5, -14, 6, 11, light(PAL.glass, 0.3));
    rect(c, 6, -13, 1, 4, '#ffffff');
  },
  clock(c) {
    box(c, 3, -13, 10, 10, PAL.woodDark);
    rect(c, 4, -12, 8, 8, '#f4efe4');
    rect(c, 8, -11, 1, 4, '#222');
    rect(c, 8, -8, 3, 1, '#222');
  },
  // Shared spaces
  washer(c) {
    box(c, 1, -15, 14, 15, PAL.white);
    rect(c, 2, -14, 12, 3, light(PAL.metal, 0.3));
    rect(c, 3, -13, 2, 1, PAL.fabricC);
    rect(c, 6, -13, 5, 1, dark(PAL.white, 0.2));
    box(c, 4, -10, 8, 8, PAL.metal);
    rect(c, 5, -9, 6, 6, '#4a6a82');
    rect(c, 6, -8, 3, 2, light('#4a6a82', 0.35));
    rect(c, 3, -1, 2, 1, PAL.woodDark);
    rect(c, 11, -1, 2, 1, PAL.woodDark);
  },
  bikeRack(c) {
    // Two wheels and a frame, leaning in the hoops.
    for (const wx of [3, 20]) {
      box(c, wx, -12, 9, 9, '#2f3238');
      rect(c, wx + 2, -10, 5, 5, '#7e8791');
      rect(c, wx + 4, -8, 1, 1, '#2f3238');
    }
    rect(c, 8, -9, 14, 2, PAL.fabricC);
    rect(c, 8, -9, 2, 6, PAL.fabricC);
    rect(c, 18, -15, 2, 8, PAL.fabricC);
    rect(c, 16, -16, 6, 2, '#2f3238');
    rect(c, 7, -12, 5, 2, '#2f3238');
    // The hoops they lock to.
    for (const hx of [1, 15, 29]) {
      rect(c, hx, -9, 2, 9, PAL.metal);
      rect(c, hx, -10, 2, 1, light(PAL.metal, 0.3));
    }
    rect(c, 0, -1, 32, 1, dark(PAL.metal, 0.3));
  },
  bench(c, W) {
    box(c, 1, -17, W - 2, 4, PAL.wood);
    box(c, 1, -11, W - 2, 3, light(PAL.wood, 0.1));
    box(c, 3, -9, 3, 9, PAL.woodDark);
    box(c, W - 6, -9, 3, 9, PAL.woodDark);
    rect(c, 4, -14, 2, 4, PAL.woodDark);
    rect(c, W - 6, -14, 2, 4, PAL.woodDark);
  },
  planter(c) {
    box(c, 2, -8, 12, 8, '#8a5a3a');
    rect(c, 3, -7, 10, 1, light('#8a5a3a', 0.25));
    box(c, 2, -12, 5, 5, PAL.plant);
    box(c, 6, -14, 6, 7, light(PAL.plant, 0.12));
    box(c, 10, -11, 4, 4, PAL.plant);
    rect(c, 8, -16, 2, 2, PAL.fabricC);
    rect(c, 4, -14, 2, 2, PAL.poster);
    rect(c, 12, -13, 2, 2, PAL.fabricC);
  },
  bbq(c) {
    // A bowl on legs with a grill over the coals, and a shelf at the side.
    rect(c, 5, -9, 2, 9, PAL.metal);
    rect(c, 18, -9, 2, 9, PAL.metal);
    rect(c, 3, -2, 6, 2, '#2f3238');
    rect(c, 16, -2, 6, 2, '#2f3238');
    box(c, 2, -17, 22, 9, '#33353b');
    rect(c, 3, -16, 20, 1, light('#33353b', 0.25));
    rect(c, 4, -15, 18, 2, PAL.metal);
    for (const gx of [6, 10, 14, 18]) rect(c, gx, -15, 1, 2, dark(PAL.metal, 0.4));
    box(c, 7, -17, 4, 2, '#a85a3a'); // sausages
    box(c, 13, -17, 4, 2, '#a85a3a');
    rect(c, 6, -11, 14, 1, PAL.fabricC);
    rect(c, 9, -11, 3, 1, PAL.poster);
    box(c, 24, -12, 7, 3, PAL.wood);
    rect(c, 26, -9, 2, 9, PAL.woodDark);
    box(c, 25, -16, 3, 4, PAL.white);
  },
  parasolTable(c, W) {
    box(c, 8, -32, W - 16, 4, dark(PAL.fabricC, 0.1));
    box(c, 3, -29, W - 6, 5, PAL.fabricC);
    for (let i = 0; i < 3; i++) rect(c, 6 + i * 8, -28, 4, 3, PAL.white);
    rect(c, W / 2 - 1, -24, 2, 12, PAL.woodDark);
    box(c, 2, -12, W - 4, 3, PAL.wood);
    box(c, 5, -9, 3, 9, PAL.woodDark);
    box(c, W - 8, -9, 3, 9, PAL.woodDark);
    box(c, 10, -17, 4, 5, PAL.glass);
    box(c, 19, -16, 4, 4, PAL.white);
  },
  // New in-flat items.
  dishwasher(c) {
    box(c, 0, -16, 16, 16, '#cfd2d4');
    box(c, 1, -15, 14, 4, '#5a6068');
    rect(c, 3, -14, 2, 1, '#7fd37f');
    rect(c, 7, -14, 5, 1, '#8a9096');
    box(c, 2, -11, 12, 9, '#b4b9bd');
    rect(c, 4, -10, 8, 1, PAL.white);
    box(c, 4, -8, 8, 4, '#3b4a5a');
    rect(c, 5, -7, 3, 1, light('#3b4a5a', 0.3));
  },
  console(c) {
    box(c, 2, -4, 12, 4, '#2e3138');
    rect(c, 3, -3, 7, 1, '#454955');
    rect(c, 11, -2, 2, 1, '#6aa0ff');
    box(c, 4, -8, 8, 4, '#4a4e57');
    rect(c, 5, -7, 2, 1, PAL.fabricC);
    rect(c, 9, -7, 2, 1, PAL.poster);
    rect(c, 4, -4, 1, 1, PAL.outline);
    rect(c, 11, -4, 1, 1, PAL.outline);
  },
  bigTv(c, W) {
    box(c, W / 2 - 9, -6, 18, 6, PAL.woodDark);
    box(c, 2, -31, W - 4, 25, '#25262b');
    rect(c, 4, -29, W - 8, 21, PAL.screen);
    rect(c, 6, -27, 9, 3, light(PAL.screen, 0.3));
    rect(c, W - 14, -14, 8, 4, light(PAL.screen, 0.12));
    rect(c, W / 2 - 1, -7, 3, 1, '#7fd37f');
  },
  bookshelf(c) {
    box(c, 2, -31, 28, 31, PAL.wood);
    rect(c, 4, -29, 24, 27, dark(PAL.wood, 0.4));
    const books = [PAL.fabricC, PAL.fabricA, PAL.poster, PAL.fabricB, '#7a4b9a', light(PAL.fabricC, 0.2)];
    for (let row = 0; row < 3; row++) {
      const base = -3 - row * 9;
      rect(c, 4, base, 24, 1, PAL.woodDark);
      let x = 5;
      for (let i = 0; i < 6; i++) {
        const w = 2 + ((i + row) % 3);
        const h = 5 + ((i * 2 + row) % 3);
        if (x + w > 27) break;
        box(c, x, base - h, w, h, books[(i + row * 2) % books.length]);
        x += w + 1;
      }
    }
  },
  diningSet(c, W) {
    box(c, 1, -18, 3, 18, PAL.woodDark);
    box(c, 1, -9, 9, 3, PAL.wood);
    rect(c, 8, -6, 2, 6, PAL.woodDark);
    box(c, W - 4, -18, 3, 18, PAL.woodDark);
    box(c, W - 10, -9, 9, 3, PAL.wood);
    rect(c, W - 10, -6, 2, 6, PAL.woodDark);
    box(c, 11, -13, W - 22, 3, PAL.wood);
    box(c, 13, -10, 3, 10, PAL.woodDark);
    box(c, W - 16, -10, 3, 10, PAL.woodDark);
    box(c, 17, -16, 5, 3, PAL.white);
    box(c, W - 22, -16, 5, 3, PAL.white);
    box(c, W / 2 - 1, -19, 3, 6, PAL.plant);
  },
  rug(c, W) {
    rect(c, 0, -3, W, 3, edge(PAL.fabricC));
    rect(c, 1, -3, W - 2, 2, PAL.fabricC);
    rect(c, 1, -3, W - 2, 1, light(PAL.fabricC, 0.2));
    for (let x = 4; x < W - 4; x += 6) rect(c, x, -2, 2, 1, PAL.poster);
    rect(c, 3, -2, 1, 1, dark(PAL.fabricC, 0.3));
    rect(c, W - 4, -2, 1, 1, dark(PAL.fabricC, 0.3));
  },
  curtains(c) {
    rect(c, 0, -31, 16, 2, PAL.woodDark);
    rect(c, 0, -32, 2, 4, PAL.poster);
    rect(c, 14, -32, 2, 4, PAL.poster);
    const drape = '#5b7fa0';
    box(c, 1, -29, 6, 28, drape);
    box(c, 9, -29, 6, 28, drape);
    for (const x of [3, 5, 11, 13]) rect(c, x, -27, 1, 24, dark(drape, 0.2));
    rect(c, 1, -14, 6, 2, PAL.poster);
    rect(c, 9, -14, 6, 2, PAL.poster);
  },
  smokeAlarm(c) {
    box(c, 4, -13, 8, 4, '#efe7da');
    rect(c, 6, -12, 4, 1, '#c9c1b3');
    rect(c, 7, -10, 2, 1, '#d0452f');
  },
  cctv(c) {
    rect(c, 2, -14, 3, 8, PAL.metal);
    rect(c, 4, -12, 3, 2, PAL.metal);
    box(c, 5, -13, 10, 5, '#3a3f4b');
    rect(c, 13, -12, 2, 3, '#25262b');
    rect(c, 6, -12, 1, 1, '#d0452f');
  },
  intercom(c) {
    box(c, 5, -14, 6, 11, '#5a6068');
    rect(c, 6, -13, 4, 3, '#1f2428');
    rect(c, 7, -12, 2, 1, '#454955');
    rect(c, 7, -8, 2, 1, PAL.poster);
    rect(c, 7, -6, 2, 1, PAL.white);
  },
  // layout L3
  extractorFan(c) {
    box(c, 3, -15, 10, 10, '#e4e1da');
    for (const y of [-13, -11, -9]) rect(c, 5, y, 6, 1, '#9a978f');
    rect(c, 7, -15, 2, 1, '#bdb9b0');
  },
};

function bed(c: Ctx, W: number, duvet: string): void {
  box(c, 0, -14, 3, 14, PAL.woodDark);
  box(c, 3, -6, W - 6, 4, PAL.wood);
  rect(c, 4, -2, 2, 2, PAL.woodDark);
  rect(c, W - 6, -2, 2, 2, PAL.woodDark);
  box(c, 3, -9, W - 6, 4, PAL.white);
  box(c, 4, -12, 7, 4, light(PAL.white, 0.3));
  box(c, 12, -11, W - 15, 6, duvet);
  box(c, W - 3, -9, 3, 9, PAL.woodDark);
}

/**
 * Draws a piece of furniture whose footprint's top-left is (x, y) in world pixels. A cheap
 * or posh one is the same drawing with a touch over it (see gradedSprite).
 */
export function drawFurniture(ctx: Ctx, def: string, x: number, y: number, flip = false, grade: Grade = 'standard'): void {
  const d = furnitureDef(def);
  const W = d.w * TILE;
  const H = d.h * TILE;
  ctx.save();
  ctx.translate(x, y + H);
  if (flip) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const sprite = grade === 'standard' ? null : gradedSprite(def, grade);
  if (sprite) ctx.drawImage(sprite, -SPRITE_PAD, -H - SPRITE_TOP);
  else drawPiece(ctx, def, W, H);
  ctx.restore();
}

function drawPiece(ctx: Ctx, def: string, W: number, H: number): void {
  const draw = PIECES[def];
  if (draw) draw(ctx, W);
  else box(ctx, 1, -H + 1, W - 2, H - 2, '#c040c0');
}

/** Room round a piece's footprint in its sprite: some poke out of it (a laptop on a desk). */
const SPRITE_PAD = 2;
const SPRITE_TOP = 16;
const GILT = hex('#e8be4a');
const sprites = new Map<string, HTMLCanvasElement | null>();

/**
 * A cheap or posh piece, drawn once and kept. Cheap is the same piece a bit faded and
 * grubby; posh has a gilt line along its top edge, so it reads at a glance.
 */
function gradedSprite(def: string, grade: Grade): HTMLCanvasElement | null {
  const k = `${def}|${grade}`;
  if (sprites.has(k)) return sprites.get(k)!;
  const d = furnitureDef(def);
  const W = d.w * TILE;
  const H = d.h * TILE;
  const c = typeof document === 'undefined' ? null : document.createElement('canvas');
  const g = c?.getContext('2d', { willReadFrequently: true });
  if (!c || !g) {
    sprites.set(k, null);
    return null;
  }
  c.width = W + SPRITE_PAD * 2;
  c.height = H + SPRITE_TOP + 1;
  g.translate(SPRITE_PAD, H + SPRITE_TOP);
  drawPiece(g, def, W, H);
  const img = g.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  const at = (x: number, y: number) => (y * c.width + x) * 4;
  if (grade === 'cheap') {
    // Faded towards grey and a shade darker.
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const grey = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
      for (let j = 0; j < 3; j++) px[i + j] = Math.round((px[i + j] + (grey - px[i + j]) * 0.45) * 0.9);
    }
  } else {
    // The top pixel of each column (anything solid enough to be the piece, not glass) turns gilt.
    for (let x = 0; x < c.width; x++) {
      for (let y = 0; y < c.height; y++) {
        const i = at(x, y);
        if (px[i + 3] < 200) continue;
        [px[i], px[i + 1], px[i + 2]] = GILT;
        break;
      }
    }
  }
  g.putImageData(img, 0, 0);
  sprites.set(k, c);
  return c;
}

/** Furniture that gives off light in the evening, and its colour. */
export const LIGHTS: Record<string, string> = { lamp: '#ffb85a', tv: '#6aa0ff', bigTv: '#6aa0ff', desk: '#8ab8ff' };

// ------------------------------------------------------------------ people

/** What the renderer knows that a pawn doesn't: are they on a seat, and the sim tick (for waving and mopping). */
export interface PoseOpts {
  seated?: boolean;
  tick?: number;
}

/**
 * A chibi person with feet at (x, y). With outlines, the silhouette is drawn first, offset a
 * pixel each way, in the outline colour.
 */
export function drawPerson(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean, opts: PoseOpts = {}): void {
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) personShape(ctx, p, x + ox, y + oy, phase, walking, PAL.outline, opts);
  personShape(ctx, p, x, y, phase, walking, null, opts);
}

/**
 * Someone lying down, head at (x, y) (its top left) facing up. With a body when they're on
 * a sofa or the floor; in bed the duvet covers it.
 */
export function drawSleeper(ctx: Ctx, p: Pawn, x: number, y: number, body: boolean, flip = false): void {
  const skin = SKIN[p.look.skin % SKIN.length];
  const hair = HAIR[p.look.hair % HAIR.length];
  const top = TOPS[p.look.top % TOPS.length];
  const legs = LEGS[p.look.legs % LEGS.length];
  const d = flip ? -1 : 1;
  const r = (rx: number, ry: number, rw: number, rh: number, c: string) => rect(ctx, d > 0 ? x + rx : x - rx - rw + 9, y + ry, rw, rh, c);
  if (body) {
    r(8, 2, 10, 6, PAL.outline);
    r(9, 3, 8, 4, top);
    r(17, 3, 9, 4, PAL.outline);
    r(18, 4, 7, 2, legs);
  }
  r(-1, -1, 11, 10, PAL.outline);
  r(0, 0, 9, 8, skin);
  r(0, 0, 3, 8, hair);
  r(5, 4, 2, 1, '#2a2020');
}

// ------------------------------------------------------------------ outfits

/** What a visitor wears for their job (a pawn's `role`), so they read from a few pixels. */
interface Outfit {
  top?: string;
  legs?: string;
  hat?: 'cap' | 'hard' | 'helmet' | 'scarf' | 'band';
  hatColour?: string;
  /** A reflective stripe across the middle, and its colour. */
  vest?: string;
  bag?: 'satchel' | 'cube';
  bagColour?: string;
  clipboard?: boolean;
  /** Small: a child's proportions. */
  kid?: boolean;
}

const OUTFITS: Record<string, Outfit> = {
  postie: { top: '#c8352b', legs: '#2b3350', hat: 'cap', hatColour: '#c8352b', bag: 'satchel', bagColour: '#7a5a3a' },
  courier: { top: '#e0782a', legs: '#2f2f35', hat: 'cap', hatColour: '#2b3a5a', vest: '#e9e6dc' },
  rider: { top: '#e9e6dc', legs: '#2f2f35', hat: 'helmet', hatColour: '#2fa39b', bag: 'cube', bagColour: '#2fa39b' },
  cleaner: { top: '#d8789a', legs: '#56606d', hat: 'scarf', hatColour: '#4f7aa8' },
  windowcleaner: { top: '#e7dccb', legs: '#e7dccb', hat: 'cap', hatColour: '#4f7aa8' },
  trade: { top: '#3f64a0', legs: '#3f64a0', hat: 'hard', hatColour: '#f2c43a' },
  meter: { top: '#56606d', legs: '#2f2f35', vest: '#d6e03a', clipboard: true },
  council: { top: '#56606d', legs: '#2f2f35', clipboard: true },
  kid: { kid: true },
  jogger: { top: '#3a9090', legs: '#2f2f35', hat: 'band', hatColour: '#e9e6dc' },
};

/** Other names a role goes by (visitors.ts and moments.ts name them as they like). */
const ROLE_ALIASES: Record<string, string> = {
  post: 'postie', sandra: 'postie',
  takeaway: 'rider', delivery: 'rider',
  lorraine: 'cleaner',
  window: 'windowcleaner', windowcleaner: 'windowcleaner',
  tradesperson: 'trade', tradie: 'trade', plumber: 'trade', electrician: 'trade', handyman: 'trade', engineer: 'trade', builder: 'trade',
  meterreader: 'meter',
  inspector: 'council', officer: 'council',
  kids: 'kid', child: 'kid',
};

export function outfitFor(role: string | undefined): Outfit {
  if (!role) return {};
  const k = role.toLowerCase().replace(/[^a-z]/g, '');
  return OUTFITS[ROLE_ALIASES[k] ?? k] ?? {};
}

/** Props that fill both hands, in front. */
const CARRIED = new Set(['parcel', 'box']);

/** The pose they're really drawn in: someone holding a box carries it, someone holding a mop mops. */
function effectivePose(p: Pawn): Pawn['pose'] {
  if (p.pose) return p.pose;
  if (p.prop && CARRIED.has(p.prop)) return 'carry';
  if (p.prop === 'mop') return 'mop';
  return undefined;
}

function personShape(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean, sil: string | null, opts: PoseOpts): void {
  const f = p.facing;
  const r = (rx: number, ry: number, rw: number, rh: number, c: string) => rect(ctx, f > 0 ? x + rx : x - rx - rw, y + ry, rw, rh, sil ?? c);
  const o = outfitFor(p.role);
  const kid = !!o.kid;
  const tick = opts.tick ?? 0;
  const skin = SKIN[p.look.skin % SKIN.length];
  const hair = HAIR[p.look.hair % HAIR.length];
  const top = p.kind === 'agent' ? '#2b3a5a' : o.top ?? TOPS[p.look.top % TOPS.length];
  const legs = o.legs ?? LEGS[p.look.legs % LEGS.length];
  const pose = effectivePose(p);
  const dancing = pose === 'dance';
  const stride = walking || dancing ? (phase < 0.5 ? 1 : -1) : 0;
  const bob = dancing ? (phase % 0.5 < 0.25 ? -2 : 0) : walking && phase % 0.5 < 0.25 ? -1 : 0;
  const sitting = pose === 'sit' || (!!opts.seated && (pose === 'read' || pose === 'phone'));
  const legH = kid ? 3 : 4;
  const bodyH = kid ? 5 : 7;
  const bx = kid ? -3 : -4;
  const bw = kid ? 6 : 8;
  const by = -(legH + bodyH) - (sitting ? 4 : 0) + bob;
  // Behind them: a rider's box, a postie's satchel.
  if (o.bag === 'cube') {
    r(-10, by - 2, 8, 8, o.bagColour!);
    r(-10, by - 2, 8, 1, light(o.bagColour!, 0.3));
    r(-8, by + 1, 3, 2, '#efe7da');
  } else if (o.bag === 'satchel') {
    r(-7, by + 3, 4, 5, o.bagColour!);
    r(-7, by + 3, 4, 1, light(o.bagColour!, 0.3));
    r(-4, by, 1, 3, dark(o.bagColour!, 0.2));
  }
  if (sitting) {
    // On a seat: thighs forward, shins down.
    r(-1, -8, 6, 3, legs);
    r(4, -5, 2, 5, legs);
  } else {
    r(-3 + stride, -legH, 2, legH, legs);
    r(1 - stride, -legH, 2, legH, legs);
  }
  r(bx, by, bw, bodyH, top);
  if (o.vest) r(bx, by + (kid ? 2 : 3), bw, 1, o.vest);
  // Arms. Hands forward for reading, carrying and mopping; one up to wave or to the ear.
  const forward = pose === 'read' || pose === 'carry' || pose === 'mop';
  if (dancing) {
    // One arm in the air, then the other.
    const up = phase < 0.5;
    r(-5, up ? by - 3 : by + 1, 1, 4, top);
    r(4, up ? by + 1 : by - 3, 1, 4, top);
    r(-5, up ? by - 4 : by + 5, 1, 1, skin);
    r(4, up ? by + 5 : by - 4, 1, 1, skin);
  } else {
    if (!forward) {
      r(-5, by + 1, 1, 4, top);
      r(-5, by + 5, 1, 1, skin);
    }
    if (pose === 'wave') {
      // Front arm straight up, the hand going side to side.
      const side = Math.floor(tick / 12) % 2;
      r(4, by, 2, 1, top);
      r(5, by - 7, 1, 7, top);
      r(5 + side, by - 9, 2, 2, skin);
    } else if (pose === 'phone') {
      // Hand to the ear, a phone against the head.
      const hyP = by - 10;
      r(4, hyP + 9, 1, by + 4 - (hyP + 9), top);
      r(4, hyP + 7, 2, 2, skin);
      r(5, hyP + 4, 2, 4, '#2e3138');
    } else if (forward) {
      r(4, by + 3, 2, 1, top);
      r(6, by + 3, 1, 1, skin);
    } else {
      r(4, by + 1, 1, 4, top);
      r(4, by + 5, 1, 1, skin);
    }
  }
  if (p.kind === 'agent' || o.clipboard) {
    r(-1, by, 2, 4, '#efe7da');
    r(4, by + 3, 3, 4, '#6b4a32'); // clipboard
    if (o.clipboard) r(5, by + 4, 1, 2, '#efe7da');
  }
  const hh = kid ? 8 : 10;
  const hx = kid ? -4 : -5;
  const hy = by - hh;
  r(hx, hy, hh, hh, skin);
  r(hx, hy - 1, hh, 4, hair);
  r(hx - 1, hy, 2, 6, hair);
  r(hx, hy + 3, 2, 3, hair);
  if (!sil) {
    const ey = pose === 'read' ? 1 : 0;
    if (kid) {
      r(0, hy + 3 + ey, 1, 2, '#2a2020');
      r(2, hy + 3 + ey, 1, 2, '#2a2020');
      r(1, hy + 6, 2, 1, mix(skin, '#c9583f', 0.35));
      r(-1, hy + 5, 1, 1, mix(skin, '#e07a7a', 0.4));
    } else {
      r(1, hy + 4 + ey, 1, 2, '#2a2020');
      r(3, hy + 4 + ey, 1, 2, '#2a2020');
      r(2, hy + 7, 2, 1, mix(skin, '#c9583f', 0.35));
      r(-1, hy + 6, 1, 1, mix(skin, '#e07a7a', 0.4));
    }
  }
  // Hats.
  const hc = o.hatColour ?? '#c9583f';
  if (o.hat === 'cap') {
    r(hx, hy - 2, hh, 4, hc);
    r(hx, hy - 2, hh, 1, light(hc, 0.2));
    r(hh / 2 - 1, hy + 1, 3, 1, dark(hc, 0.25));
  } else if (o.hat === 'hard') {
    r(hx, hy - 3, hh, 4, hc);
    r(-1, hy - 4, 2, 1, hc);
    r(hx, hy - 3, hh, 1, light(hc, 0.25));
    r(hx - 1, hy + 1, hh + 2, 1, dark(hc, 0.2));
  } else if (o.hat === 'helmet') {
    r(hx - 1, hy - 2, hh + 2, 6, hc);
    r(hx - 1, hy - 2, hh + 2, 1, light(hc, 0.3));
    r(3, hy + 2, 3, 2, '#2e3138');
  } else if (o.hat === 'scarf') {
    r(hx - 1, hy - 1, hh + 2, 4, hc);
    r(hx - 1, hy, 3, 7, hc);
  } else if (o.hat === 'band') {
    r(hx, hy + 1, hh, 2, hc);
  }
  // A book, if they're reading and it isn't the paper.
  if (pose === 'read' && p.prop !== 'paper') {
    r(4, by + 1, 5, 6, '#4f7aa8');
    r(4, by + 1, 1, 6, dark('#4f7aa8', 0.25));
    r(5, by + 2, 3, 4, '#efe7da');
    r(6, by + 3, 2, 1, '#9aa0a6');
  }
  // In the hand.
  if (p.prop) propShape(r, p.prop, { by, pose, tick, sitting, sil: sil !== null });
}

// ------------------------------------------------------------------ props

type R = (rx: number, ry: number, rw: number, rh: number, c: string) => void;

interface PropCtx {
  by: number;
  pose: Pawn['pose'];
  tick: number;
  sitting: boolean;
  sil: boolean;
}

/** What someone holds (Pawn.prop), drawn in the hand the pose puts forward. Unknown names draw nothing. */
function propShape(r: R, prop: string, c: PropCtx): void {
  const by = c.by;
  const tan = '#c99a62';
  switch (prop) {
    case 'parcel':
      r(4, by + 2, 6, 6, tan);
      r(4, by + 2, 6, 1, light(tan, 0.3));
      r(6, by + 2, 2, 6, '#e8c070');
      r(4, by + 7, 6, 1, dark(tan, 0.2));
      break;
    case 'box':
      r(3, by - 1, 8, 8, '#b98a58');
      r(3, by - 1, 8, 1, light('#b98a58', 0.3));
      r(6, by - 1, 2, 3, '#e8c070');
      r(3, by + 6, 8, 1, dark('#b98a58', 0.2));
      r(8, by + 3, 2, 2, '#efe7da');
      break;
    case 'bucket':
      r(5, -5, 5, 5, '#8aa0b8');
      r(5, -5, 5, 1, light('#8aa0b8', 0.35));
      r(9, -4, 1, 4, dark('#8aa0b8', 0.2));
      r(5, -7, 5, 1, '#4a4f57');
      r(5, -6, 1, 1, '#4a4f57');
      r(9, -6, 1, 1, '#4a4f57');
      break;
    case 'toolbox':
      r(5, -5, 7, 5, '#c9402f');
      r(5, -5, 7, 1, light('#c9402f', 0.3));
      r(5, -2, 7, 1, dark('#c9402f', 0.25));
      r(7, -7, 3, 1, '#2e3138');
      r(7, -6, 1, 1, '#2e3138');
      r(9, -6, 1, 1, '#2e3138');
      r(8, -4, 1, 1, '#e8c070');
      break;
    case 'ladder': {
      const wood = '#c9a060';
      r(6, -26, 1, 26, wood);
      r(11, -26, 1, 26, wood);
      for (let yy = -24; yy < 0; yy += 4) r(7, yy, 4, 1, dark(wood, 0.15));
      break;
    }
    case 'paper':
      if (c.pose === 'read') {
        r(4, by - 1, 6, 9, '#e8e2d4');
        r(4, by - 1, 1, 9, dark('#e8e2d4', 0.2));
        r(5, by + 1, 4, 1, '#56606d');
        r(5, by + 3, 4, 1, '#9aa0a6');
        r(5, by + 5, 3, 1, '#9aa0a6');
      } else {
        r(4, by + 3, 3, 5, '#e8e2d4');
        r(4, by + 4, 3, 1, '#9aa0a6');
      }
      break;
    case 'mop': {
      const sway = [0, 1, 2, 1][Math.floor(c.tick / 14) % 4];
      r(6 + (sway >> 1), by - 1, 1, -by - 2 - 0, '#9b6a42');
      r(4 + sway, -3, 6, 3, '#d8d0c0');
      r(4 + sway, -1, 6, 1, '#b0a898');
      break;
    }
    case 'post':
      r(5, by + 3, 5, 4, '#fbf7ef');
      r(5, by + 3, 5, 1, '#c8352b');
      r(6, by + 5, 3, 1, '#9aa0a6');
      r(5, by + 6, 5, 1, dark('#fbf7ef', 0.2));
      break;
    case 'bag':
      r(5, -8, 5, 7, '#4f944a');
      r(5, -8, 5, 1, light('#4f944a', 0.3));
      r(6, -10, 1, 2, '#2e3138');
      r(8, -10, 1, 2, '#2e3138');
      break;
    case 'ball': {
      const hop = Math.abs(Math.floor(c.tick / 6) % 8 - 4) - 2;
      const by2 = -4 - Math.max(0, hop);
      r(6, by2, 4, 4, '#efe7da');
      r(7, by2, 2, 1, '#efe7da');
      r(7, by2 + 1, 1, 1, '#2e3138');
      r(9, by2 + 3, 1, 1, dark('#efe7da', 0.25));
      break;
    }
    case 'pram':
      r(5, -13, 7, 5, '#3a4a6a'); // hood
      r(5, -9, 11, 5, '#4f7aa8');
      r(5, -9, 11, 1, light('#4f7aa8', 0.3));
      r(3, by + 3, 3, 1, '#2e3138'); // handle
      r(4, by + 3, 1, -by - 11, '#2e3138');
      r(6, -4, 3, 4, '#2e3138');
      r(13, -4, 3, 4, '#2e3138');
      break;
    case 'dog': {
      // On a lead, a little ahead.
      r(5, by + 5, 7, 1, '#8a2a2a');
      r(12, by + 5, 1, -by - 12, '#8a2a2a');
      critter((rx, ry, w, h, col) => r(rx + 13, ry, w, h, col), 'dog', ['#b98050', '#8a5a34'], 0, false, c.pose, c.tick);
      break;
    }
    default:
  }
}

// ------------------------------------------------------------------ animals

type Species = 'cat' | 'dog' | 'fox';
const CAT_COATS: [string, string][] = [['#d98a3a', '#a8601f'], ['#7c7c85', '#55555e'], ['#2f2d33', '#1c1b1f'], ['#e9e0d0', '#b9a98f']];
const DOG_COATS: [string, string][] = [['#b98050', '#8a5a34'], ['#3a3a40', '#222226'], ['#d9c9a5', '#a89773']];
const FOX_COAT: [string, string] = ['#c8642a', '#8a3f18'];
const CREAM = '#f1e6d4';
const EYE = '#2a2020';

/** Which animal a pawn is, from its role ('cat', 'dog', 'fox'; anything else is a cat). */
export function speciesOf(role: string | undefined): Species {
  const k = (role ?? '').toLowerCase();
  return k.includes('fox') ? 'fox' : k.includes('dog') ? 'dog' : 'cat';
}

/** How tall an animal is drawn, for tapping. */
export const ANIMAL_H: Record<Species, number> = { cat: 12, dog: 13, fox: 14 };

/**
 * An animal with its feet at (x, y), drawn the way people are: the silhouette first, in the
 * outline colour, then the animal itself. The pose is `sit` or `sleep`, else it stands or walks.
 */
export function drawAnimal(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean, tick = 0): void {
  const sp = speciesOf(p.role);
  const coat = sp === 'fox' ? FOX_COAT : sp === 'dog' ? DOG_COATS[p.look.top % DOG_COATS.length] : CAT_COATS[p.look.top % CAT_COATS.length];
  const go = (ox: number, oy: number, sil: string | null) => {
    const r: R = (rx, ry, rw, rh, c) => rect(ctx, p.facing > 0 ? x + ox + rx : x + ox - rx - rw, y + oy + ry, rw, rh, sil ?? c);
    critter(r, sp, coat, phase, walking, p.pose, tick);
  };
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) go(ox, oy, PAL.outline);
  go(0, 0, null);
}

/** Draws an animal facing right with its feet at (0, 0); `r` places and mirrors the pixels. */
function critter(r: R, sp: Species, [coat, shade]: [string, string], phase: number, walking: boolean, pose: Pawn['pose'], tick: number): void {
  const stride = walking ? (phase < 0.5 ? 1 : -1) : 0;
  const sway = Math.floor(tick / 20) % 2;
  if (pose === 'sleep') {
    // Curled up: a loaf with the head tucked in and the tail round.
    r(-6, -5, 12, 5, coat);
    r(-6, -5, 12, 1, light(coat, 0.2));
    r(-6, -2, 12, 2, shade);
    r(3, -5, 5, 4, coat);
    if (sp !== 'cat') r(7, -3, 3, 2, shade);
    r(3, -7, 1, 2, coat);
    r(6, -7, 1, 2, coat);
    r(5, -3, 2, 1, EYE);
    r(-8, -3, 3, 3, shade);
    return;
  }
  if (sp === 'cat') {
    if (pose === 'sit') {
      r(-4, -8, 8, 8, coat);
      r(-4, -8, 8, 1, light(coat, 0.2));
      r(2, -6, 2, 6, light(coat, 0.15));
      r(-4, -3, 8, 3, shade);
      r(2, -14, 6, 6, coat);
      r(2, -16, 2, 2, coat);
      r(6, -16, 2, 2, coat);
      r(6, -12, 1, 1, EYE);
      r(7, -10, 1, 1, '#d98a8a');
      r(-7, -2, 4, 2, shade);
      r(-8, -4 - sway, 2, 3, shade);
      return;
    }
    r(-7 + stride, -3, 2, 3, shade);
    r(-4 - stride, -3, 2, 3, shade);
    r(2 + stride, -3, 2, 3, shade);
    r(5 - stride, -3, 2, 3, shade);
    r(-7, -7, 13, 5, coat);
    r(-7, -7, 13, 1, light(coat, 0.2));
    r(-7, -3, 13, 1, shade);
    r(-5, -7, 1, 2, shade);
    r(-2, -7, 1, 2, shade);
    r(1, -7, 1, 2, shade);
    r(5, -10, 6, 6, coat);
    r(5, -12, 2, 2, coat);
    r(9, -12, 2, 2, coat);
    r(9, -9, 1, 1, EYE);
    r(10, -7, 1, 1, '#d98a8a');
    r(-9, -12 + sway, 2, 6, coat);
    r(-8, -13 + sway, 1, 1, coat);
    return;
  }
  if (sp === 'dog') {
    r(-7 + stride, -3, 2, 3, shade);
    r(-4 - stride, -3, 2, 3, shade);
    r(2 + stride, -3, 2, 3, shade);
    r(5 - stride, -3, 2, 3, shade);
    r(-8, -9, 14, 6, coat);
    r(-8, -9, 14, 1, light(coat, 0.2));
    r(-8, -4, 14, 1, shade);
    r(5, -13, 7, 6, coat);
    r(10, -10, 3, 3, light(coat, 0.25));
    r(12, -10, 1, 1, EYE);
    r(5, -13, 2, 5, shade);
    r(9, -11, 1, 1, EYE);
    r(-10, -12 + sway, 2, 5, coat);
    return;
  }
  // A fox: long and low, a brush of a tail with a white tip, black socks.
  r(-8 + stride, -3, 2, 3, '#2a2224');
  r(-4 - stride, -3, 2, 3, '#2a2224');
  r(2 + stride, -3, 2, 3, '#2a2224');
  r(5 - stride, -3, 2, 3, '#2a2224');
  r(-8, -8, 14, 5, coat);
  r(-8, -8, 14, 1, light(coat, 0.2));
  r(-8, -4, 14, 1, shade);
  r(5, -7, 3, 3, CREAM);
  r(6, -11, 6, 5, coat);
  r(11, -9, 3, 2, coat);
  r(13, -9, 1, 1, '#2a2224');
  r(6, -14, 2, 3, coat);
  r(10, -14, 2, 3, coat);
  r(6, -14, 2, 1, '#2a2224');
  r(10, -14, 2, 1, '#2a2224');
  r(10, -10, 1, 1, EYE);
  r(-17, -9 + sway, 9, 4, coat);
  r(-17, -9 + sway, 9, 1, light(coat, 0.15));
  r(-17, -9 + sway, 3, 4, CREAM);
}

/** How tall a pawn is drawn, in world pixels (for tapping and name tags). */
export function pawnHeight(p: Pawn): number {
  if (p.kind === 'animal') return ANIMAL_H[speciesOf(p.role)] + 2;
  return outfitFor(p.role).kid ? 19 : PERSON_H;
}

/** How tall a person is drawn, in world pixels (for tapping and name tags). */
export const PERSON_H = 23;

/** A head-and-shoulders portrait, for panels and the tenant bar. */
export function portrait(p: Pick<Pawn, 'look' | 'kind'>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 18;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  rect(ctx, 0, 0, 16, 18, '#d9ccb6');
  drawPerson(ctx, { ...p, facing: 1 } as Pawn, 8, 25, 0, false);
  return c;
}

// ------------------------------------------------------------------ icons

/**
 * 8x8 pixel icons, drawn like the tab icons but in colour (a bubble's `icon`). Letters pick
 * the colour: k ink, W white, r red, y gold, t tan, b blue, l light blue, g green, s steel.
 */
const ICON_INK: Record<string, string> = {
  k: PAL.outline,
  W: '#ffffff',
  r: '#d0452f',
  R: '#a02e22',
  y: '#d9a21e',
  t: '#c99a62',
  b: '#4f7aa8',
  l: '#bfe3f0',
  g: '#4f944a',
  s: '#7d848c',
};

const ICON_GRIDS: Record<string, string[]> = {
  music: ['....kkk.', '....k..k', '....k...', '....k...', '..kkk...', '.kkkk...', '.kkkk...', '..kk....'],
  cup: ['...s.s..', '..s.s...', 'kkkkkk..', 'krrrrkkk', 'krrrrk.k', 'krrrrkkk', '.krrrk..', '..kkkk..'],
  envelope: ['........', 'kkkkkkkk', 'kkWWWWkk', 'kWkWWkWk', 'kWWkkWWk', 'kWWWWWWk', 'kkkkkkkk', '........'],
  box: ['........', 'kkkkkkkk', 'kttyyttk', 'kttyyttk', 'kttttttk', 'kttttttk', 'kkkkkkkk', '........'],
  phone: ['..kkkk..', 'k.kllk.k', '..kllk..', 'k.kllk.k', '..kllk..', '..kllk..', '..kkkk..', '........'],
  zz: ['.bbbbb..', '....bb..', '...bb...', '..bb....', '.bbbbb..', '....bbbb', '.....bb.', '....bbbb'],
  question: ['..bbbb..', '.bb..bb.', '.....bb.', '....bb..', '...bb...', '...bb...', '........', '...bb...'],
  pound: ['..yyy...', '.yy.yy..', '.yy.....', 'yyyyy...', '.yy.....', '.yy.....', 'yyyyyyy.', '........'],
  heart: ['........', '.rr..rr.', 'rWrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..', '...rr...'],
  fork: ['.s.s.s..', '.s.s.s..', '.sssss..', '..sss...', '...s....', '...s....', '...s....', '...s....'],
  spanner: ['...ss.ss', '...ssss.', '...sss..', '..sss...', '.sss....', 'sss.....', 'ss......', '........'],
  paw: ['.kk..kk.', '.kk..kk.', 'kk....kk', 'kk....kk', '..kkkk..', '.kkkkkk.', '.kkkkkk.', '..kkkk..'],
  van: ['........', 'kkkkkkk.', 'kWWWWWkk', 'kWWWWWkb', 'kWWWWWkb', 'kkkkkkkk', '.kk..kk.', '........'],
  bins: ['.kkkkkk.', 'kggggggk', 'kkkkkkkk', '.kggggk.', '.kggggk.', '.kggggk.', '.kggggk.', '..kkkk..'],
  water: ['...k....', '...kk...', '..klbk..', '..kbbk..', '.klbbbk.', '.kbbbbk.', '..kbbk..', '...kk...'],
  bang: ['..rr....', '..rr....', '..rr....', '..rr....', '..rr....', '........', '..rr....', '..rr....'],
  // layout L5: who lives where
  pram: ['....kkk.', '...kbbbk', 'kkkkbbbk', 'kbbbbbbk', 'kbbbbbbk', '.kkkkkk.', '.k....k.', 'kkk..kkk'],
  stairs: ['......kk', '......kk', '....kkkk', '....kkkk', '..kkkkkk', '..kkkkkk', 'kkkkkkkk', 'kkkkkkkk'],
};

/** Other names the sim, the cards and the moments use for the same icon. */
const ICON_ALIASES: Record<string, string> = {
  note: 'music', song: 'music', '♪': 'music',
  tea: 'cup', kettle: 'cup', coffee: 'cup', mug: 'cup',
  post: 'envelope', letter: 'envelope', mail: 'envelope',
  parcel: 'box',
  call: 'phone',
  sleep: 'zz', z: 'zz', zzz: 'zz',
  '?': 'question',
  '£': 'pound', moan: 'pound', money: 'pound',
  love: 'heart', '♥': 'heart',
  eat: 'fork', food: 'fork',
  mend: 'spanner', fix: 'spanner', repair: 'spanner',
  cat: 'paw', pet: 'paw', dog: 'paw', fox: 'paw',
  bin: 'bins', leak: 'water', drip: 'water',
  '!': 'bang',
};

/** The name of the icon a bubble's `icon` means, or null if there's no such picture (the text shows instead). */
export function iconName(name: string | undefined): string | null {
  if (!name) return null;
  if (ICON_GRIDS[name]) return name;
  const a = ICON_ALIASES[name] ?? ICON_ALIASES[name.toLowerCase()];
  return a && ICON_GRIDS[a] ? a : null;
}

/** Every icon's name. */
export const ICON_NAMES = Object.keys(ICON_GRIDS);

/** An icon with its top-left corner at (x, y), each pixel k by k. */
export function drawIcon(ctx: Ctx, name: string, x: number, y: number, k = 1): void {
  const grid = ICON_GRIDS[iconName(name) ?? ''];
  if (!grid) return;
  grid.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = ICON_INK[row[i]];
      if (c) rect(ctx, x + i * k, y + j * k, k, k, c);
    }
  });
}
