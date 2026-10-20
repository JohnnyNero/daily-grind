import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';
import { mend } from '../src/sim/upkeep';
import { addVisitor, postieHasBeen, visitorRoom } from '../src/sim/visitors';
import { VISITORS } from '../src/sim/tuning';
import { SHARED } from '../src/sim/environment';

/** Runs in steps of `step` ticks, calling `look` after each. */
function watch(sim: Sim, ticks: number, look: (sim: Sim) => void, step = 10): void {
  for (let t = 0; t < ticks; t += step) {
    sim.run(step);
    look(sim);
  }
}

const visitors = (sim: Sim, role?: string) => sim.state.pawns.filter((p) => p.kind === 'visitor' && (!role || p.role === role));

describe('visitors', () => {
  it('never put more than 3 visitors or 3 passers-by on the map', () => {
    for (const seed of [1, 2]) {
      const sim = Sim.create(seed);
      let most = 0;
      let busiest = 0;
      watch(sim, 10 * TICKS_PER_DAY, (s) => {
        most = Math.max(most, visitors(s).length);
        busiest = Math.max(busiest, s.state.pawns.filter((p) => p.kind === 'passerby').length);
      });
      expect(most).toBeLessThanOrEqual(VISITORS.most);
      expect(busiest).toBeLessThanOrEqual(VISITORS.mostPassersBy);
    }
  });

  it('bring Sandra the postie every morning', () => {
    const sim = Sim.create(3);
    for (let day = 1; day <= 8; day++) {
      let came = false;
      let badge = false;
      watch(sim, TICKS_PER_DAY, (s) => {
        const sandra = visitors(s, 'postie')[0];
        if (sandra) {
          came = true;
          expect(s.minuteOfDay).toBeGreaterThanOrEqual(9 * 60);
          expect(s.minuteOfDay).toBeLessThan(11 * 60);
        }
        if (postieHasBeen(s)) badge = true;
      });
      expect(came, `day ${day}`).toBe(true);
      expect(badge, `badge on day ${day}`).toBe(true);
    }
  });

  it('bring Lorraine only if the cleaner is paid', () => {
    const sim = Sim.create(4);
    watch(sim, 3 * TICKS_PER_DAY, (s) => expect(visitors(s, 'cleaner')).toHaveLength(0));
    sim.state.cleaner = true;
    sim.state.dirt[SHARED] = 0.8;
    let came = false;
    let mopped = false;
    watch(sim, 2 * TICKS_PER_DAY, (s) => {
      const l = visitors(s, 'cleaner')[0];
      if (l) {
        came = true;
        if (l.pose === 'mop') mopped = true;
      }
    });
    expect(came).toBe(true);
    expect(mopped).toBe(true);
    expect(sim.state.dirt[SHARED]).toBeLessThan(0.8);
  });

  it('bring a tradesperson when something is mended', () => {
    const sim = Sim.create(5);
    sim.run(10 * TICKS_PER_HOUR);
    sim.state.money = 100000;
    const f = sim.state.furniture.find((x) => x.def === 'sink')!;
    f.broken = sim.day;
    expect(mend(sim, f.id)).toBeNull();
    let came: string | undefined;
    watch(sim, TICKS_PER_HOUR, (s) => {
      const t = visitors(s, 'tradesperson')[0];
      if (t) came ??= t.name;
    });
    expect(came).toMatch(/plumber|sparky|handyman/);
    sim.run(2 * TICKS_PER_HOUR);
    expect(visitors(sim, 'tradesperson')).toHaveLength(0);
  });

  it('let friends round, who sit down and go home', () => {
    const sim = Sim.create(6);
    let sat = false;
    let couriers = 0;
    const seen = new Set<number>();
    watch(sim, 14 * TICKS_PER_DAY, (s) => {
      for (const p of visitors(s)) {
        if (p.role === 'friend' && p.pose === 'sit') sat = true;
        if (p.role === 'courier' && !seen.has(p.id)) couriers++;
        seen.add(p.id);
        expect(p.doing).not.toMatch(/Stuck|Can't/);
      }
    }, 20);
    expect(sat).toBe(true);
    expect(couriers).toBeGreaterThanOrEqual(14 * 1);
    // Nobody is left on the map overnight.
    sim.run(TICKS_PER_DAY - (sim.state.tick % TICKS_PER_DAY) + 5 * TICKS_PER_HOUR);
    expect(visitors(sim).filter((p) => p.role === 'friend')).toHaveLength(0);
  });

  it('keep the building cat about', () => {
    const sim = Sim.create(7);
    sim.run(TICKS_PER_HOUR);
    sim.state.cat = { pawn: -1, since: sim.day };
    sim.run(2 * TICKS_PER_HOUR);
    const cat = sim.state.pawns.find((p) => p.role === 'cat');
    expect(cat?.kind).toBe('animal');
    expect(sim.state.cat.pawn).toBe(cat!.id);
    let slept = false;
    watch(sim, 2 * TICKS_PER_DAY, (s) => {
      expect(s.state.pawns.filter((p) => p.role === 'cat')).toHaveLength(1);
      if (cat!.pose === 'sleep') slept = true;
    });
    expect(slept).toBe(true);
  });

  it('let a card add its own visitor', () => {
    const sim = Sim.create(8);
    expect(visitorRoom(sim)).toBe(true);
    const p = addVisitor(sim, 'courier');
    expect(p.kind).toBe('visitor');
    let gone = false;
    for (let t = 0; t < 3000 && !gone; t += 10) {
      sim.run(10);
      gone = !sim.state.pawns.includes(p);
    }
    expect(gone).toBe(true);
  });
});
