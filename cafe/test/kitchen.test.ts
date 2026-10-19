import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { deserialize, sellObject, serialize } from '../src/sim/manage';
import { computeAlerts } from '../src/sim/alerts';
import { canCook } from '../src/sim/kitchen';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type SimState } from '../src/sim/state';

/** Every hot item ordered and every one cooked, by watching orders minute by minute. */
function watchHot(sim: Sim, ticks: number): { ordered: number; cooked: number; cooks: Set<string> } {
  const seen = new Set<string>();
  const out = { ordered: 0, cooked: 0, cooks: new Set<string>() };
  for (let t = 0; t < ticks; t += 30) {
    sim.run(30);
    for (const o of sim.state.orders) o.items.forEach((i, n) => {
      if (i.kind !== 'hot') return;
      const k = `${o.id}:${n}`;
      if (!seen.has(k)) { seen.add(k); out.ordered++; }
      if (i.status !== 'todo' && !seen.has(`${k}+`)) { seen.add(`${k}+`); out.cooked++; }
    });
    for (const p of sim.state.pawns) if (p.job?.work === 'kitchen' && p.job.steps.some((st) => st.kind === 'act' && st.action.type === 'prepItem')) out.cooks.add(p.name);
  }
  return out;
}

describe('the kitchen', () => {
  it('puts hot food on the café menu and a cook on the opening team', () => {
    const sim = new Sim(3);
    expect(sim.state.menu.filter((m) => m.kind === 'hot').map((m) => m.name)).toEqual(['bacon roll', 'cheese toastie']);
    const cook = sim.state.pawns.find((p) => p.staff?.station === 'kitchen')!;
    expect(cook.staff!.skills.kitchen).toBeGreaterThanOrEqual(5);
    expect(cook.shift).toEqual({ start: 7.5 * 60, end: 14.5 * 60 });
    expect(canCook(sim)).toBe(true);
  });

  it('cooks hot food to order: prep counter, then oven, then out to the pickup', () => {
    const sim = new Sim(4);
    const seen = watchHot(sim, TICKS_PER_DAY);
    expect(seen.ordered).toBeGreaterThan(5);
    expect(seen.cooked / seen.ordered).toBeGreaterThan(0.7);
    expect(seen.cooks.size).toBeGreaterThan(0);
    // A cooking job walks prep, oven, pickup in that order.
    const job = sim.state.pawns.map((p) => p.job).find((j) => j?.work === 'kitchen' && j.steps.some((s) => s.kind === 'act' && s.action.type === 'prepItem'));
    if (job) {
      const acts = job.steps.flatMap((s) => (s.kind === 'act' ? [s.action.type] : []));
      expect(acts).toEqual(['prepItem', 'makeItem', 'placeItem']);
    }
  });

  it('takes hot food off the menu while there is no oven', () => {
    const sim = new Sim(4);
    const oven = sim.state.objects.find((o) => o.def === 'oven')!;
    expect(sellObject(sim, oven.id)).toBeNull();
    expect(canCook(sim)).toBe(false);
    const seen = watchHot(sim, TICKS_PER_DAY);
    expect(seen.ordered).toBe(0);
    expect(sim.state.yesterday!.served).toBeGreaterThan(30);
  });

  it('warns when hot food is on and nobody on shift can cook', () => {
    const sim = new Sim(4);
    sim.run(3 * TICKS_PER_HOUR);
    for (const p of sim.state.pawns) if (p.staff) {
      p.staff.priorities.kitchen = 0;
      if (p.staff.station === 'kitchen') p.staff.station = null;
    }
    expect(computeAlerts(sim).some((a) => a.id === 'noCook')).toBe(true);
  });

  it('brings older saves into the kitchen era', () => {
    const fresh = new Sim(3);
    const old = JSON.parse(serialize(fresh)) as SimState;
    old.menu = old.menu.filter((m) => m.kind !== 'hot');
    for (const p of old.pawns) if (p.staff) {
      delete (p.staff.skills as Partial<typeof p.staff.skills>).kitchen;
      delete (p.staff.priorities as Partial<typeof p.staff.priorities>).kitchen;
    }
    const sim = deserialize(JSON.stringify(old));
    expect(sim.state.menu.some((m) => m.name === 'bacon roll' && m.kind === 'hot')).toBe(true);
    for (const p of sim.state.pawns) if (p.staff) {
      expect(p.staff.skills.kitchen).toBeGreaterThan(0);
      expect(p.staff.priorities.kitchen).toBe(3);
    }
  });
});
