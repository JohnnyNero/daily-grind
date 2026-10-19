// Placeholder pixel art, drawn in world pixels (16 to a tile) and scaled up without
// smoothing. Everything here is plain rectangles so it stays crisp at any zoom.

import { furnitureDef } from '../sim/defs';
import type { Pawn } from '../sim/state';
import { TILE } from '../sim/state';

type Ctx = CanvasRenderingContext2D;

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ------------------------------------------------------------------ furniture

/**
 * Draws a piece of furniture whose footprint's top-left is (x, y) in world pixels.
 * Each drawing works in a box W x H with the floor at the bottom.
 */
export function drawFurniture(ctx: Ctx, def: string, x: number, y: number, flip = false): void {
  const d = furnitureDef(def);
  const W = d.w * TILE;
  const H = d.h * TILE;
  ctx.save();
  ctx.translate(x, y);
  if (flip) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const r = (rx: number, ry: number, rw: number, rh: number, c: string) => rect(ctx, rx, ry, rw, rh, c);
  // Coordinates below are from the bottom (B) so pieces sit on the floor.
  const B = H;
  switch (def) {
    case 'bed':
    case 'doubleBed': {
      r(0, B - 12, 3, 12, '#6b4a32'); // headboard
      r(1, B - 13, 2, 1, '#7d5a3e');
      r(3, B - 6, W - 4, 4, '#7d5a3e'); // frame
      r(3, B - 9, W - 4, 3, '#e9e2d4'); // mattress
      r(4, B - 11, 6, 3, '#f6f2ea'); // pillow
      r(11, B - 10, W - 12, 4, def === 'bed' ? '#5d7fa6' : '#a65d5d'); // duvet
      r(11, B - 10, W - 12, 1, def === 'bed' ? '#7598c0' : '#c07575');
      r(W - 2, B - 8, 2, 8, '#6b4a32'); // footboard
      r(3, B - 2, 2, 2, '#4b3424');
      r(W - 6, B - 2, 2, 2, '#4b3424');
      break;
    }
    case 'wardrobe':
      r(1, B - H + 1, W - 2, H - 2, '#8a6242');
      r(2, B - H + 2, W / 2 - 3, H - 5, '#9b7150');
      r(W / 2 + 1, B - H + 2, W / 2 - 3, H - 5, '#9b7150');
      r(W / 2 - 2, B - H / 2 - 2, 1, 4, '#d8b25a');
      r(W / 2 + 1, B - H / 2 - 2, 1, 4, '#d8b25a');
      r(2, B - 2, 2, 2, '#4b3424');
      r(W - 4, B - 2, 2, 2, '#4b3424');
      break;
    case 'drawers':
      r(2, B - 12, 12, 11, '#8a6242');
      for (let i = 0; i < 3; i++) {
        r(3, B - 11 + i * 3.5, 10, 3, '#9b7150');
        r(7, B - 10 + i * 3.5, 2, 1, '#d8b25a');
      }
      r(3, B - 1, 2, 1, '#4b3424');
      r(11, B - 1, 2, 1, '#4b3424');
      break;
    case 'sofa':
      r(1, B - 11, W - 2, 6, '#5b7a63'); // back
      r(0, B - 8, 4, 6, '#4e6a55'); // arms
      r(W - 4, B - 8, 4, 6, '#4e6a55');
      r(3, B - 6, W - 6, 3, '#6b8c73'); // seat
      for (let i = 1; i < 3; i++) r((W * i) / 3, B - 10, 1, 4, '#4e6a55');
      r(2, B - 2, 2, 2, '#3a2a1e');
      r(W - 4, B - 2, 2, 2, '#3a2a1e');
      break;
    case 'armchair':
      r(2, B - 12, 12, 6, '#a0705a');
      r(1, B - 8, 3, 6, '#8c604c');
      r(12, B - 8, 3, 6, '#8c604c');
      r(4, B - 6, 8, 3, '#b07e66');
      r(2, B - 2, 2, 2, '#3a2a1e');
      r(12, B - 2, 2, 2, '#3a2a1e');
      break;
    case 'table':
      r(1, B - 9, W - 2, 2, '#9b7150');
      r(3, B - 7, 2, 7, '#7d5a3e');
      r(W - 5, B - 7, 2, 7, '#7d5a3e');
      r(8, B - 11, 3, 2, '#e8e0d0'); // a mug
      break;
    case 'chair':
      r(3, B - 14, 2, 14, '#7d5a3e');
      r(3, B - 7, 10, 2, '#9b7150');
      r(11, B - 5, 2, 5, '#7d5a3e');
      break;
    case 'desk':
      r(1, B - 9, W - 2, 2, '#8a6242');
      r(2, B - 7, 2, 7, '#6b4a32');
      r(W - 12, B - 7, 10, 7, '#7d5a3e');
      r(W - 8, B - 5, 2, 1, '#d8b25a');
      r(6, B - 16, 9, 6, '#2c2f36'); // laptop
      r(7, B - 15, 7, 4, '#6fa3c7');
      r(5, B - 10, 11, 1, '#4a4e57');
      break;
    case 'tv':
      r(2, B - 6, W - 4, 6, '#6b4a32');
      r(4, B - 5, W - 8, 2, '#7d5a3e');
      r(5, B - 16, W - 10, 10, '#1e2026');
      r(6, B - 15, W - 12, 8, '#36507a');
      r(7, B - 14, 4, 2, '#5d7fb0');
      break;
    case 'counter':
    case 'sink':
    case 'cooker': {
      const body = def === 'cooker' ? '#d9d6cf' : '#c8b394';
      r(0, B - 12, 16, 12, body);
      r(0, B - 13, 16, 2, def === 'cooker' ? '#3a3a3a' : '#8a7a62');
      if (def === 'cooker') {
        r(2, B - 10, 12, 8, '#3a3a3a');
        r(3, B - 9, 10, 6, '#5a4a3a');
        r(2, B - 14, 4, 1, '#222');
        r(10, B - 14, 4, 1, '#222');
      } else {
        r(2, B - 10, 5, 8, '#b39d7d');
        r(9, B - 10, 5, 8, '#b39d7d');
        r(6, B - 7, 1, 2, '#e0d4bf');
        r(9, B - 7, 1, 2, '#e0d4bf');
      }
      if (def === 'sink') {
        r(3, B - 13, 10, 2, '#9aa3ab');
        r(7, B - 17, 2, 4, '#b8c0c6');
        r(7, B - 17, 4, 1, '#b8c0c6');
      }
      break;
    }
    case 'fridge':
      r(1, B - H + 2, 14, H - 2, '#e6e8e8');
      r(1, B - H + 13, 14, 1, '#b9bfc2');
      r(12, B - H + 5, 1, 5, '#9aa3ab');
      r(12, B - H + 16, 1, 6, '#9aa3ab');
      r(4, B - H + 4, 3, 3, '#e86a5a'); // a magnet
      break;
    case 'toilet':
      r(8, B - 15, 6, 8, '#eef0f0');
      r(3, B - 8, 11, 3, '#e3e6e6');
      r(5, B - 5, 7, 5, '#eef0f0');
      r(3, B - 9, 9, 1, '#c9cfd1');
      break;
    case 'basin':
      r(2, B - 12, 12, 3, '#eef0f0');
      r(6, B - 9, 4, 9, '#e3e6e6');
      r(7, B - 15, 2, 3, '#b8c0c6');
      break;
    case 'shower':
      r(1, B - H + 2, 14, H - 2, '#bcd6df55');
      r(1, B - H + 2, 1, H - 2, '#c6ccd0');
      r(14, B - H + 2, 1, H - 2, '#c6ccd0');
      r(1, B - 2, 14, 2, '#d7dcdf');
      r(4, B - H + 3, 6, 2, '#9aa3ab');
      r(9, B - H + 2, 1, 4, '#9aa3ab');
      for (let i = 0; i < 3; i++) r(5 + i * 2, B - H + 7 + i * 3, 1, 3, '#8fc2dd');
      break;
    case 'bath':
      r(1, B - 10, W - 2, 8, '#eef0f0');
      r(2, B - 9, W - 4, 2, '#bfe0ec');
      r(3, B - 2, 2, 2, '#b8c0c6');
      r(W - 5, B - 2, 2, 2, '#b8c0c6');
      r(W - 5, B - 14, 2, 4, '#b8c0c6');
      break;
    case 'radiator':
      r(1, B - 11, 14, 8, '#e3e6e6');
      for (let i = 0; i < 5; i++) r(2 + i * 3, B - 11, 1, 8, '#c4c9cb');
      r(2, B - 3, 2, 3, '#b8c0c6');
      r(12, B - 3, 2, 3, '#b8c0c6');
      break;
    case 'lamp':
      r(7, B - 22, 2, 21, '#3a3a3a');
      r(4, B - 2, 8, 2, '#3a3a3a');
      r(3, B - 29, 10, 7, '#f0d9a0');
      r(4, B - 28, 8, 5, '#f7e6b8');
      break;
    case 'plant':
      r(4, B - 6, 8, 6, '#b5653f');
      r(4, B - 6, 8, 1, '#c97a52');
      r(7, B - 12, 2, 6, '#3f7a3f');
      r(3, B - 13, 5, 3, '#4f944a');
      r(8, B - 15, 5, 4, '#5aa354');
      r(6, B - 16, 3, 3, '#4f944a');
      break;
    case 'bins':
      for (const bx of [1, 17]) {
        r(bx, B - 14, 13, 13, bx === 1 ? '#2f4b3a' : '#3a3f4b');
        r(bx - 1, B - 15, 15, 2, bx === 1 ? '#253b2e' : '#2e323c');
        r(bx + 2, B - 2, 3, 2, '#222');
        r(bx + 9, B - 2, 3, 2, '#222');
      }
      break;
    case 'shelf':
      r(1, B - 4, W - 2, 2, '#8a6242');
      r(3, B - 12, 3, 8, '#b5543f');
      r(6, B - 11, 3, 7, '#3f6fb5');
      r(9, B - 10, 2, 6, '#d8b25a');
      r(W - 9, B - 9, 6, 5, '#5aa354');
      break;
    case 'cupboard':
      r(1, B - 15, 14, 13, '#c8b394');
      r(2, B - 14, 6, 11, '#b39d7d');
      r(9, B - 14, 5, 11, '#b39d7d');
      r(7, B - 6, 1, 2, '#e0d4bf');
      r(9, B - 6, 1, 2, '#e0d4bf');
      break;
    case 'picture':
      r(2, B - 13, 12, 10, '#6b4a32');
      r(3, B - 12, 10, 8, '#9fc4d6');
      r(3, B - 7, 10, 3, '#6fa36a');
      r(9, B - 11, 2, 2, '#f2d27a');
      break;
    case 'mirror':
      r(4, B - 14, 8, 12, '#b8c0c6');
      r(5, B - 13, 6, 10, '#d6eaf2');
      r(6, B - 12, 1, 4, '#ffffff');
      break;
    case 'clock':
      r(4, B - 13, 8, 8, '#3a3a3a');
      r(5, B - 12, 6, 6, '#f4efe4');
      r(7, B - 11, 1, 3, '#222');
      r(7, B - 9, 3, 1, '#222');
      break;
    default:
      r(1, 1, W - 2, H - 2, '#c040c0');
  }
  ctx.restore();
}

// ------------------------------------------------------------------ people

const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86b47', '#7d4d31', '#5a3825'];
const HAIR = ['#2b1d16', '#4a3020', '#7a4b2a', '#b0793f', '#d8b36a', '#8a8a8a', '#1a1a1a', '#a2412e'];
const TOP = ['#c8483a', '#3f6fb5', '#4f8a5b', '#d99a2b', '#7a4b9a', '#2f2f35', '#e7e1d4', '#3aa0a0', '#b5543f', '#56606d'];
const LEGS = ['#2d3a55', '#2f2f35', '#5b4a3a', '#56606d', '#3a5530', '#7a6a55'];

/** A person standing with their feet at (x, y), facing left or right, mid-stride at `phase` (0 to 1). */
export function drawPerson(ctx: Ctx, p: Pawn, x: number, y: number, phase: number, walking: boolean): void {
  const r = (rx: number, ry: number, rw: number, rh: number, c: string) => rect(ctx, x + rx * p.facing - (p.facing < 0 ? rw : 0), y + ry, rw, rh, c);
  const skin = SKIN[p.look.skin % SKIN.length];
  const hair = HAIR[p.look.hair % HAIR.length];
  const top = p.kind === 'agent' ? '#1f2a44' : TOP[p.look.top % TOP.length];
  const legs = LEGS[p.look.legs % LEGS.length];
  const stride = walking ? (phase < 0.5 ? 1 : -1) : 0;
  // Legs.
  r(-3 + stride, -10, 3, 10, legs);
  r(0 - stride, -10, 3, 10, legs);
  r(-3 + stride, -1, 4, 1, '#1e1e1e');
  r(0 - stride, -1, 4, 1, '#1e1e1e');
  // Body and arms.
  r(-4, -21, 8, 12, top);
  r(-5, -20, 1, 8, top);
  r(4, -20, 1, 8, top);
  r(-5, -12, 1, 2, skin);
  r(4, -12, 1, 2, skin);
  if (p.kind === 'agent') {
    r(-1, -21, 2, 6, '#e7e1d4');
    r(3, -14, 3, 4, '#3a2a1e'); // clipboard hand
  }
  // Head.
  r(-3, -28, 6, 7, skin);
  r(1, -26, 1, 1, '#222');
  r(-3, -29, 6, 2, hair);
  r(-4, -28, 2, 4, hair);
}
