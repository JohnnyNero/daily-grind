// Build mode: change the building. Walls, doors, windows, stairs and insulation are drawn
// as a draft first, free: anything that wouldn't be held up shows in red. Sign off builds
// the lot there and then and takes the money (and can't be pressed while anything's red).
// Pick a group, then a tool or a piece. Walls are drawn a cell at a time (drag to draw a
// line) and erased the same way. Picking a piece of furniture (or Move on a piece's
// card) puts the bar away and shows the piece as a ghost: tap or drag to put it where you
// want, and nothing happens until you press Place (furniture goes in straight away then).
// The chips at the top zoom straight to a flat. Everything can be undone.

import { applyForPlanning, needsPlanning, topRow } from '../sim/planning';
import { PLANNING_FEE, flatInfo } from '../sim/economy';
import { flatNeeds } from '../sim/impressiveness';
import { changeFacts, type Fact } from '../sim/preview';
import { flatKind } from '../sim/rooms';
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
  unsupportedCells,
} from '../sim/build';
import { FURNITURE, furnitureDef, isGraded, type FurnitureGroup } from '../sim/defs';
import { CELL_PRICE, DEMOLISH_PRICE, INSULATE_PRICE, book, furniturePrice, pounds } from '../sim/economy';
import { GRADE_NAMES, GRADE_ORDER, gradeOf, gradeProblem, gradedName, poshLockedWhy, poshUnlocked } from '../sim/grades';
import type { Sim } from '../sim/sim';
import { DOOR_ROWS, TICKS_PER_HOUR, TILE, isDoor, isSolid, key, type CellKind, type Grade, type State } from '../sim/state';
import { buyFurniture, fittedPrice, shiftFurniture, turnFurniture } from '../sim/furnish';
import { pipeCost } from '../sim/risers';
import { partsOf, piecesBetween, quote } from '../sim/works';
import { applyForRisers, riserProblem, risersOf, setRisers, unapproved } from '../sim/risers';
import { RISERS } from '../sim/tuning';
import { drawFurniture } from '../render/art';
import { floorY, type Cell, type Renderer } from '../render/renderer';
import { el, h } from './dom';
import type { FurnitureCard } from './furnitureCard';

type Tool = CellKind | 'insulate' | 'demolish' | 'riser';

const TOOLS: Record<Tool, { name: string; hint: string }> = {
  wall: { name: 'Add', hint: 'Tap or drag to draw walls a cell at a time, anywhere. A wall with space over it is a floor.' },
  window: { name: 'Window', hint: 'Tap a gap in a wall (or a wall cell) to put a window in.' },
  insulate: { name: 'Insulate', hint: 'Tap or drag along walls: much less noise gets through, and the heat stays in.' },
  door: { name: 'Door', hint: 'Tap the bottom of a two-cell gap in a wall: an inside door, between rooms of one flat.' },
  flatDoor: { name: 'Flat door', hint: "Tap the bottom of a two-cell gap: a flat's front door. Everything behind it is that flat." },
  entrance: { name: 'Street door', hint: 'Tap the bottom of a two-cell gap on the ground: the way in from the street.' },
  stair: { name: 'Stairs', hint: 'Tap a floor: a flight goes straight up from it, one cell wide, through the floor above.' },
  demolish: { name: 'Erase', hint: 'Tap or drag to take out walls, windows, doors and stairs.' },
  riser: { name: 'Riser', hint: 'Tap a column: a riser, the pipes kitchens and bathrooms plumb into, up every floor. Building control look at it first. Tap a planned one to take it out.' },
};

/** The groups along the top of the bar: building work first, then furniture. */
const GROUPS: { id: string; name: string; tools?: Tool[]; furniture?: FurnitureGroup[] }[] = [
  { id: 'walls', name: 'Walls', tools: ['wall', 'demolish'] },
  { id: 'doors', name: 'Doors & windows', tools: ['door', 'flatDoor', 'entrance', 'window'] },
  { id: 'stairs', name: 'Stairs & pipes', tools: ['stair', 'riser'] },
  { id: 'insulate', name: 'Insulation', tools: ['insulate'] },
  { id: 'sleep', name: 'Bedroom', furniture: ['sleep'] },
  { id: 'sit', name: 'Living', furniture: ['sit'] },
  { id: 'kitchen', name: 'Kitchen', furniture: ['kitchen'] },
  { id: 'bathroom', name: 'Bathroom', furniture: ['bathroom'] },
  { id: 'storage', name: 'Storage', furniture: ['storage'] },
  { id: 'decor', name: 'Decor & heat', furniture: ['decor'] },
  { id: 'shared', name: 'Shared & garden', furniture: ['shared'] },
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
  /** Undo steps: the draft as it was, or the furniture (and the money) as it was. */
  private undo: { plan?: string; furniture?: string; money?: number; ledger?: number }[] = [];
  /**
   * A piece being placed: what, where and which way round it would go, and (if it's
   * already in the building) which one is moving. Nothing changes until Place.
   */
  private pending: { def: string; x: number; s: number; flip: boolean; id?: number; grade?: Grade } | null = null;
  /** The grade new pieces are bought at (pieces that don't come in grades ignore it). */
  private grade: Grade = 'standard';
  private placeBar = el('place-bar');
  /** The draft: the building as you've drawn it (its cells and insulation; the rest is the real thing). */
  private draft!: State;
  private drag: { start: Cell; last: Cell; moved: boolean; furniture?: number } | null = null;
  private bar = el('buildbar');
  private hint = el('build-hint');
  private tools = el('build-tools');
  private zoom = el('build-zoom');
  /** The flat you've zoomed to, whose checklist shows (folded or not). */
  private needsFlat: string | null = null;
  private needsFolded = false;
  private needsKey = '';
  private needs = el('build-needs');
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
    this.loadDraft();
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
    this.startPlacing({ def: f.def, x: f.x, s: f.s, flip: !!f.flip, id, grade: gradeOf(f) });
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
    this.syncDraft();
    const problem = furnitureProblem(this.sim.state, p.def, p.x, p.s, p.id) ?? furnitureProblem(this.draft, p.def, p.x, p.s, p.id);
    if (problem) return problem;
    if (p.id !== undefined) return null;
    const locked = gradeProblem(this.sim, p.def, p.grade ?? 'standard');
    if (locked) return locked;
    if (this.sim.state.money < this.pendingPrice()) return `Can't afford it: you have ${pounds(this.sim.state.money)}`;
    return null;
  }

  /** What the piece being placed costs where it is: its price, and the plumbing if it's new (or moving) far from the pipes. */
  private pendingPrice(): number {
    const p = this.pending;
    if (!p) return 0;
    return p.id === undefined ? fittedPrice(this.sim.state, p.def, p.x, p.grade) : pipeCost(this.sim.state, p.def, p.x);
  }

  /** The ghost, and the bar: what it is, what it costs, and whether it fits there. */
  private showPending(): void {
    const p = this.pending;
    if (!p) return;
    const problem = this.pendingProblem();
    this.renderer.build.ghost = { def: p.def, x: p.x, s: p.s, flip: p.flip, ok: problem === null, grade: p.grade };
    const name = gradedName({ def: p.def, grade: p.grade });
    el('place-name').textContent = p.id === undefined ? `${name} · ${pounds(this.pendingPrice())}` : `Moving the ${name.toLowerCase()}`;
    const why = el('place-why');
    why.textContent = problem ?? 'Tap where it should go, or drag it.';
    why.classList.toggle('bad', problem !== null);
    // What it would do, in a few words: facts, not advice.
    el('place-facts').replaceChildren(...(problem === null ? this.pendingFacts() : []).map(factSpan));
    const ok = el('place-ok') as HTMLButtonElement;
    ok.disabled = problem !== null;
    ok.textContent = p.id === undefined || this.pendingPrice() > 0 ? `Place ${pounds(this.pendingPrice())}` : 'Place';
    el('place-cancel').textContent = p.id === undefined ? 'Done' : 'Cancel';
    this.bump();
  }

  /** The flats as they'd be with the piece where the ghost is, against as they are. */
  private pendingFacts(): Fact[] {
    const p = this.pending;
    if (!p) return [];
    const st = this.sim.state;
    const moving = p.id === undefined ? undefined : st.furniture.find((f) => f.id === p.id);
    const piece = { ...(moving ?? { id: -1, def: p.def }), def: p.def, x: p.x, s: p.s, flip: p.flip };
    const after = [...st.furniture.filter((f) => f.id !== p.id), piece];
    return changeFacts(this.sim, { cells: this.draft.cells }, { cells: this.draft.cells, furniture: after });
  }

  /** Place: buy it and put it in, or move it there. */
  private place(): void {
    const p = this.pending;
    if (!p || this.pendingProblem()) return;
    const out = { problem: null as string | null };
    this.furnish(() => {
      if (p.id === undefined) {
        const f = buyFurniture(this.sim, p.def, p.x, p.s, p.flip, this.draft, p.grade);
        if (typeof f === 'string') out.problem = f;
        return;
      }
      out.problem = shiftFurniture(this.sim, p.id, p.x, p.s, this.draft);
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
    this.needsFlat = null;
    this.bump();
  }

  /** Into build mode on a flat, with its checklist showing: what it needs, ticked off as you go. */
  guide(flatId: string): void {
    if (!this.active) this.start();
    this.needsFolded = false;
    this.zoomTo(flatId);
  }

  /**
   * Every frame: the checklist for the flat you've zoomed to. Tapping a line opens the part
   * of the bar that has it; it doesn't place anything for you.
   */
  updateNeeds(): void {
    const flat = this.needsFlat ? this.sim.layout.flat(this.needsFlat) : undefined;
    const show = this.active && !this.pending && flat !== undefined;
    const st = this.sim.state;
    const key = show ? `${flat!.id}|${this.sim.version}|${st.furniture.length}|${this.renderer.build.version}|${Math.floor(st.tick / TICKS_PER_HOUR)}|${this.needsFolded}` : '';
    if (key === this.needsKey) return;
    this.needsKey = key;
    this.needs.hidden = !show;
    if (!show) return;
    const list = flatNeeds(this.sim, flat!.id);
    const must = list.filter((n) => n.must);
    const got = must.filter((n) => n.done).length;
    const info = flatInfo(this.sim, flat!.id);
    const ready = got === must.length;
    const row = (n: (typeof list)[number]) =>
      h('button', { type: 'button', class: `need ${n.done ? 'done' : ''}`, disabled: n.done, onclick: () => { const g = GROUPS.find((x) => x.id === n.group); this.needsFolded = true; if (g) this.pickGroup(g); this.updateNeeds(); } }, h('span', { class: 'tick' }, n.done ? '✓' : ''), n.label);
    this.needs.replaceChildren(
      h('button', { type: 'button', class: 'needs-head', 'aria-expanded': String(!this.needsFolded), onclick: () => { this.needsFolded = !this.needsFolded; this.updateNeeds(); } }, h('b', {}, `${flat!.name} · ${flatKind(this.sim, flat!.id).name}`), h('span', {}, ready ? 'Liveable' : `${got} of ${must.length}`)),
      ...(this.needsFolded
        ? []
        : [
            ...must.map(row),
            h('small', {}, 'Nice to have'),
            ...list.filter((n) => !n.must).map(row),
            ready && !info.lease && !info.listed
              ? h('button', { type: 'button', class: 'list-it', onclick: () => { info.listed = true; this.onNotify(`${flat!.name} is listed. People will start applying.`); this.needsKey = ''; this.updateNeeds(); } }, 'List it: ready to let')
              : '',
          ]),
    );
  }

  private bump(): void {
    this.renderer.build.version++;
  }

  // ------------------------------------------------------------------ changes and undo

  /** A draft to draw on: the plans you left last time, or the building as it is. */
  private loadDraft(): void {
    const st = this.sim.state;
    const from = st.works.plan ?? st;
    this.draft = { ...st, cells: { ...from.cells }, insulated: { ...from.insulated }, wet: this.draftWet(st.works.plan?.risers ?? risersOf(st)) };
  }

  /** The draft's risers: the plan's, with the rest of the wet stack as it really is. */
  private draftWet(risers: readonly number[]): State['wet'] {
    const st = this.sim.state;
    return { approved: [], rng: 0, ...st.wet, risers: [...risers] };
  }

  /** The draft's copy of everything but the cells is the real thing, kept up to date. */
  private syncDraft(): void {
    const { cells, insulated } = this.draft;
    const risers = risersOf(this.draft);
    Object.assign(this.draft, this.sim.state, { cells, insulated, wet: this.draftWet(risers) });
  }

  /** The draft, for undo. */
  private buildingSnap(): (typeof this.undo)[number] {
    return { plan: JSON.stringify({ cells: this.draft.cells, insulated: this.draft.insulated, risers: risersOf(this.draft) }) };
  }

  /** Keeps the draft as the plans (shown in blue), or none if it's no different from the building. */
  private savePlan(): void {
    const st = this.sim.state;
    const d = this.draft;
    st.works.plan = piecesBetween(partsOf(st), partsOf(d)).length > 0 ? { cells: { ...d.cells }, insulated: { ...d.insulated }, furniture: [], risers: [...risersOf(d)] } : null;
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

  /** Runs a change to the draft. `keepUndo` is false for each cell of a drag (the drag keeps one step). */
  private change(fn: () => unknown, keepUndo = true): void {
    this.syncDraft();
    const before = this.buildingSnap();
    fn();
    if (this.buildingSnap().plan === before.plan) return;
    if (keepUndo) this.pushUndo(before);
    this.draftChanged();
  }

  private draftChanged(): void {
    this.savePlan();
    this.bump();
    this.updateFooter();
  }

  /** The cells in the draft that wouldn't be held up. */
  private unheld(): string[] {
    return unsupportedCells(this.draft.cells);
  }

  /** The cost of the draft, and Sign off (which can't be pressed while anything's red). */
  private updateFooter(): void {
    const st = this.sim.state;
    const out = el('build-quote');
    const sign = el('build-sign') as HTMLButtonElement;
    const plan = st.works.plan;
    out.replaceChildren();
    if (!plan) {
      sign.disabled = true;
      sign.textContent = 'Sign off';
      out.append(h('span', {}, 'Draw what you like: nothing is built or paid for until you sign it off.'));
      return;
    }
    const cost = quote(piecesBetween(partsOf(st), plan)).cost;
    const red = this.unheld().length;
    const planning = needsPlanning(this.sim, plan.cells);
    const applied = st.planning.applied;
    // New risers wait on building control (risers.ts), as building higher waits on planning.
    const control = !planning && unapproved(st, plan.risers).length > 0;
    const asked = st.wet?.applied;
    sign.textContent = planning && !applied ? `Apply for planning ${pounds(PLANNING_FEE)}` : control && !asked ? `Apply to building control ${pounds(RISERS.controlFee)}` : `Sign off ${pounds(cost)}`;
    sign.disabled = red > 0 || (planning ? applied !== undefined || st.money < PLANNING_FEE : control ? asked !== undefined || st.money < RISERS.controlFee : cost > st.money);
    const facts = red > 0 ? [] : changeFacts(this.sim, {}, { cells: plan.cells });
    out.append(
      ...facts.map((f) => h('span', { class: `fact${f.tone ? ` ${f.tone}` : ''}` }, f.text)),
      h('strong', {}, pounds(cost)),
      red > 0
        ? h('span', { class: 'down' }, `${red} cell${red === 1 ? " isn't" : "s aren't"} held up (in red)`)
        : planning
          ? h('span', { class: 'down' }, applied ? `Planning: the council decides on day ${applied.decideDay}` : 'Above the roofline: needs planning permission')
          : control
            ? h('span', { class: 'down' }, asked ? `Building control decide on day ${asked.decideDay}` : 'A new riser: needs building control')
          : cost > st.money
            ? h('span', { class: 'down' }, `You have ${pounds(st.money)}`)
            : h('span', {}, 'Ready to build'),
      h('button', { type: 'button', class: 'link', onclick: () => this.clearPlans() }, 'Clear'),
    );
  }

  /** Builds the draft: everything goes in at once, and is paid for. */
  private signOff(): void {
    const st = this.sim.state;
    const plan = st.works.plan;
    if (!plan || this.unheld().length > 0) return;
    if (needsPlanning(this.sim, plan.cells)) {
      const problem = applyForPlanning(this.sim, topRow(plan.cells));
      this.onNotify(problem ?? 'Planning application sent. The council will write.', problem !== null);
      this.updateFooter();
      return;
    }
    const waiting = unapproved(st, plan.risers);
    if (waiting.length > 0) {
      const problem = applyForRisers(this.sim, waiting);
      this.onNotify(problem ?? 'Sent to building control. They will write.', problem !== null);
      this.updateFooter();
      return;
    }
    const cost = quote(piecesBetween(partsOf(st), plan)).cost;
    if (cost > st.money) return;
    st.cells = { ...plan.cells };
    st.insulated = { ...plan.insulated };
    setRisers(this.sim, plan.risers);
    if (cost !== 0) book(this.sim, 'Building work', -cost);
    st.works.plan = null;
    this.sim.changed();
    this.undo = [];
    this.loadDraft();
    this.bump();
    this.renderZoom();
    this.updateButtons();
    this.updateFooter();
  }

  private clearPlans(): void {
    this.sim.state.works.plan = null;
    this.undo = this.undo.filter((u) => u.furniture);
    this.loadDraft();
    this.bump();
    this.updateButtons();
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
      const { risers, ...parts } = JSON.parse(step.plan) as Partial<State> & { risers?: number[] };
      Object.assign(this.draft, parts);
      if (risers) this.draft.wet = this.draftWet(risers);
      this.draftChanged();
    }
    if (step.furniture) {
      // Undo puts pieces back where they were, not as good as new: wear and breakages stay.
      const now = new Map(st.furniture.map((f) => [f.id, f]));
      const back = (JSON.parse(step.furniture) as State['furniture']).map((f) => {
        const cur = now.get(f.id);
        return cur ? { ...f, wear: cur.wear, broken: cur.broken, reported: cur.reported } : f;
      });
      st.furniture.splice(0, st.furniture.length, ...back);
      st.money = step.money!;
      st.ledger.length = Math.min(st.ledger.length, step.ledger!);
      this.sim.changed();
      this.bump();
    }
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
      const pieces = FURNITURE.filter((f) => this.group!.furniture!.includes(f.group));
      if (pieces.some((d) => isGraded(d.id))) this.tools.append(this.gradeToggle());
      for (const d of pieces) {
        const g = isGraded(d.id) ? this.grade : 'standard';
        this.tools.append(h('button', { type: 'button', onclick: () => this.pickPiece(d.id) }, pieceIcon(d.id, g), d.name, h('small', {}, pounds(furniturePrice(d.id, g)))));
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
    this.startPlacing({ def: id, ...this.middleSpot(id), flip: false, grade: isGraded(id) ? this.grade : 'standard' });
  }

  /**
   * Cheap, standard or posh, above the pieces: the prices below follow it. Posh shows a
   * padlock until it opens up, and tapping it says what it takes.
   */
  private gradeToggle(): HTMLElement {
    const open = poshUnlocked(this.sim);
    if (!open && this.grade === 'posh') this.grade = 'standard';
    const note: Record<Grade, string> = { cheap: 'Wears fast', standard: 'Does the job', posh: open ? 'Lasts, impresses' : 'Locked' };
    return h(
      'div',
      { class: 'grades', role: 'radiogroup', 'aria-label': 'Grade' },
      ...GRADE_ORDER.map((g) => {
        const locked = g === 'posh' && !open;
        const b = h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(g === this.grade),
            'aria-disabled': locked ? 'true' : undefined,
            class: `grade-${g}${locked ? ' locked' : ''}`,
            title: locked ? poshLockedWhy() : undefined,
            onclick: () => {
              if (locked) {
                this.setHint(`${poshLockedWhy()}.`, true);
                return;
              }
              this.grade = g;
              this.render();
            },
          },
          h('b', {}, GRADE_NAMES[g]),
          h('small', {}, note[g]),
        );
        if (locked) b.prepend(padlock());
        return b;
      }),
    );
  }

  private updateButtons(): void {
    (el('build-undo') as HTMLButtonElement).disabled = this.undo.length === 0;
  }

  /** Chips to zoom straight to a flat, or back out to the whole building. */
  private renderZoom(): void {
    const lay = this.sim.layout;
    const chips = [h('button', { type: 'button', onclick: () => { this.needsFlat = null; this.onFit(); } }, 'Whole building')];
    for (const f of lay.flats) {
      chips.push(h('button', { type: 'button', 'aria-pressed': String(f.id === this.needsFlat), onclick: () => { this.zoomTo(f.id); this.renderZoom(); } }, f.name || 'New flat'));
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
    this.needsFlat = flatId;
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
    const st = this.draft;
    if (this.pending || this.isFurniture() || !this.tool) {
      this.tapFurniture(cell);
      return;
    }
    let problem: string | null = null;
    const run = (fn: () => string | null | boolean) =>
      this.change(() => {
        const out = fn();
        if (typeof out === 'string') problem = out;
      }, single);
    const { x, s } = cell;
    // Drawing the draft: anything goes, held up or not (what isn't shows in red).
    switch (this.tool) {
      case 'demolish':
        run(() => removeCell(st, x, s, false));
        // Rubbing out across empty cells is fine: only a tap on nothing says so.
        if (!single) problem = null;
        break;
      case 'insulate':
        run(() => insulate(st, key(x, s)));
        break;
      case 'stair':
        if (single) run(() => placeStairs(st, x, this.stairFoot(x, s), false));
        break;
      case 'riser':
        if (single) run(() => this.toggleRiser(x));
        break;
      default: {
        // A door goes in by its bottom cell: tapping the top half of a gap means the cell below.
        const kind = this.tool as CellKind;
        const at = isDoor(kind) && s > 0 && cellProblem(st, x, s, kind, false) && !cellProblem(st, x, s - 1, kind, false) ? s - 1 : s;
        run(() => placeCell(st, x, at, kind, false));
      }
    }
    this.setHint(problem, problem !== null);
  }

  /** A tap with the riser tool: plans a riser up that column, or takes a planned one out. */
  private toggleRiser(x: number): string | null {
    const d = this.draft;
    const planned = risersOf(d);
    if (planned.includes(x) && !risersOf(this.sim.state).includes(x)) {
      d.wet = this.draftWet(planned.filter((r) => r !== x));
      return null;
    }
    const problem = riserProblem(this.sim.state, planned, x);
    if (problem) return problem;
    d.wet = this.draftWet([...planned, x].sort((a, b) => a - b));
    return null;
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
    const st = this.draft;
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
    const st = this.draft;
    if (this.isFurniture() || !this.tool) {
      // Nothing to show until a piece or a tool is picked.
    } else if (this.tool === 'stair') {
      const foot = this.stairFoot(cell.x, cell.s);
      b.marks.push({ x: cell.x, s: foot, w: 1, h: FLIGHT, ok: stairsProblem(st, cell.x, foot, false) === null });
    } else if (this.tool === 'riser') {
      const planned = risersOf(st);
      const ok = riserProblem(this.sim.state, planned, cell.x) === null || (planned.includes(cell.x) && !risersOf(this.sim.state).includes(cell.x));
      b.marks.push({ x: cell.x, s: 1, w: 1, h: Math.max(1, cell.s), ok });
    } else if (this.tool === 'insulate') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: insulateProblem(st, key(cell.x, cell.s)) === null });
    } else if (this.tool === 'demolish') {
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: 1, ok: removeProblem(st, cell.x, cell.s, false) === null });
    } else {
      const kind = this.tool as CellKind;
      b.marks.push({ x: cell.x, s: cell.s, w: 1, h: isDoor(kind) ? DOOR_ROWS : 1, ok: cellProblem(st, cell.x, cell.s, kind, false) === null });
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

function pieceIcon(id: string, grade: Grade = 'standard'): HTMLCanvasElement {
  const d = furnitureDef(id);
  const scale = Math.min(1, 32 / (d.w * 16), 24 / (d.h * 16));
  const [c, ctx] = iconCanvas(32, 24);
  ctx.translate((32 - d.w * 16 * scale) / 2, 24 - d.h * 16 * scale);
  ctx.scale(scale, scale);
  drawFurniture(ctx, id, 0, 0, false, grade);
  return c;
}

/** A small padlock, for posh before it opens up. */
function padlock(): HTMLCanvasElement {
  const [c, ctx] = iconCanvas(8, 9);
  c.style.width = '12px';
  c.style.height = '14px';
  c.className = 'padlock';
  ctx.fillStyle = '#7a6a55';
  ctx.fillRect(2, 0, 4, 1);
  ctx.fillRect(1, 1, 1, 3);
  ctx.fillRect(6, 1, 1, 3);
  ctx.fillRect(0, 4, 8, 5);
  ctx.fillStyle = '#efe7da';
  ctx.fillRect(3, 6, 2, 2);
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
    case 'riser':
      // A pipe up the wall, with brackets.
      r(14, 2, 5, 21, '#6f7a82');
      r(15, 2, 1, 21, '#9aa6ae');
      for (const y of [6, 14, 21]) r(12, y, 9, 2, '#4f585e');
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
  if (t === 'riser') return `${pounds(RISERS.perStorey)} a storey`;
  return `${pounds(CELL_PRICE[t])}${t === 'wall' || t === 'window' ? ' a cell' : ''}`;
}

/** One fact about a change, coloured up or down. */
function factSpan(f: Fact): HTMLElement {
  return h('span', { class: f.tone ?? '' }, f.text);
}
