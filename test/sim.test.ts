import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/path';
import { Sim } from '../src/sim/sim';
import { startBreak } from '../src/sim/breaks';
import { SAVE_VERSION, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { fireEvent } from '../src/sim/storyteller';
import { spawnGuest } from '../src/sim/guests';
import { regularWronged } from '../src/sim/regulars';
import { checkWants } from '../src/sim/wants';
import { spillAt } from '../src/sim/ambience';
import { taleScore } from '../src/sim/tales';
import {
  addStarter, isSetup, removeStarter, rerollStarter,
  buyObject, deserialize, editStaff, fire, hire, moveObject, orderBreak, sellObject, sendHomeEarly, serialize, setPrice,
} from '../src/sim/manage';
import { addMemory, expireMemories, moodReasons, moodTarget } from '../src/sim/thoughts';

describe('pathfinding', () => {
  it('routes through the kitchen door and around the counter', () => {
    const sim = new Sim(1);
    const path = findPath(sim.state.w, sim.state.h, sim.world.passable, [7, 23], [2, 2]);
    expect(path).not.toBeNull();
    expect(path!.some(([x, y]) => x === 4 && y === 6)).toBe(true);
  });

  it('returns null for a wall target', () => {
    const sim = new Sim(1);
    expect(findPath(sim.state.w, sim.state.h, sim.world.passable, [7, 23], [0, 0])).toBeNull();
  });
});

describe('simulation', () => {
  it('is deterministic for a given seed', () => {
    const a = new Sim(42);
    const b = new Sim(42);
    a.run(6 * TICKS_PER_HOUR);
    b.run(6 * TICKS_PER_HOUR);
    expect(JSON.stringify(a.state)).toEqual(JSON.stringify(b.state));
  });

  it('brings staff in for their shift and sends them home after', () => {
    const sim = new Sim(7);
    sim.run(4 * TICKS_PER_HOUR); // 06:00 -> 10:00
    expect(sim.state.pawns.filter((p) => p.kind === 'staff' && p.onMap).length).toBe(3);
    sim.run(13 * TICKS_PER_HOUR); // -> 23:00
    expect(sim.isQuiet()).toBe(true);
  });

  it('a desperate pawn goes to the loo', () => {
    const sim = new Sim(3);
    sim.run(2 * TICKS_PER_HOUR); // first staff on site
    const p = sim.state.pawns.find((x) => x.kind === 'staff' && x.onMap)!;
    p.needs.bladder = 0.05;
    let used = false;
    for (let i = 0; i < 30 * TICKS_PER_MINUTE && !used; i++) {
      sim.step();
      used = sim.activity(p) === 'In the loo';
    }
    expect(used).toBe(true);
  });

  it('nobody gets stuck over three days', () => {
    const sim = new Sim(99);
    const lastProgress = new Map<number, { x: number; y: number; label: string; tick: number }>();
    for (let t = 0; t < 3 * 24 * TICKS_PER_HOUR; t++) {
      sim.step();
      if (t % TICKS_PER_MINUTE !== 0) continue;
      for (const p of sim.state.pawns) {
        if (!p.onMap) {
          lastProgress.delete(p.id);
          continue;
        }
        const label = sim.activity(p);
        const prev = lastProgress.get(p.id);
        if (!prev || prev.label !== label || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.5) {
          lastProgress.set(p.id, { x: p.x, y: p.y, label, tick: sim.state.tick });
        } else {
          // Nothing changed for this long means the pawn is wedged.
          expect(sim.state.tick - prev.tick).toBeLessThan(1 * TICKS_PER_HOUR);
        }
        expect(sim.world.passable(Math.round(p.x), Math.round(p.y))).toBe(true);
      }
    }
    // Needs never pin at zero for long: someone's always looking after themselves.
    for (const p of sim.state.pawns) expect(Object.values(p.needs).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('counter service', () => {
  it('serves guests through a whole day and takes money', () => {
    const sim = new Sim(5);
    const start = sim.state.money;
    sim.run(24 * TICKS_PER_HOUR);
    const day = sim.state.yesterday!;
    expect(day.served).toBeGreaterThan(40);
    expect(day.takings).toBeGreaterThan(0);
    expect(day.walkouts).toBeLessThan(day.served);
    // Takings in; wages, ingredients and the next morning's rent and rates out.
    expect(sim.state.money).toBeCloseTo(start + day.takings - day.wages - day.ingredients - day.repairs - sim.state.today.rent, 0);
    expect(day.ingredients).toBeGreaterThan(0);
    // Nothing is left half-done overnight.
    expect(sim.state.orders).toHaveLength(0);
    expect(sim.state.queue).toHaveLength(0);
    expect(sim.state.pawns.every((p) => p.kind === 'staff')).toBe(true);
  });

  it('with nobody on barista, coffee never gets made and people walk out', () => {
    const sim = new Sim(5);
    for (const p of sim.state.pawns) p.staff!.priorities.barista = 0;
    sim.run(24 * TICKS_PER_HOUR);
    expect(sim.state.yesterday!.walkouts).toBeGreaterThan(10);
  });

  it('dirty cups get cleared and washed', () => {
    const sim = new Sim(8);
    sim.run(4 * TICKS_PER_HOUR);
    let cleared = false;
    for (let i = 0; i < 6 * TICKS_PER_HOUR && !cleared; i++) {
      sim.step();
      cleared = sim.state.pawns.some((p) => p.carrying?.kind === 'dishes');
    }
    expect(cleared).toBe(true);
    sim.run(16 * TICKS_PER_HOUR);
    expect(sim.state.sinkDirty).toBeLessThan(10);
  });
});

describe('mood and people', () => {
  it('mood is a ledger of named reasons', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    const p = sim.state.pawns.find((x) => x.staff && x.onMap)!;
    p.needs.hunger = 0.05;
    const reasons = moodReasons(sim, p);
    expect(reasons.some((r) => r.label === 'Starving' && r.value < 0)).toBe(true);
    expect(moodTarget(sim, p)).toBeLessThan(60);
  });

  it('insults sour opinion, and grudges fade when the memories expire', () => {
    const sim = new Sim(5);
    const [a, b] = sim.state.pawns;
    const before = sim.opinion(b, a);
    addMemory(sim, b, 'insulted', a);
    addMemory(sim, b, 'insulted', a);
    expect(sim.opinion(b, a)).toBeLessThan(before - 15);
    sim.state.tick += 13 * TICKS_PER_HOUR;
    expireMemories(sim, b);
    expect(sim.opinion(b, a)).toBe(before);
  });

  it('sustained low mood leads to a break that names the final straw', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    const p = sim.state.pawns.find((x) => x.staff && x.onMap && sim.onShift(x) && x.shift.end > 14 * 60)!;
    for (let i = 0; i < 4; i++) addMemory(sim, p, 'rudeCustomer');
    for (let i = 0; i < 3; i++) addMemory(sim, p, 'row', sim.state.pawns.find((o) => o !== p && o.staff)!);
    p.staff!.mood = 5;
    let broke = false;
    for (let i = 0; i < 8 * TICKS_PER_HOUR && !broke; i++) {
      sim.step();
      p.staff!.mood = Math.min(p.staff!.mood, 5);
      broke = p.staff!.mentalBreak !== null || p.staff!.quit;
    }
    expect(broke).toBe(true);
    expect(sim.state.log.some((e) => e.text.includes('Final straw:'))).toBe(true);
  });

  it('when someone quits they leave the books, and applicants can be hired', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    const p = sim.state.pawns.find((x) => x.staff && x.onMap)!;
    startBreak(sim, p, 'quit');
    sim.run(30 * TICKS_PER_MINUTE);
    expect(sim.pawnById(p.id)).toBeUndefined();
    expect(sim.state.pawns.filter((x) => x.staff)).toHaveLength(3);
    expect(sim.state.applicants.length).toBe(3);
    const hired = hire(sim, 0);
    expect(typeof hired).not.toBe('string');
    expect(sim.state.pawns.filter((x) => x.staff)).toHaveLength(4);
    expect(sim.state.applicants.length).toBe(2);
  });
});

describe('storyteller and recap', () => {
  it('events happen through a week, and every day gets a recap', () => {
    const sim = new Sim(13);
    sim.run(7 * 24 * TICKS_PER_HOUR);
    const tales = new Set(sim.state.log.map((e) => e.tale).filter(Boolean));
    expect(tales.size).toBeGreaterThan(4);
    expect(sim.state.recaps).toHaveLength(7);
    for (const r of sim.state.recaps) {
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.stats.served).toBeGreaterThan(0);
    }
  });

  it('a broken espresso machine stops coffee until someone fixes it', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    fireEvent(sim, 'machineBroken');
    expect(sim.hasCondition('stationBroken')).toBe(true);
    sim.run(90 * TICKS_PER_MINUTE);
    expect(sim.hasCondition('stationBroken')).toBe(false);
    expect(sim.state.log.some((e) => e.tale === 'repair')).toBe(true);
  });

  it('the recap prefers stories it has not told before', () => {
    const sim = new Sim(5);
    sim.log('A row', 'bad', null, 'row', 5);
    sim.log('A busker', 'good', null, 'busker', 3);
    sim.state.story.taleUses.row = 4;
    expect(taleScore(sim, 'row', 5)).toBeLessThan(taleScore(sim, 'busker', 3));
  });

  it("a critic's verdict moves reputation far more than a regular guest's", () => {
    const sim = new Sim(5);
    sim.run(2 * TICKS_PER_HOUR);
    const before = sim.state.reputation;
    sim.state.fame = 100; // critics only bother with places that have a bit of a name
    fireEvent(sim, 'critic');
    const critic = sim.state.pawns.find((p) => p.visit?.critic)!;
    critic.visit!.patience = 0.01;
    sim.run(5 * TICKS_PER_MINUTE);
    expect(sim.state.reputation).toBeLessThan(before - 10);
  });
});

describe('your café', () => {
  it('a saved café carries on exactly as if it had never stopped', () => {
    const a = new Sim(21);
    a.run(30 * TICKS_PER_HOUR + 1234);
    const b = deserialize(serialize(a));
    a.run(5 * TICKS_PER_HOUR);
    b.run(5 * TICKS_PER_HOUR);
    expect(serialize(b)).toEqual(serialize(a));
  });

  it('rejects files that are not saves', () => {
    expect(() => deserialize('not json')).toThrow();
    expect(() => deserialize('{"hello":1}')).toThrow();
  });

  it('furniture can be moved, bought and sold, but never so it blocks service', () => {
    const sim = new Sim(5);
    const table = sim.state.objects.find((o) => o.def === 'table2')!;
    expect(moveObject(sim, table.id, 10, 15)).toBeNull();
    expect(table.x).toBe(10);
    // The queue has to stay clear.
    expect(moveObject(sim, table.id, 9, 10)).not.toBeNull();
    const money = sim.state.money;
    expect(buyObject(sim, 'table2', 3, 15)).toBeNull();
    expect(sim.state.money).toBe(money - 12000);
    const bought = sim.state.objects[sim.state.objects.length - 1];
    expect(sellObject(sim, bought.id)).toBeNull();
    expect(sim.state.money).toBe(money - 6000);
    // Walling off the till with plants is refused.
    const results = [10, 11, 12, 13, 14].map((x) => buyObject(sim, 'plant', x, 9));
    expect(results).toContain('That would block the counter.');
    const espresso = sim.state.objects.find((o) => o.def === 'espresso')!;
    expect(sellObject(sim, espresso.id)).not.toBeNull();
  });

  it('a second sink near the floor gets used for dropping cups', () => {
    const sim = new Sim(8);
    expect(buyObject(sim, 'sink', 13, 7)).toBeNull();
    sim.run(24 * TICKS_PER_HOUR);
    expect(sim.state.yesterday!.served).toBeGreaterThan(40);
  });

  it('putting prices up brings fewer customers', () => {
    const cheap = new Sim(5);
    const dear = new Sim(5);
    for (const m of dear.state.menu) setPrice(dear, m.name, m.basePrice * 2);
    cheap.run(24 * TICKS_PER_HOUR);
    dear.run(24 * TICKS_PER_HOUR);
    const visits = (s: Sim) => s.state.yesterday!.served + s.state.yesterday!.walkouts;
    expect(visits(dear)).toBeLessThan(visits(cheap) * 0.75);
  });

  it('manager orders: take a break, go home early, and firing', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    const [a, b, c] = sim.state.pawns.filter((x) => x.staff && x.onMap);
    expect(orderBreak(sim, a)).toBeNull();
    sim.run(10);
    expect(['Feet up on the sofa', 'Eating lunch', 'Going to put feet up', 'Going to eat lunch']).toContain(sim.activity(a));
    expect(sendHomeEarly(sim, b)).toBeNull();
    sim.run(2 * TICKS_PER_MINUTE);
    expect(sim.activity(b)).toBe('Heading home');
    expect(fire(sim, c)).toBeNull();
    sim.run(30 * TICKS_PER_MINUTE);
    expect(sim.pawnById(c.id)).toBeUndefined();
  });

  it('staff can be renamed and re-traited, within the rules', () => {
    const sim = new Sim(5);
    const p = sim.state.pawns[0];
    expect(editStaff(p, { name: '  Big Dave  ', traits: ['calm', 'coffeeSnob'] })).toBeNull();
    expect(p.name).toBe('Big Dave');
    expect(editStaff(p, { traits: ['calm', 'hotHeaded'] })).not.toBeNull();
    expect(editStaff(p, { name: '   ' })).not.toBeNull();
  });
});

describe('regulars and depth', () => {
  it('happy guests become regulars who come back for their usual', () => {
    const sim = new Sim(13);
    sim.run(10 * 24 * TICKS_PER_HOUR);
    expect(sim.state.regulars.length).toBeGreaterThan(3);
    expect(sim.state.regulars.some((r) => r.visits >= 2)).toBe(true);
    const names = sim.state.regulars.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a regular kept waiting holds a grudge against whoever served them', () => {
    const sim = new Sim(13);
    sim.run(3 * TICKS_PER_HOUR);
    const server = sim.state.pawns.find((p) => p.staff && p.onMap)!;
    const g = spawnGuest(sim);
    sim.state.regulars.push({
      id: 999, name: 'Margaret', look: g.look, usual: 'latte', eatIn: true, visits: 5,
      lastVisitDay: 1, nextVisitDay: 1, likes: {}, grudge: null,
    });
    g.visit!.regularId = 999;
    regularWronged(sim, g, server, 'being kept waiting');
    const r = sim.state.regulars.find((x) => x.id === 999)!;
    expect(r.grudge?.staffName).toBe(server.name);
    expect(r.likes[server.id]).toBeLessThan(0);
  });

  it('wants can be met by the manager, and it lifts their mood', () => {
    const sim = new Sim(5);
    const p = sim.state.pawns[0];
    p.staff!.wants = [{ def: 'loveWork', since: sim.state.tick, param: 'dishes', target: 0, label: 'Put me first on dishes' }];
    p.staff!.priorities.dishes = 1;
    checkWants(sim);
    expect(p.staff!.wants.some((w) => w.def === 'loveWork' && w.param === 'dishes')).toBe(false);
    expect(p.staff!.memories.some((m) => m.def === 'gotWant')).toBe(true);
  });

  it('spills get mopped up by whoever is on cleaning', () => {
    const sim = new Sim(5);
    sim.run(3 * TICKS_PER_HOUR);
    spillAt(sim, 10, 15);
    expect(sim.state.spills).toHaveLength(1);
    for (const p of sim.state.pawns) if (p.staff) p.staff.priorities.cleaning = 1;
    sim.run(30 * TICKS_PER_MINUTE);
    expect(sim.state.spills.some((sp) => sp.x === 10 && sp.y === 15)).toBe(false);
  });

  it('older saves are upgraded when loaded', () => {
    const sim = new Sim(5);
    sim.run(2 * TICKS_PER_HOUR);
    const old = JSON.parse(serialize(sim));
    old.version = 1;
    delete old.venue;
    for (const m of old.menu) m.kind = m.kind === 'drink' ? 'coffee' : 'cake';
    delete old.regulars;
    delete old.spills;
    delete old.hallOfFame;
    for (const p of old.pawns) {
      if (p.staff) {
        delete p.staff.priorities.cleaning;
        delete p.staff.skills.cleaning;
        delete p.staff.wants;
      }
    }
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.venue).toBe('cafe');
    expect(loaded.state.menu.every((m) => m.kind === 'drink' || m.kind === 'food')).toBe(true);
    expect(loaded.state.regulars).toEqual([]);
    expect(loaded.state.pawns.find((p) => p.staff)!.staff!.priorities.cleaning).toBe(3);
    loaded.run(TICKS_PER_HOUR);
  });
});

describe('venues', () => {
  it('the pub opens in the evening, pours pints and serves its crowd', () => {
    const sim = new Sim(5, undefined, 'pub');
    expect(sim.venue.id).toBe('pub');
    sim.run(6 * TICKS_PER_HOUR); // 06:00 -> 12:00: nobody about yet but the lunch shift
    expect(sim.isOpen()).toBe(true);
    sim.run(18 * TICKS_PER_HOUR);
    const day = sim.state.yesterday!;
    expect(day.served).toBeGreaterThan(40);
    expect(sim.state.menu.some((m) => m.name === 'pint of lager')).toBe(true);
    expect(sim.state.objects.some((o) => o.def === 'taps')).toBe(true);
    expect(sim.state.recaps).toHaveLength(1);
  });

  it('pub events speak pub', () => {
    const sim = new Sim(5, undefined, 'pub');
    sim.run(7 * TICKS_PER_HOUR);
    fireEvent(sim, 'machineBroken');
    expect(sim.state.log.at(-1)!.text).toContain('barrel');
    sim.run(90 * TICKS_PER_MINUTE);
    expect(sim.hasCondition('stationBroken')).toBe(false);
  });

  it('a pub save round-trips and stays a pub', () => {
    const a = new Sim(9, undefined, 'pub');
    a.run(20 * TICKS_PER_HOUR);
    const b = deserialize(serialize(a));
    expect(b.venue.id).toBe('pub');
    a.run(3 * TICKS_PER_HOUR);
    b.run(3 * TICKS_PER_HOUR);
    expect(serialize(b)).toEqual(serialize(a));
  });
});

describe('starting team', () => {
  it('can be reshaped before opening, and is locked once the first person arrives', () => {
    const sim = new Sim(21);
    const staff = () => sim.state.pawns.filter((p) => p.staff);
    expect(isSetup(sim)).toBe(true);
    const start = staff().length;

    const added = addStarter(sim);
    expect(typeof added).not.toBe('string');
    expect(staff()).toHaveLength(start + 1);

    const p = staff()[0];
    const others = new Set(staff().filter((x) => x.id !== p.id).map((x) => x.name));
    for (let i = 0; i < 10; i++) {
      rerollStarter(sim, p);
      expect(others.has(p.name)).toBe(false);
      expect(p.staff!.traits.length).toBeGreaterThan(0);
    }

    expect(removeStarter(sim, p)).toBeNull();
    expect(sim.pawnById(p.id)).toBeUndefined();
    while (staff().length > 1) removeStarter(sim, staff()[0]);
    expect(removeStarter(sim, staff()[0])).toMatch(/open up/);

    sim.run(10 * TICKS_PER_HOUR);
    expect(isSetup(sim)).toBe(false);
    expect(typeof addStarter(sim)).toBe('string');
  });
});
