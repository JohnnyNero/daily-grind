// The card tray (spec 1.1): at most two slim cards just above the tenant bar, newest on top.
// Tap one to open it over the building; tap a button to answer; tap its face (or the
// building) to fold it back. Also where the `!` markers over a card's subject and the edge
// chips for subjects off screen are worked out (the renderer draws them, from cardMarkers and
// edgeChips; taps on them come here), and the 10-real-second floor: the tray tells the sim
// when a card has been up that long.
//
// In Build or with a panel open the tray is hidden (style.css) and the countdown keeps going;
// the HUD puts a red dot on Done and Close while a card waits (cardsWaiting).

import { answerCard, cardSeen, HOLD, openCards, viewOf, type CardView } from '../sim/drip';
import type { Sim } from '../sim/sim';
import { TILE, type Card } from '../sim/state';
import { DRIP } from '../sim/tuning';
import { furnitureDef } from '../sim/defs';
import { PERSON_H, portrait } from '../render/art';
import { floorY, type Camera } from '../render/renderer';
import { h } from './dom';

/** A card's `!` in the world, in world pixels: the bottom middle of the bubble. */
export interface Marker {
  card: number;
  wx: number;
  wy: number;
}

/** A `!` chip on the edge of the view for a subject that's off screen, in screen pixels (its centre). */
export interface EdgeChip {
  card: number;
  side: 'left' | 'right' | 'top' | 'bottom';
  sx: number;
  sy: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far from a marker or chip's centre a tap still counts, in screen pixels. */
const HIT = 22;
/** Chips sit this far inside the view's edge. */
const CHIP_INSET = 16;

/** A card is waiting to be answered: the dots on Done and Close. */
export function cardsWaiting(sim: Sim): boolean {
  return openCards(sim).length > 0;
}

/** Where a card's `!` goes: over the person, the thing, or the flat it's about. Null if it's about nothing on the map. */
export function markerOf(sim: Sim, c: Card): Marker | null {
  const st = sim.state;
  const pawnId = c.pawn ?? c.visitor;
  const p = pawnId !== undefined ? st.pawns.find((x) => x.id === pawnId) : undefined;
  // Someone out (at work, at the shops) isn't on the map: their flat stands in for them.
  if (p && !p.life?.away) return { card: c.id, wx: (p.x + 0.5) * TILE, wy: floorY(p.s) + (p.front ? 10 : 0) - PERSON_H - 6 };
  if (c.furniture !== undefined) {
    const f = st.furniture.find((x) => x.id === c.furniture);
    if (f) {
      const def = furnitureDef(f.def);
      return { card: c.id, wx: (f.x + (def.w ?? 1) / 2) * TILE, wy: floorY(f.s) - ((def.h ?? 1) + 0.5) * TILE };
    }
  }
  const flatId = c.flat ?? p?.life?.flat;
  const flat = flatId ? sim.layout.flat(flatId) : undefined;
  if (flat) {
    const cells = sim.layout.flatCells(flat).map((n) => sim.layout.xs(n));
    const top = Math.max(...cells.map(([, s]) => s));
    const xs = cells.filter(([, s]) => s === top).map(([x]) => x);
    return { card: c.id, wx: ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE, wy: floorY(top) - 2.5 * TILE };
  }
  return null;
}

/** Every open card's `!`, oldest first. */
export function cardMarkers(sim: Sim): Marker[] {
  return openCards(sim).map((c) => markerOf(sim, c)).filter((m): m is Marker => m !== null);
}

const toScreen = (cam: Camera, m: Marker) => ({ sx: cam.ox + m.wx * cam.scale, sy: cam.oy + m.wy * cam.scale });

/** The card whose `!` is under a tap, if any (newest wins). */
export function markerAt(sim: Sim, cam: Camera, sx: number, sy: number): number | null {
  const hits = cardMarkers(sim).filter((m) => {
    const p = toScreen(cam, m);
    // The bubble sits above its anchor.
    return Math.abs(p.sx - sx) <= HIT && sy <= p.sy + 6 && sy >= p.sy - HIT * 1.6;
  });
  return hits.length > 0 ? hits[hits.length - 1].card : null;
}

/**
 * Chips on the edge of the view for subjects outside it, on the side they're on, clear of
 * `avoid` (the alerts column).
 */
export function edgeChips(sim: Sim, cam: Camera, view: Box, avoid?: Box): EdgeChip[] {
  const out: EdgeChip[] = [];
  for (const m of cardMarkers(sim)) {
    const { sx, sy } = toScreen(cam, m);
    const inside = sx >= view.x && sx <= view.x + view.w && sy >= view.y && sy <= view.y + view.h;
    if (inside) continue;
    const side: EdgeChip['side'] = sx < view.x ? 'left' : sx > view.x + view.w ? 'right' : sy < view.y ? 'top' : 'bottom';
    let cx = Math.max(view.x + CHIP_INSET, Math.min(view.x + view.w - CHIP_INSET, sx));
    let cy = Math.max(view.y + CHIP_INSET, Math.min(view.y + view.h - CHIP_INSET, sy));
    if (avoid && cx >= avoid.x - CHIP_INSET && cx <= avoid.x + avoid.w + CHIP_INSET && cy >= avoid.y - CHIP_INSET && cy <= avoid.y + avoid.h + CHIP_INSET) {
      if (side === 'top') cx = avoid.x - CHIP_INSET * 2;
      else cy = avoid.y + avoid.h + CHIP_INSET * 2;
    }
    out.push({ card: m.card, side, sx: cx, sy: cy });
  }
  return out;
}

/** The chip under a tap, if any. */
export function chipAt(chips: EdgeChip[], sx: number, sy: number): number | null {
  const hit = chips.filter((c) => Math.abs(c.sx - sx) <= HIT && Math.abs(c.sy - sy) <= HIT);
  return hit.length > 0 ? hit[hit.length - 1].card : null;
}

/** Roughly how long is left, for screen readers: never seconds on screen. */
export function timeWords(v: CardView): string {
  const s = v.seconds;
  if (s < 20) return 'nearly gone';
  if (s < 90) return 'about a minute left';
  return `about ${Math.round(s / 60)} minutes left`;
}

export class CardTray {
  /** Called when a card is opened, so the camera can pan to its subject (main.ts). */
  onFocus?: (cardId: number) => void;
  /** Called when a card's been answered, with the toast's words (or why it couldn't be). */
  onNotify?: (text: string) => void;
  /** The card opened over the building, if any. Only one at a time. */
  openId: number | null = null;
  /** When each card was first seen (performance.now), for the 10-second floor. */
  private seen = new Map<number, number>();
  private lastKey = '';
  private rings = new Map<number, SVGCircleElement>();
  private known = new Set<number>();

  constructor(
    private readonly sim: Sim,
    private readonly root: HTMLElement,
  ) {
    this.root.hidden = true;
  }

  /** Every frame. `now` is performance.now(), for the 10-real-second floor. */
  update(now: number): void {
    const sim = this.sim;
    const cards = openCards(sim);
    // The floor (1.1): hold each card until it's been up 10 real seconds, wherever you are.
    for (const c of cards) {
      const at = this.seen.get(c.id);
      if (at === undefined) {
        this.seen.set(c.id, now);
        cardSeen(sim, c.id, HOLD);
      } else if (c.seenBy === HOLD && now - at >= DRIP.floorSeconds * 1000) cardSeen(sim, c.id, sim.state.tick);
    }
    for (const id of [...this.seen.keys()]) if (!cards.some((c) => c.id === id)) this.seen.delete(id);
    if (this.openId !== null && !cards.some((c) => c.id === this.openId)) this.openId = null;
    this.root.hidden = cards.length === 0;
    const views = cards.map((c) => viewOf(sim, c)).filter((v): v is CardView => v !== null);
    const key = JSON.stringify([this.openId, views.map((v) => [v.card.id, v.hook, v.name, v.text, v.choices])]);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.render(views);
    }
    for (const v of views) {
      const ring = this.rings.get(v.card.id);
      if (ring) ring.style.strokeDashoffset = String(RING * (1 - v.left));
    }
  }

  /** Opens a card over the building (and asks for the camera). */
  open(cardId: number): void {
    if (!openCards(this.sim).some((c) => c.id === cardId)) return;
    this.openId = cardId;
    this.lastKey = '';
    this.onFocus?.(cardId);
  }

  /** Folds the open card back to slim. True if there was one. */
  fold(): boolean {
    if (this.openId === null) return false;
    this.openId = null;
    this.lastKey = '';
    return true;
  }

  answer(cardId: number, choice: 0 | 1): void {
    const err = answerCard(this.sim, cardId, choice);
    if (err) this.onNotify?.(err);
    this.openId = null;
    this.lastKey = '';
  }

  /**
   * A tap on the building: a card's `!`, or an edge chip, opens it. Otherwise an open card
   * folds back. True if the tap was used.
   */
  tap(cam: Camera, sx: number, sy: number, view?: Box, avoid?: Box): boolean {
    const id = markerAt(this.sim, cam, sx, sy) ?? (view ? chipAt(edgeChips(this.sim, cam, view, avoid), sx, sy) : null);
    if (id !== null) {
      this.open(id);
      return true;
    }
    return this.fold();
  }

  private render(views: CardView[]): void {
    this.rings.clear();
    // Newest on top.
    const rows = [...views].reverse().map((v) => (v.card.id === this.openId ? this.openCard(v) : this.slim(v)));
    for (const v of views) this.known.add(v.card.id);
    this.root.replaceChildren(...rows);
  }

  private face(v: CardView, className: string): HTMLElement {
    const p = v.card.pawn !== undefined ? this.sim.state.pawns.find((x) => x.id === v.card.pawn) : undefined;
    const box = h('span', { className, 'aria-hidden': 'true' });
    if (p && !v.icon) box.append(portrait(p));
    else box.innerHTML = ICONS[v.icon ?? ''] ?? ICONS.alert;
    return box;
  }

  private ring(v: CardView): SVGSVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'ring');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', timeWords(v));
    const back = document.createElementNS(SVG, 'circle');
    const fill = document.createElementNS(SVG, 'circle');
    for (const [c, cls] of [[back, 'back'], [fill, 'left']] as const) {
      c.setAttribute('cx', '10');
      c.setAttribute('cy', '10');
      c.setAttribute('r', String(R));
      c.setAttribute('class', cls);
      svg.append(c);
    }
    fill.style.strokeDasharray = String(RING);
    fill.style.strokeDashoffset = String(RING * (1 - v.left));
    // An ask sours in steps: a mark on the ring for each.
    for (let i = 1; i < v.steps; i++) {
      const a = -Math.PI / 2 + (i / v.steps) * Math.PI * 2;
      const tick = document.createElementNS(SVG, 'line');
      tick.setAttribute('x1', String(10 + Math.cos(a) * (R - 3)));
      tick.setAttribute('y1', String(10 + Math.sin(a) * (R - 3)));
      tick.setAttribute('x2', String(10 + Math.cos(a) * (R + 2)));
      tick.setAttribute('y2', String(10 + Math.sin(a) * (R + 2)));
      tick.setAttribute('class', 'step');
      svg.append(tick);
    }
    this.rings.set(v.card.id, fill);
    return svg;
  }

  private slim(v: CardView): HTMLElement {
    const fresh = !this.known.has(v.card.id);
    const b = h('button', { type: 'button', className: `slim-card${fresh ? ' arriving' : ''}`, 'data-card': String(v.card.id), 'aria-label': `${v.hook} Open it.` }, this.face(v, 'card-face'), h('span', { className: 'hook' }, v.hook), this.ring(v));
    b.addEventListener('click', () => this.open(v.card.id));
    return b;
  }

  private openCard(v: CardView): HTMLElement {
    const face = this.face(v, 'card-face');
    const fold = h('button', { type: 'button', className: 'fold', 'aria-label': 'Fold the card away' }, face);
    fold.addEventListener('click', () => this.fold());
    const buttons = v.choices.map((c, i) => this.choice(v.card.id, i as 0 | 1, c.label, c.note));
    return h(
      'div',
      { className: 'open-card', 'data-card': String(v.card.id), role: 'group', 'aria-label': v.hook },
      h('div', { className: 'card-head' }, fold, h('b', { className: 'card-name' }, v.name || v.hook), this.ring(v)),
      h('p', { className: 'card-text' }, v.text),
      h('div', { className: 'card-choices' }, ...buttons),
    );
  }

  /** A button: tap to answer; hold to read its note in full. */
  private choice(cardId: number, i: 0 | 1, label: string, note: string): HTMLButtonElement {
    const b = h('button', { type: 'button', className: 'card-choice', 'data-choice': String(i) }, h('b', {}, label), h('small', {}, note));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        b.classList.add('reading');
      }, 450);
    });
    const stop = () => clearTimeout(timer);
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', () => {
      stop();
      b.classList.remove('reading');
    });
    b.addEventListener('click', () => {
      if (held) {
        held = false;
        b.classList.remove('reading');
        return;
      }
      this.answer(cardId, i);
    });
    return b;
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const R = 7;
const RING = 2 * Math.PI * R;

// Pixel icons for cards that aren't about a person, drawn from 8x8 grids like the tab icons.
const GRIDS: Record<string, string[]> = {
  alert: ['...##...', '...##...', '...##...', '...##...', '...##...', '........', '...##...', '...##...'],
  cat: ['#.....#.', '##...##.', '#######.', '#.##.##.', '#######.', '.#####..', '.#...#.#', '.#...###'],
  van: ['........', '#####...', '#####.#.', '#####..#', '########', '########', '.##..##.', '........'],
  bins: ['.######.', '########', '.#.#.#..', '.######.', '.#.#.#..', '.######.', '.#.#.#..', '.######.'],
  water: ['...#....', '...#....', '..###...', '..###...', '.#####..', '.##.##..', '.#####..', '..###...'],
  parcel: ['........', '.######.', '#..##..#', '########', '#..##..#', '#..##..#', '########', '........'],
  post: ['........', '########', '##....##', '#.#..#.#', '#..##..#', '#......#', '########', '........'],
  key: ['........', '.###....', '#...#...', '#...#####', '#...#.#.', '.###..#.', '........', '........'],
  door: ['.######.', '.#....#.', '.#....#.', '.#....#.', '.#...##.', '.#....#.', '.#....#.', '########'],
};
const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(GRIDS).map(([name, rows]) => {
    let r = '';
    rows.forEach((row, y) => [...row].slice(0, 8).forEach((c, x) => {
      if (c === '#') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }));
    return [name, `<svg viewBox="0 0 8 8" fill="currentColor" shape-rendering="crispEdges">${r}</svg>`];
  }),
);
