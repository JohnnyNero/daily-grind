import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import {
  STARTING_FAME, demandFactor, guestCapacity, machineWear, noteVisit, priceTolerance, serviceMachine, stars, worstWear,
} from '../src/sim/business';
import { buyObject, deserialize, serialize, setPrice } from '../src/sim/manage';
import { fireEvent } from '../src/sim/storyteller';

describe('fame, stars and demand', () => {
  it('happy customers spread the word; walkouts undo it; fame fades a little overnight', () => {
    const sim = new Sim(1);
    expect(sim.state.fame).toBe(STARTING_FAME);
    const before = demandFactor(sim);
    for (let i = 0; i < 300; i++) noteVisit(sim, 'happy');
    expect(sim.state.fame).toBeGreaterThan(25);
    expect(demandFactor(sim)).toBeGreaterThan(before * 1.4);
    expect(stars(sim)).toBeGreaterThan(1);
    const f = sim.state.fame;
    for (let i = 0; i < 50; i++) noteVisit(sim, 'walkout');
    expect(sim.state.fame).toBeLessThan(f);
  });

  it('more tables means room for more customers', () => {
    const sim = new Sim(1);
    const cap = guestCapacity(sim);
    let added = 0;
    for (let y = 11; y < 20 && added < 2; y++) for (let x = 2; x < 12 && added < 2; x++) if (buyObject(sim, 'table2', x, y) === null) added++;
    expect(guestCapacity(sim)).toBe(cap + added * 2);
  });

  it('a better-rated place can charge more before people mind', () => {
    const sim = new Sim(1);
    const low = priceTolerance(sim);
    sim.state.fame = 200;
    sim.state.reputation = 80;
    expect(priceTolerance(sim)).toBeGreaterThan(low);
    const usual = demandFactor(sim);
    for (const m of sim.state.menu) setPrice(sim, m.name, m.basePrice * 2);
    expect(demandFactor(sim)).toBeLessThan(usual * 0.3);
  });
});

describe('running costs', () => {
  it('ingredients are paid for and machines wear with every drink; a service resets them', () => {
    const sim = new Sim(5);
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.ingredients).toBeGreaterThan(0);
    expect(worstWear(sim)).toBeGreaterThan(0);
    const machine = sim.state.objects.find((o) => o.def === sim.venue.drinkStation)!;
    sim.state.wear[machine.id] = 50;
    const money = sim.state.money;
    expect(serviceMachine(sim, machine.id)).toBeNull();
    expect(machineWear(sim, machine.id)).toBe(0);
    expect(sim.state.money).toBeLessThan(money);
    expect(sim.state.today.rent).toBeGreaterThan(0);
  });

  it('a coach party is announced before it arrives', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    fireEvent(sim, 'coachParty');
    const incoming = sim.state.story.incoming!;
    expect(incoming.n).toBeGreaterThanOrEqual(4);
    expect(sim.state.story.pendingArrivals).toBe(0);
    sim.run(incoming.at - sim.state.tick + TICKS_PER_MINUTE);
    expect(sim.state.story.incoming).toBeNull();
    expect(sim.state.log.some((e) => e.tale === 'coachParty')).toBe(true);
  });

  it('new fields survive a save, and an old save without them still loads', () => {
    const sim = new Sim(5);
    sim.run(TICKS_PER_DAY);
    const back = deserialize(serialize(sim));
    expect(back.state.fame).toBeCloseTo(sim.state.fame);
    const old = JSON.parse(serialize(sim));
    delete old.fame;
    delete old.wear;
    delete old.week;
    for (const p of old.pawns) if (p.staff) { delete p.staff.passions; delete p.staff.wage; }
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.state.fame).toBe(STARTING_FAME);
    expect(loaded.state.pawns.find((p) => p.staff)!.staff!.passions.length).toBeGreaterThan(0);
    loaded.run(TICKS_PER_HOUR);
  });
});
