import { describe, expect, it } from 'vitest';
import { EMPTY_LOT_MONEY, Sim } from '../src/sim/sim';
import { buildAt } from '../src/sim/structure';
import { buyObject, deserialize, keepClear, moveObject, rotateObject, sellObject, serialize } from '../src/sim/manage';
import { computeAlerts } from '../src/sim/alerts';
import { paintZone } from '../src/sim/service';
import { rotateOffset, objectDef, spotsAt } from '../src/sim/defs';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type SimState } from '../src/sim/state';
import { VENUES, bareLot } from '../src/sim/venues';
import { isShell } from '../src/sim/structure';

const paint = (sim: Sim, kind: 'B' | 'K' | 'T', tiles: [number, number][]) => {
  for (const [x, y] of tiles) expect(buildAt(sim, x, y, { floor: kind })).toBeNull();
};

/**
 * A small set-up away from the usual spot: till and pickup on row 13 (staff behind on
 * row 12), a machine behind, a queue down column 10 and a pickup area along row 14.
 */
function fitOut(sim: Sim): void {
  for (let x = 2; x <= 8; x++) if (x !== 5) expect(buyObject(sim, sim.venue.counter, x, 13)).toBeNull();
  expect(buyObject(sim, 'pickup', 5, 13)).toBeNull();
  expect(buyObject(sim, 'till', 9, 13)).toBeNull();
  paint(sim, 'B', [[3, 11], [4, 11], [7, 11]]);
  expect(buyObject(sim, sim.venue.drinkStation, 3, 11)).toBeNull();
  expect(buyObject(sim, 'sink', 7, 11)).toBeNull();
  for (let y = 15; y <= 19; y++) expect(paintZone(sim, 9, y, 'queue')).toBeNull();
  for (let x = 2; x <= 7; x++) if (x !== 5) expect(paintZone(sim, x, 14, 'pickup')).toBeNull();
}

describe('empty lot', () => {
  it('is bare ground with no walls or doors: the pavement is all that is fixed', () => {
    for (const v of Object.values(VENUES)) {
      const rows = bareLot(v.map, v.frontFloors[0], 20, 10);
      expect(rows.join('')).not.toMatch(/[#dD]/);
      expect(rows).toHaveLength(34);
      expect(rows[32]).toBe('P'.repeat(36));
    }
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(sim.state.tiles.some((t) => t.wall || t.door)).toBe(false);
    // Corners, edges and the shop front are all buildable; the pavement isn't.
    expect(isShell(sim, 0, 0)).toBe(false);
    // The map is bigger than the ready-made buildings: wider, and further back.
    expect([sim.state.w, sim.state.h]).toEqual([36, 34]);
    expect(isShell(sim, 7, 31)).toBe(false);
    expect(isShell(sim, 7, 32)).toBe(true);
    expect(buildAt(sim, 0, 0, 'wall')).toBeNull();
    // People arrive anywhere along the pavement.
    expect(sim.entry.length).toBe(sim.state.w);
  });

  it('lets the player wall it in and choose where the front door goes', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    for (let x = 0; x < sim.state.w; x++) expect(buildAt(sim, x, 21, 'wall')).toBeNull();
    expect(buildAt(sim, 12, 21, 'door')).toBeNull();
    fitOut(sim);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(20);
    // Bricking up the only door would shut everyone out.
    const blocked = buildAt(sim, 12, 21, 'wall');
    expect(blocked).toMatch(/cut off|block|shut/);
  });

  it('starts empty, with money to fit out and nobody coming in until it can trade', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(sim.state.objects).toEqual([]);
    expect(sim.state.zones).toEqual({ queue: [], pickup: [], staff: [], screen: [] });
    expect(sim.state.money).toBe(EMPTY_LOT_MONEY);
    expect(sim.canTrade).toBe(false);
    expect(keepClear(sim)).toEqual(sim.entry);
    expect(computeAlerts(sim).find((a) => a.id === 'fitout')?.text).toMatch(/a till, a pickup counter and espresso machine/);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.pawns.filter((p) => p.onMap)).toEqual([]);
    expect(sim.state.today.wages + (sim.state.yesterday?.wages ?? 0)).toBe(0);
  });

  it('serves from wherever the till and pickup are, along the queue that was marked', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    fitOut(sim);
    expect(sim.canTrade).toBe(true);
    const pos = sim.positions;
    expect(pos.tillStaff).toEqual([9, 12]);
    expect(pos.queue).toEqual([[9, 14], [9, 15], [9, 16], [9, 17], [9, 18], [9, 19]]);
    expect(pos.pickupStaff).toEqual([5, 12]);
    expect(pos.pickupGuest).toEqual([5, 14]);
    // No food counter: food is plated at the pickup.
    expect(pos.foodStaff).toEqual([5, 12]);
    expect(pos.wait[0]).toEqual([4, 14]);
    expect(computeAlerts(sim).some((a) => a.id === 'fitout')).toBe(false);
    sim.run(TICKS_PER_DAY);
    const day = sim.state.yesterday!;
    expect(day.served).toBeGreaterThan(20);
    expect(day.wages).toBeGreaterThan(0);
    const back = deserialize(serialize(sim));
    expect(back.positions.queue).toEqual(pos.queue);
  });

  it('works the pub too', () => {
    const sim = new Sim(8, undefined, 'pub', 'empty');
    fitOut(sim);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(10);
  });

  it('copes with no pickup area: people wait off to the side, not on the queue', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    fitOut(sim);
    for (let x = 2; x <= 7; x++) paintZone(sim, x, 14, 'clear');
    expect(sim.positions.wait).toEqual([]);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(15);
  });

  it('has one till and one pickup, each needing room behind and in front', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(buyObject(sim, 'bar', 4, 12)).toMatch(/not for sale/);
    expect(buyObject(sim, 'till', 4, 12)).toBeNull();
    expect(buyObject(sim, 'till', 8, 12)).toMatch(/already/);
    const till = sim.state.objects.find((o) => o.def === 'till')!;
    expect(sellObject(sim, till.id)).toMatch(/at least one/);
    // Against a wall there's nowhere for staff to stand.
    expect(buildAt(sim, 4, 0, 'wall')).toBeNull();
    expect(moveObject(sim, till.id, 4, 1)).toMatch(/open floor behind/);
    // A table where customers would stand blocks it.
    expect(buyObject(sim, 'table2', 7, 16)).toBeNull();
    expect(moveObject(sim, till.id, 7, 15)).toMatch(/in the way/);
    // Its own spots move with it, freeing the old ones.
    expect(moveObject(sim, till.id, 4, 7)).toBeNull();
    expect(buyObject(sim, 'plant', 4, 13)).toBeNull();
    expect(buyObject(sim, 'plant', 4, 8)).toMatch(/clear for service/);
  });

  it('only moves service pieces while no customers are in', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    fitOut(sim);
    sim.run(2 * TICKS_PER_HOUR);
    for (let i = 0; i < 600 && !sim.state.pawns.some((p) => p.kind === 'guest'); i++) sim.run(60);
    expect(sim.state.pawns.some((p) => p.kind === 'guest')).toBe(true);
    const till = sim.state.objects.find((o) => o.def === 'till')!;
    expect(moveObject(sim, till.id, 9, 12)).toMatch(/customers/);
  });
});

describe('zones', () => {
  it('only marks open floor inside, and keeps furniture and walls off it', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(buildAt(sim, 0, 5, 'wall')).toBeNull();
    expect(paintZone(sim, 0, 5, 'queue')).toMatch(/open floor/);
    expect(paintZone(sim, 7, sim.state.h - 2, 'queue')).toMatch(/inside/);
    expect(paintZone(sim, 5, 15, 'queue')).toBeNull();
    expect(buyObject(sim, 'plant', 5, 15)).toMatch(/clear for service/);
    expect(buildAt(sim, 5, 15, 'wall')).toMatch(/clear for service/);
    // Repainting a tile swaps it; clearing frees it.
    expect(paintZone(sim, 5, 15, 'pickup')).toBeNull();
    expect(sim.state.zones.queue).toEqual([]);
    expect(paintZone(sim, 5, 15, 'clear')).toBeNull();
    expect(sim.state.zones.pickup).toEqual([]);
    expect(buyObject(sim, 'plant', 5, 15)).toBeNull();
    expect(paintZone(sim, 5, 15, 'queue')).toMatch(/standing there/);
  });

  it('runs the queue back from the till along joined-up floor only, nearest first', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(buyObject(sim, 'till', 6, 10)).toBeNull();
    // An L back from the till, and a stray patch that doesn't touch it.
    for (const [x, y] of [[6, 12], [6, 13], [7, 13], [8, 13], [12, 18], [13, 18]] as const) paintZone(sim, x, y, 'queue');
    expect(sim.positions.queue).toEqual([[6, 11], [6, 12], [6, 13], [7, 13], [8, 13]]);
  });
});

describe('rotation', () => {
  it('turns offsets about the footprint', () => {
    const fridge = objectDef('fridge');
    expect([0, 1, 2, 3].map((r) => rotateOffset(fridge, r as 0, [0, 1]))).toEqual([[0, 1], [-1, 0], [0, -1], [1, 0]]);
    expect(spotsAt('espresso', 2, 2, 1)).toEqual([[1, 2], [1, 3]]);
  });

  it('turns furniture in place, moving where people use it from', () => {
    const sim = new Sim(3);
    const table = sim.state.objects.find((o) => o.def === 'table2')!;
    const before = sim.world.spots(table);
    expect(rotateObject(sim, table.id)).toBeNull();
    expect(table.rot).toBe(1);
    expect(sim.world.spots(table)).not.toEqual(before);
    // A turned till serves from the side.
    const empty = new Sim(5, undefined, 'cafe', 'empty');
    expect(buyObject(empty, 'till', 6, 12, 1)).toBeNull();
    expect(empty.positions.tillStaff).toEqual([7, 12]);
    expect(empty.positions.queue[0]).toEqual([5, 12]);
    const back = deserialize(serialize(empty));
    expect(back.positions.tillStaff).toEqual([7, 12]);
  });

  it('refuses a turn that would not fit', () => {
    const sim = new Sim(3);
    const espresso = sim.state.objects.find((o) => o.def === 'espresso')!;
    // Turned upright it would poke into the kitchen wall above.
    expect(rotateObject(sim, espresso.id)).not.toBeNull();
    expect(espresso.rot).toBeUndefined();
  });
});

describe('older saves', () => {
  it('widen a narrower back plot, opening its old far wall onto the new ground', () => {
    const fresh = new Sim(3);
    const old = JSON.parse(serialize(fresh)) as SimState;
    // Cut it back to how saves looked with a 9-wide plot: walled along the far side and top.
    const w = 25;
    old.tiles = Array.from({ length: old.h }, (_, y) => old.tiles.slice(y * old.w, y * old.w + w)).flatMap((row) =>
      row.map((t, x) => (x === w - 1 && t.floor !== 'P' ? { floor: 'B' as const, wall: true, door: false } : t)));
    old.w = w;
    const sim = deserialize(JSON.stringify(old));
    expect(sim.state.w).toBe(36);
    expect(sim.world.tile(24, 12)).toEqual({ floor: 'Y', wall: false, door: false });
    expect(sim.world.tile(24, 0).wall).toBe(true);
    expect(sim.world.tile(30, 0).wall).toBe(true);
    expect(sim.world.tile(35, 12).wall).toBe(true);
    expect(sim.world.tile(30, 12)).toEqual({ floor: 'Y', wall: false, door: false });
    expect(sim.world.tile(30, 23).floor).toBe('P');
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(20);
  });

  it('swap the one-piece counter for pieces and keep the old service spots', () => {
    const fresh = new Sim(3);
    const old = JSON.parse(serialize(fresh)) as SimState & { zones?: unknown };
    // Rewind to how a save looked before: one 9-wide counter object, no zones.
    old.objects = old.objects.filter((o) => !['till', 'pickup', 'foodCounter', 'counter'].includes(o.def));
    old.objects.push({ id: 999, def: 'counter', x: 1, y: 9 });
    delete (old as { zones?: unknown }).zones;
    const sim = deserialize(JSON.stringify(old));
    expect(sim.positions.tillStaff).toEqual([8, 8]);
    expect(sim.positions.pickupGuest).toEqual([5, 10]);
    expect(sim.positions.foodStaff).toEqual([1, 8]);
    expect(sim.positions.queue).toEqual(fresh.positions.queue);
    expect(sim.positions.wait).toEqual(fresh.positions.wait);
    expect(sim.state.objects.filter((o) => o.def === 'counter')).toHaveLength(6);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(20);
  });
});
