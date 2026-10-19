// Draws the sim, side on. Reads state only, never changes it.
//
// The building and street are drawn once into a layer at world resolution (16 pixels a
// tile) and redrawn only when the building changes; the sky, people and build-mode
// overlays are drawn every frame on top. Everything is scaled up without smoothing.

import { furnitureDef } from '../sim/defs';
import type { Layout } from '../sim/layout';
import type { Sim } from '../sim/sim';
import { MAX_STOREYS, ROOM_ROWS, STOREY_ROWS, TILE, TICKS_PER_MINUTE, isDoor, type Pawn } from '../sim/state';
import { drawFurniture, drawPerson, rect } from './art';

const SKY_ROWS = 4;
const GROUND_ROWS = 3;
/** World y of the ground surface. */
export const GROUND_Y = (SKY_ROWS + MAX_STOREYS * STOREY_ROWS) * TILE;
const STOREY_PX = STOREY_ROWS * TILE;

/** World y of the top of storey s's floor. */
export const floorY = (s: number) => GROUND_Y - s * STOREY_PX;

export interface Camera {
  /** Screen (CSS) pixels per world pixel. */
  scale: number;
  ox: number;
  oy: number;
}

/** A cell of the grid: column, storey and row within the storey (3 is the floor slab above). */
export interface Cell {
  x: number;
  s: number;
  r: number;
}

export interface BuildView {
  active: boolean;
  /** Cells the current tool would change, and whether it can. */
  marks: { x: number; s: number; r: number; w: number; h: number; ok: boolean }[];
  /** Furniture being placed, where it would go. */
  ghost: { def: string; x: number; s: number; r: number; flip: boolean; ok: boolean } | null;
  selected: number | null;
  version: number;
}

const FLAT_WALLS = ['#d9b98f', '#b9c8a8', '#c9b8d0', '#a9c0cf', '#e0c2a2', '#c2c9a0', '#d4a9a0', '#b0bfb8'];
const SHARED_WALL = '#a8a296';

export class Renderer {
  readonly camera: Camera = { scale: 2, ox: 0, oy: 0 };
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private layerVersion = -1;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  selectedPawn: number | null = null;
  build: BuildView = { active: false, marks: [], ghost: null, selected: null, version: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly sim: Sim) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.layer = document.createElement('canvas');
  }

  get worldW(): number {
    return this.sim.state.w * TILE;
  }

  get worldH(): number {
    return GROUND_Y + GROUND_ROWS * TILE;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Frames the building (and a bit of street) inside the given screen box. */
  fit(x: number, y: number, w: number, h: number): void {
    const st = this.sim.state;
    let top = 1;
    for (const k of Object.keys(st.slabs)) top = Math.max(top, Number(k.split(',')[1]));
    const wx0 = (st.plot.x0 - 3) * TILE;
    const wx1 = (st.plot.x1 + 4) * TILE;
    const wy0 = floorY(top) - 2 * TILE;
    const wy1 = GROUND_Y + 2 * TILE;
    const scale = Math.min(w / (wx1 - wx0), h / (wy1 - wy0));
    this.camera.scale = Math.max(0.5, Math.floor(scale * 4) / 4 || scale);
    this.camera.ox = x + (w - (wx1 - wx0) * this.camera.scale) / 2 - wx0 * this.camera.scale;
    this.camera.oy = y + (h - (wy1 - wy0) * this.camera.scale) / 2 - wy0 * this.camera.scale;
  }

  toWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: (sx - this.camera.ox) / this.camera.scale, wy: (sy - this.camera.oy) / this.camera.scale };
  }

  cellAt(sx: number, sy: number): Cell | null {
    const { wx, wy } = this.toWorld(sx, sy);
    const rel = GROUND_Y - wy;
    if (rel < 0 || wx < 0 || wx >= this.worldW) return null;
    const s = Math.floor(rel / STOREY_PX);
    if (s >= MAX_STOREYS + 1) return null;
    return { x: Math.floor(wx / TILE), s, r: Math.floor((rel - s * STOREY_PX) / TILE) };
  }

  pawnAt(sx: number, sy: number): Pawn | null {
    const { wx, wy } = this.toWorld(sx, sy);
    let best: Pawn | null = null;
    let bestD = Infinity;
    for (const p of this.sim.state.pawns) {
      const { px, py } = this.feet(p);
      if (wx < px - 7 || wx > px + 7 || wy < py - 32 || wy > py + 4) continue;
      const d = Math.abs(wx - px);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Where someone's feet are, in world pixels. */
  feet(p: Pawn): { px: number; py: number } {
    return { px: (p.x + 0.5) * TILE, py: floorY(p.s) + (p.front ? 10 : 0) };
  }

  // ------------------------------------------------------------------ the frame

  draw(): void {
    const ctx = this.ctx;
    const c = this.camera;
    if (this.layerVersion !== this.sim.version) this.drawLayer();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawSky();
    ctx.setTransform(this.dpr * c.scale, 0, 0, this.dpr * c.scale, this.dpr * c.ox, this.dpr * c.oy);
    ctx.drawImage(this.layer, 0, 0);
    const pawns = [...this.sim.state.pawns].sort((a, b) => Number(!!a.front) - Number(!!b.front));
    for (const p of pawns) {
      const { px, py } = this.feet(p);
      const walking = p.path.length > 0;
      const phase = (Math.abs(p.x) * 1.6) % 1;
      drawPerson(ctx, p, Math.round(px), Math.round(py), phase, walking);
      if (p.id === this.selectedPawn) {
        ctx.strokeStyle = '#f2c46d';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(px) - 7.5, Math.round(py) - 31.5, 15, 33);
      }
    }
    if (this.build.active) this.drawBuild();
    // Text at screen resolution.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels();
  }

  private drawSky(): void {
    const ctx = this.ctx;
    const minute = Math.floor(this.sim.state.tick / TICKS_PER_MINUTE) % (24 * 60);
    const hour = minute / 60;
    // Daylight from 0 (night) to 1 (midday), with dawn and dusk between.
    const light = Math.max(0, Math.min(1, Math.min((hour - 5.5) / 2, (21 - hour) / 2)));
    const mix = (a: number[], b: number[]) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * light)).join(',')})`;
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, mix([18, 22, 44], [126, 178, 214]));
    g.addColorStop(1, mix([46, 40, 70], [214, 226, 228]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  // ------------------------------------------------------------------ the building

  private drawLayer(): void {
    const lay = this.sim.layout;
    const st = this.sim.state;
    this.layer.width = this.worldW;
    this.layer.height = this.worldH;
    const ctx = this.layer.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.worldW, this.worldH);
    this.drawStreet(ctx);
    this.drawRooms(ctx, lay);
    // Floors.
    for (const k of Object.keys(st.slabs)) {
      const [x, level] = k.split(',').map(Number);
      this.drawSlab(ctx, x, level);
    }
    for (let x = st.plot.x0; x <= st.plot.x1; x++) this.drawFloorTop(ctx, x, floorY(0), lay.roomOf[lay.node(x, 0)] !== -1);
    // Stairs, then walls, doors and windows over them.
    for (const t of st.stairs) this.drawStairs(ctx, t.x, t.s, t.dir);
    for (const [k, seg] of Object.entries(st.walls)) {
      const [x, s] = k.split(',').map(Number);
      const outer = x === st.plot.x0 || x === st.plot.x1;
      const y = floorY(s) - ROOM_ROWS * TILE;
      const X = x * TILE;
      const brick = outer ? '#9c5b45' : '#d6c9b2';
      const mortar = outer ? '#86493a' : '#c2b49b';
      rect(ctx, X, y, TILE, ROOM_ROWS * TILE, brick);
      for (let row = 0; row < ROOM_ROWS * 4; row++) {
        rect(ctx, X, y + row * 4 + 3, TILE, 1, mortar);
        if (outer) rect(ctx, X + (row % 2 ? 4 : 11), y + row * 4, 1, 3, mortar);
      }
      rect(ctx, X, y, 1, ROOM_ROWS * TILE, '#00000022');
      rect(ctx, X + TILE - 1, y, 1, ROOM_ROWS * TILE, '#00000033');
      if (seg === 'window') this.drawWindow(ctx, X, y);
      else if (isDoor(seg)) this.drawDoor(ctx, X, y, seg);
    }
    for (const f of st.furniture) {
      const d = furnitureDef(f.def);
      drawFurniture(ctx, f.def, f.x * TILE, floorY(f.s) - (f.r + d.h) * TILE, f.flip);
    }
    this.layerVersion = this.sim.version;
  }

  private drawStreet(ctx: CanvasRenderingContext2D): void {
    const W = this.worldW;
    const y = GROUND_Y;
    // Neighbouring terraces, just their outlines, either side of the plot.
    const { x0, x1 } = this.sim.state.plot;
    for (const [from, to] of [[0, x0 - 2], [x1 + 3, this.sim.state.w]] as const) {
      for (let x = from; x < to; x += 7) {
        const h = 2 + ((x * 7) % 3);
        const top = floorY(h) - 2 * TILE;
        rect(ctx, x * TILE, top, 6 * TILE, y - top, '#6d6a74');
        rect(ctx, x * TILE - 2, top - 3, 6 * TILE + 4, 3, '#57545e');
        for (let s = 0; s < h; s++) {
          for (const wx of [1, 4]) rect(ctx, (x + wx) * TILE, floorY(s) - 3 * TILE + 6, TILE, TILE + 6, '#4e5a6a');
        }
      }
    }
    rect(ctx, 0, y, W, TILE, '#b3ada3');
    for (let x = 0; x < W; x += TILE) rect(ctx, x, y, 1, TILE, '#9d978d');
    rect(ctx, 0, y, W, 2, '#c9c3b8');
    rect(ctx, 0, y + TILE, W, 3, '#8b867e');
    rect(ctx, 0, y + TILE + 3, W, TILE - 3, '#3d3f44');
    for (let x = 4; x < W; x += 3 * TILE) rect(ctx, x, y + TILE + 9, TILE, 2, '#d8d4c8');
    rect(ctx, 0, y + 2 * TILE, W, TILE, '#2e2420');
    // Street lamps.
    for (const x of [x0 - 5, x1 + 5]) {
      rect(ctx, x * TILE + 7, floorY(1) - 8, 2, 4 * TILE + 8, '#2f3338');
      rect(ctx, x * TILE + 4, floorY(1) - 10, 8, 3, '#2f3338');
      rect(ctx, x * TILE + 5, floorY(1) - 7, 6, 2, '#f3d98a');
    }
  }

  /** Back walls: each flat in its own colour, shared space plain, the gutted and sealed darker. */
  private drawRooms(ctx: CanvasRenderingContext2D, lay: Layout): void {
    const flatIndex = new Map(lay.flats.map((f, i) => [f.id, i]));
    for (const room of lay.rooms) {
      if (room.outdoor) continue;
      let colour = SHARED_WALL;
      if (room.flat !== null) colour = FLAT_WALLS[(flatIndex.get(room.flat) ?? 0) % FLAT_WALLS.length];
      else if (!room.shared) colour = room.enclosed ? '#5a5048' : '';
      if (!colour) continue;
      const bare = room.flat !== null && !this.sim.state.furniture.some((f) => lay.flatAt(f.x, f.s)?.id === room.flat);
      for (const n of room.nodes) {
        const [x, s] = lay.xs(n);
        if (!room.enclosed && !lay.slab(x, s + 1)) continue;
        const X = x * TILE;
        const y = floorY(s) - ROOM_ROWS * TILE;
        if (bare) {
          // Stripped to the brick.
          rect(ctx, X, y, TILE, ROOM_ROWS * TILE, '#a8826a');
          for (let row = 0; row < ROOM_ROWS * 4; row++) {
            rect(ctx, X, y + row * 4 + 3, TILE, 1, '#957260');
            rect(ctx, X + (row % 2 ? 3 : 11), y + row * 4, 1, 3, '#957260');
          }
          continue;
        }
        rect(ctx, X, y, TILE, ROOM_ROWS * TILE, colour);
        rect(ctx, X + 7, y, 2, ROOM_ROWS * TILE, '#ffffff14');
        rect(ctx, X, y, TILE, 2, '#00000022');
        rect(ctx, X, floorY(s) - 3, TILE, 3, room.shared ? '#6e675d' : '#7d5a3e');
      }
    }
  }

  private drawSlab(ctx: CanvasRenderingContext2D, x: number, level: number): void {
    const y = floorY(level);
    const X = x * TILE;
    rect(ctx, X, y, TILE, TILE, '#77706a');
    rect(ctx, X, y + TILE - 3, TILE, 3, '#5b5550');
    rect(ctx, X, y + 6, TILE, 1, '#6a645e');
    this.drawFloorTop(ctx, X / TILE, y, true);
  }

  private drawFloorTop(ctx: CanvasRenderingContext2D, x: number, y: number, boards: boolean): void {
    const X = x * TILE;
    rect(ctx, X, y, TILE, 3, boards ? '#9a6a45' : '#8b867e');
    if (boards) rect(ctx, X + ((x * 5) % 13), y, 1, 3, '#7d5236');
  }

  private drawWindow(ctx: CanvasRenderingContext2D, X: number, y: number): void {
    rect(ctx, X + 1, y + 6, TILE - 2, 30, '#efe9df');
    rect(ctx, X + 3, y + 8, TILE - 6, 26, '#8fbcd3');
    rect(ctx, X + 3, y + 20, TILE - 6, 1, '#efe9df');
    rect(ctx, X + 4, y + 9, 2, 6, '#c4e1ee');
    rect(ctx, X, y + 36, TILE, 2, '#d8d0c2');
  }

  private drawDoor(ctx: CanvasRenderingContext2D, X: number, y: number, seg: 'door' | 'flatDoor' | 'entrance'): void {
    const top = y + TILE - 2;
    const h = ROOM_ROWS * TILE - (TILE - 2);
    rect(ctx, X, top - 1, TILE, h + 1, '#efe9df');
    const leaf = seg === 'flatDoor' ? '#2f6b5a' : seg === 'entrance' ? '#23395b' : '#b07a4a';
    rect(ctx, X + 2, top + 1, TILE - 4, h - 1, leaf);
    rect(ctx, X + 3, top + 3, TILE - 6, 8, '#ffffff18');
    rect(ctx, X + 3, top + 14, TILE - 6, 14, '#00000014');
    if (seg === 'entrance') {
      rect(ctx, X + 4, top + 3, TILE - 8, 10, '#8fbcd3');
      rect(ctx, X + 1, top - TILE + 4, TILE - 2, TILE - 6, '#8fbcd3');
    }
    rect(ctx, X + TILE - 6, top + 16, 2, 2, '#d8b25a');
    if (seg === 'flatDoor') rect(ctx, X + 6, top + 5, 4, 3, '#d8b25a');
  }

  private drawStairs(ctx: CanvasRenderingContext2D, x: number, s: number, dir: 1 | -1): void {
    const X = x * TILE;
    const base = floorY(s);
    const rise = STOREY_PX;
    const run = 3 * TILE;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const sx = dir === 1 ? X + (i * run) / steps : X + run - ((i + 1) * run) / steps;
      const sy = base - ((i + 1) * rise) / steps;
      rect(ctx, sx, sy, run / steps + 1, base - sy, i % 2 ? '#7a5236' : '#835a3c');
      rect(ctx, sx, sy, run / steps + 1, 2, '#a3754f');
    }
    // Handrail.
    ctx.strokeStyle = '#3f2a1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [ax, bx] = dir === 1 ? [X, X + run] : [X + run, X];
    ctx.moveTo(ax, base - 12);
    ctx.lineTo(bx, base - rise - 12);
    ctx.stroke();
  }

  // ------------------------------------------------------------------ build mode

  private drawBuild(): void {
    const ctx = this.ctx;
    const st = this.sim.state;
    // A faint grid over the plot.
    ctx.fillStyle = '#ffffff22';
    const top = floorY(MAX_STOREYS) - ROOM_ROWS * TILE;
    for (let x = st.plot.x0; x <= st.plot.x1 + 1; x++) ctx.fillRect(x * TILE, top, 0.5, GROUND_Y - top);
    for (let s = 0; s <= MAX_STOREYS; s++) {
      ctx.fillRect(st.plot.x0 * TILE, floorY(s), (st.plot.x1 - st.plot.x0 + 1) * TILE, 0.5);
    }
    for (const m of this.build.marks) {
      ctx.fillStyle = m.ok ? '#6fd08c66' : '#e0605066';
      ctx.fillRect(m.x * TILE, floorY(m.s) - (m.r + m.h) * TILE, m.w * TILE, m.h * TILE);
    }
    const g = this.build.ghost;
    if (g) {
      const d = furnitureDef(g.def);
      ctx.globalAlpha = 0.75;
      drawFurniture(ctx, g.def, g.x * TILE, floorY(g.s) - (g.r + d.h) * TILE, g.flip);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.ok ? '#6fd08c55' : '#e0605066';
      ctx.fillRect(g.x * TILE, floorY(g.s) - (g.r + d.h) * TILE, d.w * TILE, d.h * TILE);
    }
    const sel = st.furniture.find((f) => f.id === this.build.selected);
    if (sel) {
      const d = furnitureDef(sel.def);
      ctx.strokeStyle = '#f2c46d';
      ctx.lineWidth = 1;
      ctx.strokeRect(sel.x * TILE + 0.5, floorY(sel.s) - (sel.r + d.h) * TILE + 0.5, d.w * TILE - 1, d.h * TILE - 1);
    }
  }

  // ------------------------------------------------------------------ labels

  private drawLabels(): void {
    const ctx = this.ctx;
    const c = this.camera;
    const lay = this.sim.layout;
    const toScreen = (wx: number, wy: number) => [c.ox + wx * c.scale, c.oy + wy * c.scale] as const;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Flat names, over the middle of each flat's top storey.
    const size = Math.max(9, Math.min(13, c.scale * 5));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    for (const f of lay.flats) {
      const nodes = f.rooms.flatMap((r) => lay.rooms[r].nodes).map((n) => lay.xs(n));
      const topS = Math.max(...nodes.map(([, s]) => s));
      const row = nodes.filter(([, s]) => s === topS).map(([x]) => x);
      const mid = (Math.min(...row) + Math.max(...row) + 1) / 2;
      const [sx, sy] = toScreen(mid * TILE, floorY(topS) - ROOM_ROWS * TILE + 3);
      const w = ctx.measureText(f.name).width + 8;
      ctx.fillStyle = '#1d1f23b0';
      ctx.fillRect(sx - w / 2, sy, w, size + 4);
      ctx.fillStyle = '#f3efe6';
      ctx.fillText(f.name, sx, sy + 2);
    }
    // Name tags under people, once zoomed in enough to read.
    if (c.scale < 1.6) return;
    ctx.font = `500 ${Math.min(11, c.scale * 3.5)}px system-ui, sans-serif`;
    for (const p of this.sim.state.pawns) {
      const { px, py } = this.feet(p);
      const [sx, sy] = toScreen(px, py + 1);
      const name = p.kind === 'agent' ? 'Denise' : p.name.split(' ')[0];
      const w = ctx.measureText(name).width + 6;
      ctx.fillStyle = '#1d1f2399';
      ctx.fillRect(sx - w / 2, sy, w, 13);
      ctx.fillStyle = p.id === this.selectedPawn ? '#f2c46d' : '#f3efe6';
      ctx.fillText(name, sx, sy + 1);
    }
  }
}
