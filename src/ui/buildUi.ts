// Build mode: change the building. Everything goes in straight away and is paid for on the
// spot. Pick a group, then a tool or a piece. Walls are drawn a cell at a time (drag to
// draw a line) and erased the same way. Picking a piece of furniture (or Move on a piece's
// card) puts the bar away and shows the piece as a ghost: tap or drag to put it where you
// want, and nothing happens until you press Place. The chips at the top zoom straight to a
// flat. Everything can be undone, with the money back.

import {
  FLIGHT,
  cellProblem,
  furnitureAt,
  furnitureProblem,
  insulate,
  insulateProblem,
  placeCell,
  placeStairs,
  removeCell,
  removeProblem,
  stairsProblem,
} from '../sim/build';
import { FURNITURE, furnitureDef, type FurnitureGroup } from '../sim/defs';
import { CELL_PRICE, DEMOLISH_PRICE, INSULATE_PRICE, book, furniturePrice, pounds } from '../sim/economy';
import type { Sim } from '../sim/sim';
import { DOOR_ROWS, TILE, isDoor, isSolid, key, type CellKind, type State } from '../sim/state';
import { buyFurniture, shiftFurniture, turnFurniture } from '../sim/furnish';
import { partsOf, piecesBetween, quote } from '../sim/works';
import { drawFurniture } from '../render/art';
import { floorY, type Cell, type Renderer } from '../render/renderer';
import { el, h } from './dom';
import type { FurnitureCard } from './furnitureCard';

type Tool = CellKind | 'insulate' | 'demolish';

const TOOLS: Record<Tool, { name: string; hint: string }> = {
  wall: { name: 'Add', hint: 'Tap or drag to draw walls a cell at a time, anywhere. A wall with space over it is a floor.' },
  window: { name: 'Window', hint: 'Tap a gap in a wall (or a wall cell) to put a window in.' },
  insulate: { name: 'Insulate', hint: 'Tap or drag along walls: much less noise gets through, and the heat stays in.' },
  door: { name: 'Door', hint: 'Tap the bottom of a two-cell gap in a wall: an inside door, between rooms of one flat.' },
  flatDoor: { name: 'Flat door', hint: "Tap the bottom of a two-cell gap: a flat's front door. Everything behind it is that flat." },
  entrance: { name: 'Street door', hint: 'Tap the bottom of a two-cell gap on the ground: the way in from the street.' },
  stair: { name: 'Stairs', hint: 'Tap a floor: a flight goes straight up from it, one cell wide, through the floor above.' },
  demolish: { name: 'Erase', hint: 'Tap or drag to take out walls, windows, doors and stairs.' },
};

/** The groups along the top of the bar: building work first, then furniture. */
const GROUPS: { id: string; name: string; tools?: Tool[]; furniture?: FurnitureGroup[] }[] = [
  { id: 'walls', name: 'Walls', tools: ['wall', 'demolish'] },
  { id: 'doors', name: 'Doors & windows', tools: ['door', 'flatDoor', 'entrance', 'window'] },
  { id: 'stairs', name: 'Stairs', tools: ['stair'] },
  { id: 'insulate', name: 'Insulation', tools: ['insulate'] },
  { id: 'sleep', name: 'Bedroom', furniture: ['sleep'] },
  { id: 'sit', name: 'Living', furniture: ['sit'] },
  { id: 'kitchen', name: 'Kitchen', furniture: ['kitchen'] },
  { id: 'bathroom', name: 'Bathroom', furniture: ['bathroom'] },
  { id: 'storage', name: 'Storage', furniture: ['storage'] },
  { id: 'decor', name: 'Decor & heat', furniture: ['decor'] },
];

/** Tools you paint with: drag across cells and each one gets done. */
const PAINT: readonly Tool[] = ['wall', 'window', 'insulate', 'demolish'];

const MAX_UNDO = 50;
/** How near (in screen pixels) a drag has to start to the selected piece to move it, not the view. */
const GRAB_PX = 28;

type Box = { x: number; y: number; w: number; h: number };

export class BuildUi {
  active = false;
  /** Nothing's picked when build mode opens: no group, no tool. */
  private group: (typeof GROUPS)[number] | null = null;
  private tool: Tool | null = null;
  /** Undo steps: the building or the furniture as it was, and the money. */
  private undo: { plan?: string; furniture?: string; money?: number; ledger?: number }[] = [];
  /**
   * A piece being placed: what, where and which way round it would go, and (if it's
   * already in the building) which one is moving. Nothing changes until Place.
   */
  private pending: { def: string; x: number; s: number; flip: boolean; id?: number } | null = null;
  private placeBar = el('place-bar');
  private drag: { start: Cell; last: Cell; moved: boolean; furniture?: number } | null = null;
  private bar = el('buildbar');
  private hint = el('build-hint');
  private tools = el('build-tools');
  private zoom = el('build-zoom');
  /** Fits the whole building in view (the Whole building chip). */
  onFit: () => void = () => {};
  /** A message for the player. */
  onNotify: (text: string, bad?: boolean) => void = () => {};
  /** The part of the screen the building shows in, for zooming to a flat. */
  viewBox: () => Box = () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });

  constructor(private readonly sim: Sim, private readonly renderer: Renderer, private readonly card: FurnitureCard) {
    el('build-done').addEventListener('click', () => this.stop());
    el('build-undo').addEventListener('click', () => this.doUndo());
    el('place-flip').addEventListener('click', () => this.turn());
    el('place-ok').addEventListener('click', () => this.place());
    el('place-cancel').addEventListener('click', () => this.endPlacing());
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
      else if (e.key === 'Escape') {
        if (this.pending) this.endPlacing();
        else this.stop();
      } else if (e.key === 'Enter' && this.pending) this.place();
    });
  }

  start(): void {
    this.active = true;
    this.bar.hidden = false;
    this.zoom.hidden = false;
    document.body.classList.add('building');
    this.renderer.build.active = true;
    this.undo = [];
    this.pending = null;
    // Plans from before building went in straight away are dropped.
    this.sim.state.works.plan = null;
    this.render();
  }

  /** Straight into moving a piece (from its card, outside build mode): zooms to its flat. */
  startMoving(id: number): void {
    const f = this.sim.state.furniture.find((o) => o.id === id);
    if (!f) return;
    if (!this.active) this.start();
    const flat = this.sim.layout.flatAt(f.x, f.s);
    if (flat) this.zoomTo(flat.id);
    this.beginMove(id);
  }

  private beginMove(id: number): void {
    const f = this.sim.state.furniture.find((o) => o.id === id);
    if (!f) return;
    this.group = GROUPS.find((g) => g.furniture?.includes(furnitureDef(f.def).group)) ?? this.group;
    this.render();
    this.startPlacing({ def: f.def, x: f.x, s: f.s, flip: !!f.flip, id });
  }

  // ------------------------------------------------------------------ placing furniture

  /** Puts the bar away and shows the piece as a ghost, ready to be put where you want. */
  private startPlacing(p: NonNullable<typeof this.pending>): void {
    this.card.hide();
    this.pending = p;
    this.renderer.build.selected = p.id ?? null;
    document.body.classList.add('placing');
    this.bar.hidden = true;
    this.placeBar.hidden = false;
    document.body.style.setProperty('--buildbar-h', `${this.placeBar.offsetHeight + 8}px`);
    this.showPending();
  }

  private endPlacing(): void {
    if (!this.pending) return;
    this.pending = null;
    document.body.classList.remove('placing');
    this.placeBar.hidden = true;
    this.bar.hidden = false;
    Object.assign(this.renderer.build, { ghost: null, selected: null });
    this.render();
    this.bump();
  }

  /** Why the piece can't go where it is now, if it can't. */
  private pendingProblem(): string | null {
    const p = this.pending;
    if (!p) return null;
    const problem = furnitureProblem(this.sim.state, p.def, p.x, p.s, p.id);
    if (problem) return problem;
    if (p.id === undefined && this.sim.state.money < furniturePrice(p.def)) return `Can't afford it: you have ${pounds(this.sim.state.money)}`;
    return null;
  }

  /** The ghost, and the bar: what it is, what it costs, and whether it fits there. */
  private showPending(): void {
    const p = this.pending;
    if (!p) return;
    const problem = this.pendingProblem();
    this.renderer.build.ghost = { def: p.def, x: p.x, s: p.s, flip: p.flip, ok: problem === null };
    const name = furnitureDef(p.def).name;
    el('place-name').textContent = p.id === undefined ? `${name} · ${pounds(furniturePrice(p.def))}` : `Moving the ${name.toLowerCase()}`;
    const why = el('place-why');
    why.textContent = problem ?? 'Tap where it should go, or drag it.';
    why.classList.toggle('bad', problem !== null);
    const ok = el('place-ok') as HTMLButtonElement;
    ok.disabled = problem !== null;
    ok.textContent = p.id === undefined ? `Place ${pounds(furniturePrice(p.def))}` : 'Place';
    el('place-cancel').textContent = p.id === undefined ? 'Done' : 'Cancel';
    this.bump();
  }

  /** Place: buy it and put it in, or move it there. */
  private place(): void {
    const p = this.pending;
    if (!p || this.pendingProblem()) return;
    const out = { problem: null as string | null };
    this.furnish(() => {
      if (p.id === undefined) {
        const f = buyFurniture(this.sim, p.def, p.x, p.s, p.flip);
        if (typeof f === 'string') out.problem = f;
        return;
      }
      out.problem = shiftFurniture(this.sim, p.id, p.x, p.s);
      const f = this.sim.state.furniture.find((o) => o.id === p.id);
      if (!out.problem && f && !!f.flip !== p.flip) turnFurniture(this.sim, p.id);
    });
    if (out.problem) {
      el('place-why').textContent = out.problem;
      return;
    }
    // A new piece: another copy, just along from the last, until Done. A move is finished.
    if (p.id === undefined) {
      p.x += furnitureDef(p.def).w;
      this.showPending();
    } else this.endPlacing();
  }

  /** Where the ghost first goes: under the middle of the view, dropped to a floor. */
  private middleSpot(def: string): Cell {
    const b = this.viewBox();
    const cell = this.renderer.cellAt(b.x + b.w / 2, b.y + b.h / 2) ?? { x: this.sim.state.plot.x0 + 1, s: 0 };
    const x = Math.max(this.sim.state.plot.x0, Math.min(this.sim.state.plot.x1, cell.x));
    return this.spotFor(def, { x, s: Math.max(0, cell.s) });
  }

  stop(): void {
    this.active = false;
    this.bar.hidden = true;
    this.zoom.hidden = true;
    document.body.classList.remove('building');
    if (this.pending) this.endPlacing();
    Object.assign(this.renderer.build, { active: false, marks: [], ghost: null, selected: null });
    this.card.hide();
    this.bump();
  }

  private bump(): void {
    this.renderer.build.version++;
  }

  // ------------------------------------------------------------------ changes and undo

  /** The building (not the furniture) and the money, for undo. */
  private buildingSnap(): (typeof this.undo)[number] {
    const st = this.sim.state;
    return { plan: JSON.stringify({ cells: st.cells, insulated: st.insulated }), money: st.money, ledger: st.ledger.length };
  }

  private furnitureSnap(): (typeof this.undo)[number] {
    const st = this.sim.state;
    return { furniture: JSON.stringify(st.furniture), money: st.money, ledger: st.ledger.length };
  }

  private pushUndo(step: (typeof this.undo)[number]): void {
    this.undo.push(step);
    if (this.undo.length > MAX_UNDO) this.undo.shift();
    this.updateButtons();
  }

  /** Runs a change to the furniture (which happens straight away), keeping an undo step. */
  private furnish(fn: () => unknown): void {
    const before = this.furnitureSnap();
    fn();
    if (JSON.stringify(this.sim.state.furniture) !== before.furniture) this.pushUndo(before);
    this.bump();
  }

  /**
   * Runs a change to the building and pays for it there and then. If it can't be afforded,
   * it's put back. `keepUndo` is false for each cell of a drag (the drag keeps one step).
   */
  private change(fn: () => unknown, keepUndo = true): string | null {
    const st = this.sim.state;
    const before = this.buildingSnap();
    fn();
    const was = JSON.parse(before.plan!) as { cells: State['cells']; insulated: State['insulated'] };
    if (JSON.stringify({ cells: st.cells, insulated: st.insulated }) === before.plan) return null;
    const cost = quote(piecesBetween({ ...was, furniture: [] }, partsOf(st))).cost;
    if (cost > st.money) {
      Object.assign(st, was);
      return `Can't afford that: it's ${pounds(cost)} and you have ${pounds(st.money)}`;
    }
    if (cost !== 0) book(this.sim, 'Building work', -cost);
    if (keepUndo) this.pushUndo(before);
    this.sim.changed();
    this.bump();
    this.renderZoom();
    return null;
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.restoreStep(prev);
    this.select(null);
  }

  private restoreStep(step: (typeof this.undo)[number]): void {
    const st = this.sim.state;
    if (step.plan) Object.assign(st, JSON.parse(step.plan) as Partial<State>);
    if (step.furniture) st.furniture.splice(0, st.furniture.length, ...(JSON.parse(step.furniture) as State['furniture']));
    st.money = step.money!;
    st.ledger.length = Math.min(st.ledger.length, step.ledger!);
    this.sim.changed();
    this.bump();
    this.renderZoom();
  }

  private turn(): void {
    if (!this.pending) return;
    this.pending.flip = !this.pending.flip;
    this.showPending();
  }

  private isFurniture(): boolean {
    return this.group?.furniture !== undefined;
  }

  private select(id: number | null): void {
    if (id === null) this.card.hide();
    this.renderer.build.selected = id;
    this.bump();
    this.setHint(null);
    this.updateButtons();
  }

  // ------------------------------------------------------------------ the bar

  private render(): void {
    const groups = el('build-groups');
    groups.replaceChildren(
      ...GROUPS.map((g, i) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: i === 4 ? 'gap' : '',
            'aria-selected': String(g === this.group),
            onclick: () => this.pickGroup(g),
          },
          g.name,
        ),
      ),
    );
    groups.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.tools.replaceChildren();
    if (!this.group) {
      // Nothing picked yet.
    } else if (this.group.tools) {
      for (const t of this.group.tools) {
        this.tools.append(h('button', { type: 'button', 'aria-pressed': String(t === this.tool), onclick: () => this.pickTool(t) }, toolIcon(t), TOOLS[t].name, h('small', {}, toolPrice(t))));
      }
    } else {
      for (const d of FURNITURE.filter((f) => this.group!.furniture!.includes(f.group))) {
        this.tools.append(h('button', { type: 'button', onclick: () => this.pickPiece(d.id) }, pieceIcon(d.id), d.name, h('small', {}, pounds(furniturePrice(d.id)))));
      }
    }
    this.renderZoom();
    this.setHint(null);
    this.updateButtons();
    document.body.style.setProperty('--buildbar-h', `${this.bar.offsetHeight}px`);
  }

  private pickGroup(g: (typeof GROUPS)[number]): void {
    this.group = g;
    this.tool = null;
    this.select(null);
    this.render();
  }

  private pickTool(t: Tool): void {
    this.tool = t;
    this.render();
  }

  private pickPiece(id: string): void {
    this.select(null);
    this.startPlacing({ def: id, ...this.middleSpot(id), flip: false });
  }

  private updateButtons(): void {
    (el('build-undo') as HTMLButtonElement).disabled = this.undo.length === 0;
  }

  /** Chips to zoom straight to a flat, or back out to the whole building. */
  private renderZoom(): void {
    const lay = this.sim.layout;
    const chips = [h('button', { type: 'button', onclick: () => this.onFit() }, 'Whole building')];
    for (const f of lay.flats) {
      chips.push(h('button', { type: 'button', onclick: () => this.zoomTo(f.id) }, f.name || 'New flat'));
    }
    this.zoom.replaceChildren(...chips);
  }

  private zoomTo(flatId: string): void {
    const lay = this.sim.layout;
    const f = lay.flat(flatId);
    if (!f) return;
    const cells = lay.flatCells(f).map((n) => lay.xs(n));
    const xs = cells.map(([x]) => x);
    const ss = cells.map(([, s]) => s);
    this.renderer.focus(Math.min(...xs), Math.max(...xs), Math.min(...ss), Math.max(...ss), this.viewBox());
    this.bump();
  }

  private setHint(text: string | null, bad = false): void {
    let base: string;
    if (!this.group) base = 'Pick what to build: walls, doors, stairs, or furniture for a room. Tap furniture in the building to move or sell it.';
    else if (!this.isFurniture()) base = this.tool ? TOOLS[this.tool].hint : 'Pick a tool.';
    else base = 'Pick something to buy, or tap a piece in the building to move or sell it.';
    this.hint.textContent = text ?? base;
    this.hint.classList.toggle('bad', bad);
  }

  // ------------------------------------------------------------------ the canvas

  tap(sx: number, sy: number): void {
    const cell = this.renderer.cellAt(sx, sy);
    if (!cell) return;
    this.apply(cell, true);
    this.preview(null);
  }

  dragStart(sx: number, sy: number): boolean {
    if (!this.active) return false;
    const cell = this.renderer.cellAt(sx, sy);
    if (!cell) return false;
    if (this.pending || this.isFurniture() || !this.tool) {
      // Dragging near the piece being placed slides it (it doesn't jump under your finger,
      // so you can see it); anywhere else moves the view.
      if (!this.pending || !this.nearPending(sx, sy)) return false;
      this.drag = { start: cell, last: cell, moved: false, furniture: this.pending.id ?? -1 };
      return true;
    }
    this.drag = { start: cell, last: cell, moved: false };
    // A drag is one undo step, however many cells it paints.
    this.pushUndo(this.buildingSnap());
    this.preview(cell);
    return true;
  }

  /** Is a screen point on or near the piece being placed? */
  private nearPending(sx: number, sy: number): boolean {
    const f = this.pending;
    if (!f) return false;
    const d = furnitureDef(f.def);
    const c = this.renderer.camera;
    const left = c.ox + f.x * TILE * c.scale;
    const right = left + d.w * TILE * c.scale;
    const bottom = c.oy + floorY(f.s) * c.scale;
    const top = bottom - d.h * TILE * c.scale;
    return sx > left - GRAB_PX && sx < right + GRAB_PX && sy > top - GRAB_PX && sy < bottom + GRAB_PX;
  }

  dragMove(sx: number, sy: number): void {
    const d = this.drag;
    const cell = this.renderer.cellAt(sx, sy);
    if (!d || !cell || (cell.x === d.last.x && cell.s === d.last.s)) return;
    // The cell the drag started on gets painted too, once it's clear this is a drag.
    if (!d.moved && d.furniture === undefined && this.tool && PAINT.includes(this.tool)) this.apply(d.start, false);
    d.moved = true;
    if (d.furniture !== undefined && this.pending) {
      // The ghost follows the finger, a cell at a time; it shows red where it won't fit.
      this.pending.x += cell.x - d.last.x;
      this.pending.s += cell.s - d.last.s;
      d.last = cell;
      this.showPending();
      return;
    }
    if (this.tool && PAINT.includes(this.tool)) {
      // Every cell along the way, so a quick swipe doesn't leave gaps.
      for (const c of between(d.last, cell)) this.apply(c, false);
    }
    d.last = cell;
  }

  dragEnd(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.furniture !== undefined) {
      // A press near the piece that didn't move is a tap, not a slide.
      if (!d.moved) this.tapFurniture(d.start);
      return;
    }
    if (!d.moved) {
      this.undo.pop();
      this.apply(d.start, true);
    } else if (this.undo[this.undo.length - 1]?.plan === this.buildingSnap().plan) {
      this.undo.pop();
    }
    this.renderer.build.marks = [];
    this.bump();
    this.updateButtons();
  }

  dragCancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.furniture === undefined) {
      const prev = this.undo.pop();
      if (prev) this.restoreStep(prev);
    }
    this.renderer.build.marks = [];
    this.bump();
  }

  /** Does the current tool at a cell. `single` is a tap (keeps its own undo step). */
  private apply(cell: Cell, single: boolean): void {
    const st = this.sim.state;
    if (this.pending || this.isFurniture() || !this.tool) {
      this.tapFurniture(cell);
      return;
    }
    let problem: string | null = null;
    const run = (fn: () => string | null | boolean) => {
      const why = this.change(() => {
        const out = fn();
        if (typeof out === 'string') problem = out;
      }, single);
      if (why) problem = why;
    };
    const { x, s } = cell;
    switch (this.tool) {
      case 'demolish':
        run(() => removeCell(st, x, s));
        break;
      case 'insulate':
        run(() => insulate(st, key(x, s)));
        break;
      case 'stair':
        if (single) run(() => placeStairs(st, x, this.stairFoot(x, s)));
        break;
      default: {
        // A door goes in by its bottom cell: tapping the top half of a gap means the cell below.
        const kind = this.tool as CellKind;
        const at = isDoor(kind) && s > 0 && cellProblem(st, x, s, kind) && !cellProblem(st, x, s - 1, kind) ? s - 1 : s;
        run(() => placeCell(st, x, at, kind));
      }
    }
    this.setHint(problem, problem !== null);
  }

  get isMoving(): boolean {
    return this.pending?.id !== undefined;
  }

  /**
   * With a piece being placed, a tap moves its ghost there. Otherwise a tap on a piece in
   * the building brings up its card.
   */
  private tapFurniture(cell: Cell): void {
    if (this.pending) {
      Object.assign(this.pending, this.spotFor(this.pending.def, cell));
      this.showPending();
      return;
    }
    const under = furnitureAt(this.sim.state, cell.x, cell.s);
    if (under && this.card.showing !== under.id) this.showCard(under.id);
    else this.select(null);
  }

  private showCard(id: number): void {
    this.renderer.build.selected = id;
    this.card.show(id);
    this.bump();
    this.setHint(null);
    this.updateButtons();
  }

  /** The piece's card says Move (in build mode). */
  moveFromCard(id: number): void {
    this.beginMove(id);
  }

  /**
   * Where a piece goes for a tapped cell: centred on it. Wall pieces go at the height
   * tapped; floor pieces drop to the floor under the tap (or sit on the floor tapped).
   */
  private spotFor(def: string, cell: Cell): Cell {
    const d = furnitureDef(def);
    const x = cell.x - Math.floor((d.w - 1) / 2);
    if (d.wall) return { x, s: cell.s };
    const st = this.sim.state;
    if (isSolid(st.cells[key(cell.x, cell.s)])) return { x, s: cell.s + 1 };
    let s = cell.s;
    for (let i = 0; i < 3 && s > 0 && !isSolid(st.cells[key(cell.x, s - 1)]); i++) s--;
    return { x, s };
  }

  /** Where a flight starts for a tapped cell: the floor at or just under the tap. */
  private stairFoot(x: number, s: number): number {
    const st = this.sim.state;
    const at = (r: number) => st.cells[key(x, r)];
    if (isSolid(at(s))) return s + 1;
    let foot = s;
    for (let i = 0; i < FLIGHT - 1 && foot > 0 && !isSolid(at(foot - 1)) && at(foot - 1) !== 'stair'; i++) foot--;
    return foot;
  }

  /** Shows where the tool or piece would go (mouse hover, and the start of a drag). */
  private preview(cell: Cell | null): void {
    // A piece being placed stays where it was put; hovering doesn't move it.
    if (this.pending) {
      this.showPending();
      return;
    }
    const b = this.renderer.build;
    b.marks = [];
    b.ghost = null;
    if (!cell || this.drag) {
      this.bump();
      return;
    }
    const st = this.sim.state;
    if (this.isFurniture() || !this.tool) {
      // Nothing to show until a piece or a tool is picked.
    } else if (this.tool === 'stair') {
      const foot = this.stairFoot(cell.x, cell.s);
      b.marks.push({ x: cell.x, s: foot, w: 1, h: FLIGHT, ok: stairsProblem(st, cell.x, foot) === null });
    } else if (this.tool === 'insulate') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: insulateProblem(st, key(cell.x, cell.s)) === null });
    } else if (this.tool === 'demolish') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: removeProblem(st, cell.x, cell.s) === null });
    } else {
      const kind = this.tool as CellKind;
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: isDoor(kind) ? DOOR_ROWS : 1, ok: cellProblem(st, cell.x, cell.s, kind) === null });
    }
    this.bump();
  }
}

/** Every cell on a straight line from a to b, not counting a (so a drag paints each cell once). */
function between(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.s - a.s));
  for (let i = 1; i <= n; i++) {
    const c = { x: Math.round(a.x + ((b.x - a.x) * i) / n), s: Math.round(a.s + ((b.s - a.s) * i) / n) };
    if (!out.some((o) => o.x === c.x && o.s === c.s)) out.push(c);
  }
  return out;
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
    case 'wall':
      // A few cells of wall, the way you draw them.
      for (const [x, y] of [[4, 14], [12, 14], [20, 14], [20, 6]]) r(x, y, 8, 8, '#9c5b45');
      break;
    case 'window':
      r(12, 6, 8, 12, '#d6c9b2');
      r(13, 7, 6, 10, '#8fbcd3');
      r(15, 6, 2, 12, '#bfe3f0');
      break;
    case 'door':
    case 'flatDoor':
    case 'entrance':
      r(11, 2, 10, 21, '#d6c9b2');
      r(15, 6, 2, 17, t === 'flatDoor' ? '#2f6b5a' : t === 'entrance' ? '#23395b' : '#b07a4a');
      break;
    case 'stair':
      // A flight climbing away: treads narrowing as they go up.
      for (let i = 0; i < 6; i++) r(9 + i, 20 - i * 3, 14 - i * 2, 3, i % 2 ? '#835a3c' : '#6d4a31');
      break;
    case 'insulate':
      r(11, 2, 10, 21, '#d6c9b2');
      for (let i = 0; i < 5; i++) r(12 + (i % 2) * 4, 3 + i * 4, 4, 3, '#e8c84a');
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

// ------------------------------------------------------------------ prices

function toolPrice(t: Tool): string {
  if (t === 'demolish') return `${pounds(DEMOLISH_PRICE)} a cell`;
  if (t === 'insulate') return `${pounds(INSULATE_PRICE)} a cell`;
  if (t === 'stair') return `${pounds(CELL_PRICE.stair * FLIGHT)} a flight`;
  return `${pounds(CELL_PRICE[t])}${t === 'wall' || t === 'window' ? ' a cell' : ''}`;
}
