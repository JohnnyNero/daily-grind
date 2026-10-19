// Draws the sim, side on. Reads state only, never changes it.
//
// The building and street are drawn once into a layer at world resolution (16 pixels a
// tile) and redrawn only when the building changes; the sky, people and build-mode
// overlays are drawn every frame on top. Everything is scaled up without smoothing.

import { furnitureDef } from '../sim/defs';
import type { Layout } from '../sim/layout';
import type { Sim } from '../sim/sim';
import { MAX_STOREYS, ROOM_ROWS, STOREY_ROWS, TILE, TICKS_PER_MINUTE, isDoor, type Pawn, type Segment } from '../sim/state';
import { FLAT_WALLS, LIGHTS, PAL, PERSON_H, box, dark, drawFurniture, drawPerson, light, mix, rect } from './art';

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

/** Doors are 30 pixels tall: a person and a bit. */
const DOOR_H = 30;

export class Renderer {
  readonly camera: Camera = { scale: 2, ox: 0, oy: 0 };
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private layerVersion = -1;
  private lightMap: HTMLCanvasElement = document.createElement('canvas');
  private lightKey = '';
  /** How far open each door is, and which way it swings. */
  private doors = new Map<string, { open: number; dir: 1 | -1 }>();
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
      if (wx < px - 7 || wx > px + 7 || wy < py - PERSON_H - 2 || wy > py + 4) continue;
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

  /** 0 in full daylight, 1 at night, in between at dawn and dusk. */
  private get darkness(): number {
    const hour = (Math.floor(this.sim.state.tick / TICKS_PER_MINUTE) % (24 * 60)) / 60;
    return 1 - Math.max(0, Math.min(1, Math.min((hour - 5.5) / 2, (20.5 - hour) / 2)));
  }

  draw(): void {
    const ctx = this.ctx;
    const c = this.camera;
    if (this.layerVersion !== this.sim.version) this.drawLayer();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawSky();
    ctx.setTransform(this.dpr * c.scale, 0, 0, this.dpr * c.scale, this.dpr * c.ox, this.dpr * c.oy);
    ctx.drawImage(this.layer, 0, 0);
    this.drawDoors(ctx);
    const pawns = [...this.sim.state.pawns].sort((a, b) => Number(!!a.front) - Number(!!b.front));
    for (const p of pawns) {
      const { px, py } = this.feet(p);
      const walking = p.path.length > 0;
      const phase = (Math.abs(p.x) * 1.6) % 1;
      drawPerson(ctx, p, Math.round(px), Math.round(py), phase, walking);
      if (p.id === this.selectedPawn) {
        ctx.strokeStyle = '#f2c46d';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(px) - 7.5, Math.round(py) - PERSON_H - 2.5, 15, PERSON_H + 4);
      }
    }
    this.drawLight(ctx);
    if (this.build.active) this.drawBuild();
    // Text at screen resolution.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels();
  }

  private drawSky(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    const d = this.darkness;
    g.addColorStop(0, mix(PAL.sky, PAL.skyNight, d));
    g.addColorStop(1, mix('#e4d8c4', '#2e2846', d));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  // ------------------------------------------------------------------ the building

  /** The back-wall colour of each room, or null where there's no wall to see (the street, the open roof). */
  private roomColours(lay: Layout): (string | null)[] {
    const flatIndex = new Map(lay.flats.map((f, i) => [f.id, i]));
    return lay.rooms.map((room) => {
      if (room.outdoor) return null;
      if (room.flat !== null) return FLAT_WALLS[(flatIndex.get(room.flat) ?? 0) % FLAT_WALLS.length];
      if (room.shared) return PAL.shared;
      return room.enclosed ? '#5a4a40' : null;
    });
  }

  private drawLayer(): void {
    const lay = this.sim.layout;
    const st = this.sim.state;
    this.layer.width = this.worldW;
    this.layer.height = this.worldH;
    const ctx = this.layer.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.worldW, this.worldH);
    const colours = this.roomColours(lay);
    this.drawStreet(ctx);
    this.drawRooms(ctx, lay, colours);
    for (const k of Object.keys(st.slabs)) {
      const [x, level] = k.split(',').map(Number);
      this.drawSlab(ctx, x, level);
    }
    for (let x = st.plot.x0; x <= st.plot.x1; x++) {
      if (lay.roomOf[lay.node(x, 0)] !== -1 && !lay.rooms[lay.roomOf[lay.node(x, 0)]].outdoor) this.drawFloorTop(ctx, x, floorY(0));
    }
    for (const t of st.stairs) this.drawStairs(ctx, t.x, t.s, t.dir);
    for (const [k, seg] of Object.entries(st.walls)) {
      const [x, s] = k.split(',').map(Number);
      this.drawWall(ctx, lay, colours, x, s, seg);
    }
    for (const f of st.furniture) {
      const d = furnitureDef(f.def);
      drawFurniture(ctx, f.def, f.x * TILE, floorY(f.s) - (f.r + d.h) * TILE, f.flip);
    }
    this.layerVersion = this.sim.version;
    this.lightKey = '';
  }

  private drawStreet(ctx: CanvasRenderingContext2D): void {
    const W = this.worldW;
    const y = GROUND_Y;
    // Neighbouring terraces either side of the plot.
    const { x0, x1 } = this.sim.state.plot;
    for (const [from, to] of [[0, x0 - 2], [x1 + 3, this.sim.state.w]] as const) {
      for (let x = from; x < to; x += 7) {
        const h = 2 + ((x * 7) % 3);
        const top = floorY(h) - 2 * TILE;
        const X = x * TILE;
        rect(ctx, X, top, 6 * TILE, y - top, '#7a5a4c');
        for (let row = top + 3; row < y; row += 4) rect(ctx, X, row, 6 * TILE, 1, '#6d4f42');
        rect(ctx, X - 2, top - 4, 6 * TILE + 4, 4, PAL.outline);
        rect(ctx, X - 1, top - 3, 6 * TILE + 2, 2, '#4a3a34');
        for (let s = 0; s < h; s++) {
          for (const wx of [1, 4]) {
            rect(ctx, (x + wx) * TILE - 1, floorY(s) - 3 * TILE + 5, TILE + 2, TILE + 8, PAL.outline);
            rect(ctx, (x + wx) * TILE, floorY(s) - 3 * TILE + 6, TILE, TILE + 6, '#3e4a5c');
            rect(ctx, (x + wx) * TILE, floorY(s) - 2 * TILE + 12, TILE, 2, PAL.white);
          }
        }
      }
    }
    rect(ctx, 0, y, W, TILE, PAL.pave);
    for (let x = 0; x < W; x += TILE) rect(ctx, x, y, 1, TILE - 4, dark(PAL.pave, 0.1));
    rect(ctx, 0, y, W, 1, light(PAL.pave, 0.2));
    rect(ctx, 0, y + TILE - 4, W, 2, dark(PAL.pave, 0.25));
    rect(ctx, 0, y + TILE - 2, W, TILE + 2, PAL.road);
    for (let x = 4; x < W; x += 3 * TILE) rect(ctx, x, y + TILE + 8, TILE, 2, '#d8d4c8');
    rect(ctx, 0, y + 2 * TILE, W, TILE, '#2a1e1a');
    // Street lamps.
    for (const x of this.streetLamps()) {
      rect(ctx, x * TILE + 7, floorY(1) - 8, 2, 4 * TILE + 8, '#2f3338');
      box(ctx, x * TILE + 3, floorY(1) - 11, 10, 4, '#2f3338');
      rect(ctx, x * TILE + 5, floorY(1) - 7, 6, 2, '#f3d98a');
    }
  }

  private streetLamps(): number[] {
    const { x0, x1 } = this.sim.state.plot;
    return [x0 - 5, x1 + 5];
  }

  /** Back walls: each flat in its own colour, shared space plain, a flat with nothing in it stripped to the brick. */
  private drawRooms(ctx: CanvasRenderingContext2D, lay: Layout, colours: (string | null)[]): void {
    for (const room of lay.rooms) {
      const colour = colours[room.id];
      if (!colour) continue;
      const bare = room.flat !== null && !this.sim.state.furniture.some((f) => lay.flatAt(f.x, f.s)?.id === room.flat);
      for (const n of room.nodes) {
        const [x, s] = lay.xs(n);
        if (!room.enclosed && !lay.slab(x, s + 1)) continue;
        this.backWall(ctx, x * TILE, s, TILE, bare ? null : colour);
      }
    }
  }

  /** A strip of back wall in a storey: wallpaper with a skirting board, or bare brick. */
  private backWall(ctx: CanvasRenderingContext2D, X: number, s: number, w: number, colour: string | null): void {
    const y = floorY(s) - ROOM_ROWS * TILE;
    const H = ROOM_ROWS * TILE;
    if (!colour) {
      rect(ctx, X, y, w, H, '#a8826a');
      for (let row = 0; row < ROOM_ROWS * 4; row++) {
        rect(ctx, X, y + row * 4 + 3, w, 1, '#957260');
        for (let bx = X + (row % 2 ? 3 : 11); bx < X + w; bx += TILE) rect(ctx, bx, y + row * 4, 1, 3, '#957260');
      }
      return;
    }
    rect(ctx, X, y, w, H, colour);
    for (let sx = X + 6 - (X % 10); sx < X + w; sx += 10) if (sx >= X) rect(ctx, sx, y, 1, H, light(colour, 0.08));
    rect(ctx, X, y, w, 2, dark(colour, 0.12));
    rect(ctx, X, floorY(s) - 3, w, 3, PAL.skirting);
  }

  private drawSlab(ctx: CanvasRenderingContext2D, x: number, level: number): void {
    const y = floorY(level);
    const X = x * TILE;
    rect(ctx, X, y, TILE, TILE, PAL.slab);
    for (let xx = X + (level % 2); xx < X + TILE; xx += 2) rect(ctx, xx, y + TILE - 2, 1, 1, dark(PAL.slab, 0.25));
    rect(ctx, X, y + TILE - 1, TILE, 1, PAL.outline);
    this.drawFloorTop(ctx, x, y);
  }

  private drawFloorTop(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const X = x * TILE;
    rect(ctx, X, y, TILE, 3, PAL.floor);
    rect(ctx, X, y, TILE, 1, light(PAL.floor, 0.15));
    rect(ctx, X + ((x * 5) % 13), y, 1, 3, PAL.floorLine);
  }

  /** The colour of the back wall beside a wall segment, on one side. */
  private sideColour(lay: Layout, colours: (string | null)[], x: number, s: number): string | null {
    if (x < 0 || x >= lay.w) return null;
    const room = lay.roomOf[lay.node(x, s)];
    if (room === -1) return null;
    const bare = lay.rooms[room].flat !== null && !this.sim.state.furniture.some((f) => lay.flatAt(f.x, f.s)?.id === lay.rooms[room].flat);
    return bare ? 'bare' : colours[room];
  }

  /**
   * A wall segment: a thin wall (brick on the outside of the building) with the rooms either
   * side showing behind it. Windows and doors are gaps; a window is a line of glass, and doors
   * are drawn every frame so they can swing.
   */
  private drawWall(ctx: CanvasRenderingContext2D, lay: Layout, colours: (string | null)[], x: number, s: number, seg: Segment): void {
    const X = x * TILE;
    const H = ROOM_ROWS * TILE;
    const y = floorY(s) - H;
    for (const [side, ox] of [[-1, 0], [1, TILE / 2]] as const) {
      const c = this.sideColour(lay, colours, x + side, s);
      if (c) this.backWall(ctx, X + ox, s, TILE / 2, c === 'bare' ? null : c);
    }
    const outer = x === this.sim.state.plot.x0 || x === this.sim.state.plot.x1;
    const bw = outer ? 8 : 4;
    const bx = X + (TILE - bw) / 2;
    const body = (top: number, h: number) => {
      if (h <= 0) return;
      if (outer) {
        rect(ctx, bx, top, bw, h, PAL.brick);
        for (let row = top; row < top + h; row += 4) {
          rect(ctx, bx, row + 3, bw, 1, PAL.mortar);
          rect(ctx, bx + ((row / 4) % 2 ? 2 : 5), row, 1, 3, PAL.mortar);
        }
      } else {
        rect(ctx, bx, top, bw, h, '#8a7262');
        rect(ctx, bx + 1, top, 2, h, '#a08878');
      }
      rect(ctx, bx - 1, top, 1, h, PAL.outline);
      rect(ctx, bx + bw, top, 1, h, PAL.outline);
    };
    if (seg === 'window') {
      body(y, 8);
      body(y + 38, H - 38);
      rect(ctx, X + 7, y + 8, 2, 30, PAL.glass);
      rect(ctx, X + 7, y + 20, 2, 1, light(PAL.glass, 0.6));
      box(ctx, X + 2, y + 37, 12, 3, PAL.white);
    } else if (isDoor(seg)) {
      body(y, H - DOOR_H - 1);
      box(ctx, X + 1, y + H - DOOR_H - 2, TILE - 2, 3, PAL.woodDark);
    } else body(y, H);
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
      box(ctx, sx, sy, run / steps + 1, base - sy, i % 2 ? PAL.wood : dark(PAL.wood, 0.08));
    }
    ctx.strokeStyle = PAL.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [ax, bx] = dir === 1 ? [X, X + run] : [X + run, X];
    ctx.moveTo(ax, base - 14);
    ctx.lineTo(bx, base - rise - 14);
    ctx.stroke();
  }

  // ------------------------------------------------------------------ doors

  /**
   * Doors seen side on: a line when shut, a panel swinging out into the room as someone
   * passes through, towards the way they're going.
   */
  private drawDoors(ctx: CanvasRenderingContext2D): void {
    const st = this.sim.state;
    for (const [k, seg] of Object.entries(st.walls)) {
      if (!isDoor(seg)) continue;
      const [x, s] = k.split(',').map(Number);
      const state = this.doors.get(k) ?? { open: 0, dir: 1 as 1 | -1 };
      const near = st.pawns.find((p) => Math.abs(p.s - s) < 0.2 && Math.abs(p.x - x) < 1 && !p.front);
      if (near) state.dir = near.facing;
      state.open = Math.max(0, Math.min(1, state.open + (near ? 0.12 : -0.06)));
      this.doors.set(k, state);
      const leaf = seg === 'flatDoor' ? '#2f6b5a' : seg === 'entrance' ? '#2b3a5a' : PAL.door;
      const F = floorY(s);
      const hinge = x * TILE + 8;
      const w = Math.round(12 * Math.sin((state.open * Math.PI) / 2));
      if (w <= 1) {
        rect(ctx, hinge - 1, F - DOOR_H, 2, DOOR_H, leaf);
        continue;
      }
      const left = state.dir === 1 ? hinge : hinge - w;
      box(ctx, left, F - DOOR_H, w, DOOR_H, leaf);
      if (w > 4) rect(ctx, state.dir === 1 ? left + w - 3 : left + 2, F - 15, 1, 2, PAL.poster);
    }
  }

  // ------------------------------------------------------------------ evening light

  /**
   * At dusk the whole scene is multiplied by a light map: dark blue outside, a softer dim
   * indoors, and warm pools around lamps, tellies, screens, ceiling lights and street lamps.
   * Redrawn when the hour moves on or the building changes.
   */
  private drawLight(ctx: CanvasRenderingContext2D): void {
    const d = this.darkness;
    if (d <= 0) return;
    const key = `${Math.round(d * 40)}|${this.sim.version}`;
    if (key !== this.lightKey) this.drawLightMap(d);
    this.lightKey = key;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.lightMap, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawLightMap(d: number): void {
    const lay = this.sim.layout;
    const st = this.sim.state;
    const m = this.lightMap;
    m.width = this.worldW;
    m.height = this.worldH;
    const c = m.getContext('2d')!;
    c.fillStyle = mix('#ffffff', '#5a5a8a', d);
    c.fillRect(0, 0, m.width, m.height);
    c.fillStyle = mix('#ffffff', '#c4b0b4', d);
    for (const room of lay.rooms) {
      if (room.outdoor) continue;
      for (const n of room.nodes) {
        const [x, s] = lay.xs(n);
        if (!room.enclosed && !lay.slab(x, s + 1)) continue;
        c.fillRect(x * TILE - 8, floorY(s) - ROOM_ROWS * TILE, TILE + 16, ROOM_ROWS * TILE + 3);
      }
    }
    c.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, colour: string, k: number) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, colour);
      g.addColorStop(1, '#00000000');
      c.globalAlpha = k * d;
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const f of st.furniture) {
      const colour = LIGHTS[f.def];
      if (!colour) continue;
      const def = furnitureDef(f.def);
      const cx = (f.x + def.w / 2) * TILE;
      const cy = floorY(f.s) - (f.r + def.h) * TILE + (f.def === 'lamp' ? 4 : 10);
      glow(cx, cy, f.def === 'lamp' ? 46 : f.def === 'tv' ? 26 : 18, colour, f.def === 'lamp' ? 0.75 : 0.5);
    }
    // A ceiling light in every lived-in room and on the landings.
    for (const room of lay.rooms) {
      if (room.outdoor || !room.enclosed) continue;
      const lit = room.shared || this.sim.state.furniture.some((f) => lay.roomOf[lay.node(f.x, f.s)] === room.id);
      if (!lit) continue;
      for (const s of new Set(room.nodes.map((n) => lay.xs(n)[1]))) {
        const xs = room.nodes.filter((n) => lay.xs(n)[1] === s).map((n) => lay.xs(n)[0]);
        const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE;
        glow(cx, floorY(s) - ROOM_ROWS * TILE + 8, Math.min(70, (Math.max(...xs) - Math.min(...xs) + 2) * 7), '#ffd08a', 0.6);
      }
    }
    // Lit windows glow a little into the street.
    for (const [k, seg] of Object.entries(st.walls)) {
      if (seg !== 'window') continue;
      const [x, s] = k.split(',').map(Number);
      glow(x * TILE + 8, floorY(s) - 26, 14, '#ffd890', 0.5);
    }
    for (const x of this.streetLamps()) glow(x * TILE + 8, floorY(1) - 6, 40, '#ffd88a', 0.6);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
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
