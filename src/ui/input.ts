// Touch and mouse: one finger drags, two fingers pinch, a quick tap selects.

import type { Camera } from '../render/renderer';

const TAP_SLOP = 8;
const MIN_SCALE = 0.3;
const MAX_SCALE = 6;

export interface InputHandlers {
  onTap(x: number, y: number): void;
}

export function attachInput(canvas: HTMLCanvasElement, camera: Camera, handlers: InputHandlers): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number } | null = null;
  let moved = false;
  let pinchDist = 0;

  const zoomAround = (sx: number, sy: number, factor: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
    const k = next / camera.scale;
    camera.ox = sx - (sx - camera.ox) * k;
    camera.oy = sy - (sy - camera.oy) * k;
    camera.scale = next;
  };

  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      moved = false;
    } else if (pointers.size === 2) {
      pinchDist = pair().d;
      moved = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 1) {
      camera.ox += e.clientX - prev.x;
      camera.oy += e.clientY - prev.y;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > TAP_SLOP) moved = true;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (pointers.size === 2) {
      const before = pair();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = pair();
      camera.ox += after.mx - before.mx;
      camera.oy += after.my - before.my;
      if (pinchDist > 0) zoomAround(after.mx, after.my, after.d / pinchDist);
      pinchDist = after.d;
    }
  });

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!moved && downAt && e.type === 'pointerup') handlers.onTap(e.clientX, e.clientY);
      downAt = null;
    }
    if (pointers.size < 2) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
}
