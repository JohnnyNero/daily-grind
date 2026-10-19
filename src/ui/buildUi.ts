// Build mode: draw plans for the building. Plans are free and change nothing until you sign
// them off; then the builders come and do the work over the next few days, a piece at a
// time. Furniture is different: it goes in, moves and sells straight away. Pick a group,
// then a tool or a piece. Tap to place, drag to build along a line or mark out a room. Tap
// a piece of furniture for its card (move, turn, sell). The chips at the top zoom straight
// to a flat. Everything can be undone.

import {
  buildRoom,
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
  type BuildParts,
} from '../sim/build';
import { FURNITURE, furnitureDef, type FurnitureGroup } from '../sim/defs';
import { CELL_PRICE, DEMOLISH_PRICE, INSULATE_PRICE, TIER_RENT, furniturePrice, pounds } from '../sim/economy';
import { flatScore, occupants, scoreFor } from '../sim/impressiveness';
import { Sim } from '../sim/sim';
import { DOOR_ROWS, TILE, isDoor, isSolid, key, type CellKind, type State } from '../sim/state';
import { buyFurniture, sellFurniture, shiftFurniture, turnFurniture } from '../sim/furnish';
import { BUILDERS, copyParts, howLong, jobPieces, partsOf, piecesBetween, plannedParts, quote, signOff, stopJob } from '../sim/works';
import { drawFurniture } from '../render/art';
import { floorY, type Cell, type Renderer } from '../render/renderer';
import { el, h } from './dom';
import type { FurnitureCard } from './furnitureCard';

type Tool = 'room' | CellKind | 'insulate' | 'demolish';

const TOOLS: Record<Tool, { name: string; hint: string }> = {
  wall: { name: 'Wall', hint: 'Draw walls a cell at a time, anywhere. A wall with space over it is a floor.' },
  room: { name: 'Room', hint: 'Drag a box: walls all round it, with the room inside.' },
  window: { name: 'Window', hint: 'Tap a gap in a wall (or a wall cell) to put a window in.' },
  insulate: { name: 'Insulate', hint: 'Tap or drag along walls: much less noise gets through, and the heat stays in.' },
  door: { name: 'Door', hint: 'Tap the bottom of a two-cell gap in a wall: an inside door, between rooms of one flat.' },
  flatDoor: { name: 'Flat door', hint: "Tap the bottom of a two-cell gap: a flat's front door. Everything behind it is that flat." },
  entrance: { name: 'Street door', hint: 'Tap the bottom of a two-cell gap on the ground: the way in from the street.' },
  stair: { name: 'Stairs', hint: 'Tap a floor: a flight goes straight up from it, one cell wide, through the floor above.' },
  demolish: { name: 'Knock down', hint: 'Tap or drag to take out walls, windows, doors and stairs. Tap furniture to sell it.' },
};

/** The groups along the top of the bar: building work first, then furniture. */
const GROUPS: { id: string; name: string; tools?: Tool[]; furniture?: FurnitureGroup[] }[] = [
  { id: 'walls', name: 'Walls', tools: ['wall', 'room', 'window', 'insulate'] },
  { id: 'doors', name: 'Doors', tools: ['door', 'flatDoor', 'entrance'] },
  { id: 'stairs', name: 'Stairs', tools: ['stair'] },
  { id: 'demolish', name: 'Knock down', tools: ['demolish'] },
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
  private group = GROUPS[0];
  private tool: Tool = 'wall';
  private piece: string | null = null;
  private flip = false;
  /** Undo steps: the plans as they were, or the furniture (and the money) as it was. */
  private undo: { plan?: string; furniture?: string; money?: number; ledger?: number }[] = [];
  /** A piece being moved: the next tap puts it there. */
  private moving: number | null = null;
  private drag: { start: Cell; last: Cell; moved: boolean; furniture?: number } | null = null;
  /** The plans being drawn: a copy of the state with the planned building in it. */
  private draft!: State;
  private draftSim!: Sim;
  private bar = el('buildbar');
  private hint = el('build-hint');
  private tools = el('build-tools');
  private zoom = el('build-zoom');
  /** Called when build mode opens or closes (the view refits around the bar). */
  onToggle: () => void = () => {};
  /** A message for the player. */
  onNotify: (text: string, bad?: boolean) => void = () => {};
  /** The part of the screen the building shows in, for zooming to a flat. */
  viewBox: () => Box = () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });

  constructor(private readonly sim: Sim, private readonly renderer: Renderer, private readonly card: FurnitureCard) {
    el('build-done').addEventListener('click', () => this.stop());
    el('build-undo').addEventListener('click', () => this.doUndo());
    el('build-flip').addEventListener('click', () => this.turn());
    el('build-sign').addEventListener('click', () => this.signOff());
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
    this.zoom.hidden = false;
    document.body.classList.add('building');
    this.renderer.build.active = true;
    this.undo = [];
    this.moving = null;
    this.loadDraft();
    this.render();
    this.onToggle();
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
    this.piece = null;
    this.render();
    this.card.hide();
    this.moving = id;
    this.renderer.build.selected = id;
    this.bump();
    this.setHint(null);
    this.updateButtons();
  }

  stop(): void {
    this.active = false;
    this.bar.hidden = true;
    this.zoom.hidden = true;
    document.body.classList.remove('building');
    Object.assign(this.renderer.build, { active: false, marks: [], ghost: null, selected: null });
    this.moving = null;
    this.card.hide();
    this.bump();
    if (this.sim.state.works.plan) this.onNotify('Your plans are kept. Sign them off in build mode to get the builders in.');
    this.onToggle();
  }

  private bump(): void {
    this.renderer.build.version++;
  }

  // ------------------------------------------------------------------ the plans

  /** A copy of the state to draw plans on, starting from the plans so far (or the job, or the building). */
  private loadDraft(): void {
    const st = this.sim.state;
    this.draft = { ...st, ...copyParts(plannedParts(st)), furniture: st.furniture };
    this.draftSim = new Sim(this.draft);
  }

  private draftParts(): BuildParts {
    return partsOf(this.draft);
  }

  /** Brings the draft's copy of everything but the building up to date (people move in, ids get used). */
  private syncDraft(): void {
    const parts = this.draftParts();
    Object.assign(this.draft, this.sim.state, parts, { furniture: this.sim.state.furniture });
  }

  /** The plans, without the furniture (which isn't planned), for undo. */
  private planSnap(): string {
    const d = this.draft;
    return JSON.stringify({ cells: d.cells, insulated: d.insulated });
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
    this.draftSim.changed();
    this.bump();
    this.updateFooter();
  }

  /** Stores the draft as the plans (or no plans, if it's no different from what's already happening). */
  private savePlan(): void {
    const st = this.sim.state;
    const base = st.works.job ?? partsOf(st);
    const parts = this.draftParts();
    st.works.plan = piecesBetween(base, parts).length > 0 ? copyParts(parts) : null;
  }

  /** Runs a change to the plans, keeping an undo step if anything changed. */
  private change(fn: () => unknown): void {
    this.syncDraft();
    const before = this.planSnap();
    fn();
    this.sim.state.nextId = Math.max(this.sim.state.nextId, this.draft.nextId);
    if (this.planSnap() === before) return;
    this.pushUndo({ plan: before });
    this.planChanged();
  }

  private planChanged(): void {
    this.draftSim.changed();
    this.savePlan();
    this.bump();
    this.updateFooter();
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.restoreStep(prev);
    this.select(null);
  }

  private restoreStep(step: (typeof this.undo)[number]): void {
    const st = this.sim.state;
    if (step.plan) {
      Object.assign(this.draft, JSON.parse(step.plan) as Partial<BuildParts>);
      this.planChanged();
    }
    if (step.furniture) {
      st.furniture.splice(0, st.furniture.length, ...(JSON.parse(step.furniture) as State['furniture']));
      st.money = step.money!;
      st.ledger.length = Math.min(st.ledger.length, step.ledger!);
      this.sim.changed();
      this.draftSim.changed();
      this.bump();
      this.updateFooter();
    }
  }

  private signOff(): void {
    const problem = signOff(this.sim);
    if (problem) {
      this.setHint(`Can't sign that off: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}.`, true);
      return;
    }
    this.undo = [];
    this.loadDraft();
    this.select(null);
    this.bump();
    this.updateFooter();
  }

  private turn(): void {
    const id = this.renderer.build.selected;
    if (id !== null) this.furnish(() => turnFurniture(this.sim, id));
    else if (this.isFurniture()) this.flip = !this.flip;
    this.setHint(null);
  }

  private isFurniture(): boolean {
    return this.group.furniture !== undefined;
  }

  private select(id: number | null): void {
    if (id === null) {
      this.moving = null;
      this.card.hide();
    }
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
    if (this.group.tools) {
      for (const t of this.group.tools) {
        this.tools.append(h('button', { type: 'button', 'aria-pressed': String(t === this.tool), onclick: () => this.pickTool(t) }, toolIcon(t), TOOLS[t].name, h('small', {}, toolPrice(t))));
      }
    } else {
      for (const d of FURNITURE.filter((f) => this.group.furniture!.includes(f.group))) {
        this.tools.append(h('button', { type: 'button', 'aria-pressed': String(d.id === this.piece), onclick: () => this.pickPiece(d.id) }, pieceIcon(d.id), d.name, h('small', {}, pounds(furniturePrice(d.id)))));
      }
    }
    this.renderZoom();
    this.setHint(null);
    this.updateButtons();
    this.updateFooter();
    document.body.style.setProperty('--buildbar-h', `${this.bar.offsetHeight}px`);
  }

  private pickGroup(g: (typeof GROUPS)[number]): void {
    this.group = g;
    if (g.tools) this.tool = g.tools[0];
    this.piece = null;
    this.select(null);
    this.render();
  }

  private pickTool(t: Tool): void {
    this.tool = t;
    this.render();
  }

  private pickPiece(id: string): void {
    this.piece = this.piece === id ? null : id;
    this.select(null);
    this.render();
  }

  private updateButtons(): void {
    const selected = this.renderer.build.selected !== null;
    (el('build-undo') as HTMLButtonElement).disabled = this.undo.length === 0;
    el('build-flip').hidden = !this.isFurniture() || (!selected && this.piece === null);
  }

  /** The cost of the plans, how long they'll take, and what they'll do for the flats. */
  private updateFooter(): void {
    const st = this.sim.state;
    const out = el('build-quote');
    const sign = el('build-sign') as HTMLButtonElement;
    out.replaceChildren();
    if (st.works.plan) {
      const q = quote(piecesBetween(partsOf(st), st.works.plan));
      sign.disabled = false;
      sign.textContent = `Sign off ${pounds(q.cost)}`;
      out.append(
        h('strong', {}, `${pounds(q.cost)} · ${howLong(q.minutes)}`),
        ...this.effects().map((e) => h('span', { class: e.up ? 'up' : 'down' }, e.text)),
        h('button', { type: 'button', class: 'link', onclick: () => this.clearPlans() }, 'Clear plans'),
      );
    } else {
      sign.disabled = true;
      sign.textContent = 'Sign off';
      const left = jobPieces(this.sim);
      if (left.length > 0) {
        const q = quote(left);
        out.append(
          h('span', {}, `${BUILDERS} are on it: ${q.pieces} job${q.pieces === 1 ? '' : 's'} left, ${pounds(q.cost)} to pay, ${howLong(q.minutes)}${st.works.waiting ? ' (waiting to be paid)' : ''}.`),
          h('button', { type: 'button', class: 'link', onclick: () => this.stopBuilders() }, 'Stop them'),
        );
      } else out.append(h('span', {}, 'Plans are free. Nothing happens until you sign them off.'));
    }
  }

  /** Flats whose tier the plans would change, and new flats the plans make. */
  private effects(): { text: string; up: boolean }[] {
    const ranks = Object.keys(TIER_RENT);
    const live = this.sim.layout;
    const out: { text: string; up: boolean }[] = [];
    for (const f of this.draftSim.layout.flats) {
      const people = occupants(this.sim, f.id);
      const after = scoreFor(this.draftSim, f.id, people).tier;
      const was = live.flat(f.id);
      if (!was) {
        out.push({ text: `New flat: ${after}, about ${pounds(TIER_RENT[after])}/wk`, up: true });
        continue;
      }
      const before = flatScore(this.sim, f.id).tier;
      if (before === after) continue;
      const diff = TIER_RENT[after] - TIER_RENT[before];
      out.push({ text: `${f.name || was.name}: ${before} → ${after} (${pounds(diff, true)}/wk)`, up: ranks.indexOf(after) > ranks.indexOf(before) });
    }
    for (const f of live.flats) if (!this.draftSim.layout.flat(f.id)) out.push({ text: `${f.name} would go`, up: false });
    return out;
  }

  private clearPlans(): void {
    this.sim.state.works.plan = null;
    this.undo = [];
    this.loadDraft();
    this.select(null);
    this.bump();
    this.updateFooter();
  }

  private stopBuilders(): void {
    stopJob(this.sim);
    this.clearPlans();
  }

  /** Chips to zoom straight to a flat, or back out to the whole building. */
  private renderZoom(): void {
    const lay = this.draftSim.layout;
    const chips = [h('button', { type: 'button', onclick: () => this.onToggle() }, 'Whole building')];
    for (const f of lay.flats) {
      chips.push(h('button', { type: 'button', onclick: () => this.zoomTo(f.id) }, f.name || 'New flat'));
    }
    this.zoom.replaceChildren(...chips);
  }

  private zoomTo(flatId: string): void {
    const lay = this.draftSim.layout;
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
    if (!this.isFurniture()) base = TOOLS[this.tool].hint;
    else if (this.moving !== null) base = `Tap where the ${furnitureDef(this.movingDef()!).name.toLowerCase()} should go, or drag near it to slide it.`;
    else if (this.renderer.build.selected !== null) base = 'Drag near it to slide it about.';
    else if (this.piece) base = `Tap where the ${furnitureDef(this.piece).name.toLowerCase()} should go.`;
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
    if (this.isFurniture()) {
      // Dragging near the selected piece slides it (it doesn't jump under your finger, so
      // you can see it); anywhere else moves the view.
      const sel = this.renderer.build.selected;
      if (sel === null || !this.nearSelected(sx, sy)) return false;
      this.drag = { start: cell, last: cell, moved: false, furniture: sel };
      this.pushUndo(this.furnitureSnap());
      return true;
    }
    this.syncDraft();
    this.drag = { start: cell, last: cell, moved: false };
    if (this.tool !== 'room') this.pushUndo({ plan: this.planSnap() });
    this.preview(cell);
    return true;
  }

  /** Is a screen point on or near the selected piece? */
  private nearSelected(sx: number, sy: number): boolean {
    const f = this.draft.furniture.find((o) => o.id === this.renderer.build.selected);
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
    if (!d.moved && d.furniture === undefined && PAINT.includes(this.tool)) this.apply(d.start, false);
    d.moved = true;
    if (d.furniture !== undefined) {
      const f = this.sim.state.furniture.find((o) => o.id === d.furniture)!;
      const dx = cell.x - d.last.x;
      const ds = cell.s - d.last.s;
      // If it doesn't fit there, it stays put until the finger reaches somewhere it does.
      this.syncDraft();
      if (!shiftFurniture(this.sim, f.id, f.x + dx, f.s + ds, this.draft)) {
        d.last = cell;
        this.draftSim.changed();
        this.bump();
      }
      return;
    }
    if (this.tool === 'room') this.markRoom(d.start, cell);
    else if (PAINT.includes(this.tool)) {
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
      if (!d.moved || this.undo[this.undo.length - 1]?.furniture === JSON.stringify(this.sim.state.furniture)) this.undo.pop();
      else this.moving = null;
      // A press near the piece that didn't move is a tap, not a slide.
      if (!d.moved) this.tapFurniture(d.start);
      this.updateButtons();
      this.setHint(null);
      return;
    }
    if (this.tool === 'room') {
      if (Math.abs(d.last.x - d.start.x) < 2 || Math.abs(d.last.s - d.start.s) < 3) this.setHint('Make it at least 3 wide and 4 tall: people need two cells of headroom.', true);
      else this.change(() => buildRoom(this.draft, d.start.x, d.start.s, d.last.x, d.last.s));
    } else if (!d.moved) {
      this.undo.pop();
      this.apply(d.start, true);
    } else if (this.undo[this.undo.length - 1]?.plan === this.planSnap()) {
      this.undo.pop();
    }
    this.renderer.build.marks = [];
    this.bump();
    this.updateButtons();
  }

  dragCancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d && (d.furniture !== undefined || this.tool !== 'room')) {
      const prev = this.undo.pop();
      if (prev) this.restoreStep(prev);
    }
    this.renderer.build.marks = [];
    this.bump();
  }

  /** Does the current tool at a cell. `single` is a tap (keeps its own undo step). */
  private apply(cell: Cell, single: boolean): void {
    const st = this.draft;
    if (this.isFurniture()) {
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
        this.planChanged();
      }
    };
    const { x, s } = cell;
    switch (this.tool) {
      case 'room':
        if (single) problem = 'Drag across to mark out a room.';
        break;
      case 'demolish': {
        // Knocking down furniture sells it, there and then (only with a tap, not a drag).
        const f = furnitureAt(this.sim.state, x, s);
        if (f) {
          if (single) this.furnish(() => sellFurniture(this.sim, f.id));
        } else run(() => removeCell(st, x, s));
        break;
      }
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
    return this.moving !== null;
  }

  private movingDef(): string | null {
    return this.sim.state.furniture.find((o) => o.id === this.moving)?.def ?? null;
  }

  /**
   * Moving a piece: a tap puts it there. With a piece in hand, a tap buys one and puts it in
   * (tapping furniture that's already there brings up its card instead). With nothing in
   * hand, a tap brings up a piece's card.
   */
  private tapFurniture(cell: Cell): void {
    const st = this.sim.state;
    this.syncDraft();
    const movingDef = this.movingDef();
    if (this.moving !== null && movingDef) {
      const id = this.moving;
      const spot = this.spotFor(movingDef, cell);
      const out = { problem: null as string | null };
      this.furnish(() => {
        out.problem = shiftFurniture(this.sim, id, spot.x, spot.s, this.draft);
      });
      if (out.problem) {
        this.setHint(out.problem, true);
        return;
      }
      this.moving = null;
      this.showCard(id);
      return;
    }
    const under = furnitureAt(st, cell.x, cell.s);
    const spot = this.piece ? this.spotFor(this.piece, cell) : null;
    if (!this.piece || !spot || (under && furnitureProblem(st, this.piece, spot.x, spot.s) !== null)) {
      if (under && this.card.showing !== under.id) this.showCard(under.id);
      else this.select(null);
      return;
    }
    const out = { result: 'Nothing placed' as ReturnType<typeof buyFurniture> };
    this.furnish(() => {
      out.result = buyFurniture(this.sim, this.piece!, spot.x, spot.s, this.flip, this.draft);
    });
    if (typeof out.result === 'string') this.setHint(out.result, true);
    else {
      // Selected, so a drag near it slides it into place.
      this.renderer.build.selected = out.result.id;
      this.bump();
      this.setHint(null);
      this.updateButtons();
    }
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
    const st = this.draft;
    const at = (r: number) => st.cells[key(x, r)];
    if (isSolid(at(s))) return s + 1;
    let foot = s;
    for (let i = 0; i < FLIGHT - 1 && foot > 0 && !isSolid(at(foot - 1)) && at(foot - 1) !== 'stair'; i++) foot--;
    return foot;
  }

  private markRoom(a: Cell, b: Cell): void {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [s0, s1] = [Math.min(a.s, b.s), Math.max(a.s, b.s)];
    const ok = x1 - x0 >= 2 && s1 - s0 >= 3;
    const m = this.renderer.build.marks;
    m.length = 0;
    m.push({ x: x0, s: s0, w: x1 - x0 + 1, h: 1, ok }, { x: x0, s: s1, w: x1 - x0 + 1, h: 1, ok });
    if (s1 - s0 > 1) m.push({ x: x0, s: s0 + 1, w: 1, h: s1 - s0 - 1, ok }, { x: x1, s: s0 + 1, w: 1, h: s1 - s0 - 1, ok });
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
    const st = this.draft;
    if (this.isFurniture()) {
      const moving = this.sim.state.furniture.find((o) => o.id === this.moving);
      const def = moving?.def ?? this.piece;
      if (def) {
        const spot = this.spotFor(def, cell);
        const ok = furnitureProblem(this.sim.state, def, spot.x, spot.s, moving?.id) === null && furnitureProblem(st, def, spot.x, spot.s, moving?.id) === null;
        b.ghost = { def, ...spot, flip: moving ? !!moving.flip : this.flip, ok };
      }
    } else if (this.tool === 'stair') {
      const foot = this.stairFoot(cell.x, cell.s);
      b.marks.push({ x: cell.x, s: foot, w: 1, h: FLIGHT, ok: stairsProblem(st, cell.x, foot) === null });
    } else if (this.tool === 'insulate') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: insulateProblem(st, key(cell.x, cell.s)) === null });
    } else if (this.tool === 'demolish') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: removeProblem(st, cell.x, cell.s) === null || furnitureAt(this.sim.state, cell.x, cell.s) !== undefined });
    } else if (this.tool !== 'room') {
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
    case 'room':
      r(4, 20, 24, 3, '#77706a');
      r(4, 2, 24, 3, '#77706a');
      r(4, 5, 3, 15, '#9c5b45');
      r(25, 5, 3, 15, '#9c5b45');
      r(7, 5, 18, 15, '#d9b98f');
      break;
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
  if (t === 'room') return `${pounds(CELL_PRICE.wall)} a cell`;
  if (t === 'demolish') return `${pounds(DEMOLISH_PRICE)} a cell`;
  if (t === 'insulate') return `${pounds(INSULATE_PRICE)} a cell`;
  if (t === 'stair') return `${pounds(CELL_PRICE.stair * FLIGHT)} a flight`;
  return `${pounds(CELL_PRICE[t])}${t === 'wall' || t === 'window' ? ' a cell' : ''}`;
}
