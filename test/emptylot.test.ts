import { describe, expect, it } from 'vitest';
import { EMPTY_LOT_MONEY, Sim } from '../src/sim/sim';
import { buildAt } from '../src/sim/structure';
import { buyObject, deserialize, keepClear, moveObject, sellObject, serialize } from '../src/sim/manage';
import { computeAlerts } from '../src/sim/alerts';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';
import { VENUES, emptyShell } from '../src/sim/venues';

const paint = (sim: Sim, kind: 'B' | 'K' | 'T', tiles: [number, number][]) => {
  for (const [x, y] of tiles) expect(buildAt(sim, x, y, { floor: kind })).toBeNull();
};

/** The bare minimum: a counter three rows down from usual, and a machine behind it. */
function fitOut(sim: Sim): void {
  expect(buyObject(sim, sim.venue.counter, 1, 12)).toBeNull();
  paint(sim, 'B', [[2, 10], [3, 10], [5, 10]]);
  expect(buyObject(sim, sim.venue.drinkStation, 2, 10)).toBeNull();
  expect(buyObject(sim, 'sink', 5, 10)).toBeNull();
}

describe('empty lot', () => {
  it('keeps only the outside walls and the front door', () => {
    for (const v of Object.values(VENUES)) {
      const rows = emptyShell(v.map, v.frontFloors[0]);
      expect(rows.join('')).not.toMatch(/[dKSBT]/);
      expect(rows[0]).toBe(v.map[0]);
      expect(rows[21]).toBe(v.map[21]);
      expect(rows[6]).toBe(`#${v.frontFloors[0].repeat(14)}#`);
      expect(rows.every((r, y) => r[0] === v.map[y][0] && r[15] === v.map[y][15])).toBe(true);
    }
  });

  it('starts empty, with money to fit out and nobody coming in until it can trade', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(sim.state.objects).toEqual([]);
    expect(sim.state.money).toBe(EMPTY_LOT_MONEY);
    expect(sim.canTrade).toBe(false);
    expect(keepClear(sim)).toEqual(sim.venue.positions.entry);
    expect(computeAlerts(sim).find((a) => a.id === 'fitout')?.text).toMatch(/counter and espresso machine/);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.pawns.filter((p) => p.onMap)).toEqual([]);
    expect(sim.state.today.wages + (sim.state.yesterday?.wages ?? 0)).toBe(0);
    expect(sim.state.yesterday?.served ?? 0).toBe(0);
  });

  it('opens once there is a counter and a drinks machine, with service around the counter', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    fitOut(sim);
    expect(sim.canTrade).toBe(true);
    expect(sim.positions.tillStaff).toEqual([8, 11]);
    expect(sim.positions.queue[0]).toEqual([8, 13]);
    expect(sim.positions.entry).toEqual(sim.venue.positions.entry);
    expect(computeAlerts(sim).some((a) => a.id === 'fitout')).toBe(false);
    sim.run(TICKS_PER_DAY);
    const day = sim.state.yesterday!;
    expect(day.served).toBeGreaterThan(20);
    expect(day.wages).toBeGreaterThan(0);
    // A save keeps the counter where it was put.
    const back = deserialize(serialize(sim));
    expect(back.positions.tillStaff).toEqual([8, 11]);
  });

  it('works the pub too', () => {
    const sim = new Sim(8, undefined, 'pub', 'empty');
    expect(sim.state.money).toBe(EMPTY_LOT_MONEY);
    fitOut(sim);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(10);
  });

  it('has one counter, which moves with its service spots and stays clear of furniture', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(buyObject(sim, 'bar', 1, 12)).toMatch(/not for sale/);
    expect(buyObject(sim, 'counter', 1, 12)).toBeNull();
    expect(buyObject(sim, 'counter', 1, 16)).toMatch(/already/);
    const counter = sim.counter!;
    expect(sellObject(sim, counter.id)).toMatch(/at least one/);
    // The queue would run into the side wall.
    expect(moveObject(sim, counter.id, 3, 12)).toMatch(/open floor/);
    // A table on the new queue line blocks the move, until it goes.
    expect(buyObject(sim, 'table2', 8, 15)).toBeNull();
    expect(moveObject(sim, counter.id, 1, 5)).toBeNull();
    expect(sim.positions.queue[0]).toEqual([8, 6]);
    expect(moveObject(sim, counter.id, 1, 14)).toMatch(/in the way/);
    // Old service spots are free for furniture now; the new ones aren't.
    expect(buyObject(sim, 'table2', 2, 13)).toBeNull();
    expect(buyObject(sim, 'table2', 9, 6)).toMatch(/clear for service/);
  });

  it('only moves the counter while no customers are in', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    fitOut(sim);
    sim.run(5 * TICKS_PER_HOUR);
    expect(sim.state.pawns.some((p) => p.kind === 'guest')).toBe(true);
    expect(moveObject(sim, sim.counter!.id, 1, 13)).toMatch(/customers/);
  });

  it('lets the standard layouts move their counter too', () => {
    const sim = new Sim(3);
    const c = sim.counter!;
    expect([c.x, c.y]).toEqual([1, 9]);
    expect(sim.positions).toBe(sim.venue.positions);
  });
});
