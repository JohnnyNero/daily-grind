import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { checkGoals, checkUnlocks, diaryArrivals, planDiary } from '../src/sim/goals';
import { fireEvent } from '../src/sim/storyteller';

describe('goals, diary and unlocks', () => {
  it('there are always three goals, and meeting one pays out', () => {
    const sim = new Sim(8);
    expect(sim.state.goals.length).toBe(3);
    sim.state.goals = [{ id: 'serve:1', title: 'Serve 1', detail: '', byDay: 9, done: false, failed: false, reward: 12345 }];
    sim.state.today.served = 5;
    const money = sim.state.money;
    checkGoals(sim);
    expect(sim.state.money).toBe(money + 12345);
    expect(sim.state.goals.filter((g) => !g.done).length).toBe(3);
    expect(sim.state.letters.some((l) => l.title === 'Goal reached')).toBe(true);
  });

  it('new menu items unlock with the stars', () => {
    const sim = new Sim(8);
    const n = sim.state.menu.length;
    sim.state.fame = 200;
    sim.state.reputation = 90;
    checkUnlocks(sim);
    expect(sim.state.menu.length).toBeGreaterThan(n);
    expect(sim.state.menu.some((m) => m.name === 'iced latte')).toBe(true);
  });

  it('big days are booked ahead: the festival brings a crowd, the inspector comes at eleven', () => {
    const sim = new Sim(8);
    sim.run(9 * TICKS_PER_DAY);
    expect(sim.state.diary.some((d) => d.kind === 'festival' && d.day === 10)).toBe(true);
    expect(sim.state.letters.some((l) => l.title === 'The food festival')).toBe(true);
    sim.run(4 * TICKS_PER_HOUR); // day 10, ten in the morning
    expect(sim.day).toBe(10);
    expect(diaryArrivals(sim)).toBeGreaterThan(1);
    // On to inspection day (day 12) at noon.
    sim.run(2 * TICKS_PER_DAY + 2 * TICKS_PER_HOUR);
    planDiary(sim);
    expect(sim.state.log.some((e) => e.tale === 'inspector' && e.tick > sim.state.tick - 2 * TICKS_PER_HOUR)).toBe(true);
  });

  it('an office order is a big takeaway that gets made and collected', () => {
    const sim = new Sim(8);
    sim.run(TICKS_PER_HOUR + 5 * TICKS_PER_MINUTE); // just after opening, before a queue builds
    sim.state.fame = 100;
    fireEvent(sim, 'officeOrder');
    const courier = sim.state.pawns.find((p) => p.visit && p.visit.items.length >= 5)!;
    expect(courier).toBeDefined();
    const served = sim.state.today.served;
    for (let i = 0; i < 90 && sim.pawnById(courier.id)?.visit?.mood === undefined; i++) sim.run(TICKS_PER_MINUTE);
    sim.run(60 * TICKS_PER_MINUTE);
    expect(sim.state.today.served + sim.state.today.walkouts).toBeGreaterThan(served);
  });
});
