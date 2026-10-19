import { describe, expect, it } from 'vitest';
import { placeFurniture, removeFurniture } from '../src/sim/build';
import { flatScore } from '../src/sim/impressiveness';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { BASELINE, likingTarget, thoughtsOf } from '../src/sim/thoughts';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life);

describe('tenants', () => {
  it('the building comes with sitting tenants: a couple in Flat 1 and one person in Flat 4', () => {
    const sim = Sim.create(4);
    const ts = tenants(sim);
    expect(ts).toHaveLength(3);
    const flats = sim.layout.flats;
    expect(ts.filter((p) => p.life!.flat === flats[0].id)).toHaveLength(2);
    expect(ts.filter((p) => p.life!.flat === flats[3].id)).toHaveLength(1);
    for (const p of ts) {
      expect(p.life!.traits.length).toBeGreaterThanOrEqual(2);
      expect(sim.state.flats[p.life!.flat].lease?.sitting).toBe(true);
    }
  });

  it('live a month without getting stuck, and every point of liking is a listed thought', () => {
    for (const seed of [1, 2, 3]) {
      const sim = Sim.create(seed);
      let workdays = 0;
      let sleptInBed = 0;
      for (let t = 0; t < 30 * TICKS_PER_DAY; t += 10 * TICKS_PER_MINUTE) {
        sim.run(10 * TICKS_PER_MINUTE);
        for (const p of tenants(sim)) {
          const life = p.life!;
          expect(p.doing, `${p.name} day ${sim.day}`).not.toMatch(/Stuck|Can't|Wondering/);
          // Liking is the baseline plus the listed thoughts, nothing hidden.
          const thoughts = thoughtsOf(sim, p);
          const sum = BASELINE + thoughts.reduce((n, th) => n + th.value, 0);
          expect(likingTarget(thoughts)).toBeCloseTo(Math.max(0, Math.min(100, sum)), 6);
          for (const v of Object.values(life.needs)) expect(v).toBeGreaterThanOrEqual(0);
          if (life.away?.why === 'At work') workdays++;
          if (p.pose === 'sleep' && life.sleptOn === 'bed') sleptInBed++;
        }
        if (t % (7 * TICKS_PER_DAY) === 0 && t > 0) {
          // Nobody's starving or exhausted for long in a decent flat.
          for (const p of tenants(sim)) expect(p.life!.needs.food + p.life!.needs.sleep).toBeGreaterThan(0.2);
        }
      }
      expect(workdays).toBeGreaterThan(0);
      expect(sleptInBed).toBeGreaterThan(0);
    }
  });

  it('cope without a bed or a loo, and like it less', () => {
    const sim = Sim.create(5);
    const flat = sim.layout.flats[0].id;
    const before = tenants(sim).map((p) => likingTarget(thoughtsOf(sim, p)));
    for (const f of [...sim.state.furniture]) {
      if (['doubleBed', 'toilet'].includes(f.def) && sim.layout.flatAt(f.x, f.s)?.id === flat) removeFurniture(sim.state, f.id);
    }
    sim.changed();
    sim.run(2 * TICKS_PER_DAY);
    const labels = tenants(sim).flatMap((p) => thoughtsOf(sim, p).map((t) => t.label));
    expect(labels).toContain('No bed');
    expect(labels).toContain('No toilet');
    const after = tenants(sim).map((p) => likingTarget(thoughtsOf(sim, p)));
    expect(Math.max(...after)).toBeLessThan(Math.min(...before));
    // They slept on the sofa.
    const memories = tenants(sim).flatMap((p) => p.life!.memories.map((m) => m.id));
    expect(memories.some((m) => m === 'sleptSofa' || m === 'sleptFloor')).toBe(true);
  });

  it('use a telly once there is one', () => {
    const sim = Sim.create(6);
    const st = sim.state;
    const { x0 } = st.plot;
    // Flat 1's living room is full, so swap the sink and cooker for a telly by the sofa.
    const sink = st.furniture.find((f) => f.def === 'sink' && f.s === 0)!;
    removeFurniture(st, sink.id);
    const cooker = st.furniture.find((f) => f.def === 'cooker' && f.s === 0)!;
    removeFurniture(st, cooker.id);
    expect(typeof placeFurniture(st, 'tv', x0 + 15, 0, 0)).not.toBe('string');
    sim.changed();
    let watched = false;
    for (let t = 0; t < 3 * TICKS_PER_DAY && !watched; t += TICKS_PER_HOUR / 4) {
      sim.run(TICKS_PER_HOUR / 4);
      watched = tenants(sim).some((p) => p.doing === 'Watching telly');
    }
    expect(watched).toBe(true);
  });

  it('scores flats: the weakest factor drags it down', () => {
    const sim = Sim.create(7);
    const lay = sim.layout;
    const one = flatScore(sim, lay.flats[0].id);
    const bare = flatScore(sim, lay.flats[4].id);
    expect(bare.tier).toBe('Grim');
    expect(one.score).toBeGreaterThan(bare.score);
    const mean = Object.values(one.factors).reduce((a, b) => a + b, 0) / Object.values(one.factors).length;
    expect(one.score).toBeLessThanOrEqual(Math.round(mean));
  });

  it('carry on the same after saving and loading', () => {
    const a = Sim.create(8);
    a.run(30 * TICKS_PER_HOUR);
    const b = deserialize(serialize(a));
    a.run(30 * TICKS_PER_HOUR);
    b.run(30 * TICKS_PER_HOUR);
    expect(serialize(b)).toBe(serialize(a));
  });
});
