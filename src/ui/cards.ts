// The card tray (spec 1.1): at most two slim cards just above the tenant bar, newest on top.
// Tap one to open it over the building; tap a button to answer; tap its face (or the
// building) to fold it back. The renderer draws the `!` markers over a card's subject and the
// edge chips for subjects off screen, and says which card a tap on one hit (renderer.cardAt,
// handed in as `cardAt`). The tray also keeps the 10-real-second floor: it tells the sim when
// a card has been up that long.
//
// In Build or with a panel open the tray is hidden (style.css) and the countdown keeps going;
// the HUD puts a red dot on Done and Close while a card waits (cardsWaiting).

import { answerCard, cardSeen, HOLD, openCards, viewOf, type CardView } from '../sim/drip';
import type { Sim } from '../sim/sim';
import { DRIP } from '../sim/tuning';
import { drawIcon, iconName, portrait } from '../render/art';
import { h } from './dom';

/** A card is waiting to be answered: the dots on Done and Close. */
export function cardsWaiting(sim: Sim): boolean {
  return openCards(sim).length > 0;
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
  /** Which card's `!` marker or edge chip is under a screen point (main.ts hands in renderer.cardAt). */
  cardAt?: (sx: number, sy: number) => { card: number; chip: boolean } | null;
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
  tap(sx: number, sy: number): boolean {
    const hit = this.cardAt?.(sx, sy);
    if (hit) {
      this.open(hit.card);
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
    else {
      // The renderer's pixel icons (the van, the bins, the water...), or a red `!`.
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      c.className = 'icon';
      const ctx = c.getContext('2d');
      if (ctx) drawIcon(ctx, iconName(v.icon) ?? 'bang', 0, 0, 1);
      box.append(c);
    }
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
    const b = h('button', { type: 'button', className: 'card-choice', 'data-choice': String(i) }, h('b', {}, label), note ? h('small', {}, note) : '');
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
