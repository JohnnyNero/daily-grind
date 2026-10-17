import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { buyObject, deserialize, moveObject, serialize } from '../src/sim/manage';
import { buildAt } from '../src/sim/structure';
import { guestBarred, paintZone, zoneOf } from '../src/sim/service';
import { buildStaffFlat, hasFlat } from '../src/sim/flat';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type SimState } from '../src/sim/state';

describe('zones decide who goes where', () => {
  it('gives the ready-made places their back of house, flat and screens as zones', () => {
    const cafe = new Sim(3);
    // Kitchen, behind the counter and the staff room are staff only; the floor out front isn't.
    expect(zoneOf(cafe, 3, 3)).toBe('staff');
    expect(zoneOf(cafe, 12, 3)).toBe('staff');
    expect(zoneOf(cafe, 5, 8)).toBe('staff');
    expect(zoneOf(cafe, 5, 14)).toBeNull();
    const cinema = new Sim(3, undefined, 'cinema');
    expect(zoneOf(cinema, 11, 4)).toBe('screen');
    expect(zoneOf(cinema, 3, 5)).toBe('staff');
  });

  it('keeps customers out of staff-only areas, all day', () => {
    const sim = new Sim(4);
    let trespass = 0;
    for (let t = 0; t < TICKS_PER_DAY; t += TICKS_PER_MINUTE) {
      sim.run(TICKS_PER_MINUTE);
      for (const p of sim.state.pawns) if (p.kind === 'guest' && p.onMap && guestBarred(sim, Math.round(p.x), Math.round(p.y))) trespass++;
    }
    expect(trespass).toBe(0);
    expect(sim.state.yesterday!.served).toBeGreaterThan(40);
  });

  it('sends customers the long way round a staff-only patch, and never fences off the till', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    for (let x = 2; x <= 8; x++) if (x !== 5) buyObject(sim, 'counter', x, 13);
    expect(buyObject(sim, 'pickup', 5, 13)).toBeNull();
    expect(buyObject(sim, 'till', 9, 13)).toBeNull();
    // The customer side of the till can't be made staff only.
    expect(paintZone(sim, 9, 14, 'staff')).toMatch(/Customers stand there/);
    // Nor can the way in: in the café, making both tiles inside the front door staff only.
    const cafe = new Sim(3);
    expect(paintZone(cafe, 7, 20, 'staff')).toBeNull();
    expect(paintZone(cafe, 8, 20, 'staff')).toMatch(/Customers couldn't get to/);
    // Nor can the till move so its customers would stand in a staff-only area.
    expect(paintZone(sim, 12, 8, 'staff')).toBeNull();
    const till = sim.state.objects.find((o) => o.def === 'till')!;
    expect(moveObject(sim, till.id, 12, 7)).toMatch(/staff-only/);
  });

  it('lets furniture stand in rooms but not on the queue or pickup', () => {
    const sim = new Sim(5, undefined, 'cafe', 'empty');
    expect(paintZone(sim, 4, 4, 'staff')).toBeNull();
    expect(buyObject(sim, 'oven', 4, 4)).toBeNull();
    expect(paintZone(sim, 6, 6, 'queue')).toBeNull();
    expect(buyObject(sim, 'plant', 6, 6)).toMatch(/clear for service/);
    // Floors don't matter any more: an oven on carpet is fine.
    expect(buildAt(sim, 8, 8, { floor: 'C' })).toBeNull();
    expect(buyObject(sim, 'oven', 8, 8)).toBeNull();
  });

  it('staff hang about out the back', () => {
    const sim = new Sim(6);
    let idleOut = 0;
    let idleBack = 0;
    for (let t = 0; t < 8 * 60; t++) {
      sim.run(TICKS_PER_MINUTE);
      for (const p of sim.state.pawns) {
        if (!p.staff || !p.onMap || p.job?.label !== 'Hanging about' || p.moving) continue;
        if (zoneOf(sim, Math.round(p.x), Math.round(p.y)) === 'staff') idleBack++;
        else idleOut++;
      }
    }
    expect(idleBack).toBeGreaterThan(idleOut);
  });

  it('builds the flat as a flat zone', () => {
    const sim = new Sim(3);
    sim.state.money = 1000000;
    expect(buildStaffFlat(sim)).toBeNull();
    expect(hasFlat(sim)).toBe(true);
    expect(zoneOf(sim, sim.state.w - 18, 4)).toBe('flat');
  });

  it('gives older saves the rooms their floors used to mean', () => {
    const fresh = new Sim(3, undefined, 'cinema');
    const old = JSON.parse(serialize(fresh)) as SimState;
    const z = old.zones as Partial<SimState['zones']>;
    delete z.staff;
    delete z.flat;
    delete z.screen;
    const sim = deserialize(JSON.stringify(old));
    expect(zoneOf(sim, 3, 5)).toBe('staff');
    expect(zoneOf(sim, 11, 4)).toBe('screen');
    // The queue stays the queue.
    expect(zoneOf(sim, 5, 9)).toBe('queue');
  });
});
