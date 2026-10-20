import { describe, expect, it } from 'vitest';
import { accept } from '../src/sim/leases';
import { Sim } from '../src/sim/sim';
import { bedtime } from '../src/sim/schedules';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { serialize, deserialize } from '../src/sim/save';
import { vansAtKerb } from '../src/sim/visitors';

/** Gets an applicant, lets them have the flat at 10:00 the next day, and returns the flat's id. */
function letOne(seed: number, fit?: (sim: Sim, flatId: string) => void, at = 10 * 60): { sim: Sim; flat: string } {
  const sim = Sim.create(seed);
  for (let i = 0; i < 6 * 24 && sim.state.applicants.length === 0; i++) sim.run(TICKS_PER_HOUR);
  const a = sim.state.applicants[0];
  expect(a).toBeDefined();
  fit?.(sim, a.flat);
  // Ten in the morning is a decent time to move house.
  while (sim.minuteOfDay !== at) sim.run(TICKS_PER_MINUTE);
  expect(accept(sim, a.id)).toBeNull();
  return { sim, flat: a.flat };
}

interface Day {
  vanSeen: boolean;
  vanGone: boolean;
  moversSeen: number;
  boxesCarried: boolean;
  boxesInFlat: boolean;
  settled: string[];
  rider: boolean;
  firstNight: boolean;
  vanAt: number;
  vanLeft: number;
}

/** Watches the first day and a bit: the van, the boxes, where they sit, the takeaway. */
function watch(sim: Sim, flat: string, hours = 20): Day {
  const d: Day = { vanSeen: false, vanGone: false, moversSeen: 0, boxesCarried: false, boxesInFlat: false, settled: [], rider: false, firstNight: false, vanAt: -1, vanLeft: -1 };
  const t0 = sim.state.tick;
  for (let t = 0; t < hours * 60; t++) {
    sim.run(TICKS_PER_MINUTE);
    const here = vansAtKerb(sim).some((v) => v.flat === flat);
    if (here && !d.vanSeen) (d.vanSeen = true), (d.vanAt = sim.state.tick - t0);
    if (!here && d.vanSeen && !d.vanGone) (d.vanGone = true), (d.vanLeft = sim.state.tick - t0);
    const movers = sim.state.pawns.filter((p) => p.role === 'mover');
    d.moversSeen = Math.max(d.moversSeen, movers.length);
    for (const m of movers) {
      if (m.prop === 'box') d.boxesCarried = true;
      if (m.prop === 'box' && sim.layout.flatAt(Math.round(m.x), Math.round(m.s))?.id === flat) d.boxesInFlat = true;
    }
    for (const p of sim.state.pawns) {
      if (p.life?.flat === flat && p.life.moment?.kind === 'settlingIn' && p.pose === 'sit' && !d.settled.includes(p.doing)) d.settled.push(p.doing);
      if (p.life?.flat === flat && p.life.memories.some((m) => m.id === 'firstNight')) d.firstNight = true;
    }
    if (sim.state.pawns.some((p) => p.role === 'rider' && p.flat === flat)) d.rider = true;
  }
  return d;
}

describe('moving-in day', () => {
  it('a van, boxes carried up, somewhere to sit, a takeaway that night', () => {
    const { sim, flat } = letOne(5);
    const d = watch(sim, flat);
    expect(d.vanSeen).toBe(true);
    expect(d.moversSeen).toBe(2);
    expect(d.boxesCarried).toBe(true);
    expect(d.boxesInFlat).toBe(true);
    expect(d.vanGone).toBe(true);
    expect(d.vanLeft).toBeGreaterThan(d.vanAt);
    expect(sim.state.pawns.filter((p) => p.role === 'mover')).toHaveLength(0);
    expect(d.settled.length).toBeGreaterThan(0);
    expect(d.rider).toBe(true);
    expect(d.firstNight).toBe(true);
    // Nothing left behind in the saved list but the day's ordinary callers.
    expect(Object.keys(sim.state.visitors.next).filter((k) => /^#(van|settle)/.test(k))).toHaveLength(0);
  });

  it('where they sit comes from the flat: the sofa if there is one, the bed if there is not', () => {
    const sit = (seed: number, strip: boolean) => {
      const { sim, flat } = letOne(seed, (s, id) => {
        if (!strip) return;
        const cells = new Set(s.layout.flatCells(s.layout.flat(id)!));
        s.state.furniture = s.state.furniture.filter((f) => !(['sofa', 'armchair', 'diningSet'].includes(f.def) && cells.has(s.layout.node(f.x, f.s))));
        s.changed();
      });
      return watch(sim, flat).settled;
    };
    for (const seed of [5, 6, 7]) {
      const withSofa = sit(seed, false);
      const without = sit(seed, true);
      expect(without.some((x) => /sofa|armchair|table/.test(x)), `seed ${seed}: ${without}`).toBe(false);
      expect(without.length).toBeGreaterThan(0);
      expect(withSofa.length).toBeGreaterThan(0);
    }
  });

  it('the first night runs late (for anyone who is not up early), and the van waits for daylight', () => {
    let later = 0;
    for (const seed of [5, 6, 7, 8]) {
      const { sim, flat } = letOne(seed);
      const people = sim.state.pawns.filter((o) => o.life?.flat === flat);
      const before = people.map((p) => bedtime(sim, p.life!));
      watch(sim, flat, 14);
      people.forEach((p, i) => {
        expect(bedtime(sim, p.life!)).toBeGreaterThanOrEqual(before[i]);
        if (bedtime(sim, p.life!) > before[i]) later++;
      });
    }
    expect(later).toBeGreaterThan(0);
    // Let at ten at night: no van, no removal men, until the morning.
    const { sim, flat } = letOne(5, undefined, 22 * 60);
    let early = false;
    let came = false;
    for (let t = 0; t < 14 * 60; t++) {
      sim.run(TICKS_PER_MINUTE);
      const there = vansAtKerb(sim).length > 0 || sim.state.pawns.some((o) => o.role === 'mover');
      if (there && sim.minuteOfDay < 7 * 60 && sim.minuteOfDay > 0) early = true;
      if (there) came = true;
    }
    expect(early).toBe(false);
    expect(came).toBe(true);
    expect(flat).toBeTruthy();
  });

  it('saves and loads mid-move', () => {
    const { sim, flat } = letOne(5);
    for (let i = 0; i < 25; i++) sim.run(TICKS_PER_MINUTE);
    const copy = deserialize(serialize(sim));
    const a = watch(sim, flat, 8);
    const b = watch(copy, flat, 8);
    expect(b.vanGone).toBe(a.vanGone);
    expect(b.settled).toEqual(a.settled);
  });

  it('the removal men are not counted among the callers: the usual limit still holds', () => {
    const { sim, flat } = letOne(5);
    let most = 0;
    for (let t = 0; t < 14 * 60; t++) {
      sim.run(TICKS_PER_MINUTE);
      most = Math.max(most, sim.state.pawns.filter((p) => p.kind === 'visitor' && p.role !== 'mover').length);
    }
    expect(most).toBeLessThanOrEqual(3);
    expect(flat).toBeTruthy();
  });
});
