import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY } from '../src/sim/state';
import { buyObject, setDaysOff } from '../src/sim/manage';
import { DEBT_LIMIT } from '../src/sim/business';
import { isDayOff, weekday } from '../src/sim/stakes';

describe('stakes', () => {
  it('working every day burns people out; a day off a week keeps it down', () => {
    const run = (daysOff: boolean) => {
      const sim = new Sim(4);
      if (!daysOff) for (const p of sim.state.pawns) if (p.staff) setDaysOff(p, []);
      sim.run(14 * TICKS_PER_DAY);
      const staff = sim.state.pawns.filter((p) => p.staff && !p.staff.quit);
      return staff.reduce((n, p) => n + p.staff!.stress, 0) / staff.length;
    };
    expect(run(false)).toBeGreaterThan(run(true) + 10);
  });

  it('staff stay home on their day off', () => {
    const sim = new Sim(4);
    const p = sim.state.pawns.find((x) => x.staff)!;
    setDaysOff(p, [weekday(2)]);
    sim.run(TICKS_PER_DAY + 12 * 3600);
    expect(isDayOff(sim, p)).toBe(true);
    expect(p.onMap).toBe(false);
    expect(setDaysOff(p, [0, 1, 2, 3, 4, 5, 6])).toMatch(/at least one/);
  });

  it('debt costs fees, makes wages late, and stops the bank lending', () => {
    const sim = new Sim(4);
    sim.state.money = DEBT_LIMIT + 1000;
    expect(buyObject(sim, 'plant', 1, 11)).toMatch(/bank/);
    sim.state.money = DEBT_LIMIT - 20000;
    sim.state.goals = [];
    sim.run(TICKS_PER_DAY);
    expect(sim.state.debtDays).toBeGreaterThan(0);
    expect(sim.state.today.other + (sim.state.yesterday?.other ?? 0)).toBeGreaterThan(0);
    const anyone = sim.state.pawns.find((p) => p.staff)!;
    expect(anyone.staff!.memories.some((m) => m.def === 'wagesLate')).toBe(true);
  });
});
