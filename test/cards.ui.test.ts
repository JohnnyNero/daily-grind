import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/sim/chat';
import { fixtureSim, sitting } from '../src/sim/cards/rule';
import type { CardDef } from '../src/sim/cards/types';
import { answerCard, HOLD, openCard, openCards, useCatalogue } from '../src/sim/drip';
import { TICKS_PER_MINUTE } from '../src/sim/state';
import { CardTray, cardsWaiting, edgeChips, markerOf } from '../src/ui/cards';

// The tray (spec 1.1) on a phone-sized screen (390 x 844), with a fake clock and a fake
// document: just enough DOM for the tray to build its cards and take taps.

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  attrs: Record<string, string> = {};
  style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {};
  hidden = false;
  text = '';
  innerHTML = '';
  className = '';
  width = 0;
  height = 0;
  private listeners: Record<string, (() => void)[]> = {};
  constructor(public tagName: string) {}
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (c: string) => (this.className = [...new Set([...list(), c])].join(' ')),
      remove: (c: string) => (this.className = list().filter((x) => x !== c).join(' ')),
      toggle: (c: string, on?: boolean) => ((on ?? !list().includes(c)) ? this.classList.add(c) : this.classList.remove(c)),
      contains: (c: string) => list().includes(c),
    };
  }
  set textContent(t: string) {
    this.text = t;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  setAttribute(k: string, v: string) {
    if (k === 'class') this.className = v;
    else this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  append(...nodes: (FakeNode | string)[]) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? Object.assign(new FakeNode('#text'), { text: n }) : n;
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeNode | string)[]) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click ?? []) fn();
  }
  getContext() {
    return new Proxy({}, { get: () => () => {}, set: () => true });
  }
  /** Every node under this one with a class. */
  all(cls: string): FakeNode[] {
    return this.children.flatMap((c) => [...(c.classList.contains(cls) ? [c] : []), ...c.all(cls)]);
  }
}

const doc = {
  createElement: (tag: string) => new FakeNode(tag),
  createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  body: new FakeNode('body'),
};

const tCard = (id: string, source: CardDef['source']): CardDef => ({
  id,
  source,
  kind: 'moment',
  cooldownDays: 0,
  turnsOn: ['test'],
  fixtures: [],
  when: (sim) => tenants(sim).map((p) => ({ pawn: p.id })),
  hook: () => `${id} hook`,
  text: () => `${id} text`,
  choices: () => [
    { label: 'Yes', note: 'He\'ll be glad' },
    { label: 'No', note: 'Might walk' },
  ],
  resolve: (_sim, c, a) => ({ effects: [`mem:${c.pawn}:${a === 'ignored' ? 'leftToIt' : 'landlordListened'}`], notice: 'Done.' }),
});

beforeAll(() => {
  (globalThis as { document?: unknown }).document = doc;
  useCatalogue([tCard('first', 'tenant'), tCard('second', 'street')]);
});
afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
  useCatalogue(null);
});

/** Two cards, a minute apart: the first about Flat 1's tenant, the second about Bill. */
function twoCards() {
  const sim = fixtureSim(1, 9, 10);
  const [a, b] = sitting(sim);
  const first = openCard(sim, 'first', { pawn: a.id })!;
  sim.run(TICKS_PER_MINUTE);
  const second = openCard(sim, 'second', { pawn: b.id })!;
  const root = new FakeNode('section');
  const tray = new CardTray(sim, root as unknown as HTMLElement);
  return { sim, root, tray, first, second };
}

describe('the tray', () => {
  it('stacks two slim cards, newest on top', () => {
    const { root, tray, first, second } = twoCards();
    tray.update(0);
    expect(root.hidden).toBe(false);
    const slim = root.children;
    expect(slim).toHaveLength(2);
    expect(slim.map((n) => n.attrs['data-card'])).toEqual([String(second.id), String(first.id)]);
    expect(slim.every((n) => n.classList.contains('slim-card'))).toBe(true);
    expect(slim[0].textContent).toContain('second hook');
  });

  it('opens a card when you tap it, and answers it from a button', () => {
    const { sim, root, tray, first } = twoCards();
    let focused: number | null = null;
    tray.onFocus = (id) => (focused = id);
    tray.update(0);
    root.children[1].click();
    tray.update(16);
    expect(tray.openId).toBe(first.id);
    expect(focused).toBe(first.id);
    const open = root.children[1];
    expect(open.classList.contains('open-card')).toBe(true);
    expect(open.textContent).toContain('first text');
    expect(open.all('card-choice')).toHaveLength(2);
    // Tap the face to fold it back.
    open.all('fold')[0].click();
    tray.update(32);
    expect(root.children[1].classList.contains('slim-card')).toBe(true);
    root.children[1].click();
    tray.update(48);
    root.children[1].all('card-choice')[0].click();
    tray.update(64);
    expect(openCards(sim).map((c) => c.id)).not.toContain(first.id);
    expect(root.children).toHaveLength(1);
  });

  it('opens a card when you tap its `!` over the person, or its chip on the edge', () => {
    const { sim, tray, first, second } = twoCards();
    tray.update(0);
    const cam = { scale: 2, ox: 0, oy: 0 };
    const m = markerOf(sim, first)!;
    expect(m).not.toBeNull();
    expect(tray.tap(cam, m.wx * 2, m.wy * 2 - 8)).toBe(true);
    expect(tray.openId).toBe(first.id);
    // Off screen: a chip on the edge, clear of the alerts column, opens it too.
    const view = { x: 8, y: 60, w: 374, h: 500 };
    const far = { scale: 2, ox: 5000, oy: 0 };
    const chips = edgeChips(sim, far, view, { x: 232, y: 60, w: 150, h: 120 });
    const chip = chips.find((c) => c.card === second.id)!;
    expect(chip.side).toBe('right');
    expect(chip.sy).toBeGreaterThan(180);
    expect(tray.tap(far, chip.sx, chip.sy, view)).toBe(true);
    expect(tray.openId).toBe(second.id);
    // A tap on the building with a card open folds it.
    expect(tray.tap(cam, 1, 1, view)).toBe(true);
    expect(tray.openId).toBeNull();
    expect(tray.tap(cam, 1, 1, view)).toBe(false);
  });

  it('holds a card for 10 real seconds on the fake clock, then hands over the tick', () => {
    const { sim, tray, first } = twoCards();
    tray.update(1000);
    expect(first.seenBy).toBe(HOLD);
    tray.update(10_999);
    expect(first.seenBy).toBe(HOLD);
    sim.run(5 * TICKS_PER_MINUTE);
    tray.update(11_000);
    expect(first.seenBy).toBe(sim.state.tick);
  });

  it('puts a dot on Done and Close while a card waits, and not after', async () => {
    // Read as text (vitest hands CSS imports back empty); no Node types in this project, hence the loose import.
    const fs = await import(['node', 'fs'].join(':'));
    const css: string = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const { sim, first, second } = twoCards();
    expect(cardsWaiting(sim)).toBe(true);
    expect(css).toMatch(/body\.cards-waiting #build-done::after/);
    expect(css).toMatch(/body\.cards-waiting #info-close::after/);
    expect(css).toMatch(/body\.building \.tray, body\.panel-open \.tray \{ display: none; \}/);
    answerCard(sim, first.id, 0);
    answerCard(sim, second.id, 1);
    expect(cardsWaiting(sim)).toBe(false);
  });
});
