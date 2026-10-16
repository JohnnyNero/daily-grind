import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR } from '../src/sim/state';
import { editStaff, setRushStation, setStation } from '../src/sim/manage';
import { homeWork } from '../src/sim/work';
import { sayCatchphrase } from '../src/sim/social';

describe('footfall, rush stations and catchphrases', () => {
  it('footsteps are counted per tile and walking is timed per kind of work', () => {
    const sim = new Sim(3);
    sim.run(4 * TICKS_PER_HOUR);
    let total = 0;
    for (const v of sim.footfall) total += v;
    expect(total).toBeGreaterThan(100);
    const tasks = Object.values(sim.walkToday).reduce((n, w) => n + w.tasks, 0);
    const walk = Object.values(sim.walkToday).reduce((n, w) => n + w.walk, 0);
    expect(tasks).toBeGreaterThan(20);
    expect(walk).toBeGreaterThan(0);
  });

  it('a rush station takes over while there is a rush on', () => {
    const sim = new Sim(3);
    const p = sim.state.pawns.find((x) => x.staff)!;
    setStation(sim, p, 'floor');
    setRushStation(p, 'barista');
    sim.state.rushes = [];
    expect(homeWork(p, sim)).toBe('floor');
    sim.state.rushes = ['counter'];
    expect(homeWork(p, sim)).toBe('barista');
  });

  it('catchphrases are tidied, capped at three, and come out in conversation', () => {
    const sim = new Sim(3);
    const p = sim.state.pawns.find((x) => x.staff)!;
    expect(editStaff(p, { catchphrases: ['a', 'b', 'c', 'd'] })).toMatch(/Three/);
    expect(editStaff(p, { catchphrases: ['  "Not my circus."  ', ''] })).toBeNull();
    expect(p.staff!.catchphrases).toEqual(['Not my circus.']);
    sayCatchphrase(sim, p, 1);
    expect(sim.state.log[sim.state.log.length - 1].text).toBe(`${p.name}: "Not my circus."`);
  });
});
