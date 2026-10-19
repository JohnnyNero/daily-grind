// Build mode: draw plans for the building. Plans are free and change nothing until you sign
// them off; then the builders come and do the work over the next few days, a piece at a
// time. Pick a group, then a tool or a piece. Tap to place, drag to build along a line or
// mark out a room, and drag near a piece of furniture to slide it about. The chips at the
// top zoom straight to a flat. Every change to the plans can be undone.

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
  segmentProblem,
  slabProblem,
  slabRemoveProblem,
  stairIn,
  stairProblem,
  insulate,
  insulateProblem,
  type BuildParts,
} from '../sim/build';
import { FURNITURE, furnitureDef, type FurnitureGroup } from '../sim/defs';
import { DEMOLISH_PRICE, FLOOR_PRICE, INSULATE_PRICE, SEGMENT_PRICE, STAIRS_PRICE, TIER_RENT, furniturePrice, pounds } from '../sim/economy';
import { floorKey, wallKey } from '../sim/environment';
import { flatScore, occupants, scoreFor } from '../sim/impressiveness';
import { Sim } from '../sim/sim';
import { ROOM_ROWS, TILE, key, type Segment, type State } from '../sim/state';
import { BUILDERS, copyParts, howLong, jobPieces, partsOf, piecesBetween, plannedParts, quote, signOff, stopJob } from '../sim/works';
import { drawFurniture } from '../render/art';
import { floorY, type Cell, type Renderer } from '../render/renderer';
import { el, h } from './dom';

type Tool = 'room' | Segment | 'floor' | 'stairs' | 'insulate' | 'demolish';

const TOOLS: Record<Tool, { name: string; hint: string }> = {
  room: { name: 'Room', hint: 'Drag across to mark out a room: walls at both ends, a floor and a ceiling.' },
  wall: { name: 'Wall', hint: 'Tap or drag to put up walls.' },
  window: { name: 'Window', hint: 'Tap a wall to put a window in it.' },
  insulate: { name: 'Insulate', hint: 'Tap a wall or a floor: much less noise gets through, and the heat stays in.' },
  door: { name: 'Door', hint: 'An inside door, between rooms of the same flat.' },
  flatDoor: { name: 'Flat door', hint: "A flat's front door. Everything behind it is that flat." },
  entrance: { name: 'Street door', hint: 'The way in from the street, on the ground floor.' },
  floor: { name: 'Floor', hint: 'Tap or drag along a storey to lay a floor (or a ceiling) there.' },
  stairs: { name: 'Stairs', hint: 'Tap where the stairs should start. "Turn" makes them climb the other way.' },
  demolish: { name: 'Knock down', hint: 'Tap or drag to take out walls, doors, floors, stairs and furniture.' },
};

/** The groups along the top of the bar: building work first, then furniture. */
const GROUPS: { id: string; name: string; tools?: Tool[]; furniture?: FurnitureGroup[] }[] = [
  { id: 'walls', name: 'Walls', tools: ['room', 'wall', 'window', 'insulate'] },
  { id: 'doors', name: 'Doors', tools: ['door', 'flatDoor', 'entrance'] },
  { id: 'floors', name: 'Floors', tools: ['floor', 'stairs'] },
  { id: 'demolish', name: 'Knock down', tools: ['demolish'] },
  { id: 'sleep', name: 'Bedroom', furniture: ['sleep'] },
  { id: 'sit', name: 'Living', furniture: ['sit'] },
  { id: 'kitchen', name: 'Kitchen', furniture: ['kitchen'] },
  { id: 'bathroom', name: 'Bathroom', furniture: ['bathroom'] },
  { id: 'storage', name: 'Storage', furniture: ['storage'] },
  { id: 'decor', name: 'Decor & heat', furniture: ['decor'] },
];

const MAX_UNDO = 50;
/** How near (in screen pixels) a drag has to start to the selected piece to move it, not the view. */
const GRAB_PX = 28;

type Box = { x: number; y: number; w: number; h: number };

export class BuildUi {
  active = false;
  private group = GROUPS[0];
  private tool: Tool = 'room';
  private piece: string | null = null;
  private stairDir: 1 | -1 = 1;
  private flip = false;
  private undo: string[] = [];
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

  constructor(private readonly sim: Sim, private readonly renderer: Renderer) {
    el('build-done').addEventListener('click', () => this.stop());
    el('build-undo').addEventListener('click', () => this.doUndo());
    el('build-flip').addEventListener('click', () => this.turn());
    el('build-remove').addEventListener('click', () => {
      const id = this.renderer.build.selected;
      if (id === null) return;
      this.change(() => removeFurniture(this.draft, id));
      this.select(null);
    });
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
    this.loadDraft();
    this.render();
    document.body.style.setProperty('--buildbar-h', `${this.bar.offsetHeight}px`);
    this.onToggle();
  }

  stop(): void {
    this.active = false;
    this.bar.hidden = true;
    this.zoom.hidden = true;
    document.body.classList.remove('building');
    Object.assign(this.renderer.build, { active: false, marks: [], ghost: null, selected: null });
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
    this.draft = { ...st, ...copyParts(plannedParts(st)) };
    this.draftSim = new Sim(this.draft);
  }

  private draftParts(): BuildParts {
    return partsOf(this.draft);
  }

  /** Brings the draft's copy of everything but the building up to date (people move in, ids get used). */
  private syncDraft(): void {
    const parts = this.draftParts();
    Object.assign(this.draft, this.sim.state, parts);
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
    const before = JSON.stringify(this.draftParts());
    fn();
    this.sim.state.nextId = Math.max(this.sim.state.nextId, this.draft.nextId);
    if (JSON.stringify(this.draftParts()) === before) return;
    this.undo.push(before);
    if (this.undo.length > MAX_UNDO) this.undo.shift();
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
    Object.assign(this.draft, JSON.parse(prev) as BuildParts);
    this.select(null);
    this.planChanged();
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
    if (id !== null) this.change(() => flipFurniture(this.draft, id));
    else if (this.isFurniture()) this.flip = !this.flip;
    else this.stairDir = this.stairDir === 1 ? -1 : 1;
    this.setHint(!this.isFurniture() && this.tool === 'stairs' ? `Stairs climb to the ${this.stairDir === 1 ? 'right' : 'left'}.` : null);
  }

  private isFurniture(): boolean {
    return this.group.furniture !== undefined;
  }

  private select(id: number | null): void {
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
    el('build-remove').hidden = !selected;
    el('build-flip').hidden = this.isFurniture() ? !selected && this.piece === null : this.tool !== 'stairs';
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
    const cells = f.rooms.flatMap((r) => lay.rooms[r].nodes).map((n) => lay.xs(n));
    const xs = cells.map(([x]) => x);
    const ss = cells.map(([, s]) => s);
    this.renderer.focus(Math.min(...xs), Math.max(...xs), Math.min(...ss), Math.max(...ss), this.viewBox());
    this.bump();
  }

  private setHint(text: string | null, bad = false): void {
    let base: string;
    if (!this.isFurniture()) base = TOOLS[this.tool].hint;
    else if (this.renderer.build.selected !== null) base = 'Drag near it to slide it about, or turn it round.';
    else if (this.piece) base = `Tap where the ${furnitureDef(this.piece).name.toLowerCase()} should go.`;
    else base = 'Pick something to place, or tap furniture to move it.';
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
    if (this.isFurniture()) {
      // Dragging near the selected piece slides it (it doesn't jump under your finger, so
      // you can see it); anywhere else moves the view.
      const sel = this.renderer.build.selected;
      if (sel === null || !this.nearSelected(sx, sy)) return false;
      this.syncDraft();
      this.drag = { start: cell, last: cell, moved: false, furniture: sel };
      this.undo.push(JSON.stringify(this.draftParts()));
      return true;
    }
    this.syncDraft();
    this.drag = { start: cell, last: cell, moved: false };
    if (this.tool !== 'room') this.undo.push(JSON.stringify(this.draftParts()));
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
    const bottom = c.oy + (floorY(f.s) - f.r * TILE) * c.scale;
    const top = bottom - d.h * TILE * c.scale;
    return sx > left - GRAB_PX && sx < right + GRAB_PX && sy > top - GRAB_PX && sy < bottom + GRAB_PX;
  }

  dragMove(sx: number, sy: number): void {
    const d = this.drag;
    const cell = this.renderer.cellAt(sx, sy);
    if (!d || !cell || (cell.x === d.last.x && cell.s === d.last.s && cell.r === d.last.r)) return;
    d.moved = true;
    if (d.furniture !== undefined) {
      const f = this.draft.furniture.find((o) => o.id === d.furniture)!;
      const dx = cell.x - d.last.x;
      const ds = cell.s - d.last.s;
      const r = furnitureDef(f.def).wall ? Math.max(1, f.r + (ds === 0 ? cell.r - d.last.r : 0)) : 0;
      // If it doesn't fit there, it stays put until the finger reaches somewhere it does.
      if (!moveFurniture(this.draft, f.id, f.x + dx, f.s + ds, r)) {
        d.last = cell;
        this.planChanged();
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
      if (!d.moved || this.undo[this.undo.length - 1] === JSON.stringify(this.draftParts())) this.undo.pop();
      this.updateButtons();
      return;
    }
    if (this.tool === 'room') {
      if (Math.abs(d.last.x - d.start.x) < 2) this.setHint('Make it at least three tiles wide.', true);
      else this.change(() => buildRoom(this.draft, d.start.x, d.start.s, d.last.x, d.last.s));
    } else if (!d.moved) {
      this.undo.pop();
      this.apply(d.start, d.start, true);
    } else if (this.undo.length > 0 && this.undo[this.undo.length - 1] === JSON.stringify(this.draftParts())) {
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
      if (prev) {
        Object.assign(this.draft, JSON.parse(prev) as BuildParts);
        this.planChanged();
      }
    }
    this.renderer.build.marks = [];
    this.bump();
  }

  /** Does the current tool at a cell. `single` is a tap (keeps its own undo step). */
  private apply(cell: Cell, start: Cell, single: boolean): void {
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
        this.sim.state.nextId = Math.max(this.sim.state.nextId, this.draft.nextId);
        this.planChanged();
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
      case 'insulate': {
        const part = this.insulatePart(cell.x, s, r);
        if (!part) problem = 'Tap a wall, or a floor between storeys';
        else run(() => insulate(st, part));
        break;
      }
      default:
        if (r === ROOM_ROWS) problem = 'Tap the storey, not the floor';
        else run(() => placeSegment(st, cell.x, s, this.tool as Segment));
    }
    this.setHint(problem, problem !== null);
  }

  /** The wall or floor tile the insulate tool means at a cell. */
  private insulatePart(x: number, s: number, r: number): string | null {
    if (r === ROOM_ROWS) return floorKey(x, s + 1);
    return this.draft.walls[key(x, s)] ? wallKey(x, s) : null;
  }

  private demolish(x: number, s: number, r: number): string | null {
    const st = this.draft;
    if (r === ROOM_ROWS) return removeSlab(st, x, s + 1);
    const f = furnitureAt(st, x, s, r);
    if (f) return removeFurniture(st, f.id) ? null : 'Nothing there';
    if (removeSegment(st, x, s)) return null;
    const t = stairIn(st, x, s);
    if (t) return removeStair(st, t.id) ? null : 'Nothing there';
    if (st.slabs[key(x, s)] && s > 0) return removeSlab(st, x, s);
    return 'Nothing to knock down there';
  }

  /**
   * With a piece in hand, a tap places it (and selects it, ready to slide or turn); tapping
   * furniture that's already there picks that up instead. With nothing in hand, a tap
   * selects furniture.
   */
  private tapFurniture(cell: Cell): void {
    const st = this.draft;
    const under = furnitureAt(st, cell.x, cell.s, cell.r);
    if (!this.piece || (under && furnitureProblem(st, this.piece, ...spotXSR(this.spotFor(this.piece, cell))) !== null)) {
      this.select(under && this.renderer.build.selected !== under.id ? under.id : null);
      return;
    }
    const spot = this.spotFor(this.piece, cell);
    const out: { result: ReturnType<typeof placeFurniture> } = { result: 'Nothing placed' };
    this.change(() => {
      out.result = placeFurniture(st, this.piece!, spot.x, spot.s, spot.r, this.flip);
    });
    if (typeof out.result === 'string') this.setHint(out.result, true);
    else this.select(out.result.id);
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
    const st = this.draft;
    if (this.isFurniture()) {
      if (this.piece) {
        const spot = this.spotFor(this.piece, cell);
        b.ghost = { def: this.piece, ...spot, flip: this.flip, ok: furnitureProblem(st, this.piece, spot.x, spot.s, spot.r) === null };
      }
    } else if (this.tool === 'stairs') {
      b.marks.push({ x: cell.x, s: cell.s, r: 0, w: 3, h: ROOM_ROWS, ok: stairProblem(st, cell.x, cell.s, this.stairDir) === null });
    } else if (this.tool === 'floor') {
      const level = cell.r === ROOM_ROWS ? cell.s + 1 : cell.s;
      b.marks.push({ x: cell.x, s: level - 1, r: ROOM_ROWS, w: 1, h: 1, ok: level >= 1 && slabProblem(st, cell.x, level) === null });
    } else if (this.tool === 'insulate') {
      const part = this.insulatePart(cell.x, cell.s, cell.r);
      const ok = part !== null && insulateProblem(st, part) === null;
      if (cell.r === ROOM_ROWS) b.marks.push({ x: cell.x, s: cell.s, r: ROOM_ROWS, w: 1, h: 1, ok });
      else b.marks.push({ x: cell.x, s: cell.s, r: 0, w: 1, h: ROOM_ROWS, ok });
    } else if (this.tool === 'demolish') {
      const ok = cell.r === ROOM_ROWS ? slabRemoveProblem(st, cell.x, cell.s + 1) === null : true;
      b.marks.push({ x: cell.x, s: cell.s, r: cell.r === ROOM_ROWS ? ROOM_ROWS : 0, w: 1, h: cell.r === ROOM_ROWS ? 1 : ROOM_ROWS, ok });
    } else if (this.tool !== 'room' && cell.r < ROOM_ROWS) {
      b.marks.push({ x: cell.x, s: cell.s, r: 0, w: 1, h: ROOM_ROWS, ok: segmentProblem(st, cell.x, cell.s, this.tool as Segment) === null });
    }
    this.bump();
  }
}

const spotXSR = (c: Cell): [number, number, number] => [c.x, c.s, c.r];

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
  if (t === 'room') return 'by the part';
  if (t === 'floor') return `${pounds(FLOOR_PRICE)} a tile`;
  if (t === 'stairs') return pounds(STAIRS_PRICE);
  if (t === 'demolish') return pounds(DEMOLISH_PRICE);
  if (t === 'insulate') return pounds(INSULATE_PRICE);
  return pounds(SEGMENT_PRICE[t]);
}
