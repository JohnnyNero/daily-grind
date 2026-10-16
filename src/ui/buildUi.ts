// Build mode. Three tabs:
//   Furniture: drag anything to move it, tap to sell, pick from the palette to buy.
//   Walls:     drag to build walls, put doors in them, or knock them out.
//   Floors:    drag to lay floor; a room is whatever its floor says (kitchen, staff room...).
// Every change goes through sim/manage.ts or sim/structure.ts, which validate it.

import { OBJECT_DEFS, objectDef } from '../sim/defs';
import { buyObject, moveObject, placementProblem, sellObject, sellValue } from '../sim/manage';
import type { Sim } from '../sim/sim';
import type { ObjectInst } from '../sim/state';
import {
  BUILD_PRICES, PAINTABLE_FLOORS, buildAt, restoreLayout, snapshotLayout, type LayoutSnapshot, type StructureTool,
} from '../sim/structure';
import { drawFloorTile } from '../render/objectArt';
import type { Renderer } from '../render/renderer';
import { el, h, setupTabs } from './dom';
import { pounds } from './hud';
import type { ManageHooks } from './manageUi';

type Mode = 'furniture' | 'walls' | 'floors';
type WallTool = 'wall' | 'door' | 'remove';

const WALL_TOOLS: readonly { id: WallTool; label: string; price: number; hint: string }[] = [
  { id: 'wall', label: 'Wall', price: BUILD_PRICES.wall, hint: 'Drag to draw a straight wall.' },
  { id: 'door', label: 'Door', price: BUILD_PRICES.door, hint: 'Tap a wall to put a door in it.' },
  { id: 'remove', label: 'Knock out', price: 0, hint: 'Drag a box over walls and doors to knock them out.' },
];

const MOVE_HINT = 'Two fingers (or right-drag) move the view.';

interface Drag {
  /** The furniture being moved, or null when it's the one being bought. */
  object: ObjectInst | null;
  def: string;
  /** Which tile of the footprint the finger grabbed. */
  grabX: number;
  grabY: number;
}

export class BuildUi {
  private bar = el('buildbar');
  private hint = el('build-hint');
  private tools = el('build-tools');
  private undoButton = el<HTMLButtonElement>('build-undo');
  private sellButton = el<HTMLButtonElement>('build-sell');
  private cancelButton = el<HTMLButtonElement>('build-cancel');
  private confirmButton = el<HTMLButtonElement>('build-confirm');
  private selectTab: (tab: string) => void;

  private mode: Mode = 'furniture';
  private wallTool: WallTool = 'wall';
  private floorTool = PAINTABLE_FLOORS[0].kind;
  private selected: number | null = null;
  /** Furniture being bought: a ghost you drag into place, then confirm. */
  private buying: { def: string; x: number; y: number } | null = null;
  private drag: Drag | null = null;
  private ghost: { def: string; x: number; y: number; ok: boolean } | null = null;
  /** Painting walls or floors: the layout before this stroke, where it started and what it did. */
  private stroke: {
    before: LayoutSnapshot;
    start: [number, number];
    last: [number, number] | null;
    changed: number;
    problem: string | null;
  } | null = null;
  private undo: LayoutSnapshot | null = null;

  constructor(private readonly sim: Sim, private readonly renderer: Renderer, private readonly hooks: ManageHooks) {
    this.selectTab = setupTabs(this.bar, (tab) => {
      this.mode = tab as Mode;
      this.clear();
    });
    el('build-done').addEventListener('click', () => this.stop());
    this.undoButton.addEventListener('click', () => this.undoStroke());
    this.sellButton.addEventListener('click', () => this.sell());
    this.cancelButton.addEventListener('click', () => this.clear());
    this.confirmButton.addEventListener('click', () => this.confirmBuy());
  }

  get active(): boolean {
    return !this.bar.hidden;
  }

  start(): void {
    this.bar.hidden = false;
    document.body.classList.add('building');
    this.undo = null;
    this.selectTab('furniture');
  }

  stop(): void {
    this.bar.hidden = true;
    document.body.classList.remove('building');
    this.undo = null;
    this.clear();
  }

  private clear(): void {
    this.selected = null;
    this.buying = null;
    this.drag = null;
    this.ghost = null;
    this.update();
  }

  // ---------------------------------------------------------------- pointer

  /** A press on the café. Returns true to take the drag (otherwise the view pans). */
  dragStart(sx: number, sy: number): boolean {
    if (!this.active) return false;
    const [tx, ty] = this.renderer.screenToTile(sx, sy);
    if (this.mode !== 'furniture') {
      this.stroke = { before: snapshotLayout(this.sim), start: [tx, ty], last: null, changed: 0, problem: null };
      this.paintTo(tx, ty);
      return true;
    }
    const b = this.buying;
    if (b) {
      const d = objectDef(b.def);
      if (tx >= b.x && tx < b.x + d.w && ty >= b.y && ty < b.y + d.h) {
        this.drag = { object: null, def: b.def, grabX: tx - b.x, grabY: ty - b.y };
        return true;
      }
      return false;
    }
    const o = this.renderer.objectAtTile(tx, ty);
    if (!o || objectDef(o.def).fixed) return false;
    this.selected = o.id;
    this.drag = { object: o, def: o.def, grabX: tx - o.x, grabY: ty - o.y };
    this.ghost = { def: o.def, x: o.x, y: o.y, ok: true };
    this.update();
    return true;
  }

  dragMove(sx: number, sy: number): void {
    const [tx, ty] = this.renderer.screenToTile(sx, sy);
    if (this.stroke) {
      this.paintTo(tx, ty);
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const x = tx - drag.grabX;
    const y = ty - drag.grabY;
    if (this.ghost && this.ghost.x === x && this.ghost.y === y) return;
    if (this.buying) {
      this.buying.x = x;
      this.buying.y = y;
    }
    this.ghost = { def: drag.def, x, y, ok: placementProblem(this.sim, drag.def, x, y, drag.object) === null };
    this.update();
  }

  dragEnd(): void {
    if (this.stroke) {
      this.finishStroke();
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.object && this.ghost) {
      const o = drag.object;
      if (this.ghost.x !== o.x || this.ghost.y !== o.y) {
        const err = moveObject(this.sim, o.id, this.ghost.x, this.ghost.y);
        if (err) this.hooks.notify(err, 'bad');
        else this.furnitureChanged();
      }
      this.ghost = null;
    }
    this.update();
  }

  /** A second finger landed: they meant to pinch, so put back whatever the first finger did. */
  dragCancel(): void {
    if (this.stroke) {
      restoreLayout(this.sim, this.stroke.before);
      this.stroke = null;
      this.renderer.rebuildStatic();
    }
    this.drag = null;
    if (!this.buying) this.ghost = null;
    this.update();
  }

  /** A tap that wasn't taken as a drag: select furniture, or move the thing being bought. */
  tap(sx: number, sy: number): void {
    if (this.mode !== 'furniture') return;
    const [tx, ty] = this.renderer.screenToTile(sx, sy);
    if (this.buying) {
      const d = objectDef(this.buying.def);
      this.placeGhost(tx - Math.floor((d.w - 1) / 2), ty - Math.floor((d.h - 1) / 2));
      return;
    }
    const hit = this.renderer.objectAtTile(tx, ty);
    this.selected = hit && hit.id !== this.selected ? hit.id : null;
    this.update();
  }

  // ---------------------------------------------------------------- walls and floors

  private get structureTool(): StructureTool {
    return this.mode === 'walls' ? this.wallTool : { floor: this.floorTool };
  }

  /**
   * The tiles a stroke from `start` to (tx, ty) covers: a straight line for walls and
   * doors (snapped to whichever way the drag mostly went), a filled box otherwise.
   */
  private strokeTiles(tx: number, ty: number): [number, number][] {
    const [sx, sy] = this.stroke!.start;
    const out: [number, number][] = [];
    if (this.mode === 'walls' && this.wallTool !== 'remove') {
      const across = Math.abs(tx - sx) >= Math.abs(ty - sy);
      const [ex, ey] = across ? [tx, sy] : [sx, ty];
      const n = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
      for (let i = 0; i <= n; i++) out.push([sx + Math.sign(ex - sx) * i, sy + Math.sign(ey - sy) * i]);
      return out;
    }
    for (let y = Math.min(sy, ty); y <= Math.max(sy, ty); y++) {
      for (let x = Math.min(sx, tx); x <= Math.max(sx, tx); x++) out.push([x, y]);
    }
    return out;
  }

  /** Redoes the stroke from scratch for the finger's new position, so it previews live. */
  private paintTo(tx: number, ty: number): void {
    const st = this.stroke!;
    if (st.last && st.last[0] === tx && st.last[1] === ty) return;
    st.last = [tx, ty];
    if (st.changed > 0 && restoreLayout(this.sim, st.before) !== null) return;
    st.changed = 0;
    st.problem = null;
    const s = this.sim.state;
    for (const [x, y] of this.strokeTiles(tx, ty)) {
      if (!this.sim.world.inBounds(x, y)) continue;
      const before = s.tiles[y * s.w + x];
      const err = buildAt(this.sim, x, y, this.structureTool);
      if (err) st.problem ??= err;
      else if (s.tiles[y * s.w + x] !== before) st.changed++;
    }
    this.renderer.rebuildStatic();
  }

  private finishStroke(): void {
    const st = this.stroke!;
    this.stroke = null;
    if (st.changed > 0) {
      this.undo = st.before;
      const spent = st.before.money - this.sim.state.money;
      if (st.problem) this.hooks.notify(`Some of it was skipped: ${st.problem.charAt(0).toLowerCase()}${st.problem.slice(1)}`, 'bad');
      else if (spent > 0) this.hooks.notify(`Building work: ${pounds(spent)}.`, 'neutral');
    } else if (st.problem) {
      this.hooks.notify(st.problem, 'bad');
    }
    this.update();
  }

  private undoStroke(): void {
    if (!this.undo) return;
    const err = restoreLayout(this.sim, this.undo);
    if (err) {
      this.hooks.notify(`Can't undo: ${err.charAt(0).toLowerCase()}${err.slice(1)}`, 'bad');
      return;
    }
    this.undo = null;
    this.renderer.rebuildStatic();
    this.update();
  }

  // ---------------------------------------------------------------- furniture

  /** Furniture changed, so a wall undo could now clash with it. */
  private furnitureChanged(): void {
    this.undo = null;
    this.renderer.rebuildStatic();
  }

  private startBuying(def: string): void {
    this.selected = null;
    // Start in the middle of the view, or the nearest free spot to it.
    const [cx, cy] = this.renderer.screenToTile(window.innerWidth / 2, window.innerHeight * 0.4);
    let best: [number, number] = [cx, cy];
    search: for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (placementProblem(this.sim, def, cx + dx, cy + dy) === null) {
            best = [cx + dx, cy + dy];
            break search;
          }
        }
      }
    }
    this.buying = { def, x: best[0], y: best[1] };
    this.placeGhost(best[0], best[1]);
  }

  private placeGhost(x: number, y: number): void {
    const b = this.buying!;
    b.x = x;
    b.y = y;
    this.ghost = { def: b.def, x, y, ok: placementProblem(this.sim, b.def, x, y) === null };
    this.update();
  }

  private confirmBuy(): void {
    const b = this.buying;
    if (!b) return;
    const err = buyObject(this.sim, b.def, b.x, b.y);
    if (err) {
      this.hooks.notify(err, 'bad');
      return;
    }
    this.hooks.notify(`Bought a ${objectDef(b.def).label.toLowerCase()}.`, 'neutral');
    this.furnitureChanged();
    this.clear();
  }

  private sell(): void {
    if (this.selected === null) return;
    const o = this.sim.world.objectById(this.selected);
    const err = sellObject(this.sim, this.selected);
    if (err) this.hooks.notify(err, 'bad');
    else if (o) this.hooks.notify(`Sold the ${objectDef(o.def).label.toLowerCase()}.`, 'neutral');
    this.furnitureChanged();
    this.clear();
  }

  // ---------------------------------------------------------------- the bar

  private renderTools(): void {
    if (this.mode === 'furniture') {
      const buyable = Object.values(OBJECT_DEFS).filter((d) => d.price !== undefined && !d.fixed);
      this.tools.replaceChildren(...buyable.map((d) => h('button', {
        type: 'button', 'aria-pressed': String(this.buying?.def === d.id),
        onclick: () => (this.buying?.def === d.id ? this.clear() : this.startBuying(d.id)),
      }, d.label, h('small', {}, pounds(d.price!)))));
    } else if (this.mode === 'walls') {
      this.tools.replaceChildren(...WALL_TOOLS.map((t) => h('button', {
        type: 'button', 'aria-pressed': String(this.wallTool === t.id),
        onclick: () => { this.wallTool = t.id; this.update(); },
      }, t.label, h('small', {}, t.price > 0 ? `${pounds(t.price)} each` : 'Free'))));
    } else {
      this.tools.replaceChildren(...PAINTABLE_FLOORS.map((f) => {
        const swatch = h('canvas', { className: 'floor-swatch', width: 40, height: 40, 'aria-hidden': 'true' });
        const ctx = swatch.getContext('2d');
        if (ctx) drawFloorTile(ctx, f.kind, 0, 0, 40);
        return h('button', {
          type: 'button', 'aria-pressed': String(this.floorTool === f.kind),
          onclick: () => { this.floorTool = f.kind; this.update(); },
        }, swatch, f.label, h('small', {}, `${pounds(BUILD_PRICES.floor)} a tile`));
      }));
    }
  }

  private hintText(o: ObjectInst | undefined): string {
    if (this.mode === 'walls') return `${WALL_TOOLS.find((t) => t.id === this.wallTool)!.hint} ${MOVE_HINT}`;
    if (this.mode === 'floors') {
      return `Drag a box to lay floor. Kitchen, staff room and toilet floors decide what goes where. ${MOVE_HINT}`;
    }
    if (this.buying) {
      const d = objectDef(this.buying.def);
      const problem = placementProblem(this.sim, this.buying.def, this.buying.x, this.buying.y);
      return problem ? `${problem} Drag the ${d.label.toLowerCase()} somewhere else.` : `Drag the ${d.label.toLowerCase()} into place, then buy it.`;
    }
    if (o) {
      const d = objectDef(o.def);
      return d.fixed ? `The ${d.label.toLowerCase()} is fixed in place.` : `Drag the ${d.label.toLowerCase()} to move it, or sell it for ${pounds(sellValue(o.def))}.`;
    }
    return 'Drag furniture to move it, tap it to sell, or pick something below to buy.';
  }

  private update(): void {
    const o = this.selected !== null ? this.sim.world.objectById(this.selected) : undefined;
    const view = this.renderer.buildSelection;
    view.active = this.active;
    view.objectId = this.selected;
    view.ghost = this.ghost;
    view.shell = this.active && this.mode !== 'furniture';
    view.version++;

    const furniture = this.mode === 'furniture';
    this.sellButton.hidden = !furniture || !o || objectDef(o.def).fixed === true || this.buying !== null;
    if (o) this.sellButton.textContent = `Sell ${pounds(sellValue(o.def))}`;
    this.confirmButton.hidden = !this.buying;
    if (this.buying) {
      this.confirmButton.textContent = `Buy ${pounds(objectDef(this.buying.def).price!)}`;
      this.confirmButton.disabled = !this.ghost?.ok;
    }
    this.cancelButton.hidden = !this.buying && !o;
    this.undoButton.hidden = furniture;
    this.undoButton.disabled = !this.undo;
    el('build-done').hidden = this.buying !== null;
    this.hint.textContent = this.hintText(o);
    this.renderTools();
  }
}
