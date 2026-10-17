// Draws the sim. Reads state only, never changes it.

import { NEEDS, WORK_COLOURS, objectDef, type NeedId, type WorkType } from '../sim/defs';
import type { Sim } from '../sim/sim';
import type { ObjectInst, Pawn } from '../sim/state';
import { drawFloorTile, drawObject } from './objectArt';
import { isShell } from '../sim/structure';
import { PLOT_W } from '../sim/world';
import { drawBubble, drawItem, drawPawn, drawStationBadge, type BadgeStyle, type BubbleKind } from './pawnArt';
import { homeWork } from '../sim/work';

/** World pixels per tile. */
export const TILE = 32;
/** Static layer resolution multiplier, so zooming in stays crisp. */
const STATIC_SCALE = 3;
const BUBBLE_BELOW = 0.3;

/** What build mode wants drawn on top of the café. */
export interface BuildView {
  active: boolean;
  /** Furniture picked out with a highlight. */
  objectId: number | null;
  /** Furniture being dragged or bought, drawn where it would land. */
  ghost: { def: string; x: number; y: number; ok: boolean } | null;
  /** Shade the parts of the building that can't be changed (walls and floors modes). */
  shell: boolean;
  /** Show where people walk: a heat map of footsteps. */
  footfall: boolean;
  /** Bumped on every change, so the frame loop knows to redraw. */
  version: number;
}

export interface Camera {
  /** Screen (CSS) pixels per world pixel. */
  scale: number;
  /** Screen position of the world origin, in CSS pixels. */
  ox: number;
  oy: number;
}

export class Renderer {
  readonly camera: Camera = { scale: 1, ox: 0, oy: 0 };
  private ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement;
  private dpr = 1;
  selectedId: number | null = null;
  /** Build mode: draw a grid and outline the selected object. */
  buildSelection: BuildView = { objectId: null, active: false, ghost: null, shell: false, footfall: false, version: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly sim: Sim) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.staticLayer = document.createElement('canvas');
    this.rebuildStatic();
  }

  /** Show the back plot even if nothing's built on it (build mode). */
  showPlot = false;

  /** Width the camera frames: the plot only once something's built on it, so the café stays big on a phone. */
  private get viewWidth(): number {
    const s = this.sim.state;
    const x0 = s.w - PLOT_W;
    if (this.showPlot) return this.worldWidth;
    for (let y = 0; y < s.h; y++) {
      for (let x = x0; x < s.w; x++) {
        const t = this.sim.world.tile(x, y);
        if (t.door || (!t.wall && t.floor !== 'Y' && t.floor !== 'P')) return this.worldWidth;
      }
    }
    return x0 * TILE;
  }

  get worldWidth(): number {
    return this.sim.state.w * TILE;
  }

  get worldHeight(): number {
    return this.sim.state.h * TILE;
  }

  resize(cssW: number, cssH: number): void {
    this.staticVersion++;
    // Beyond 2x a phone can't show the difference, and filling 3x the pixels every frame
    // costs budget phones most of their frame time.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  /** Fits the whole café into the given screen rectangle, top-aligned so a bottom sheet hides less. */
  fit(x: number, y: number, w: number, h: number): void {
    const scale = Math.min(w / this.viewWidth, h / this.worldHeight);
    this.camera.scale = scale;
    this.camera.ox = x + (w - this.viewWidth * scale) / 2;
    this.camera.oy = y;
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const c = this.camera;
    return [(sx - c.ox) / c.scale, (sy - c.oy) / c.scale];
  }

  screenToTile(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.screenToWorld(sx, sy);
    return [Math.floor(wx / TILE), Math.floor(wy / TILE)];
  }

  objectAtTile(tx: number, ty: number): ObjectInst | null {
    for (const o of this.sim.state.objects) {
      const d = objectDef(o.def);
      if (tx >= o.x && tx < o.x + d.w && ty >= o.y && ty < o.y + d.h) return o;
    }
    return null;
  }

  /** The on-map pawn closest to a screen point, within reach of a fingertip. */
  pawnAt(sx: number, sy: number): Pawn | null {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const reach = Math.max(TILE * 0.8, 22 / this.camera.scale);
    let best: Pawn | null = null;
    let bestD = reach;
    for (const p of this.sim.state.pawns) {
      if (!p.onMap) continue;
      const px = (p.x + 0.5) * TILE;
      const py = (p.y + 0.35) * TILE;
      const d = Math.hypot(px - wx, py - wy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Bumped whenever the static layer is redrawn, so the frame loop knows to repaint. */
  staticVersion = 0;
  private scaledLayer: HTMLCanvasElement = document.createElement('canvas');
  private scaledKey = '';

  /** The static layer at exactly the current zoom and pixel density. Rebuilt only when those change. */
  private scaledStatic(): HTMLCanvasElement {
    const k = this.dpr * this.camera.scale;
    const key = `${k}|${this.staticVersion}`;
    if (key !== this.scaledKey) {
      this.scaledKey = key;
      const w = Math.max(1, Math.round(this.worldWidth * k));
      const h = Math.max(1, Math.round(this.worldHeight * k));
      this.scaledLayer.width = w;
      this.scaledLayer.height = h;
      const sctx = this.scaledLayer.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(this.staticLayer, 0, 0, w, h);
    }
    return this.scaledLayer;
  }

  rebuildStatic(): void {
    this.staticVersion++;
    const s = this.sim.state;
    const layer = this.staticLayer;
    layer.width = s.w * TILE * STATIC_SCALE;
    layer.height = s.h * TILE * STATIC_SCALE;
    const ctx = layer.getContext('2d')!;
    ctx.scale(STATIC_SCALE, STATIC_SCALE);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const t = this.sim.world.tile(x, y);
        if (!t.wall) drawFloorTile(ctx, t.floor, x * TILE, y * TILE, TILE);
      }
    }
    ctx.fillStyle = '#3b3f45';
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (this.sim.world.tile(x, y).wall) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (this.sim.world.tile(x, y).door) this.drawDoor(ctx, x, y);
      }
    }
    for (const o of s.objects) {
      const def = objectDef(o.def);
      drawObject(ctx, o.def, o.x * TILE, o.y * TILE, def.w, def.h, TILE);
    }
  }

  private drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const w = this.sim.world;
    const isWall = (tx: number, ty: number) => w.inBounds(tx, ty) && w.tile(tx, ty).wall;
    // A door set in a vertical wall (walls above and below) gets a vertical leaf.
    const inVerticalWall = isWall(x, y - 1) && isWall(x, y + 1);
    ctx.fillStyle = '#7d5233';
    if (!inVerticalWall) {
      ctx.fillRect(x * TILE, y * TILE + TILE * 0.42, TILE, TILE * 0.16);
    } else {
      ctx.fillRect(x * TILE + TILE * 0.42, y * TILE, TILE * 0.16, TILE);
    }
  }

  draw(timeMs: number): void {
    const ctx = this.ctx;
    const c = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Floors, walls and furniture: a pre-scaled copy blitted 1:1 is far cheaper than
    // stretching the full-detail layer every frame.
    const scaled = this.scaledStatic();
    ctx.drawImage(scaled, Math.round(this.dpr * c.ox), Math.round(this.dpr * c.oy));
    ctx.setTransform(this.dpr * c.scale, 0, 0, this.dpr * c.scale, this.dpr * c.ox, this.dpr * c.oy);
    ctx.imageSmoothingEnabled = true;

    if (this.buildSelection.active) this.drawBuildOverlay();
    this.drawItems();

    const pawns = this.sim.state.pawns.filter((p) => p.onMap).sort((a, b) => a.y - b.y || a.id - b.id);
    const size = TILE * 1.25;
    for (const p of pawns) {
      const bob = p.moving ? Math.abs(Math.sin(timeMs / 110 + p.id)) * 2.2 : 0;
      const cx = (p.x + 0.5) * TILE;
      const cy = (p.y + 0.5) * TILE;
      // A ring at their feet in the colour of the station they're on.
      const badge = this.badgeFor(p);
      if (badge) {
        ctx.save();
        ctx.globalAlpha = badge.style === 'waiting' ? 0.45 : 0.9;
        ctx.strokeStyle = WORK_COLOURS[badge.work];
        ctx.lineWidth = Math.max(2.5, 3 / this.camera.scale);
        if (badge.style === 'helping') ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(cx, cy + TILE * 0.36, TILE * 0.42, TILE * 0.15, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawPawn(ctx, p.look, cx, cy, size, bob, p.id === this.selectedId);
      const held = p.carrying;
      if (held && p.visit?.state !== 'eating') {
        const kind = held.kind === 'takeaway' ? held.item : held.kind === 'dishes' ? 'dirty' : held.kind;
        drawItem(ctx, kind, cx + TILE * 0.36, cy + TILE * 0.08 - bob, TILE * 0.3);
      }
    }
    for (const p of pawns) {
      const kind = bubbleFor(p);
      if (kind) drawBubble(ctx, kind, (p.x + 0.85) * TILE, (p.y - 0.15) * TILE, TILE * 0.7);
      const badge = this.badgeFor(p);
      if (badge) {
        // Never smaller than a fingertip-readable 18 screen pixels, however far out you zoom.
        const size = Math.max(TILE * 0.5, 18 / this.camera.scale);
        drawStationBadge(ctx, badge.work, WORK_COLOURS[badge.work], badge.style, (p.x + 0.5) * TILE - size * 0.55, (p.y - 0.1) * TILE - size * 0.6, size);
      }
    }
  }

  /** What station a staff member is on right now, and whether it's theirs (for the badge). */
  private badgeFor(p: Pawn): { work: WorkType; style: BadgeStyle } | null {
    if (!p.staff || !p.job || p.staff.mentalBreak || !this.sim.onShift(p)) return null;
    const work = p.job.work;
    if (!work) return null;
    if (p.job.idle) return { work, style: 'waiting' };
    const home = homeWork(p, this.sim);
    return { work, style: home === null || home === work ? 'own' : 'helping' };
  }

  private drawBuildOverlay(): void {
    const ctx = this.ctx;
    const s = this.sim.state;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 / this.camera.scale;
    ctx.beginPath();
    for (let x = 0; x <= s.w; x++) {
      ctx.moveTo(x * TILE, 0);
      ctx.lineTo(x * TILE, s.h * TILE);
    }
    for (let y = 0; y <= s.h; y++) {
      ctx.moveTo(0, y * TILE);
      ctx.lineTo(s.w * TILE, y * TILE);
    }
    ctx.stroke();
    const view = this.buildSelection;
    if (view.footfall) this.drawFootfall();
    if (view.shell) {
      ctx.fillStyle = 'rgba(20, 22, 26, 0.45)';
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) if (isShell(this.sim, x, y)) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    const id = view.objectId;
    const o = id !== null ? this.sim.world.objectById(id) : undefined;
    if (o) {
      const d = objectDef(o.def);
      ctx.strokeStyle = '#f2c46d';
      ctx.lineWidth = 3;
      ctx.strokeRect(o.x * TILE + 1, o.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2);
    }
    const g = view.ghost;
    if (g) {
      const d = objectDef(g.def);
      if (o && (o.x !== g.x || o.y !== g.y)) {
        // The original spot, faded, so it's clear what's moving.
        ctx.fillStyle = 'rgba(29, 31, 35, 0.45)';
        ctx.fillRect(o.x * TILE, o.y * TILE, d.w * TILE, d.h * TILE);
      }
      ctx.fillStyle = g.ok ? 'rgba(79, 138, 91, 0.35)' : 'rgba(200, 72, 58, 0.4)';
      ctx.fillRect(g.x * TILE, g.y * TILE, d.w * TILE, d.h * TILE);
      ctx.save();
      ctx.globalAlpha = 0.85;
      drawObject(ctx, g.def, g.x * TILE, g.y * TILE, d.w, d.h, TILE);
      ctx.restore();
      ctx.strokeStyle = g.ok ? '#8fd19e' : '#ff8a7a';
      ctx.lineWidth = 3;
      ctx.strokeRect(g.x * TILE + 1, g.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2);
    }
  }

  /** Footsteps per tile as warm colour: busy routes glow, so long walks and pinch points show. */
  private drawFootfall(): void {
    const ctx = this.ctx;
    const s = this.sim.state;
    const f = this.sim.footfall;
    if (f.length !== s.w * s.h) return;
    let max = 0;
    for (const v of f) max = Math.max(max, v);
    if (max <= 0) return;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const v = f[y * s.w + x] / max;
        if (v < 0.04) continue;
        const t = Math.sqrt(v);
        ctx.fillStyle = `rgba(${Math.round(240)}, ${Math.round(200 - 150 * t)}, ${Math.round(60 - 40 * t)}, ${0.18 + 0.5 * t})`;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  /** Cups on tables, orders waiting at the pass, and the pile by the sink. */
  private drawItems(): void {
    const ctx = this.ctx;
    const s = this.sim.state;
    const cup = TILE * 0.28;
    for (const sp of s.spills) {
      ctx.fillStyle = 'rgba(122, 77, 44, 0.55)';
      ctx.beginPath();
      ctx.ellipse((sp.x + 0.5) * TILE, (sp.y + 0.62) * TILE, TILE * 0.34, TILE * 0.18, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse((sp.x + 0.75) * TILE, (sp.y + 0.45) * TILE, TILE * 0.1, TILE * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const o of s.objects) {
      const n = s.dirty[o.id] ?? 0;
      if (n <= 0) continue;
      const def = objectDef(o.def);
      for (let i = 0; i < Math.min(n, 4); i++) {
        drawItem(ctx, 'dirty', (o.x + def.w / 2 + (i % 2 ? 0.22 : -0.22)) * TILE, (o.y + def.h / 2 + (i > 1 ? 0.22 : -0.1)) * TILE, cup);
      }
    }
    // Seated guests' cups sit on the table in front of them.
    for (const p of s.pawns) {
      const v = p.visit;
      if (!v || v.state !== 'eating' || v.seatObject === null || p.carrying?.kind !== 'takeaway') continue;
      const o = this.sim.world.objectById(v.seatObject);
      if (!o) continue;
      const def = objectDef(o.def);
      const tx = o.x + def.w / 2 - 0.5;
      const ty = o.y + def.h / 2 - 0.5;
      const k = o.def === 'armchair' ? 0 : 0.55;
      drawItem(ctx, p.carrying.item, (p.x + (tx - p.x) * k + 0.5) * TILE, (p.y + (ty - p.y) * k + 0.5) * TILE, cup);
    }
    let slot = 0;
    for (const order of s.orders) {
      for (const item of order.items) {
        if (item.status !== 'ready') continue;
        const [px, py] = this.sim.venue.positions.pickupStaff;
        const x = px - 0.3 + (slot % 4) * 0.32;
        const y = py + 1 + (slot >= 4 ? 0.3 : 0);
        drawItem(ctx, item.kind, (x + 0.5) * TILE, (y + 0.45) * TILE, cup);
        slot++;
      }
    }
    const sink = s.objects.find((o) => o.def === 'sink');
    if (sink && s.sinkDirty > 0) {
      for (let i = 0; i < Math.min(s.sinkDirty, 6); i++) {
        drawItem(ctx, 'dirty', (sink.x - 0.25 - (i % 2) * 0.32) * TILE + TILE / 2, (sink.y + 0.3 + Math.floor(i / 2) * 0.22) * TILE, cup);
      }
    }
  }
}

function bubbleFor(p: Pawn): BubbleKind | null {
  const v = p.visit;
  if (v) {
    if (v.mood === 'furious') return 'angry';
    if ((v.state === 'queuing' || v.state === 'waiting') && v.patience < 0.35) return 'impatient';
    if (v.mood === 'happy' && (v.state === 'eating' || v.state === 'leaving' || v.state === 'toSeat')) return 'happy';
    return null;
  }
  const staff = p.staff;
  if (staff?.mentalBreak) {
    const k = staff.mentalBreak.kind;
    return k === 'sulk' || k === 'cry' || k === 'slowWalk' ? 'sad' : 'angry';
  }
  if (p.job?.label.startsWith('Having a row')) return 'angry';
  if (staff?.inspiration) return 'happy';
  return pressingNeed(p);
}

function pressingNeed(p: Pawn): NeedId | null {
  let worst: NeedId | null = null;
  let value = BUBBLE_BELOW;
  for (const def of NEEDS) {
    if (p.needs[def.id] < value) {
      value = p.needs[def.id];
      worst = def.id;
    }
  }
  return worst;
}
