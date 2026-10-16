// Stress and robustness tests: random "chaos manager" play, extreme set-ups and damaged
// saves, all checked against the invariants. Sized to run in CI in a few seconds; the
// longer version is test/soak.ts.

import { describe, expect, it } from 'vitest';
import { OBJECT_DEFS } from '../src/sim/defs';
import { buyObject, deserialize, fire, sellObject, serialize, setEnabled, setPrice, setShift } from '../src/sim/manage';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { fireEvent } from '../src/sim/storyteller';
import { chaosAction, FuzzRng } from './fuzz';
import { checkInvariants, StuckWatch } from './invariants';

/** Runs the sim, checking invariants every 10 minutes; returns every problem found. */
function soak(sim: Sim, ticks: number, chaos?: { rng: FuzzRng; perHour: number }): string[] {
  const problems: string[] = [];
  const watch = new StuckWatch();
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (t % TICKS_PER_MINUTE !== 0) continue;
    if (chaos && chaos.rng.next() < chaos.perHour / 60) chaosAction(sim, chaos.rng);
    if (t % (10 * TICKS_PER_MINUTE) === 0) problems.push(...checkInvariants(sim), ...watch.check(sim));
  }
  return problems;
}

describe.each(['cafe', 'pub'])('%s under stress', (venue) => {
  it('survives three days of a chaotic manager, with save/reload, breaking no rules', () => {
    for (const seed of [11, 12]) {
      let sim = new Sim(seed, undefined, venue);
      const rng = new FuzzRng(seed);
      const problems: string[] = [];
      for (let day = 0; day < 3; day++) {
        problems.push(...soak(sim, TICKS_PER_DAY, { rng, perHour: 6 }));
        sim = deserialize(serialize(sim));
      }
      expect(problems).toEqual([]);
    }
  });

  const extremes: [string, (s: Sim) => void][] = [
    ['everyone fired', (s) => { for (const p of [...s.state.pawns]) fire(s, p); }],
    ['every job switched off', (s) => { for (const p of s.state.pawns) if (p.staff) for (const k of Object.keys(p.staff.priorities)) p.staff.priorities[k as keyof typeof p.staff.priorities] = 0; }],
    ['prices at the maximum', (s) => { for (const m of s.state.menu) setPrice(s, m.name, 1e9); }],
    ['prices at the minimum', (s) => { for (const m of s.state.menu) setPrice(s, m.name, 0); }],
    ['food only, and the food delivery late', (s) => {
      for (const m of s.state.menu) if (m.kind === 'drink') setEnabled(s, m.name, false);
      s.run(6 * TICKS_PER_HOUR);
      fireEvent(s, 'lateDelivery');
      fireEvent(s, 'critic');
    }],
    ['every sellable thing sold', (s) => { for (const o of [...s.state.objects]) sellObject(s, o.id); }],
    ['every tile bought up', (s) => {
      for (const def of Object.keys(OBJECT_DEFS)) for (let y = 0; y < s.state.h; y++) for (let x = 0; x < s.state.w; x++) buyObject(s, def, x, y);
    }],
    ['shifts at impossible times', (s) => { for (const p of s.state.pawns) if (p.staff) setShift(s, p, -500, 99999); }],
    ['a two-hundred-person rush', (s) => { s.run(6 * TICKS_PER_HOUR); s.state.story.pendingArrivals = 200; }],
    ['deep in debt', (s) => { s.state.money = -1e9; }],
  ];
  it.each(extremes)('copes with %s', (_name, setup) => {
    const sim = new Sim(3, undefined, venue);
    setup(sim);
    expect(soak(sim, TICKS_PER_DAY)).toEqual([]);
  });
});

describe('damaged saves', () => {
  const good = serialize(new Sim(1));
  const cases: [string, string][] = [
    ['truncated', good.slice(0, 3000)],
    ['empty object', '{}'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a bare skeleton', '{"version":3,"pawns":[],"tiles":[]}'],
    ['the wrong map size', JSON.stringify({ ...JSON.parse(good), w: 3 })],
    ['missing story state', JSON.stringify({ ...JSON.parse(good), story: undefined })],
  ];
  it.each(cases)('rejects %s with a friendly message', (_name, json) => {
    expect(() => deserialize(json)).toThrow(/Daily Grind save|newer version/);
  });

  it('rejects a save from a newer version as such', () => {
    expect(() => deserialize(JSON.stringify({ ...JSON.parse(good), version: 99 }))).toThrow(/newer version/);
  });
});
