// The art, in the "Lamplight" style: warm colours, dark brown outlines and dithered
// shading, drawn in world pixels (16 to a tile) and scaled up without smoothing.

import { furnitureDef } from '../sim/defs';
import type { Pawn } from '../sim/state';
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

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A block with a dark outline, a highlight along the top and dithered shade at the bottom. */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  if (w <= 2 || h <= 2) {
    rect(ctx, x, y, w, h, c);
    return;
  }
  rect(ctx, x, y, w, h, PAL.outline);
  const ix = x + 1;
  const iy = y + 1;
  const iw = w - 2;
  const ih = h - 2;
  rect(ctx, ix, iy, iw, ih, c);
  if (iw < 2 || ih < 2) return;
  rect(ctx, ix, iy, iw, 1, light(c, 0.22));
  const d = dark(c, 0.2);
  for (let yy = iy + ih - 2; yy < iy + ih; yy++) {
    for (let xx = ix + ((yy - iy) % 2); xx < ix + iw; xx += 2) rect(ctx, xx, yy, 1, 1, d);
  }
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

/** Draws a piece of furniture whose footprint's top-left is (x, y) in world pixels. */
export function drawFurniture(ctx: Ctx, def: string, x: number, y: number, flip = false): void {
  const d = furnitureDef(def);
  const W = d.w * TILE;
  const H = d.h * TILE;
  ctx.save();
  ctx.translate(x, y + H);
  if (flip) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const draw = PIECES[def];
  if (draw) draw(ctx, W);
  else box(ctx, 1, -H + 1, W - 2, H - 2, '#c040c0');
  ctx.restore();
}

/** Furniture that gives off light in the evening, and its colour. */
export const LIGHTS: Record<string, string> = { lamp: '#ffb85a', tv: '#6aa0ff', desk: '#8ab8ff' };

// ------------------------------------------------------------------ people

/**
 * A chibi person with feet at (x, y). With outlines, the silhouette is drawn first, offset a
 * pixel each way, in the outline colour.
 */
export function drawPerson(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean): void {
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) personShape(ctx, p, x + ox, y + oy, phase, walking, PAL.outline);
  personShape(ctx, p, x, y, phase, walking, null);
}

function personShape(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean, sil: string | null): void {
  const f = p.facing;
  const r = (rx: number, ry: number, rw: number, rh: number, c: string) => rect(ctx, f > 0 ? x + rx : x - rx - rw, y + ry, rw, rh, sil ?? c);
  const skin = SKIN[p.look.skin % SKIN.length];
  const hair = HAIR[p.look.hair % HAIR.length];
  const top = p.kind === 'agent' ? '#2b3a5a' : TOPS[p.look.top % TOPS.length];
  const legs = LEGS[p.look.legs % LEGS.length];
  const stride = walking ? (phase < 0.5 ? 1 : -1) : 0;
  const bob = walking && phase % 0.5 < 0.25 ? -1 : 0;
  r(-3 + stride, -4, 2, 4, legs);
  r(1 - stride, -4, 2, 4, legs);
  const by = -11 + bob;
  r(-4, by, 8, 7, top);
  r(-5, by + 1, 1, 4, top);
  r(4, by + 1, 1, 4, top);
  r(-5, by + 5, 1, 1, skin);
  r(4, by + 5, 1, 1, skin);
  if (p.kind === 'agent') {
    r(-1, by, 2, 4, '#efe7da');
    r(4, by + 3, 3, 4, '#6b4a32'); // clipboard
  }
  const hy = by - 10;
  r(-5, hy, 10, 10, skin);
  r(-5, hy - 1, 10, 4, hair);
  r(-6, hy, 2, 6, hair);
  r(-5, hy + 3, 2, 3, hair);
  if (!sil) {
    r(1, hy + 4, 1, 2, '#2a2020');
    r(3, hy + 4, 1, 2, '#2a2020');
    r(2, hy + 7, 2, 1, mix(skin, '#c9583f', 0.35));
    r(-1, hy + 6, 1, 1, mix(skin, '#e07a7a', 0.4));
  }
}

/** How tall a person is drawn, in world pixels (for tapping and name tags). */
export const PERSON_H = 23;
