import { describe, expect, it } from 'vitest';
import { placeFurniture } from '../src/sim/build';
import { POUND, book, flatInfo } from '../src/sim/economy';
import { points, startFight, startParty, struggling, threat } from '../src/sim/events';
import { startBurglary } from '../src/sim/crime';
import { makePerson, moveOut } from '../src/sim/leases';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { INTEREST, MAX_TALES, recap, tale, talesOf } from '../src/sim/tales';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Pawn } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

/** Sets the clock to a time on a day (day 1 is a Monday). */
function at(sim: Sim, day: number, hour: number): void {
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

/** Puts someone in an empty flat. */
function newTenant(sim: Sim, flat: number, rent = 80 * POUND): Pawn {
  const f = sim.layout.flats[flat];
  flatInfo(sim, f.id).lease = { rent, startDay: 1, endDay: 60, deposit: 0, owed: 0, paid: 0, late: 0 };
  return moveIn(sim, f.id, [makePerson(sim.state, undefined, false)])[0];
}

/** Every flat let at a good rent, everyone happy and money in the bank. */
function fill(sim: Sim): void {
  sim.layout.flats.forEach((f, i) => {
    if (!flatInfo(sim, f.id).lease) newTenant(sim, i);
    flatInfo(sim, f.id).lease!.rent = 260 * POUND;
  });
  for (const p of tenants(sim)) p.life!.liking = 70;
  sim.state.money = 3000 * POUND;
}

describe('tales', () => {
  it('are written down when things happen, with the names at the time', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const [a, b] = tenants(sim);
    startFight(sim, a, b);
    const flat = sim.layout.flats[0].id;
    startParty(sim, flat);
    const kinds = sim.state.chronicle.tales.map((t) => t.kind);
    expect(kinds).toContain('fight');
    expect(kinds).toContain('party');
    const fight = sim.state.chronicle.tales.find((t) => t.kind === 'fight')!;
    expect(fight.pawns.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(fight.text).toContain(a.name.split(' ')[0]);
    expect(fight.interest).toBe(INTEREST.fight);
    // An affair is better gossip than a fight, which is better than a broken shower.
    expect(INTEREST.affair).toBeGreaterThan(INTEREST.fight);
    expect(INTEREST.fight).toBeGreaterThan(INTEREST.burglary);
    expect(INTEREST.burglary).toBeGreaterThan(INTEREST.partyShutDown);
    expect(INTEREST.partyShutDown).toBeGreaterThan(INTEREST.moveOut);
    expect(INTEREST.moveOut).toBeGreaterThan(INTEREST.broken);
    // Each person's history has their own tales.
    expect(talesOf(sim, a.id).some((t) => t.kind === 'fight')).toBe(true);
    // Moving out says how many stars they left.
    moveOut(sim, a.life!.flat);
    const out = sim.state.chronicle.tales.find((t) => t.kind === 'moveOut')!;
    expect(out.stars).toBeGreaterThanOrEqual(1);
    expect(out.text).toMatch(/star review/);
  });

  it('keep only the most recent ones, and survive saving', () => {
    const sim = Sim.create(2);
    for (let i = 0; i < MAX_TALES + 30; i++) tale(sim, 'broken', [], { what: 'kettle' });
    expect(sim.state.chronicle.tales.length).toBe(MAX_TALES);
    const back = deserialize(serialize(sim));
    expect(back.state.chronicle.tales.length).toBe(MAX_TALES);
    // An old save without any gets an empty list.
    const old = JSON.parse(serialize(sim));
    delete old.chronicle;
    expect(deserialize(JSON.stringify(old)).state.chronicle.tales).toEqual([]);
  });

  it('get less interesting each time they are told', () => {
    const sim = Sim.create(3);
    at(sim, 13, 12);
    const [a, b] = tenants(sim);
    startFight(sim, a, b);
    const t = sim.state.chronicle.tales.find((x) => x.kind === 'fight')!;
    at(sim, 14, 20);
    recap(sim);
    expect(t.interest).toBeLessThan(INTEREST.fight);
    expect(t.told).toBe(1);
    const once = t.interest;
    at(sim, 21, 20);
    recap(sim);
    expect(t.interest).toBeLessThan(once);
    expect(sim.state.post.at(-1)!.body).toContain('Still going on about');
  });
});

describe('the weekly recap', () => {
  it('arrives in the post on Sunday evening with the week\'s best tales and the money', () => {
    const sim = Sim.create(4);
    at(sim, 10, 12);
    const [a, b] = tenants(sim);
    startFight(sim, a, b);
    tale(sim, 'broken', [], { what: 'kettle' });
    book(sim, 'Rent · test', 500 * POUND);
    at(sim, 14, 19);
    sim.run(TICKS_PER_HOUR);
    const l = sim.state.post.find((x) => x.title === 'Week 2 at Albert Terrace');
    expect(l).toBeTruthy();
    expect(l!.body).toContain(a.name.split(' ')[0]);
    expect(l!.body).toMatch(/In: £[\d,]+/);
    // The broken kettle isn't news.
    expect(l!.body).not.toContain('kettle');
  });

  it('says who moved in and out', () => {
    const sim = Sim.create(5);
    at(sim, 15, 10);
    const empty = sim.layout.flats.findIndex((f) => !flatInfo(sim, f.id).lease);
    const p = newTenant(sim, empty);
    tale(sim, 'moveIn', [p], { flat: p.life!.flat });
    at(sim, 21, 20);
    recap(sim);
    expect(sim.state.post.at(-1)!.body).toContain(`Moved in: ${p.name.split(' ')[0]}`);
  });
});

describe('the storyteller\'s budget', () => {
  it('grows with a fuller, dearer building, and makes things bigger', () => {
    const sim = Sim.create(6);
    sim.state.money = 3000 * POUND;
    for (const p of tenants(sim)) p.life!.liking = 70;
    const before = points(sim);
    const t0 = threat(sim);
    fill(sim);
    expect(points(sim)).toBeGreaterThan(before);
    const t1 = threat(sim);
    expect(t1).toBeGreaterThan(t0);
    expect(t1).toBeLessThanOrEqual(2);
    // Bigger parties.
    at(sim, 12, 19);
    const h = startParty(sim, sim.layout.flats[0].id)!;
    expect(h.queue!).toBeGreaterThanOrEqual(3 + Math.round((t1 - 1) * 5));
    expect(h.queue!).toBeGreaterThan(6);
    // Greedier burglars.
    at(sim, 13, 2);
    sim.state.story.running = [];
    expect(startBurglary(sim)).toBe(true);
    const burglar = sim.state.pawns.find((p) => p.kind === 'burglar')!;
    expect(burglar.burgle!.take).toBe(2);
  });

  it('makes burglars greedy enough to try a second flat', () => {
    const sim = Sim.create(2);
    fill(sim);
    // A telly (or a desk) in every flat.
    for (const f of sim.layout.flats) {
      for (const n of sim.layout.flatCells(f)) {
        const [x, s] = sim.layout.xs(n);
        if (['tv', 'desk'].some((d) => typeof placeFurniture(sim.state, d, x, s) !== 'string')) break;
      }
    }
    sim.changed();
    at(sim, 13, 2);
    expect(threat(sim)).toBe(2);
    expect(startBurglary(sim)).toBe(true);
    sim.run(3 * TICKS_PER_HOUR);
    const hit = sim.state.chronicle.tales.filter((t) => t.kind === 'burglary');
    expect(hit.length).toBe(2);
    expect(hit[0].flat).not.toBe(hit[1].flat);
  });

  it('goes back to normal when you\'re struggling', () => {
    const sim = Sim.create(7);
    fill(sim);
    expect(threat(sim)).toBeGreaterThan(1);
    sim.state.money = 0;
    expect(struggling(sim)).toBe(true);
    expect(threat(sim)).toBe(1);
  });
});
