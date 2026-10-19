// Top-down furniture and floors in the "Pawn" style: flat fills, dark outlines.
// Every function draws into a box given in pixels.

import type { FloorKind } from '../sim/state';
import { OUTLINE } from './pawnArt';

type Ctx = CanvasRenderingContext2D;

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, lw = 2): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, lw = 2): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
}

const WOOD = '#b07d52';

/** A counter section: a slab with a lip along the staff side and a darker front, no side edges so pieces join. */
function counterBase(ctx: Ctx, x: number, y: number, W: number, H: number, p: number, body: string, top: string): void {
  ctx.fillStyle = body;
  ctx.fillRect(x, y + p, W, H - 2 * p);
  ctx.fillStyle = top;
  ctx.fillRect(x, y + p, W, H * 0.24);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(x, y + H - p - H * 0.14, W, H * 0.14);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + p);
  ctx.lineTo(x + W, y + p);
  ctx.moveTo(x, y + H - p);
  ctx.lineTo(x + W, y + H - p);
  ctx.stroke();
}
const CHAIR = '#7d5233';

export function drawFloorTile(ctx: Ctx, kind: FloorKind, x: number, y: number, t: number): void {
  const half = t / 2;
  switch (kind) {
    case 'K':
    case 'T': {
      const a = kind === 'K' ? '#e3e6e8' : '#eef1f3';
      const b = kind === 'K' ? '#d2d7db' : '#dde3e7';
      ctx.fillStyle = a;
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = b;
      ctx.fillRect(x, y, half, half);
      ctx.fillRect(x + half, y + half, half, half);
      break;
    }
    case 'S':
      ctx.fillStyle = '#d9d3c7';
      ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = '#cbc4b6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
      break;
    case 'B':
      ctx.fillStyle = '#c4c9cd';
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = '#b6bcc1';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * (t / 4), y + 3, 2, t - 6);
      break;
    case 'F':
      ctx.fillStyle = '#c9a77a';
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = '#b08c5f';
      ctx.fillRect(x, y + t - 1, t, 1);
      ctx.fillRect(x, y + half - 0.5, t, 1);
      ctx.fillRect(x + ((x / t) % 2 === 0 ? t * 0.3 : t * 0.7), y, 1, half);
      break;
    case 'C': {
      // Pub carpet: burgundy with a small repeating motif. Never quite clean.
      ctx.fillStyle = '#7a2e36';
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = '#8f3a42';
      ctx.fillRect(x + half - 3, y + half - 3, 6, 6);
      ctx.fillStyle = '#c9973a';
      ctx.fillRect(x + half - 1, y + half - 1, 2, 2);
      ctx.fillStyle = '#6b2730';
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x + t - 2, y + t - 2, 2, 2);
      break;
    }
    case 'X': {
      // Cinema carpet: dark blue with a faint fleck, so the screen stands out.
      ctx.fillStyle = '#2c3348';
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = '#353d55';
      ctx.fillRect(x + t * 0.2, y + t * 0.3, 2, 2);
      ctx.fillRect(x + t * 0.7, y + t * 0.65, 2, 2);
      break;
    }
    case 'P':
      ctx.fillStyle = '#a7a9ab';
      ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = '#95979a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
      break;    case 'Y': {
      // The back plot: scrubby grass.
      ctx.fillStyle = '#7f9a5e';
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = '#738d53';
      ctx.fillRect(x + t * 0.15, y + t * 0.2, t * 0.12, t * 0.12);
      ctx.fillRect(x + t * 0.6, y + t * 0.55, t * 0.12, t * 0.12);
      ctx.fillRect(x + t * 0.35, y + t * 0.75, t * 0.1, t * 0.1);
      break;
    }
    case 'R': {
      // Boards: warm, slightly worn.
      ctx.fillStyle = '#d8b99a';
      ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = '#c9a785';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + t / 2);
      ctx.lineTo(x + t, y + t / 2);
      ctx.stroke();
      break;
    }
  }
}

/** Draws an object whose footprint starts at (x, y) and spans w x h tiles of size t. */
export function drawObject(ctx: Ctx, def: string, x: number, y: number, w: number, h: number, t: number): void {
  const W = w * t;
  const H = h * t;
  const p = t * 0.08;
  ctx.lineJoin = 'round';
  switch (def) {
    case 'fridge':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, '#dfe5ea');
      ctx.beginPath();
      ctx.moveTo(x + p, y + H * 0.42);
      ctx.lineTo(x + W - p, y + H * 0.42);
      ctx.stroke();
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(x + W * 0.7, y + H * 0.18, 2, H * 0.16);
      ctx.fillRect(x + W * 0.7, y + H * 0.52, 2, H * 0.25);
      break;
    case 'oven':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, '#4a4f57');
      box(ctx, x + W * 0.22, y + H * 0.35, W * 0.56, H * 0.4, 2, '#2a2d33', 1.5);
      disc(ctx, x + W * 0.3, y + H * 0.2, 2, '#a3aab3', 0);
      disc(ctx, x + W * 0.5, y + H * 0.2, 2, '#e87a2c', 0);
      disc(ctx, x + W * 0.7, y + H * 0.2, 2, '#a3aab3', 0);
      break;
    case 'prep':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, '#c9ced3');
      box(ctx, x + W * 0.12, y + H * 0.25, W * 0.3, H * 0.5, 2, '#c8955f', 1.5);
      disc(ctx, x + W * 0.24, y + H * 0.5, t * 0.09, '#d6463b', 0);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + W * 0.58, y + H * 0.35);
      ctx.lineTo(x + W * 0.82, y + H * 0.68);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'sink':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, '#c9ced3');
      box(ctx, x + W * 0.2, y + H * 0.28, W * 0.6, H * 0.52, 4, '#bcd6e8', 1.5);
      disc(ctx, x + W * 0.5, y + H * 0.17, 2.5, '#6d757e', 0);
      break;
    case 'espresso':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 4, '#3b3f45');
      box(ctx, x + W * 0.08, y + H * 0.2, W * 0.84, H * 0.25, 2, '#a3aab3', 1.5);
      disc(ctx, x + W * 0.3, y + H * 0.65, t * 0.13, '#1d1d1f', 1.5);
      disc(ctx, x + W * 0.7, y + H * 0.65, t * 0.13, '#1d1d1f', 1.5);
      disc(ctx, x + W * 0.3, y + H * 0.65, t * 0.06, '#c8955f', 0);
      break;
    case 'staffSofa':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 6, '#4f7f8a');
      box(ctx, x + p, y + p, W - 2 * p, H * 0.3, 4, '#3f6a74', 1.5);
      box(ctx, x + W * 0.1, y + H * 0.4, W * 0.38, H * 0.45, 4, '#5f909b', 1.5);
      box(ctx, x + W * 0.52, y + H * 0.4, W * 0.38, H * 0.45, 4, '#5f909b', 1.5);
      break;
    case 'staffTable':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, WOOD);
      disc(ctx, x + W * 0.25, y + H * 0.55, t * 0.17, '#ffffff', 1.2);
      disc(ctx, x + W * 0.75, y + H * 0.55, t * 0.17, '#ffffff', 1.2);
      break;
    case 'lockers':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 2, '#8a96a3');
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + W / 2, y + p);
      ctx.lineTo(x + W / 2, y + H - p);
      ctx.stroke();
      break;
    case 'table4':
      box(ctx, x + W * 0.15, y - t * 0.3, W * 0.25, t * 0.4, 3, CHAIR);
      box(ctx, x + W * 0.6, y - t * 0.3, W * 0.25, t * 0.4, 3, CHAIR);
      box(ctx, x + W * 0.15, y + H - t * 0.1, W * 0.25, t * 0.4, 3, CHAIR);
      box(ctx, x + W * 0.6, y + H - t * 0.1, W * 0.25, t * 0.4, 3, CHAIR);
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 4, WOOD);
      disc(ctx, x + W * 0.3, y + H * 0.3, t * 0.16, '#ffffff', 1.2);
      disc(ctx, x + W * 0.7, y + H * 0.7, t * 0.16, '#ffffff', 1.2);
      break;
    case 'table2':
      box(ctx, x + W * 0.25, y - t * 0.3, W * 0.5, t * 0.4, 3, CHAIR);
      box(ctx, x + W * 0.25, y + H - t * 0.1, W * 0.5, t * 0.4, 3, CHAIR);
      disc(ctx, x + W / 2, y + H / 2, t * 0.42, WOOD);
      disc(ctx, x + W / 2, y + H / 2, t * 0.12, '#f3efe6', 1.2);
      break;
    case 'armchair':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 6, '#c9973a');
      box(ctx, x + p, y + p, W - 2 * p, H * 0.3, 4, '#a87b2a', 1.5);
      box(ctx, x + W * 0.22, y + H * 0.42, W * 0.56, H * 0.42, 4, '#ddb056', 1.5);
      break;
    case 'plant':
      disc(ctx, x + W / 2, y + H / 2, t * 0.38, '#9c5b3a');
      disc(ctx, x + W * 0.38, y + H * 0.4, t * 0.22, '#5d8f4e', 1.5);
      disc(ctx, x + W * 0.62, y + H * 0.42, t * 0.2, '#6fa25d', 1.5);
      disc(ctx, x + W * 0.5, y + H * 0.62, t * 0.2, '#5d8f4e', 1.5);
      break;
    case 'toilet':
      box(ctx, x + W * 0.2, y + p, W * 0.6, H * 0.28, 3, '#f4f6f8');
      ctx.beginPath();
      ctx.ellipse(x + W / 2, y + H * 0.6, W * 0.28, H * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f6f8';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      break;
    // Counter pieces join up edge to edge: staff work from the top, customers face the bottom.
    case 'counter':
      counterBase(ctx, x, y, W, H, p, '#6b4429', '#8e5d3b');
      break;
    case 'bar':
      counterBase(ctx, x, y, W, H, p, '#4a2c1a', '#6b4429');
      disc(ctx, x + W * 0.35, y + H * 0.58, t * 0.1, '#c9973a', 1.2);
      disc(ctx, x + W * 0.65, y + H * 0.58, t * 0.1, '#f2f2f2', 1.2);
      break;
    case 'till':
      counterBase(ctx, x, y, W, H, p, '#5a3a24', '#7d5233');
      box(ctx, x + W * 0.2, y + H * 0.2, W * 0.6, H * 0.5, 2, '#2b2e35', 1.5);
      box(ctx, x + W * 0.28, y + H * 0.27, W * 0.44, H * 0.16, 1, '#8fd19e', 1);
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(x + W * 0.3, y + H * 0.5, W * 0.4, H * 0.08);
      break;
    case 'pickup':
      counterBase(ctx, x, y, W, H, p, '#5a3a24', '#7d5233');
      box(ctx, x + W * 0.14, y + H * 0.24, W * 0.72, H * 0.48, 3, '#e9e1d2', 1.5);
      disc(ctx, x + W * 0.5, y + H * 0.42, t * 0.11, '#d4a63a', 1.2);
      ctx.fillStyle = '#2b2e35';
      ctx.fillRect(x + W * 0.47, y + H * 0.26, W * 0.06, H * 0.07);
      break;
    case 'foodCounter':
      counterBase(ctx, x, y, W, H, p, '#5a3a24', '#7d5233');
      box(ctx, x + W * 0.12, y + H * 0.18, W * 0.76, H * 0.6, 4, 'rgba(220,235,245,0.85)', 1.5);
      disc(ctx, x + W * 0.36, y + H * 0.5, t * 0.14, '#e8b0a8', 1.2);
      disc(ctx, x + W * 0.64, y + H * 0.5, t * 0.14, '#9a6b46', 1.2);
      break;
    case 'fountain':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 4, '#c43c3c');
      box(ctx, x + W * 0.08, y + H * 0.15, W * 0.84, H * 0.3, 2, '#2b2e35', 1.2);
      for (let i = 0; i < 4; i++) {
        disc(ctx, x + W * (0.18 + i * 0.21), y + H * 0.66, t * 0.1, ['#3a2416', '#e8862c', '#f2f2f2', '#6fbf4a'][i], 1.2);
      }
      break;
    case 'bin':
      disc(ctx, x + W / 2, y + H / 2, t * 0.32, '#5f6670', 1.5);
      disc(ctx, x + W / 2, y + H / 2, t * 0.2, '#2b2e35', 1);
      break;
    case 'screen':
      // A wide pale screen in a black frame.
      box(ctx, x + 2, y + p, W - 4, H - 2 * p, 2, '#151619');
      box(ctx, x + t * 0.2, y + H * 0.22, W - t * 0.4, H * 0.5, 1, '#e9edf2', 1);
      break;
    case 'cinemaSeats':
      // A row of red seats, backs towards the bottom so the row faces up the room.
      for (let i = 0; i < w; i++) {
        const sx = x + i * t;
        box(ctx, sx + t * 0.12, y + t * 0.12, t * 0.76, t * 0.62, 4, '#a3283a', 1.5);
        box(ctx, sx + t * 0.1, y + t * 0.66, t * 0.8, t * 0.24, 3, '#7a1f2b', 1.5);
      }
      break;
    case 'taps':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 4, '#2b2e35');
      for (let i = 0; i < 5; i++) {
        box(ctx, x + W * (0.1 + i * 0.17), y + H * 0.18, W * 0.1, H * 0.34, 2, ['#3f7d4f', '#8b4a2b', '#c9973a', '#5a3a22', '#3f7d4f'][i], 1);
      }
      ctx.fillStyle = '#a3aab3';
      ctx.fillRect(x + W * 0.08, y + H * 0.62, W * 0.84, H * 0.16);
      break;
    case 'kegs':
      disc(ctx, x + W * 0.27, y + H / 2, t * 0.4, '#8a96a3');
      disc(ctx, x + W * 0.27, y + H / 2, t * 0.22, '#6d757e', 1.2);
      disc(ctx, x + W * 0.73, y + H / 2, t * 0.4, '#8a96a3');
      disc(ctx, x + W * 0.73, y + H / 2, t * 0.22, '#6d757e', 1.2);
      break;
    case 'poolTable':
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 6, '#5a3a22');
      box(ctx, x + W * 0.08, y + H * 0.14, W * 0.84, H * 0.72, 3, '#2f7a4a', 1.5);
      for (const [cx, cy] of [[0.1, 0.16], [0.5, 0.12], [0.9, 0.16], [0.1, 0.84], [0.5, 0.88], [0.9, 0.84]]) {
        disc(ctx, x + W * cx, y + H * cy, t * 0.08, '#1d1d1f', 0);
      }
      disc(ctx, x + W * 0.3, y + H * 0.5, t * 0.1, '#ffffff', 1);
      disc(ctx, x + W * 0.62, y + H * 0.42, t * 0.1, '#d6463b', 1);
      disc(ctx, x + W * 0.68, y + H * 0.58, t * 0.1, '#d8b45a', 1);
      break;
    case 'dartboard':
      disc(ctx, x + W / 2, y + H / 2, t * 0.4, '#1d1d1f');
      disc(ctx, x + W / 2, y + H / 2, t * 0.28, '#e3dccf', 1);
      disc(ctx, x + W / 2, y + H / 2, t * 0.16, '#8b2f3c', 1);
      disc(ctx, x + W / 2, y + H / 2, t * 0.05, '#3f7d4f', 0);
      break;
    default:
      box(ctx, x + p, y + p, W - 2 * p, H - 2 * p, 3, '#ff00ff');
  }
}
