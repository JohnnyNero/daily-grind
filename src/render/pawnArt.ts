// "Pawn" style characters: outlined capsule body, floating head, no face or arms.
// Drawn in a 48 x 48 design box; the feet sit near y = 44.

import type { ItemKind, NeedId } from '../sim/defs';
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

/** Small top-down item: a coffee cup, a slice of cake, or a dirty cup. */
export function drawItem(ctx: CanvasRenderingContext2D, kind: ItemKind | 'dirty', cx: number, cy: number, size: number): void {
  const r = size / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, size / 9);
  if (kind === 'food') {
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
