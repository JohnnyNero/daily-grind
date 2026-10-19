// "Pawn" style characters: outlined capsule body, floating head, no face or arms.
// Drawn in a 48 x 48 design box; the feet sit near y = 44.

import type { ItemKind, NeedId, WorkType } from '../sim/defs';
import type { Look } from '../sim/state';

export const OUTLINE = '#2a2a2a';

const HAIR_CAP_SHORT = new Path2D('M14.5 17 A9.5 9.5 0 0 1 33.5 17 Q29 12 24 12.5 Q18 13 14.5 17 Z');
const HAIR_CAP_PARTED = new Path2D('M14.5 17 A9.5 9.5 0 0 1 33.5 17 Q24 10 14.5 17 Z');
const BEANIE = new Path2D('M14.6 15.5 A9.5 9.5 0 0 1 33.4 15.5 Z');

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draws a pawn centred on (cx, cy) in screen pixels; `size` is the design box size in pixels.
 * `bob` lifts the whole figure slightly while walking.
 */
export function drawPawn(
  ctx: CanvasRenderingContext2D,
  look: Look,
  cx: number,
  cy: number,
  size: number,
  bob = 0,
  selected = false,
): void {
  const k = size / 48;
  ctx.save();
  ctx.translate(cx - 24 * k, cy - 30 * k);
  ctx.scale(k, k);

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(24, 44, 11, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#f2c46d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(24, 44, 15, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.translate(0, -bob);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;

  if (look.hairStyle === 'long') {
    ctx.fillStyle = look.hair;
    roundRect(ctx, 13, 11, 22, 22, 10);
    ctx.fill();
    ctx.stroke();
  } else if (look.hairStyle === 'bun') {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(24, 6.5, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = look.shirt;
  roundRect(ctx, 12, 24, 24, 21, 11);
  ctx.fill();
  ctx.stroke();

  if (look.apron) {
    ctx.fillStyle = look.apron;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 18, 27, 12, 15, 3);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2;
  }

  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(24, 18, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = look.hair;
  switch (look.hairStyle) {
    case 'short':
      ctx.fill(HAIR_CAP_SHORT);
      ctx.stroke(HAIR_CAP_SHORT);
      break;
    case 'long':
    case 'bun':
      ctx.fill(HAIR_CAP_PARTED);
      ctx.stroke(HAIR_CAP_PARTED);
      break;
    case 'beanie':
      ctx.fill(BEANIE);
      ctx.stroke(BEANIE);
      roundRect(ctx, 14, 13.5, 20, 3.5, 1.5);
      ctx.fill();
      ctx.stroke();
      break;
    case 'bald':
      break;
  }
  ctx.restore();
}

/** How a staff member relates to the work they're on: their own station, helping out, or waiting for it. */
export type BadgeStyle = 'own' | 'helping' | 'waiting';

/**
 * A round badge above a staff member's head showing the kind of work they're on:
 * till, cup, tray, suds or mop, in that work's colour. Solid for their own station,
 * a white badge with a coloured ring when they're helping out, faded while they wait.
 */
export function drawStationBadge(
  ctx: CanvasRenderingContext2D,
  work: WorkType,
  colour: string,
  style: BadgeStyle,
  cx: number,
  cy: number,
  size: number,
): void {
  const r = size / 2;
  ctx.save();
  ctx.globalAlpha = style === 'waiting' ? 0.55 : 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = style === 'helping' ? '#ffffff' : colour;
  ctx.fill();
  ctx.lineWidth = style === 'helping' ? r * 0.28 : r * 0.16;
  ctx.strokeStyle = style === 'helping' ? colour : OUTLINE;
  ctx.stroke();
  const ink = style === 'helping' ? colour : '#ffffff';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = r * 0.5;
  ctx.beginPath();
  switch (work) {
    case 'counter':
      // A till: screen on top, drawer below.
      ctx.rect(cx - u * 0.9, cy - u * 0.15, u * 1.8, u);
      ctx.fill();
      ctx.fillRect(cx - u * 0.45, cy - u * 0.95, u * 0.9, u * 0.6);
      break;
    case 'barista':
      // A cup with a handle.
      ctx.moveTo(cx - u * 0.85, cy - u * 0.6);
      ctx.lineTo(cx + u * 0.55, cy - u * 0.6);
      ctx.lineTo(cx + u * 0.35, cy + u * 0.8);
      ctx.lineTo(cx - u * 0.65, cy + u * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + u * 0.65, cy - u * 0.05, u * 0.35, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    case 'kitchen':
      // A frying pan.
      ctx.arc(cx - u * 0.2, cy + u * 0.15, u * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + u * 0.35, cy - u * 0.3);
      ctx.lineTo(cx + u * 0.95, cy - u * 0.85);
      ctx.stroke();
      break;
    case 'floor':
      // A tray with a cup on it.
      ctx.moveTo(cx - u, cy + u * 0.55);
      ctx.lineTo(cx + u, cy + u * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + u * 0.35, u * 0.6, Math.PI, 0);
      ctx.fill();
      break;
    case 'dishes':
      // Suds.
      for (const [dx, dy, rr] of [[-0.45, 0.25, 0.42], [0.4, 0.3, 0.36], [0, -0.4, 0.38]] as const) {
        ctx.moveTo(cx + u * dx + u * rr, cy + u * dy);
        ctx.arc(cx + u * dx, cy + u * dy, u * rr, 0, Math.PI * 2);
      }
      ctx.stroke();
      break;
    case 'cleaning':
      // A mop.
      ctx.moveTo(cx + u * 0.6, cy - u * 0.95);
      ctx.lineTo(cx - u * 0.15, cy + u * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx - u * 0.3, cy + u * 0.65, u * 0.65, u * 0.3, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

export type BubbleKind = NeedId | 'impatient' | 'angry' | 'happy' | 'sad';

/** A speech bubble above a pawn with a one-symbol icon: a pressing need or a mood. */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  kind: BubbleKind,
  cx: number,
  cy: number,
  size: number,
): void {
  const k = size / 24;
  ctx.save();
  ctx.translate(cx - 12 * k, cy - 24 * k);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(3, 3);
  ctx.lineTo(21, 3);
  ctx.lineTo(21, 15);
  ctx.lineTo(11, 15);
  ctx.lineTo(6, 20);
  ctx.lineTo(6, 15);
  ctx.lineTo(3, 15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  switch (kind) {
    case 'impatient':
      ctx.strokeStyle = '#2a2a2a';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(12, 9, 4.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 9);
      ctx.lineTo(12, 6);
      ctx.moveTo(12, 9);
      ctx.lineTo(14.2, 10);
      ctx.stroke();
      break;
    case 'angry':
      ctx.fillStyle = '#c8483a';
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 12, 13);
      break;
    case 'sad':
      ctx.fillStyle = '#4b8fd1';
      ctx.beginPath();
      ctx.moveTo(9, 6);
      ctx.quadraticCurveTo(12, 10, 9, 12.5);
      ctx.quadraticCurveTo(6, 10, 9, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(15, 6);
      ctx.quadraticCurveTo(18, 10, 15, 12.5);
      ctx.quadraticCurveTo(12, 10, 15, 6);
      ctx.fill();
      break;
    case 'happy':
      ctx.fillStyle = '#d6463b';
      ctx.beginPath();
      ctx.moveTo(12, 13);
      ctx.bezierCurveTo(5, 8, 8, 3.5, 12, 6.5);
      ctx.bezierCurveTo(16, 3.5, 19, 8, 12, 13);
      ctx.fill();
      break;
    case 'energy':
      ctx.fillStyle = '#2e4878';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('z', 10, 13);
      ctx.font = '700 6px system-ui, sans-serif';
      ctx.fillText('z', 15, 9);
      break;
    case 'hunger':
      ctx.fillStyle = '#f3efe6';
      ctx.beginPath();
      ctx.arc(12, 9, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c8483a';
      ctx.beginPath();
      ctx.arc(12, 9, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bladder':
      ctx.fillStyle = '#4b8fd1';
      ctx.beginPath();
      ctx.moveTo(12, 4.5);
      ctx.quadraticCurveTo(16.5, 10, 12, 13);
      ctx.quadraticCurveTo(7.5, 10, 12, 4.5);
      ctx.fill();
      break;
    case 'comfort':
      ctx.fillStyle = '#d99a2b';
      ctx.beginPath();
      ctx.moveTo(13, 4);
      ctx.lineTo(9, 10);
      ctx.lineTo(12, 10);
      ctx.lineTo(10.5, 14);
      ctx.lineTo(15, 8);
      ctx.lineTo(12, 8);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** Small top-down item: a coffee cup, a slice of cake, a hot plate, or a dirty cup. */
export function drawItem(ctx: CanvasRenderingContext2D, kind: ItemKind | 'dirty', cx: number, cy: number, size: number): void {
  const r = size / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, size / 9);
  if (kind === 'hot') {
    // A plate with something toasted and a wisp of steam.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d99a3e';
    ctx.fillRect(cx - r * 0.55, cy - r * 0.35, r * 1.1, r * 0.7);
    ctx.strokeRect(cx - r * 0.55, cy - r * 0.35, r * 1.1, r * 0.7);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.15, cy - r * 0.45);
    ctx.quadraticCurveTo(cx - r * 0.4, cy - r * 0.8, cx - r * 0.1, cy - r * 1.15);
    ctx.stroke();
  } else if (kind === 'food') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9a6b46';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy + r * 0.35);
    ctx.lineTo(cx + r * 0.6, cy + r * 0.35);
    ctx.lineTo(cx + r * 0.1, cy - r * 0.55);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx + r * 0.85, cy, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kind === 'dirty' ? '#c9c3b8' : '#8a5a2b';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
