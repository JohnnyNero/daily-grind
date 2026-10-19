// Build mode: change the building and place furniture. Tap to build one piece, drag to
// build along a line (walls, floors) or mark out a whole room. Every change can be undone.

import {
  buildRoom,
  flipFurniture,
  furnitureAt,
  furnitureProblem,
  moveFurniture,
  placeFurniture,
  placeSegment,
  placeSlab,
  placeStair,
  removeFurniture,
  removeSegment,
  removeSlab,
  removeStair,
  restore,
  segmentProblem,
  slabProblem,
  slabRemoveProblem,
  snapshot,
  stairIn,
  stairProblem,
} from '../sim/build';
import { FURNITURE, furnitureDef } from '../sim/defs';
import type { Sim } from '../sim/sim';
import { ROOM_ROWS, key, type Segment } from '../sim/state';
import { drawFurniture } from '../render/art';
import type { Cell, Renderer } from '../render/renderer';
import { el, h } from './dom';

type Tool = 'room' | Segment | 'floor' | 'stairs' | 'demolish';

const TOOLS: { id: Tool; name: string; hint: string }[] = [
  { id: 'room', name: 'Room', hint: 'Drag across to mark out a room: walls at both ends, a floor and a ceiling.' },
  { id: 'wall', name: 'Wall', hint: 'Tap or drag to put up walls.' },
  { id: 'door', name: 'Door', hint: 'An inside door, between rooms of the same flat.' },
  { id: 'flatDoor', name: 'Flat door', hint: "A flat's front door. Everything behind it is that flat." },
  { id: 'window', name: 'Window', hint: 'Tap a wall to put a window in it.' },
  { id: 'entrance', name: 'Street door', hint: 'The way in from the street, on the ground floor.' },
  { id: 'floor', name: 'Floor', hint: 'Tap or drag along a storey to lay a floor (or a ceiling) there.' },
  { id: 'stairs', name: 'Stairs', hint: 'Tap where the stairs should start. "Turn round" makes them climb the other way.' },
  { id: 'demolish', name: 'Knock down', hint: 'Tap or drag to take out walls, doors, floors, stairs and furniture.' },
];

const MAX_UNDO = 50;

export class BuildUi {
  active = false;
  private tab: 'structure' | 'furniture' = 'structure';
  private tool: Tool = 'room';
  private piece: string | null = null;
  private stairDir: 1 | -1 = 1;
  private flip = false;
  private undo: string[] = [];
  private drag: { start: Cell; last: Cell; moved: boolean; furniture?: number } | null = null;
  private bar = el('buildbar');
  private hint = el('build-hint');
  private tools = el('build-tools');
  /** Called when build mode opens or closes (the view refits around the bar). */
  onToggle: () => void = () => {};

  constructor(private readonly sim: Sim, private readonly renderer: Renderer) {
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as 'structure' | 'furniture';
        this.renderer.build.selected = null;
        this.render();
      });
    }
    el('build-done').addEventListener('click', () => this.stop());
    el('build-undo').addEventListener('click', () => this.doUndo());
    el('build-flip').addEventListener('click', () => this.turn());
    el('build-remove').addEventListener('click', () => {
      const id = this.renderer.build.selected;
      if (id === null) return;
      this.change(() => removeFurniture(this.sim.state, id));
      this.renderer.build.selected = null;
      this.render();
    });
    // A mouse shows where things would go before you click.
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerType !== 'mouse' || e.buttons !== 0) return;
      this.preview(this.renderer.cellAt(e.clientX, e.clientY));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) this.doUndo();
      else if (e.key === 'r' || e.key === 'R') this.turn();
      else if (e.key === 'Escape') this.stop();
    });
  }

  start(): void {
    this.active = true;
    this.bar.hidden = false;
    document.body.classList.add('building');
    this.renderer.build.active = true;
    this.render();
    document.body.style.setProperty('--buildbar-h', `${this.bar.offsetHeight}px`);
    this.onToggle();
  }

  stop(): void {
    this.active = false;
    this.bar.hidden = true;
    document.body.classList.remove('building');
    Object.assign(this.renderer.build, { active: false, marks: [], ghost: null, selected: null });
    this.bump();
    this.onToggle();
  }

  private bump(): void {
    this.renderer.build.version++;
  }

  /** Runs a change to the building, keeping an undo step if anything changed. */
  private change(fn: () => unknown, keepUndo = true): void {
    const before = snapshot(this.sim.state);
    fn();
    if (snapshot(this.sim.state) === before) return;
    if (keepUndo) {
      this.undo.push(before);
      if (this.undo.length > MAX_UNDO) this.undo.shift();
    }
    this.sim.changed();
    this.bump();
    this.updateButtons();
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    restore(this.sim.state, prev);
    this.renderer.build.selected = null;
    this.sim.changed();
    this.bump();
    this.render();
  }

  private turn(): void {
    const id = this.renderer.build.selected;
    if (id !== null) this.change(() => flipFurniture(this.sim.state, id));
    else if (this.tab === 'furniture') this.flip = !this.flip;
    else this.stairDir = this.stairDir === 1 ? -1 : 1;
    this.setHint(this.tab === 'structure' && this.tool === 'stairs' ? `Stairs climb to the ${this.stairDir === 1 ? 'right' : 'left'}.` : null);
  }

  // ------------------------------------------------------------------ the bar

  private render(): void {
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    }
    this.tools.replaceChildren();
    if (this.tab === 'structure') {
      for (const t of TOOLS) {
        const b = h('button', { type: 'button', 'aria-pressed': String(t.id === this.tool), onclick: () => this.pickTool(t.id) }, toolIcon(t.id), t.name);
        this.tools.append(b);
      }
    } else {
      for (const d of FURNITURE) {
        const b = h('button', { type: 'button', 'aria-pressed': String(d.id === this.piece), onclick: () => this.pickPiece(d.id) }, pieceIcon(d.id), d.name);
        this.tools.append(b);
      }
    }
    this.setHint(null);
    this.updateButtons();
  }

  private pickTool(t: Tool): void {
    this.tool = t;
    this.render();
  }

  private pickPiece(id: string): void {
    this.piece = this.piece === id ? null : id;
    this.renderer.build.selected = null;
    this.render();
  }

  private updateButtons(): void {
    const selected = this.renderer.build.selected !== null;
    (el('build-undo') as HTMLButtonElement).disabled = this.undo.length === 0;
    (el('build-remove') as HTMLButtonElement).disabled = !selected;
    const flipBtn = el('build-flip') as HTMLButtonElement;
    flipBtn.disabled = this.tab === 'structure' ? this.tool !== 'stairs' : !selected && this.piece === null;
  }

  private setHint(text: string | null, bad = false): void {
    let base: string;
    if (this.tab === 'structure') base = TOOLS.find((t) => t.id === this.tool)!.hint;
    else if (this.renderer.build.selected !== null) base = 'Drag it to move it, or turn it round.';
    else if (this.piece) base = `Tap where the ${furnitureDef(this.piece).name.toLowerCase()} should go.`;
    else base = 'Pick something to place, or tap furniture in the building to move it.';
    this.hint.textContent = text ?? base;
    this.hint.classList.toggle('bad', bad);
  }

  // ------------------------------------------------------------------ the canvas

  tap(sx: number, sy: number): void {
    const cell = this.renderer.cellAt(sx, sy);
    if (!cell) return;
    this.apply(cell, cell, true);
    this.preview(null);
  }

  dragStart(sx: number, sy: number): boolean {
    if (!this.active) return false;
    const cell = this.renderer.cellAt(sx, sy);
    if (!cell) return false;
    if (this.tab === 'furniture') {
      // Dragging the selected piece moves it; anywhere else pans the view.
      const sel = this.renderer.build.selected;
      const under = furnitureAt(this.sim.state, cell.x, cell.s, cell.r);
      if (sel === null || under?.id !== sel) return false;
      this.drag = { start: cell, last: cell, moved: false, furniture: sel };
      this.undo.push(snapshot(this.sim.state));
      return true;
    }
    this.drag = { start: cell, last: cell, moved: false };
    if (this.tool !== 'room') this.undo.push(snapshot(this.sim.state));
    this.preview(cell);
    return true;
  }

  dragMove(sx: number, sy: number): void {
    const d = this.drag;
    const cell = this.renderer.cellAt(sx, sy);
    if (!d || !cell || (cell.x === d.last.x && cell.s === d.last.s && cell.r === d.last.r)) return;
    d.moved = true;
    if (d.furniture !== undefined) {
      const f = this.sim.state.furniture.find((o) => o.id === d.furniture)!;
      const dx = cell.x - d.last.x;
      const r = furnitureDef(f.def).wall ? Math.max(1, f.r + (cell.s === d.last.s ? cell.r - d.last.r : 0)) : 0;
      // If it doesn't fit there, it stays put until the finger reaches somewhere it does.
      if (!moveFurniture(this.sim.state, f.id, f.x + dx, cell.s, r)) {
        this.sim.changed();
        this.bump();
        d.last = cell;
      }
      return;
    }
    if (this.tool === 'room') this.markRoom(d.start, cell);
    else {
      // Fill in every cell along the way, so a quick swipe doesn't leave gaps.
      const step = Math.sign(cell.x - d.last.x);
      for (let x = d.last.x + step; step !== 0 && x !== cell.x; x += step) this.apply({ ...cell, x }, d.start, false);
      this.apply(cell, d.start, false);
    }
    d.last = cell;
  }

  dragEnd(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.furniture !== undefined) {
      if (!d.moved) this.undo.pop();
      this.updateButtons();
      return;
    }
    if (this.tool === 'room') {
      if (Math.abs(d.last.x - d.start.x) < 2) this.setHint('Make it at least three tiles wide.', true);
      else this.change(() => buildRoom(this.sim.state, d.start.x, d.start.s, d.last.x, d.last.s));
    } else if (!d.moved) {
      this.undo.pop();
      this.apply(d.start, d.start, true);
    } else if (this.undo.length > 0 && this.undo[this.undo.length - 1] === snapshot(this.sim.state)) {
      this.undo.pop();
    }
    this.renderer.build.marks = [];
    this.bump();
    this.updateButtons();
  }

  dragCancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.furniture === undefined && this.tool !== 'room') {
      const prev = this.undo.pop();
      if (prev) {
        restore(this.sim.state, prev);
        this.sim.changed();
      }
    }
    this.renderer.build.marks = [];
    this.bump();
  }

  /** Does the current tool at a cell. `single` is a tap (keeps its own undo step). */
  private apply(cell: Cell, start: Cell, single: boolean): void {
    const st = this.sim.state;
    if (this.tab === 'furniture') {
      this.tapFurniture(cell);
      return;
    }
    let problem: string | null = null;
    const run = (fn: () => string | null | boolean) => {
      const go = () => {
        const out = fn();
        if (typeof out === 'string') problem = out;
      };
      if (single) this.change(go);
      else {
        go();
        this.sim.changed();
        this.bump();
      }
    };
    // Drags stay on the storey they started on.
    const s = single ? cell.s : start.s;
    const r = single ? cell.r : start.r;
    switch (this.tool) {
      case 'room':
        if (single) problem = 'Drag across to mark out a room.';
        break;
      case 'floor': {
        const level = r === ROOM_ROWS ? s + 1 : s;
        if (level < 1) problem = 'The ground floor stands on the ground';
        else run(() => placeSlab(st, cell.x, level));
        break;
      }
      case 'stairs':
        if (single) run(() => placeStair(st, cell.x, s, this.stairDir));
        break;
      case 'demolish':
        run(() => this.demolish(cell.x, s, r));
        break;
      default:
        if (r === ROOM_ROWS) problem = 'Tap the storey, not the floor';
        else run(() => placeSegment(st, cell.x, s, this.tool as Segment));
    }
    if (problem) this.setHint(problem, true);
    else this.setHint(null);
  }

  private demolish(x: number, s: number, r: number): string | null {
    const st = this.sim.state;
    if (r === ROOM_ROWS) return removeSlab(st, x, s + 1);
    const f = furnitureAt(st, x, s, r);
    if (f) return removeFurniture(st, f.id) ? null : 'Nothing there';
    if (removeSegment(st, x, s)) return null;
    const t = stairIn(st, x, s);
    if (t) return removeStair(st, t.id) ? null : 'Nothing there';
    if (st.slabs[key(x, s)] && s > 0) return removeSlab(st, x, s);
    return 'Nothing to knock down there';
  }

  private tapFurniture(cell: Cell): void {
    const st = this.sim.state;
    const under = furnitureAt(st, cell.x, cell.s, cell.r);
    if (under && (this.piece === null || this.renderer.build.selected === null)) {
      this.renderer.build.selected = this.renderer.build.selected === under.id ? null : under.id;
      this.bump();
      this.setHint(null);
      this.updateButtons();
      return;
    }
    this.renderer.build.selected = null;
    if (!this.piece) {
      this.setHint(null);
      this.updateButtons();
      return;
    }
    const spot = this.spotFor(this.piece, cell);
    let result: ReturnType<typeof placeFurniture> = 'Nothing placed';
    this.change(() => {
      result = placeFurniture(st, this.piece!, spot.x, spot.s, spot.r, this.flip);
    });
    if (typeof result === 'string') this.setHint(result, true);
    else this.setHint(null);
    this.updateButtons();
  }

  /** Where a piece goes for a tapped cell: on the floor, or on the wall at the height tapped. */
  private spotFor(def: string, cell: Cell): Cell {
    const d = furnitureDef(def);
    const r = d.wall ? Math.min(ROOM_ROWS - d.h, Math.max(1, cell.r)) : 0;
    return { x: cell.x, s: cell.s, r };
  }

  private markRoom(a: Cell, b: Cell): void {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [s0, s1] = [Math.min(a.s, b.s), Math.max(a.s, b.s)];
    const ok = x1 - x0 >= 2;
    this.renderer.build.marks = [];
    for (let s = s0; s <= s1; s++) this.renderer.build.marks.push({ x: x0, s, r: 0, w: x1 - x0 + 1, h: ROOM_ROWS, ok });
    this.bump();
  }

  /** Shows where the tool or piece would go (mouse hover, and the start of a drag). */
  private preview(cell: Cell | null): void {
    const b = this.renderer.build;
    b.marks = [];
    b.ghost = null;
    if (!cell || this.drag) {
      this.bump();
      return;
    }
    const st = this.sim.state;
    if (this.tab === 'furniture') {
      if (this.piece && b.selected === null) {
        const spot = this.spotFor(this.piece, cell);
        b.ghost = { def: this.piece, ...spot, flip: this.flip, ok: furnitureProblem(st, this.piece, spot.x, spot.s, spot.r) === null };
      }
    } else if (this.tool === 'stairs') {
      b.marks.push({ x: cell.x, s: cell.s, r: 0, w: 3, h: ROOM_ROWS, ok: stairProblem(st, cell.x, cell.s, this.stairDir) === null });
    } else if (this.tool === 'floor') {
      const level = cell.r === ROOM_ROWS ? cell.s + 1 : cell.s;
      b.marks.push({ x: cell.x, s: level - 1, r: ROOM_ROWS, w: 1, h: 1, ok: level >= 1 && slabProblem(st, cell.x, level) === null });
    } else if (this.tool === 'demolish') {
      const ok = cell.r === ROOM_ROWS ? slabRemoveProblem(st, cell.x, cell.s + 1) === null : true;
      b.marks.push({ x: cell.x, s: cell.s, r: cell.r === ROOM_ROWS ? ROOM_ROWS : 0, w: 1, h: cell.r === ROOM_ROWS ? 1 : ROOM_ROWS, ok });
    } else if (this.tool !== 'room' && cell.r < ROOM_ROWS) {
      b.marks.push({ x: cell.x, s: cell.s, r: 0, w: 1, h: ROOM_ROWS, ok: segmentProblem(st, cell.x, cell.s, this.tool as Segment) === null });
    }
    this.bump();
  }
}

// ------------------------------------------------------------------ icons

function iconCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.width = `${w * 1.5}px`;
  c.style.height = `${h * 1.5}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function pieceIcon(id: string): HTMLCanvasElement {
  const d = furnitureDef(id);
  const scale = Math.min(1, 32 / (d.w * 16), 24 / (d.h * 16));
  const [c, ctx] = iconCanvas(32, 24);
  ctx.translate((32 - d.w * 16 * scale) / 2, 24 - d.h * 16 * scale);
  ctx.scale(scale, scale);
  drawFurniture(ctx, id, 0, 0);
  return c;
}

function toolIcon(t: Tool): HTMLCanvasElement {
  const [c, ctx] = iconCanvas(32, 24);
  const r = (x: number, y: number, w: number, hh: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, hh);
  };
  switch (t) {
    case 'room':
      r(4, 20, 24, 3, '#77706a');
      r(4, 2, 24, 3, '#77706a');
      r(4, 5, 3, 15, '#9c5b45');
      r(25, 5, 3, 15, '#9c5b45');
      r(7, 5, 18, 15, '#d9b98f');
      break;
    case 'wall':
    case 'window':
    case 'door':
    case 'flatDoor':
    case 'entrance':
      r(11, 2, 10, 21, '#d6c9b2');
      if (t === 'window') r(13, 6, 6, 9, '#8fbcd3');
      if (t !== 'wall' && t !== 'window') r(12, 8, 8, 15, t === 'flatDoor' ? '#2f6b5a' : t === 'entrance' ? '#23395b' : '#b07a4a');
      break;
    case 'floor':
      r(2, 12, 28, 6, '#77706a');
      r(2, 12, 28, 2, '#9a6a45');
      break;
    case 'stairs':
      for (let i = 0; i < 6; i++) r(4 + i * 4, 20 - i * 3, 4, 3 + i * 3, '#835a3c');
      break;
    case 'demolish':
      r(14, 3, 4, 14, '#6b4a32');
      r(8, 3, 16, 6, '#56606d');
      r(10, 19, 3, 3, '#a8826a');
      r(18, 18, 4, 4, '#a8826a');
      break;
  }
  return c;
}
