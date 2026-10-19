import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';

describe('the simulation', () => {
  it('is the same every time from the same seed', () => {
    const a = Sim.create(7);
    const b = Sim.create(7);
    a.run(TICKS_PER_DAY);
    b.run(TICKS_PER_DAY);
    expect(serialize(a)).toBe(serialize(b));
  });

  it('carries on the same after saving and loading', () => {
    const a = Sim.create(9);
    a.run(10 * TICKS_PER_HOUR);
    const b = deserialize(serialize(a));
    a.run(10 * TICKS_PER_HOUR);
    b.run(10 * TICKS_PER_HOUR);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('sends people past and the agent round every empty flat over a few days', () => {
    const sim = Sim.create(3);
    const seen = new Set<string>();
    let passers = 0;
    let lastIds = new Set<number>();
    for (let t = 0; t < 4 * TICKS_PER_DAY; t += 60) {
      sim.run(60);
      for (const p of sim.state.pawns) {
        if (p.kind === 'agent' && p.task === 'look' && p.flat) seen.add(p.flat);
        if (p.kind === 'passerby' && !lastIds.has(p.id)) passers++;
        expect(p.doing).not.toMatch(/Stuck|Can't|Wondering/);
        // Passers-by stay on the pavement in front of the building, never inside it.
        if (p.kind === 'passerby' && p.x > sim.state.plot.x0 && p.x < sim.state.plot.x1) expect(p.front, `${p.name} at ${p.x}`).toBe(true);
      }
      lastIds = new Set(sim.state.pawns.map((p) => p.id));
    }
    const lived = new Set(sim.state.pawns.flatMap((p) => (p.life ? [p.life.flat] : [])));
    expect(seen.size).toBe(sim.layout.flats.length - lived.size);
    for (const f of lived) expect(seen.has(f)).toBe(false);
    expect(passers).toBeGreaterThan(50);
  });
});
