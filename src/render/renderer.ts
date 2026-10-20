// Draws the sim, side on. Reads state only, never changes it.
//
// The building and street are drawn once into a layer at world resolution (16 pixels a
// tile) and redrawn only when the building changes; the sky, people and build-mode
// overlays are drawn every frame on top. Everything is scaled up without smoothing.

import { furnitureDef } from '../sim/defs';
import type { Layout } from '../sim/layout';
import type { Sim } from '../sim/sim';
import { DOOR_ROWS, MAX_ROWS, TILE, TICKS_PER_MINUTE, isDoor, key, seconds, type Card, type CellKind, type Grade, type Pawn } from '../sim/state';
import { SHARED, noiseReaching, tempOf, warmthOf } from '../sim/environment';
import { FLAT_WALLS, LIGHTS, PAL, box, dark, edge, drawAnimal, drawFurniture, drawIcon, drawPerson, drawSleeper, iconName, light, mix, pawnHeight, rect, PERSON_H } from './art';
import { mapFit } from '../sim/fit';
import { BUDGET } from '../sim/tuning';
import { spacesOf } from '../sim/shared';
import { flatKind } from '../sim/rooms';
import { flightOf, unsupportedCells, type BuildParts } from '../sim/build';
import { currentPiece, partsOf, piecesBetween, type Piece } from '../sim/works';

const SKY_ROWS = 4;
const GROUND_ROWS = 3;
/** World y of the ground surface. */
export const GROUND_Y = (SKY_ROWS + MAX_ROWS) * TILE;
/** Rows to a storey, for the neighbouring houses and the street lamps. */
const STOREY = 4;

/** World y of the bottom of row s (where the feet of someone standing in it are). */
export const floorY = (s: number) => GROUND_Y - s * TILE;

const STEP = '#b9ad98';
const STEP_EDGE = '#d8cdb8';

export interface Camera {
  /** Screen (CSS) pixels per world pixel. */
  scale: number;
  ox: number;
  oy: number;
}

/** A cell of the grid: column and row. */
export interface Cell {
  x: number;
  s: number;
}

export interface BuildView {
  active: boolean;
  /** Cells the current tool would change, and whether it can. */
  marks: { x: number; s: number; w: number; h: number; ok: boolean }[];
  /** Furniture being placed, where it would go. */
  ghost: { def: string; x: number; s: number; flip: boolean; ok: boolean; grade?: Grade } | null;
  selected: number | null;
  version: number;
}


// ------------------------------------------------------------------ the bubble budget (spec 2.5)

/** Where a bubble sits in the budget: card markers first, then talk, then moments, then habits. */
export type BubbleRank = 0 | 1 | 2 | 3;

/** Something that wants a bubble this frame: a pawn's own, or a card's `!` (keyed by minus the card's id). */
export interface BubbleCand {
  key: number;
  rank: BubbleRank;
  /** What it says: changes when the bubble does. */
  sig: string;
  text: string;
  icon?: string;
  card?: number;
  pawn?: number;
}

interface Held {
  cand: BubbleCand;
  since: number;
}

/**
 * Keeps bubbles to BUDGET.bubbles on screen, best first, and each up for at least
 * BUDGET.bubbleSeconds of real time (`now` is in ms from a clock you pass in, so tests can fake it).
 * The sim's `until` is only a minimum: a bubble the sim has dropped stays till its time is up,
 * and one being talked over waits its turn.
 */
export class BubbleBudget {
  private held = new Map<number, Held>();

  constructor(
    private readonly most = BUDGET.bubbles,
    private readonly minMs = BUDGET.bubbleSeconds * 1000,
  ) {}

  /** The bubbles to draw now, worst first (so the best end up on top). */
  pick(cands: BubbleCand[], now: number): BubbleCand[] {
    const want = new Map<number, BubbleCand>();
    for (const c of cands) {
      const was = want.get(c.key);
      if (!was || c.rank < was.rank) want.set(c.key, c);
    }
    const served = (h: Held) => now - h.since >= this.minMs;
    for (const [k, h] of this.held) {
      const c = want.get(k);
      if (c && c.sig === h.cand.sig) {
        h.cand = c;
        want.delete(k);
      } else if (c && (c.rank === 0 || served(h))) {
        this.held.delete(k);
      } else if (c) {
        // Same pawn, something new to say, but the old one's not had its time yet.
        want.delete(k);
      } else if (served(h)) this.held.delete(k);
    }
    const fresh = [...want.values()].sort((a, b) => a.rank - b.rank);
    for (const c of fresh) {
      if (this.held.size >= this.most) {
        // Make room by dropping the worst that's had its time, if this one beats it.
        let worst: [number, Held] | null = null;
        for (const e of this.held) {
          if (!served(e[1]) || e[1].cand.rank <= c.rank) continue;
          if (!worst || e[1].cand.rank > worst[1].cand.rank || (e[1].cand.rank === worst[1].cand.rank && e[1].since < worst[1].since)) worst = e;
        }
        if (!worst) continue;
        this.held.delete(worst[0]);
      }
      this.held.set(c.key, { cand: c, since: now });
    }
    return [...this.held.values()].map((h) => h.cand).sort((a, b) => b.rank - a.rank);
  }

  /** Anything still waiting out its time (so the frame needs drawing again). */
  get any(): boolean {
    return this.held.size > 0;
  }
}

// ------------------------------------------------------------------ edge chips and the arrival pulse

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Chip {
  x: number;
  y: number;
  side: 'left' | 'right' | 'top' | 'bottom';
}

/** Radius of an edge chip, and the room round it, in screen pixels. */
export const CHIP_R = 15;
const CHIP_GAP = 6;

/**
 * Where the `!` chip for an off-screen spot goes: on the edge of the box on the side it's
 * on, and clear of `avoid` (the alerts column). Null if the spot is inside the box.
 */
export function chipFor(ax: number, ay: number, box: Rect, avoid?: Rect): Chip | null {
  const x1 = box.x + box.w;
  const y1 = box.y + box.h;
  if (ax >= box.x && ax <= x1 && ay >= box.y && ay <= y1) return null;
  const m = CHIP_R + CHIP_GAP;
  const cx = Math.max(box.x + m, Math.min(x1 - m, ax));
  const cy = Math.max(box.y + m, Math.min(y1 - m, ay));
  // The side it's furthest past, as a share of the box.
  const dx = ax < box.x ? (box.x - ax) / box.w : ax > x1 ? (ax - x1) / box.w : 0;
  const dy = ay < box.y ? (box.y - ay) / box.h : ay > y1 ? (ay - y1) / box.h : 0;
  let chip: Chip;
  if (dx >= dy) chip = { side: ax < box.x ? 'left' : 'right', x: ax < box.x ? box.x + m : x1 - m, y: cy };
  else chip = { side: ay < box.y ? 'top' : 'bottom', x: cx, y: ay < box.y ? box.y + m : y1 - m };
  if (avoid && chip.x + CHIP_R > avoid.x && chip.x - CHIP_R < avoid.x + avoid.w && chip.y + CHIP_R > avoid.y && chip.y - CHIP_R < avoid.y + avoid.h) {
    if (chip.side === 'right') chip.y = Math.min(y1 - m, avoid.y + avoid.h + CHIP_R + CHIP_GAP);
    else chip.x = Math.max(box.x + m, avoid.x - CHIP_R - CHIP_GAP);
  }
  return chip;
}

/** How long the pale ring round a new card's subject takes, in real ms. */
export const PULSE_MS = 500;

/** 0 to 1 through the ring, or null once it's done (or before it began). */
export function pulseAt(since: number, now: number): number | null {
  const t = (now - since) / PULSE_MS;
  return t < 0 || t >= 1 ? null : t;
}

/** What a card is about, in world pixels. */
export interface Spot {
  /** Its bounding box. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The cell it's in. */
  cell: Cell;
  /** Pawn id of the person, if it's about one (the marker takes the place of their own bubble). */
  pawn?: number;
}

/** Doors are 30 pixels tall: a person and a bit. */
const DOOR_H = 30;

/** The builder, for drawing (not a person in the sim). */
const BUILDER = { look: { skin: 1, hair: 2, top: 3, legs: 1 }, facing: 1, kind: 'passerby' } as Pawn;

export class Renderer {
  readonly camera: Camera = { scale: 2, ox: 0, oy: 0 };
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private layerVersion = -1;
  private lightMap: HTMLCanvasElement = document.createElement('canvas');
  private lightKey = '';
  /** A tint over each flat: noise getting in, warmth, or how much they like it. */
  overlay: 'none' | 'noise' | 'warmth' | 'liking' = 'none';
  /** How far open each door is, and which way it swings. */
  private doors = new Map<string, { open: number; dir: 1 | -1 }>();
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  selectedPawn: number | null = null;
  /** Real time in ms (a fake one in tests). The bubble hold and the arrival pulse run on it. */
  clock: () => number = () => performance.now();
  /** The part of the screen the building shows in (set by fit and focus): chips sit on its edge. */
  private box: Rect | null = null;
  /** The alerts column's size, top right of the box: chips keep clear of it. */
  alertsSize = { w: 160, h: 150 };
  private bubbles = new BubbleBudget();
  /** When each open card was first drawn (real ms), for its pulse. */
  private seen = new Map<number, number>();
  /** Where the `!` markers and chips were last drawn, for taps. */
  private hits: { card: number; x: number; y: number; r: number; chip: boolean }[] = [];
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
    let top = STOREY;
    for (const k of Object.keys(st.cells)) top = Math.max(top, Number(k.split(',')[1]) + 1);
    this.frame((st.plot.x0 - 3) * TILE, (st.plot.x1 + 4) * TILE, floorY(top) - 3 * TILE, GROUND_Y + 2 * TILE, { x, y, w, h });
  }

  /** Frames columns x0 to x1 and rows s0 to s1 (with a tile round them) inside the screen box. */
  focus(x0: number, x1: number, s0: number, s1: number, box: { x: number; y: number; w: number; h: number }): void {
    this.frame((x0 - 1) * TILE, (x1 + 2) * TILE, floorY(s1 + 1) - TILE, floorY(s0) + TILE, box, 8);
  }

  /** Fits a box of the world inside a box of the screen, centred. */
  private frame(wx0: number, wx1: number, wy0: number, wy1: number, box: { x: number; y: number; w: number; h: number }, most = 6): void {
    this.box = { ...box };
    const scale = Math.min(most, box.w / (wx1 - wx0), box.h / (wy1 - wy0));
    this.camera.scale = Math.max(0.5, Math.floor(scale * 4) / 4 || scale);
    this.camera.ox = box.x + (box.w - (wx1 - wx0) * this.camera.scale) / 2 - wx0 * this.camera.scale;
    this.camera.oy = box.y + (box.h - (wy1 - wy0) * this.camera.scale) / 2 - wy0 * this.camera.scale;
  }

  toWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: (sx - this.camera.ox) / this.camera.scale, wy: (sy - this.camera.oy) / this.camera.scale };
  }

  cellAt(sx: number, sy: number): Cell | null {
    const { wx, wy } = this.toWorld(sx, sy);
    const rel = GROUND_Y - wy;
    if (rel < 0 || wx < 0 || wx >= this.worldW) return null;
    const s = Math.floor(rel / TILE);
    if (s >= MAX_ROWS) return null;
    return { x: Math.floor(wx / TILE), s };
  }

  pawnAt(sx: number, sy: number): Pawn | null {
    const { wx, wy } = this.toWorld(sx, sy);
    let best: Pawn | null = null;
    let bestD = Infinity;
    for (const p of this.visiblePawns()) {
      const { px, py } = this.feet(p);
      const half = p.kind === 'animal' ? 9 : 7;
      if (wx < px - half || wx > px + half || wy < py - pawnHeight(p) - 2 || wy > py + 4) continue;
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
    this.drawDirt(ctx);
    this.drawDoors(ctx);
    const pawns = this.visiblePawns().sort((a, b) => Number(!!a.front) - Number(!!b.front));
    for (const p of pawns) {
      const { px, py } = this.feet(p);
      const tick = this.sim.state.tick;
      const walking = p.path.length > 0;
      if (p.kind === 'animal') {
        drawAnimal(ctx, p, Math.round(px), Math.round(py), (Math.abs(p.x) * 1.6) % 1, walking, tick);
      } else if (p.pose === 'sleep') {
        this.drawAsleep(ctx, p, px, py);
        continue;
      } else {
        const phase = p.pose === 'dance' ? (tick / 14) % 1 : (Math.abs(p.x) * 1.6) % 1;
        drawPerson(ctx, p, Math.round(px), Math.round(py), phase, walking, { seated: this.onSeat(p), tick });
      }
      if (p.id === this.selectedPawn) {
        ctx.strokeStyle = '#f2c46d';
        ctx.lineWidth = 1;
        const h = pawnHeight(p);
        ctx.strokeRect(Math.round(px) - 7.5, Math.round(py) - h - 2.5, 15, h + 4);
      }
    }
    this.drawLight(ctx);
    if (this.overlay !== 'none') this.drawOverlay(ctx);
    this.drawWorks(ctx);
    if (this.build.active) this.drawBuild();
    this.drawSelected(ctx);
    // Text at screen resolution.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels();
  }

  /** Sat on something (a chair, the loo): reading or on the phone, they're drawn sitting. */
  private onSeat(p: Pawn): boolean {
    const id = p.life?.using?.furniture;
    const f = id === undefined ? undefined : this.sim.state.furniture.find((o) => o.id === id);
    return !!f && !!furnitureDef(f.def).offers?.some((o) => o.pose === 'sit');
  }

  /** Everyone on the map (tenants at work or out aren't). */
  private visiblePawns(): Pawn[] {
    return this.sim.state.pawns.filter((p) => !p.life?.away);
  }

  /** Asleep: head on the pillow in bed, or stretched out on the sofa or the floor. */
  private drawAsleep(ctx: CanvasRenderingContext2D, p: Pawn, px: number, py: number): void {
    const u = p.life?.using;
    const f = u ? this.sim.state.furniture.find((o) => o.id === u.furniture) : undefined;
    if (f && (f.def === 'bed' || f.def === 'doubleBed')) {
      const def = furnitureDef(f.def);
      const left = f.x * TILE;
      const W = def.w * TILE;
      const pillow = f.flip ? left + W - 13 : left + 3;
      const across = (u?.spot ?? 0) * 11 * (f.flip ? -1 : 1);
      drawSleeper(ctx, p, pillow + across, floorY(f.s) - 15, false);
    } else if (f) {
      const def = furnitureDef(f.def);
      drawSleeper(ctx, p, f.x * TILE + (f.flip ? def.w * TILE - 14 : 4), floorY(f.s) - 15, true, f.flip);
    } else drawSleeper(ctx, p, Math.round(px) - 12, Math.round(py) - 8, true);
    // A little z above them.
    const zx = Math.round(px) + 4;
    const zy = Math.round(py) - 26 - (Math.floor(this.sim.state.tick / 90) % 3) * 2;
    rect(ctx, zx, zy, 4, 1, PAL.white);
    rect(ctx, zx + 2, zy + 1, 1, 1, PAL.white);
    rect(ctx, zx + 1, zy + 2, 1, 1, PAL.white);
    rect(ctx, zx, zy + 3, 4, 1, PAL.white);
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
    for (const [k, kind] of Object.entries(st.cells)) {
      const [x, s] = k.split(',').map(Number);
      this.drawCell(ctx, lay, colours, x, s, kind);
    }
    this.drawDoorsteps(ctx, lay);
    // Rugs first, so everything else stands on them.
    const drawOrder = [...st.furniture].sort((a, b) => Number(!!furnitureDef(b.def).underfoot) - Number(!!furnitureDef(a.def).underfoot));
    for (const f of drawOrder) {
      const d = furnitureDef(f.def);
      const top = floorY(f.s) - d.h * TILE;
      drawFurniture(ctx, f.def, f.x * TILE, top, f.flip, f.grade);
      // Broken: a red tag with a "!" on its top corner.
      if (f.broken !== undefined) {
        const tx = (f.x + d.w) * TILE - 7;
        rect(ctx, tx, top - 3, 6, 9, PAL.outline);
        rect(ctx, tx + 1, top - 2, 4, 7, '#d0452f');
        rect(ctx, tx + 2, top - 1, 2, 3, '#fff4e0');
        rect(ctx, tx + 2, top + 3, 2, 1, '#fff4e0');
      }
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
        const top = floorY(h * STOREY) - 2 * TILE;
        const X = x * TILE;
        rect(ctx, X, top, 6 * TILE, y - top, '#7a5a4c');
        for (let row = top + 3; row < y; row += 4) rect(ctx, X, row, 6 * TILE, 1, '#6d4f42');
        rect(ctx, X - 2, top - 4, 6 * TILE + 4, 4, PAL.outline);
        rect(ctx, X - 1, top - 3, 6 * TILE + 2, 2, '#4a3a34');
        for (let s = 0; s < h; s++) {
          for (const wx of [1, 4]) {
            rect(ctx, (x + wx) * TILE - 1, floorY(s * STOREY) - 3 * TILE + 5, TILE + 2, TILE + 8, PAL.outline);
            rect(ctx, (x + wx) * TILE, floorY(s * STOREY) - 3 * TILE + 6, TILE, TILE + 6, '#3e4a5c');
            rect(ctx, (x + wx) * TILE, floorY(s * STOREY) - 2 * TILE + 12, TILE, 2, PAL.white);
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
      rect(ctx, x * TILE + 7, floorY(STOREY) - 8, 2, 4 * TILE + 8, '#2f3338');
      box(ctx, x * TILE + 3, floorY(STOREY) - 11, 10, 4, '#2f3338');
      rect(ctx, x * TILE + 5, floorY(STOREY) - 7, 6, 2, '#f3d98a');
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
      const bare = this.isBare(lay, room.id);
      for (const n of room.cells) {
        const [x, s] = lay.xs(n);
        this.backWall(ctx, lay, x * TILE, s, TILE, bare ? null : colour);
      }
    }
    // Floorboards on the ground inside the building.
    for (let x = this.sim.state.plot.x0; x <= this.sim.state.plot.x1; x++) {
      const room = lay.roomOf[lay.node(x, 0)];
      if (room !== -1 && !lay.rooms[room].outdoor) this.drawFloorTop(ctx, x, floorY(0));
    }
  }

  /** A flat with no furniture in it at all is stripped to the brick. */
  private isBare(lay: Layout, room: number): boolean {
    const flat = lay.rooms[room].flat;
    return flat !== null && !this.sim.state.furniture.some((f) => lay.flatAt(f.x, f.s)?.id === flat);
  }

  /** One cell of back wall: wallpaper (with a skirting board along the floor), or bare brick. */
  private backWall(ctx: CanvasRenderingContext2D, lay: Layout, X: number, s: number, w: number, colour: string | null): void {
    const y = floorY(s) - TILE;
    if (!colour) {
      rect(ctx, X, y, w, TILE, '#a8826a');
      for (let row = 0; row < 4; row++) {
        rect(ctx, X, y + row * 4 + 3, w, 1, '#957260');
        for (let bx = X + ((s * 4 + row) % 2 ? 3 : 11) - (X % TILE); bx < X + w; bx += TILE) if (bx >= X) rect(ctx, bx, y + row * 4, 1, 3, '#957260');
      }
      return;
    }
    rect(ctx, X, y, w, TILE, colour);
    for (let sx = X + 6 - (X % 10); sx < X + w; sx += 10) if (sx >= X) rect(ctx, sx, y, 1, TILE, light(colour, 0.08));
    const x = Math.floor(X / TILE);
    if (lay.solid(x, s + 1)) rect(ctx, X, y, w, 2, dark(colour, 0.12));
    if (lay.solid(x, s - 1)) rect(ctx, X, floorY(s) - 3, w, 3, PAL.skirting);
  }

  private drawFloorTop(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const X = x * TILE;
    rect(ctx, X, y, TILE, 3, PAL.floor);
    rect(ctx, X, y, TILE, 1, light(PAL.floor, 0.15));
    rect(ctx, X + ((x * 5) % 13), y, 1, 3, PAL.floorLine);
  }

  /** The colour of the back wall in a cell, for showing through a doorway. */
  private sideColour(lay: Layout, colours: (string | null)[], x: number, s: number): string | null {
    if (x < 0 || x >= lay.w || s < 0 || s >= lay.rows) return null;
    const room = lay.roomOf[lay.node(x, s)];
    if (room === -1) return null;
    return this.isBare(lay, room) ? 'bare' : colours[room];
  }

  /**
   * Steps up from the pavement to a street door that's raised off the ground: two stone
   * treads, seen side on, in the cell in front of the door.
   */
  private drawDoorsteps(ctx: CanvasRenderingContext2D, lay: Layout): void {
    for (const [k, kind] of Object.entries(this.sim.state.cells)) {
      if (kind !== 'entrance') continue;
      const [x, s] = k.split(',').map(Number);
      if (s !== 1) continue;
      for (const dx of [-1, 1]) {
        if (lay.inPlot(x + dx)) continue;
        const X = (x + dx) * TILE;
        const near = dx < 0 ? X + TILE / 2 : X;
        const far = dx < 0 ? X : X + TILE / 2;
        box(ctx, far, GROUND_Y - TILE / 2, TILE / 2, TILE / 2, STEP);
        box(ctx, near, GROUND_Y - TILE, TILE / 2, TILE, STEP);
        // Worn front edges.
        rect(ctx, far, GROUND_Y - TILE / 2, TILE / 2, 1, STEP_EDGE);
        rect(ctx, near, GROUND_Y - TILE, TILE / 2, 1, STEP_EDGE);
      }
    }
  }

  /** Does this cell face the outside (so it's brick)? */
  private facesOutside(lay: Layout, x: number, s: number): boolean {
    // The plinth along the street is brick, like the outside walls.
    if (s === 0) return true;
    for (const [dx, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ns = s + ds;
      if (ns < 0) continue;
      if (!lay.inPlot(nx)) return true;
      const room = lay.air(nx, ns) ? lay.roomOf[lay.node(nx, ns)] : -1;
      if (room !== -1 && lay.rooms[room].outdoor) return true;
    }
    return false;
  }

  /**
   * One cell of the building. Walls are brick where they face the outside and plaster
   * inside, with floorboards on top where there's a room over them. A window is a line of
   * glass in its cell; a doorway shows the rooms either side (the door itself is drawn
   * every frame, so it can swing); a stair is part of a flight climbing away from you.
   */
  private drawCell(ctx: CanvasRenderingContext2D, lay: Layout, colours: (string | null)[], x: number, s: number, kind: CellKind): void {
    const X = x * TILE;
    const Y = floorY(s) - TILE;
    if (isDoor(kind)) {
      for (let r = 0; r < DOOR_ROWS; r++) {
        for (const [side, ox] of [[-1, 0], [1, TILE / 2]] as const) {
          const c = this.sideColour(lay, colours, x + side, s + r);
          if (c) this.backWall(ctx, lay, X + ox, s + r, TILE / 2, c === 'bare' ? null : c);
        }
      }
      return;
    }
    if (kind === 'stair') {
      this.drawStair(ctx, x, s);
      return;
    }
    const outer = this.facesOutside(lay, x, s);
    const base = outer ? PAL.brick : '#8a7262';
    rect(ctx, X, Y, TILE, TILE, base);
    if (outer) {
      for (let row = 0; row < 4; row++) {
        rect(ctx, X, Y + row * 4 + 3, TILE, 1, PAL.mortar);
        for (let bx = X + ((s * 4 + row) % 2 ? 3 : 11); bx < X + TILE; bx += 8) rect(ctx, bx, Y + row * 4, 1, 3, PAL.mortar);
      }
    } else {
      rect(ctx, X, Y + 5, TILE, 1, '#a08878');
      rect(ctx, X, Y + 12, TILE, 1, '#7a6252');
    }
    // Edges only where the wall meets air, so neighbouring cells read as one wall.
    const e = edge(base);
    if (!lay.solid(x - 1, s) || isDoor(lay.cell(x - 1, s))) rect(ctx, X, Y, 1, TILE, e);
    if (!lay.solid(x + 1, s) || isDoor(lay.cell(x + 1, s))) rect(ctx, X + TILE - 1, Y, 1, TILE, e);
    if (s > 0 && !lay.solid(x, s - 1)) rect(ctx, X, Y + TILE - 1, TILE, 1, e);
    if (this.sim.state.insulated[key(x, s)]) {
      rect(ctx, X + 3, Y + 3, TILE - 6, TILE - 6, '#e3c45a');
      rect(ctx, X + 5, Y + 5, 2, 2, '#c9a63e');
      rect(ctx, X + 9, Y + 9, 2, 2, '#c9a63e');
    }
    if (kind === 'window') {
      rect(ctx, X + 1, Y + 1, TILE - 2, TILE - 2, light(PAL.glass, 0.25));
      rect(ctx, X + 7, Y, 2, TILE, PAL.glass);
      rect(ctx, X + 7, Y + 5, 2, 1, light(PAL.glass, 0.6));
    }
    // Floorboards where there's a room on top.
    if (lay.air(x, s + 1) && lay.roomOf[lay.node(x, s + 1)] !== -1 && !lay.rooms[lay.roomOf[lay.node(x, s + 1)]].outdoor) this.drawFloorTop(ctx, x, Y);
  }

  /**
   * A stair cell, part of a flight climbing straight away from you: treads all the same
   * width, a little darker the higher they go, between two side rails.
   */
  private drawStair(ctx: CanvasRenderingContext2D, x: number, s: number): void {
    const X = x * TILE;
    const rows = flightOf(this.sim.state, x, s);
    const height = rows.length * 4;
    const from = (s - rows[0]) * 4;
    for (let j = 0; j < 4; j++) {
      const k = from + j;
      const t = k / Math.max(1, height - 1);
      const inset = 1;
      const y = floorY(s) - (j + 1) * 4;
      rect(ctx, X + inset, y, TILE - inset * 2, 4, dark(PAL.wood, 0.1 + t * 0.35));
      rect(ctx, X + inset, y, TILE - inset * 2, 1, light(PAL.wood, 0.25 - t * 0.2));
    }
    rect(ctx, X, floorY(s) - TILE, 1, TILE, edge(PAL.wood));
    rect(ctx, X + TILE - 1, floorY(s) - TILE, 1, TILE, edge(PAL.wood));
  }

  // ------------------------------------------------------------------ doors

  /**
   * Doors seen side on: a line down the slot when shut, a panel swinging out into the room
   * as someone passes through, towards the way they're going.
   */
  private drawDoors(ctx: CanvasRenderingContext2D): void {
    const st = this.sim.state;
    for (const [k, kind] of Object.entries(st.cells)) {
      if (!isDoor(kind)) continue;
      const [x, s] = k.split(',').map(Number);
      const state = this.doors.get(k) ?? { open: 0, dir: 1 as 1 | -1 };
      const near = st.pawns.find((p) => !p.life?.away && Math.abs(p.s - s) < 0.2 && Math.abs(p.x - x) < 1 && !p.front);
      if (near) state.dir = near.facing;
      state.open = Math.max(0, Math.min(1, state.open + (near ? 0.12 : -0.06)));
      this.doors.set(k, state);
      const leaf = kind === 'flatDoor' ? '#2f6b5a' : kind === 'entrance' ? '#2b3a5a' : PAL.door;
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

  // ------------------------------------------------------------------ dirt and overlays

  /** Specks on the floor where it's dirty, more the dirtier it is. */
  private drawDirt(ctx: CanvasRenderingContext2D): void {
    const lay = this.sim.layout;
    const dirt = this.sim.state.dirt;
    for (const room of lay.rooms) {
      if (room.outdoor) continue;
      const d = room.flat !== null ? (dirt[room.flat] ?? 0) : room.shared ? (dirt[SHARED] ?? 0) : 0;
      if (d < 0.15) continue;
      const count = Math.floor(d * 6);
      for (const n of room.nodes) {
        const [x, s] = lay.xs(n);
        const F = floorY(s);
        for (let i = 0; i < count; i++) {
          const hsh = ((n * 73 + i * 151) * 2654435761) >>> 0;
          rect(ctx, x * TILE + (hsh % 15), F - 1 - ((hsh >> 5) % 2), 1 + ((hsh >> 8) % 2), 1, '#4a3324aa');
        }
        if (d > 0.6 && n % 3 === 0) rect(ctx, x * TILE + 3, F - 30, 8, 6, '#6b5a3a33');
      }
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const lay = sim.layout;
    const made = sim.noise();
    for (const f of lay.flats) {
      let v: number;
      if (this.overlay === 'noise') v = 1 - Math.min(1, noiseReaching(sim, made, f.id).amount / 3);
      else if (this.overlay === 'warmth') v = warmthOf(tempOf(sim, f.id));
      else {
        const people = sim.state.pawns.filter((p) => p.life?.flat === f.id && !p.life.leaving);
        if (people.length === 0) continue;
        v = people.reduce((n, p) => n + p.life!.liking, 0) / people.length / 100;
      }
      const colour = v >= 0.6 ? '#5f9a4c' : v >= 0.4 ? '#d6a63c' : v >= 0.25 ? '#d9813a' : '#c4523f';
      ctx.globalAlpha = 0.45;
      for (const r of f.rooms) {
        for (const n of lay.rooms[r].cells) {
          const [x, s] = lay.xs(n);
          rect(ctx, x * TILE, floorY(s) - TILE, TILE, TILE, colour);
        }
      }
      ctx.globalAlpha = 1;
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
      for (const n of room.cells) {
        const [x, s] = lay.xs(n);
        c.fillRect(x * TILE - 4, floorY(s) - TILE - 4, TILE + 8, TILE + 8);
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
      const cy = floorY(f.s) - def.h * TILE + (f.def === 'lamp' ? 4 : 10);
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
        glow(cx, floorY(s) - 2 * TILE, Math.min(70, (Math.max(...xs) - Math.min(...xs) + 2) * 7), '#ffd08a', 0.6);
      }
    }
    // Lit windows glow a little into the street.
    for (const [k, kind] of Object.entries(st.cells)) {
      if (kind !== 'window') continue;
      const [x, s] = k.split(',').map(Number);
      glow(x * TILE + 8, floorY(s) - 8, 14, '#ffd890', 0.5);
    }
    for (const x of this.streetLamps()) glow(x * TILE + 8, floorY(STOREY) - 6, 40, '#ffd88a', 0.6);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ build mode

  private drawBuild(): void {
    const ctx = this.ctx;
    const st = this.sim.state;
    // A faint grid over the plot.
    ctx.fillStyle = '#ffffff22';
    const top = floorY(MAX_ROWS);
    for (let x = st.plot.x0; x <= st.plot.x1 + 1; x++) ctx.fillRect(x * TILE, top, 0.5, GROUND_Y - top);
    for (let s = 0; s <= MAX_ROWS; s++) {
      ctx.fillRect(st.plot.x0 * TILE, floorY(s), (st.plot.x1 - st.plot.x0 + 1) * TILE, 0.5);
    }
    for (const m of this.build.marks) {
      ctx.fillStyle = m.ok ? '#6fd08c66' : '#e0605066';
      ctx.fillRect(m.x * TILE, floorY(m.s) - m.h * TILE, m.w * TILE, m.h * TILE);
    }
    const g = this.build.ghost;
    if (g) {
      const d = furnitureDef(g.def);
      ctx.globalAlpha = 0.75;
      drawFurniture(ctx, g.def, g.x * TILE, floorY(g.s) - d.h * TILE, g.flip, g.grade);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.ok ? '#6fd08c55' : '#e0605066';
      ctx.fillRect(g.x * TILE, floorY(g.s) - d.h * TILE, d.w * TILE, d.h * TILE);
    }
  }

  /** An outline round the piece of furniture that's selected (its card is up, or it's being moved). */
  private drawSelected(ctx: CanvasRenderingContext2D): void {
    const sel = this.sim.state.furniture.find((f) => f.id === this.build.selected);
    if (!sel) return;
    const d = furnitureDef(sel.def);
    ctx.strokeStyle = '#f2c46d';
    ctx.lineWidth = 1;
    ctx.strokeRect(sel.x * TILE + 0.5, floorY(sel.s) - d.h * TILE + 0.5, d.w * TILE - 1, d.h * TILE - 1);
  }

  // ------------------------------------------------------------------ building work

  private worksCache: { version: number; target: BuildParts; pieces: Piece[]; unheld: string[] } | null = null;

  /**
   * Blueprints: what's planned (in build mode) or what the builders have still to do, drawn
   * in blue over the building, with things coming out crossed in red. And the builder.
   */
  private drawWorks(ctx: CanvasRenderingContext2D): void {
    const st = this.sim.state;
    const target = this.build.active ? (st.works.plan ?? st.works.job) : st.works.job;
    if (!target) return;
    let c = this.worksCache;
    if (!c || c.version !== this.sim.version || c.target !== target) {
      c = { version: this.sim.version, target, pieces: piecesBetween(partsOf(st), target), unheld: this.build.active ? unsupportedCells(target.cells) : [] };
      this.worksCache = c;
    }
    for (const p of c.pieces) this.drawPiece(ctx, p);
    // Anything in the plans that wouldn't be held up, in red.
    for (const k of c.unheld) {
      const [x, s] = k.split(',').map(Number);
      const rows = isDoor(target.cells[k]) ? DOOR_ROWS : 1;
      const y = floorY(s) - rows * TILE;
      ctx.fillStyle = '#e0453acc';
      ctx.fillRect(x * TILE, y, TILE, rows * TILE);
      ctx.strokeStyle = '#ffd8d0';
      ctx.lineWidth = 1;
      ctx.strokeRect(x * TILE + 0.5, y + 0.5, TILE - 1, rows * TILE - 1);
    }
    const now = currentPiece(this.sim);
    if (now) this.drawBuilder(ctx, now);
  }

  private drawPiece(ctx: CanvasRenderingContext2D, p: Piece): void {
    const BLUE = '#5fb2ff';
    const cross = (x: number, y: number, w: number, h: number) => {
      ctx.strokeStyle = '#ff6a55';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + w - 2, y + h - 2);
      ctx.moveTo(x + w - 2, y + 2);
      ctx.lineTo(x + 2, y + h - 2);
      ctx.stroke();
      ctx.fillStyle = '#ff6a5526';
      ctx.fillRect(x, y, w, h);
    };
    const outline = (x: number, y: number, w: number, h: number, colour = BLUE) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
    };
    const part = p.part;
    const X = p.x * TILE;
    const Y = floorY(p.s) - TILE;
    if (part.kind === 'insulate') {
      if (p.removes) cross(X, Y, TILE, TILE);
      else {
        for (let yy = Y; yy < Y + TILE; yy += 4) {
          ctx.fillStyle = (yy - Y) % 8 ? `${BLUE}aa` : '#e8c84aaa';
          ctx.fillRect(X + 3, yy, TILE - 6, 4);
        }
      }
      return;
    }
    const rows = isDoor(part.cell ?? part.was) ? DOOR_ROWS : 1;
    const top = floorY(p.s) - rows * TILE;
    if (part.cell === null) {
      cross(X, top, TILE, rows * TILE);
      return;
    }
    ctx.fillStyle = `${BLUE}aa`;
    if (part.cell === 'window') {
      ctx.fillRect(X, top, TILE, TILE);
      ctx.fillStyle = '#d8f0ffcc';
      ctx.fillRect(X + 7, top, 2, TILE);
    } else if (isDoor(part.cell)) {
      ctx.fillRect(X + 7, floorY(p.s) - DOOR_H, 2, DOOR_H);
    } else if (part.cell === 'stair') {
      for (let j = 0; j < 4; j++) ctx.fillRect(X + 2, floorY(p.s) - (j + 1) * 4, TILE - 4, 3);
    } else ctx.fillRect(X, top, TILE, TILE);
    outline(X, top, TILE, rows * TILE);
  }

  /** A builder in a hard hat, hammering away at the piece they're on. */
  private drawBuilder(ctx: CanvasRenderingContext2D, p: Piece): void {
    // Beside the cell they're working on, at the height of the floor nearest it.
    const lay = this.sim.layout;
    let row = p.s;
    while (row > 0 && !lay.standable[lay.node(p.x - 1, row)] && !lay.standable[lay.node(p.x, row)]) row--;
    const x = Math.round((p.x - 0.5) * TILE);
    const y = floorY(row);
    const bob = Math.floor(this.sim.state.tick / 40) % 2;
    drawPerson(ctx, BUILDER, x, y, 0, false);
    // The hat, and a hammer going up and down.
    rect(ctx, x - 5, y - PERSON_H - 1, 10, 3, PAL.outline);
    rect(ctx, x - 4, y - PERSON_H, 8, 2, '#f2c43a');
    rect(ctx, x + 4, y - 14 - bob * 3, 1, 6, '#6b4a32');
    rect(ctx, x + 3, y - 15 - bob * 3, 3, 2, '#56606d');
  }

  // ------------------------------------------------------------------ what's on screen: bubbles, markers, chips

  /** Where an open card's subject is: the visitor at the door, the person, the thing, the flat, or the street door. */
  spotOf(card: Card): Spot | null {
    const st = this.sim.state;
    const lay = this.sim.layout;
    const pawnSpot = (id: number | undefined): Spot | null => {
      const p = id === undefined ? undefined : this.visiblePawns().find((o) => o.id === id);
      if (!p) return null;
      const { px, py } = this.feet(p);
      const h = pawnHeight(p);
      return { x0: px - 7, x1: px + 7, y0: py - h, y1: py + 2, cell: { x: Math.round(p.x), s: Math.round(p.s) }, pawn: p.id };
    };
    const v = pawnSpot(card.visitor) ?? pawnSpot(card.pawn);
    if (v) return v;
    const f = card.furniture === undefined ? undefined : st.furniture.find((o) => o.id === card.furniture);
    if (f) {
      const d = furnitureDef(f.def);
      return { x0: f.x * TILE, x1: (f.x + d.w) * TILE, y0: floorY(f.s) - d.h * TILE, y1: floorY(f.s), cell: { x: f.x, s: f.s } };
    }
    const flat = card.flat ? lay.flat(card.flat) : undefined;
    if (flat) {
      const cells = lay.flatCells(flat).map((n) => lay.xs(n));
      const xs = cells.map(([x]) => x);
      const ss = cells.map(([, s]) => s);
      const topS = Math.max(...ss);
      return { x0: Math.min(...xs) * TILE, x1: (Math.max(...xs) + 1) * TILE, y0: floorY(topS) - 2 * TILE - 2, y1: floorY(Math.min(...ss)), cell: { x: xs[0], s: topS } };
    }
    // Something in the street (the van, the bins, the cat out front): the street door.
    const mid = Math.round((st.plot.x0 + st.plot.x1) / 2);
    return { x0: mid * TILE - 8, x1: mid * TILE + 8, y0: GROUND_Y - 30, y1: GROUND_Y, cell: { x: mid, s: 0 } };
  }

  /** The visible part of the screen: where the building shows. */
  private get visibleBox(): Rect {
    return this.box ?? { x: 0, y: 0, w: this.viewW, h: this.viewH };
  }

  /** The card whose `!` marker or edge chip is under this screen point (a tap), and whether it was the chip. */
  cardAt(sx: number, sy: number): { card: number; chip: boolean } | null {
    let best: { card: number; chip: boolean } | null = null;
    let bestD = Infinity;
    for (const h of this.hits) {
      const d = Math.hypot(sx - h.x, sy - h.y);
      if (d <= h.r && d < bestD) {
        bestD = d;
        best = { card: h.card, chip: h.chip };
      }
    }
    return best;
  }

  /** True while something's moving that needs frames even if the sim's paused (a pulse, a bubble running out its time). */
  get animating(): boolean {
    return this.pulsing || this.lingering;
  }
  private pulsing = false;
  private lingering = false;

  private drawBubbles(ctx: CanvasRenderingContext2D, toScreen: (wx: number, wy: number) => readonly [number, number]): void {
    const c = this.camera;
    const st = this.sim.state;
    const tick = st.tick;
    const now = this.clock();
    const open = st.drip?.open ?? [];
    this.hits = [];
    // Cards: where each one's subject is, a pulse when it's new, a marker or an edge chip.
    const box = this.visibleBox;
    const avoid: Rect = { x: box.x + box.w - this.alertsSize.w, y: box.y, w: this.alertsSize.w, h: this.alertsSize.h };
    for (const id of [...this.seen.keys()]) if (!open.some((k) => k.id === id)) this.seen.delete(id);
    const cands: BubbleCand[] = [];
    const markers: { card: Card; spot: Spot; sx: number; sy: number }[] = [];
    const takenPawns = new Set<number>();
    const chips: Chip[] = [];
    this.pulsing = false;
    for (const card of open) {
      const spot = this.spotOf(card);
      if (!spot) continue;
      if (!this.seen.has(card.id)) this.seen.set(card.id, tick - card.tick <= seconds(3) ? now : -Infinity);
      const [sx, sy] = toScreen((spot.x0 + spot.x1) / 2, spot.y0 - 3);
      const chip = chipFor(sx, sy, box, avoid);
      if (chip) {
        // Two on the same edge sit side by side rather than on top of each other.
        for (const o of chips) {
          if (Math.hypot(o.x - chip.x, o.y - chip.y) < CHIP_R * 2 + 3) {
            if (chip.side === 'left' || chip.side === 'right') chip.y = o.y + CHIP_R * 2 + 4;
            else chip.x = o.x - CHIP_R * 2 - 4;
          }
        }
        chips.push(chip);
        this.drawChip(ctx, chip, card.id, now);
        continue;
      }
      markers.push({ card, spot, sx, sy });
      cands.push({ key: -card.id, rank: 0, sig: `card${card.id}`, text: '!', card: card.id, pawn: spot.pawn });
      if (spot.pawn !== undefined) takenPawns.add(spot.pawn);
      const t = pulseAt(this.seen.get(card.id)!, now);
      if (t !== null) {
        this.pulsing = true;
        const [x0, y0] = toScreen(spot.x0, spot.y0);
        const [x1, y1] = toScreen(spot.x1, spot.y1);
        const grow = 3 + t * 9;
        ctx.strokeStyle = `rgba(255,233,224,${(1 - t) * 0.95})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x0 - grow, y0 - grow, x1 - x0 + grow * 2, y1 - y0 + grow * 2, 6 + grow);
        ctx.stroke();
      }
    }
    // Everyone's own bubble, but the card's marker takes the place of a person's.
    for (const p of this.visiblePawns()) {
      const b = p.bubble;
      if (!b || b.until <= tick || takenPawns.has(p.id)) continue;
      const icon = iconName(b.icon);
      if (p.pose === 'sleep' && icon !== 'zz') continue;
      cands.push({ key: p.id, rank: b.kind === 'habit' ? 3 : b.kind === 'moment' ? 2 : 1, sig: `${b.text}|${b.icon ?? ''}`, text: b.text, icon: icon ?? undefined, pawn: p.id });
    }
    const picks = this.bubbles.pick(cands, now);
    this.lingering = picks.some((k) => !cands.some((o) => o.key === k.key));
    ctx.font = `700 ${Math.max(10, Math.min(14, c.scale * 4))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const k = Math.max(2, Math.min(4, Math.round(c.scale)));
    const drawn: { x: number; w: number; y: number }[] = [];
    for (const cand of picks) {
      let sx: number;
      let sy: number;
      if (cand.card !== undefined) {
        const m = markers.find((o) => o.card.id === cand.card);
        if (!m) continue;
        [sx, sy] = [m.sx, m.sy];
      } else {
        const p = st.pawns.find((o) => o.id === cand.key);
        if (!p) continue;
        const { px, py } = this.feet(p);
        [sx, sy] = toScreen(px, py - pawnHeight(p) - 3);
      }
      const isCard = cand.card !== undefined;
      const hgt = isCard ? 26 : cand.icon ? 8 * k + 8 : 18;
      const w = isCard ? 26 : cand.icon ? 8 * k + 8 : Math.max(18, ctx.measureText(cand.text).width + 10);
      // A marker bobs a little; a bubble that would sit on another moves aside.
      if (isCard) sy += Math.round(Math.sin(now / 220) * 2);
      let bx = sx;
      for (const d of drawn) if (Math.abs(d.x - bx) < (d.w + w) / 2 + 2 && Math.abs(d.y - sy) < hgt) bx = d.x + (d.w + w) / 2 + 3;
      drawn.push({ x: bx, w, y: sy });
      const top = sy - hgt - 6;
      ctx.fillStyle = isCard ? '#d0452f' : cand.text === '!' ? '#f6d2ca' : '#fbf7ef';
      ctx.strokeStyle = PAL.outline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx - w / 2, top, w, hgt, isCard ? 13 : 5);
      ctx.fill();
      ctx.stroke();
      // The tail, down to what it's about.
      ctx.beginPath();
      ctx.moveTo(sx - 3, top + hgt);
      ctx.lineTo(sx, sy - 1);
      ctx.lineTo(sx + 3, top + hgt);
      ctx.closePath();
      ctx.fillStyle = isCard ? '#d0452f' : cand.text === '!' ? '#f6d2ca' : '#fbf7ef';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 2, top + hgt - 1);
      ctx.lineTo(sx + 2, top + hgt - 1);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
      if (isCard) {
        ctx.font = '800 17px system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('!', bx, top + 4);
        ctx.font = `700 ${Math.max(10, Math.min(14, c.scale * 4))}px system-ui, sans-serif`;
        this.hits.push({ card: cand.card!, x: bx, y: top + hgt / 2, r: 24, chip: false });
      } else if (cand.icon) {
        drawIcon(ctx, cand.icon, Math.round(bx - 4 * k), Math.round(top + 4), k);
      } else {
        ctx.fillStyle = PAL.outline;
        ctx.fillText(cand.text, bx, top + 3);
      }
    }
  }

  /** A round red `!` on the edge of the screen, with a point towards what it's about. Tap it to go there. */
  private drawChip(ctx: CanvasRenderingContext2D, chip: Chip, card: number, now: number): void {
    const pulse = Math.sin(now / 260) * 1.2;
    ctx.fillStyle = '#d0452f';
    ctx.strokeStyle = PAL.outline;
    ctx.lineWidth = 1.5;
    const dir = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[chip.side];
    const [dx, dy] = dir;
    const tip = CHIP_R + 6 + pulse;
    ctx.beginPath();
    ctx.moveTo(chip.x + dx * tip, chip.y + dy * tip);
    ctx.lineTo(chip.x + dx * (CHIP_R - 4) - dy * 7, chip.y + dy * (CHIP_R - 4) + dx * 7);
    ctx.lineTo(chip.x + dx * (CHIP_R - 4) + dy * 7, chip.y + dy * (CHIP_R - 4) - dx * 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(chip.x, chip.y, CHIP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', chip.x, chip.y + 1);
    ctx.textBaseline = 'top';
    this.hits.push({ card, x: chip.x, y: chip.y, r: CHIP_R + 8, chip: true });
  }

  // ------------------------------------------------------------------ labels

  private drawLabels(): void {
    const ctx = this.ctx;
    const c = this.camera;
    const lay = this.sim.layout;
    const toScreen = (wx: number, wy: number) => [c.ox + wx * c.scale, c.oy + wy * c.scale] as const;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Flat names, over the middle of each flat's top floor.
    const size = Math.max(9, Math.min(13, c.scale * 5));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    for (const f of lay.flats) {
      const nodes = f.rooms.flatMap((r) => lay.rooms[r].nodes).map((n) => lay.xs(n));
      const topS = Math.max(...nodes.map(([, s]) => s));
      const row = nodes.filter(([, s]) => s === topS).map(([x]) => x);
      const mid = (Math.min(...row) + Math.max(...row) + 1) / 2;
      const [sx, sy] = toScreen(mid * TILE, floorY(topS) - 2 * TILE - 2);
      // "Flat 3 · Two-bed": what kind of flat it is, from its bedrooms.
      const label = `${f.name} · ${flatKind(this.sim, f.id).name}`;
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = '#1d1f23b0';
      ctx.fillRect(sx - w / 2, sy, w, size + 4);
      ctx.fillStyle = '#f3efe6';
      ctx.fillText(label, sx, sy + 2);
      // layout L5: the household's need you know about, coloured by how the flat suits it.
      const fit = mapFit(this.sim, f.id);
      if (fit) {
        const k = Math.max(1, Math.round((size + 4) / 10));
        const bx = sx + w / 2 + 2;
        ctx.fillStyle = fit.mood === 'good' ? '#4f944a' : fit.mood === 'bad' ? '#c4523f' : '#d9a21e';
        ctx.fillRect(bx, sy, 8 * k + 6, size + 4);
        ctx.fillStyle = '#f3efe6';
        ctx.fillRect(bx + 2, sy + 2, 8 * k + 2, size);
        drawIcon(ctx, fit.icon, bx + 3, Math.round(sy + (size + 4 - 8 * k) / 2), k);
      }
    }
    // In build mode, what each room is for, on its floor.
    if (this.build.active) {
      const small = Math.max(8, Math.min(11, c.scale * 4));
      ctx.font = `500 ${small}px system-ui, sans-serif`;
      for (const f of lay.flats) {
        for (const r of flatKind(this.sim, f.id).rooms) {
          const nodes = lay.rooms[r.room].nodes.map((n) => lay.xs(n));
          if (nodes.length === 0) continue;
          const low = Math.min(...nodes.map(([, s]) => s));
          const xs = nodes.filter(([, s]) => s === low).map(([x]) => x);
          const [sx, sy] = toScreen(((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE, floorY(low) + 1);
          const w = ctx.measureText(r.name).width + 6;
          ctx.fillStyle = r.bedroom ? '#2d3a52c0' : '#3b3530b0';
          ctx.fillRect(sx - w / 2, sy, w, small + 3);
          ctx.fillStyle = '#f3efe6';
          ctx.fillText(r.name, sx, sy + 1.5);
        }
      }
      ctx.font = `600 ${size}px system-ui, sans-serif`;
    }
    // Laundry rooms, bike stores and gardens, named the same way (a little greener).
    const named = new Set<number>();
    for (const sp of spacesOf(this.sim)) {
      if ((!sp.working && sp.outdoor) || (!sp.outdoor && named.has(sp.room))) continue;
      named.add(sp.room);
      const mid = (sp.x0 + sp.x1 + 1) / 2;
      const top = sp.outdoor ? sp.s + 1 : Math.max(...lay.rooms[sp.room].nodes.map((n) => lay.xs(n)[1]));
      const [sx, sy] = toScreen(mid * TILE, floorY(top) - (sp.outdoor ? 3 : 2) * TILE - 2);
      const w = ctx.measureText(sp.name).width + 8;
      ctx.fillStyle = '#3a4a3ab0';
      ctx.fillRect(sx - w / 2, sy, w, size + 4);
      ctx.fillStyle = '#f3efe6';
      ctx.fillText(sp.name, sx, sy + 2);
    }
    this.drawBubbles(ctx, toScreen);
    // Name tags under people, once zoomed in enough to read.
    if (c.scale < 1.6) return;
    ctx.font = `500 ${Math.min(11, c.scale * 3.5)}px system-ui, sans-serif`;
    for (const p of this.visiblePawns()) {
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
