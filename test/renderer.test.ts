// The renderer's rules (spec 2.4, 2.5, 1.1): the bubble budget, edge chips, the arrival pulse,
// and that every pose, role, prop, animal and icon draws. Time is a fake clock, in ms.

import { describe, expect, it } from 'vitest';
import { BubbleBudget, CHIP_R, PULSE_MS, Renderer, chipFor, pulseAt, type BubbleCand } from '../src/render/renderer';
import { ICON_NAMES, drawAnimal, drawIcon, drawPerson, iconName, outfitFor, speciesOf } from '../src/render/art';
import type { Pawn, Pose } from '../src/sim/state';
import { seconds } from '../src/sim/state';
import { BUDGET } from '../src/sim/tuning';
import { fixtureSim } from '../src/sim/cards/rule';

const cand = (key: number, rank: 0 | 1 | 2 | 3, text = 'hi'): BubbleCand => ({ key, rank, sig: `${text}${key}`, text });
const MIN = BUDGET.bubbleSeconds * 1000;

describe('the bubble budget', () => {
  it('shows at most four, best first', () => {
    const b = new BubbleBudget();
    const out = b.pick([cand(1, 3), cand(2, 3), cand(3, 2), cand(4, 1), cand(5, 0), cand(6, 1)], 0);
    expect(out).toHaveLength(BUDGET.bubbles);
    expect(out.map((c) => c.key).sort()).toEqual([3, 4, 5, 6]);
  });

  it('puts card markers above everything, even when the rest are up', () => {
    const b = new BubbleBudget();
    b.pick([1, 2, 3, 4].map((k) => cand(k, 3)), 0);
    // After their time, a card marker takes a slot from a habit.
    const out = b.pick([...[1, 2, 3, 4].map((k) => cand(k, 3)), cand(-9, 0, '!')], MIN + 1);
    expect(out.map((c) => c.key)).toContain(-9);
    expect(out).toHaveLength(4);
  });

  it('holds a bubble for its real seconds even when the sim drops it', () => {
    const b = new BubbleBudget();
    b.pick([cand(1, 1)], 1000);
    expect(b.pick([], 1000 + MIN - 1)).toHaveLength(1);
    expect(b.pick([], 1000 + MIN)).toHaveLength(0);
  });

  it('does not bump a bubble before its time is served', () => {
    const b = new BubbleBudget();
    b.pick([1, 2, 3, 4].map((k) => cand(k, 3)), 0);
    const early = b.pick([...[1, 2, 3, 4].map((k) => cand(k, 3)), cand(5, 1)], MIN - 1);
    expect(early.map((c) => c.key).sort()).toEqual([1, 2, 3, 4]);
    const later = b.pick([...[1, 2, 3, 4].map((k) => cand(k, 3)), cand(5, 1)], MIN);
    expect(later.map((c) => c.key)).toContain(5);
  });

  it('lets a card marker in at once over a talk bubble on the same pawn only when the card is the new thing', () => {
    const b = new BubbleBudget();
    b.pick([{ ...cand(7, 1, 'talk'), pawn: 7 }], 0);
    // Same key, new words, not served: waits.
    expect(b.pick([{ ...cand(7, 1, 'other'), sig: 'other' }], 100)[0].text).toBe('talk');
    // A card marker has its own key and goes straight up.
    expect(b.pick([cand(7, 1, 'talk'), cand(-1, 0, '!')], 200).map((c) => c.key)).toContain(-1);
  });
});

describe('edge chips', () => {
  const box = { x: 8, y: 100, w: 374, h: 600 };
  const alerts = { x: 382 - 160, y: 100, w: 160, h: 150 };

  it('has none for a subject on screen', () => {
    expect(chipFor(200, 300, box, alerts)).toBeNull();
  });

  it('sits on the side the subject is on', () => {
    expect(chipFor(-50, 400, box, alerts)?.side).toBe('left');
    expect(chipFor(500, 400, box, alerts)?.side).toBe('right');
    expect(chipFor(200, 20, box, alerts)?.side).toBe('top');
    expect(chipFor(200, 900, box, alerts)?.side).toBe('bottom');
  });

  it('stays inside the box and clear of the alerts column', () => {
    for (const [ax, ay] of [[500, 120], [500, 160], [300, -40], [600, 100], [-80, 90]]) {
      const c = chipFor(ax, ay, box, alerts)!;
      expect(c.x - CHIP_R).toBeGreaterThanOrEqual(box.x);
      expect(c.x + CHIP_R).toBeLessThanOrEqual(box.x + box.w);
      expect(c.y - CHIP_R).toBeGreaterThanOrEqual(box.y);
      expect(c.y + CHIP_R).toBeLessThanOrEqual(box.y + box.h);
      const hit = c.x + CHIP_R > alerts.x && c.y - CHIP_R < alerts.y + alerts.h && c.y + CHIP_R > alerts.y;
      expect(hit).toBe(false);
    }
  });
});

describe('the arrival pulse', () => {
  it('runs for half a second of real time, then stops', () => {
    expect(pulseAt(1000, 999)).toBeNull();
    expect(pulseAt(1000, 1000)).toBe(0);
    expect(pulseAt(1000, 1000 + PULSE_MS / 2)).toBeCloseTo(0.5);
    expect(pulseAt(1000, 1000 + PULSE_MS)).toBeNull();
    expect(pulseAt(-Infinity, 5000)).toBeNull();
  });
});

// A drawing context that records what it's asked and draws nothing.
function fakeCtx() {
  const calls: string[] = [];
  const ctx: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, k: string) => {
        if (k === 'measureText') return () => ({ width: 30 });
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...a: unknown[]) => void calls.push(`${k}(${a.join(',')})`);
      },
      set: () => true,
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const person = (over: Partial<Pawn> = {}): Pawn => ({ id: 1, name: 'X', kind: 'visitor', x: 0, s: 0, path: [], goal: null, task: 'go', exit: 0, doing: '', waitUntil: 0, flat: null, look: { skin: 1, hair: 2, top: 3, legs: 1 }, facing: 1, ...over }) as Pawn;

describe('the art', () => {
  it('draws every pose, with and without something in the hand, both ways round', () => {
    const poses: (Pose | undefined)[] = [undefined, 'sit', 'dance', 'read', 'phone', 'carry', 'mop', 'wave'];
    for (const pose of poses) {
      for (const prop of [undefined, 'parcel', 'bucket', 'toolbox', 'ladder', 'paper', 'box', 'mop', 'post', 'ball', 'bag', 'pram', 'dog', 'nonsense']) {
        for (const facing of [1, -1] as const) {
          const { ctx, calls } = fakeCtx();
          drawPerson(ctx, person({ pose, prop, facing }), 20, 30, 0.3, false, { tick: 17, seated: true });
          expect(calls.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('makes each visitor role look different from a plain person', () => {
    const plain = fakeCtx();
    drawPerson(plain.ctx, person({ role: 'friend' }), 20, 30, 0, false);
    const roles = ['postie', 'courier', 'rider', 'cleaner', 'windowcleaner', 'tradesperson', 'meter', 'council', 'kid', 'jogger'];
    const seen = new Set<string>();
    for (const role of roles) {
      const { ctx, calls } = fakeCtx();
      drawPerson(ctx, person({ role }), 20, 30, 0, false);
      expect(calls.join('|')).not.toBe(plain.calls.join('|'));
      seen.add(calls.join('|'));
    }
    expect(seen.size).toBe(roles.length);
    expect(outfitFor('Sandra')).toEqual(outfitFor('postie'));
  });

  it('draws the cat, the dog and the fox, standing, walking, sitting and asleep', () => {
    expect(speciesOf('fox')).toBe('fox');
    expect(speciesOf('dog')).toBe('dog');
    expect(speciesOf('cat')).toBe('cat');
    const all = new Set<string>();
    for (const role of ['cat', 'dog', 'fox']) {
      for (const pose of [undefined, 'sit', 'sleep'] as const) {
        const { ctx, calls } = fakeCtx();
        drawAnimal(ctx, person({ kind: 'animal', role, pose }), 20, 30, 0.2, pose === undefined, 40);
        expect(calls.length).toBeGreaterThan(10);
        all.add(calls.join('|'));
      }
    }
    // Dogs and foxes don't sit: it's the same drawing as standing still.
    expect(all.size).toBe(8);
  });

  it('has every icon the spec names, 8x8, and draws it', () => {
    for (const n of ['music', 'cup', 'envelope', 'box', 'phone', 'zz', 'question', 'pound', 'heart', 'fork', 'spanner', 'paw']) expect(ICON_NAMES).toContain(n);
    for (const n of ICON_NAMES) {
      const { ctx, calls } = fakeCtx();
      drawIcon(ctx, n, 0, 0, 3);
      expect(calls.length).toBeGreaterThan(5);
    }
    expect(iconName('tea')).toBe('cup');
    expect(iconName('£')).toBe('pound');
    expect(iconName('nope')).toBeNull();
  });
});

describe('the renderer', () => {
  // Enough of a browser for a frame to draw into.
  const canvas = () => {
    const { ctx } = fakeCtx();
    return { getContext: () => ctx, width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement;
  };
  Object.assign(globalThis, { document: { createElement: canvas }, window: { devicePixelRatio: 1 } });

  function make() {
    const sim = fixtureSim(7, 3, 10);
    const r = new Renderer(canvas(), sim);
    let now = 0;
    r.clock = () => now;
    r.resize(390, 844);
    r.fit(8, 60, 374, 560);
    return { sim, r, at: (ms: number) => void (now = ms) };
  }

  it('finds a card by its marker and by its chip, and pulses a new one for half a second', () => {
    const { sim, r, at } = make();
    const tenant = sim.state.pawns.find((p) => p.life)!;
    sim.state.drip.open.push({ id: 5, def: 'x', tick: sim.state.tick, until: sim.state.tick + 999, pawn: tenant.id });
    at(1000);
    r.draw();
    expect(r.animating).toBe(true);
    const spot = r.spotOf(sim.state.drip.open[0])!;
    const sx = r.camera.ox + ((spot.x0 + spot.x1) / 2) * r.camera.scale;
    const hit = r.cardAt(sx, 100);
    expect(hit === null || !hit.chip).toBe(true);
    at(1000 + PULSE_MS + 1);
    r.draw();
    expect(r.animating).toBe(false);
  });

  it('does not pulse a card that was already open when the game loaded', () => {
    const { sim, r, at } = make();
    const tenant = sim.state.pawns.find((p) => p.life)!;
    sim.state.tick += seconds(60);
    sim.state.drip.open.push({ id: 6, def: 'x', tick: sim.state.tick - seconds(30), until: sim.state.tick + 999, pawn: tenant.id });
    at(500);
    r.draw();
    expect(r.animating).toBe(false);
  });

  it('puts a chip on the edge for a subject off the screen, and a tap on it finds the card', () => {
    const { sim, r, at } = make();
    const st = sim.state;
    const tenant = st.pawns.find((p) => p.life)!;
    sim.state.drip.open.push({ id: 8, def: 'x', tick: sim.state.tick, until: sim.state.tick + 999, pawn: tenant.id });
    r.camera.ox -= 2000; // pan away
    at(10);
    r.draw();
    const spot = r.spotOf(st.drip.open[0])!;
    const box = { x: 8, y: 60, w: 374, h: 560 };
    const chip = chipFor(r.camera.ox + ((spot.x0 + spot.x1) / 2) * r.camera.scale, r.camera.oy + spot.y0 * r.camera.scale, box, { x: box.x + box.w - 160, y: box.y, w: 160, h: 150 })!;
    expect(chip).not.toBeNull();
    expect(r.cardAt(chip.x, chip.y)).toEqual({ card: 8, chip: true });
    expect(r.cardAt(chip.x + 200, chip.y + 200)).toBeNull();
  });

  it('draws a frame with bubbles, icons, visitors and an animal in it', () => {
    const { sim, r, at } = make();
    const st = sim.state;
    const t = st.pawns.find((p) => p.life)!;
    t.bubble = { text: '', icon: 'cup', until: st.tick + 500, kind: 'moment' };
    t.pose = 'read';
    st.pawns.push(person({ id: 900, role: 'postie', prop: 'post', x: 5, bubble: { text: 'Morning.', until: st.tick + 500 } }), person({ id: 901, kind: 'animal', role: 'cat', x: 7, pose: 'sleep' }));
    at(0);
    expect(() => r.draw()).not.toThrow();
  });
});
