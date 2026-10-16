import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { buildAt, isShell, restoreLayout, snapshotLayout, BUILD_PRICES } from '../src/sim/structure';
import { deserialize, serialize } from '../src/sim/manage';
import { TICKS_PER_HOUR } from '../src/sim/state';

const tile = (sim: Sim, x: number, y: number) => sim.world.tile(x, y);

describe('building work', () => {
  it('builds a wall, charges for it, and knocks it down again for free', () => {
    const sim = new Sim(3);
    const money = sim.state.money;
    expect(buildAt(sim, 10, 14, 'wall')).toBeNull();
    expect(tile(sim, 10, 14).wall).toBe(true);
    expect(sim.state.money).toBe(money - BUILD_PRICES.wall);
    expect(buildAt(sim, 10, 14, 'remove')).toBeNull();
    expect(tile(sim, 10, 14)).toEqual({ floor: 'F', wall: false, door: false });
    expect(sim.state.money).toBe(money - BUILD_PRICES.wall);
  });

  it('keeps the shell, the service spots and furniture untouchable', () => {
    const sim = new Sim(3);
    expect(isShell(sim, 0, 5)).toBe(true);
    expect(buildAt(sim, 0, 5, 'remove')).toMatch(/outside/);
    expect(buildAt(sim, 7, 21, 'remove')).toMatch(/outside/);
    const till = sim.venue.positions.tillStaff;
    expect(buildAt(sim, till[0], till[1], 'wall')).toMatch(/clear for service/);
    expect(buildAt(sim, 2, 12, 'wall')).toMatch(/Move the four-top/);
    expect(buildAt(sim, 2, 11, 'wall')).toMatch(/Leave room/);
  });

  it('refuses a wall that would cut people off, and a door anywhere but a straight wall', () => {
    const sim = new Sim(3);
    // The toilet's only door.
    expect(buildAt(sim, 12, 18, 'wall')).toMatch(/block the toilet/);
    expect(tile(sim, 12, 18).door).toBe(true);
    expect(buildAt(sim, 5, 14, 'door')).toMatch(/straight wall/);
    // A second way into the kitchen.
    expect(buildAt(sim, 6, 6, 'door')).toBeNull();
    expect(tile(sim, 6, 6)).toMatchObject({ wall: false, door: true });
  });

  it('paints floors, but not under furniture that needs a particular floor', () => {
    const sim = new Sim(3);
    expect(buildAt(sim, 6, 15, { floor: 'C' })).toBeNull();
    expect(tile(sim, 6, 15).floor).toBe('C');
    expect(buildAt(sim, 2, 1, { floor: 'F' })).toMatch(/oven can't stand/);
  });

  it('undoes a stroke, refunding it, and survives a save', () => {
    const sim = new Sim(3);
    const snap = snapshotLayout(sim);
    for (let x = 1; x <= 4; x++) expect(buildAt(sim, x, 15, 'wall')).toBeNull();
    const reloaded = deserialize(serialize(sim));
    expect(reloaded.world.tile(3, 15).wall).toBe(true);
    expect(restoreLayout(sim, snap)).toBeNull();
    expect(tile(sim, 3, 15).wall).toBe(false);
    expect(sim.state.money).toBe(snap.money);
  });

  it('a café with a wall across the floor still runs for a day without anyone getting stuck', () => {
    const sim = new Sim(8);
    sim.run(4 * TICKS_PER_HOUR);
    let built = 0;
    for (let x = 1; x <= 9; x++) if (buildAt(sim, x, 15, 'wall') === null) built++;
    expect(built).toBeGreaterThan(5);
    sim.run(20 * TICKS_PER_HOUR);
    expect(sim.state.recaps.length).toBe(1);
    expect(sim.state.recaps[0].stats.served).toBeGreaterThan(20);
    for (const p of sim.state.pawns) if (p.onMap) expect(sim.world.passable(Math.round(p.x), Math.round(p.y))).toBe(true);
  });
});
