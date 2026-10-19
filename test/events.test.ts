import { describe, expect, it } from 'vitest';
import { answer } from '../src/sim/chat';
import { POUND, flatInfo, goingRate } from '../src/sim/economy';
import { CAP, FIRST_DAY, endParty, found, maybeFight, running, startAffair, startFight, startParty } from '../src/sim/events';
import { burglaryRisk, startBurglary, waysIn } from '../src/sim/crime';
import { scoreFor } from '../src/sim/impressiveness';
import { landlordRating, makePerson, moveOut } from '../src/sim/leases';
import { applyForPlanning, needsPlanning } from '../src/sim/planning';
import { Sim } from '../src/sim/sim';
import { opinion } from '../src/sim/social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Pawn } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { bookInspection, breakIt, mend, useUp } from '../src/sim/upkeep';
import { landlord } from './policy';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

/** Sets the clock to a time on a day (day 1 is a Monday). */
function at(sim: Sim, day: number, hour: number): void {
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

/** Puts someone in an empty flat. */
function newTenant(sim: Sim, flat: number): Pawn {
  const f = sim.layout.flats[flat];
  flatInfo(sim, f.id).lease = { rent: 80 * POUND, startDay: 1, endDay: 60, deposit: 0, owed: 0, paid: 0, late: 0 };
  return moveIn(sim, f.id, [makePerson(sim.state, undefined, false)])[0];
}

describe('the storyteller', () => {
  it('keeps the first week quiet, and never has more than a couple of things going at once', () => {
    const sim = Sim.create(7);
    let most = 0;
    for (let h = 0; h < 45 * 24; h++) {
      sim.run(TICKS_PER_HOUR);
      landlord(sim, 'decent');
      if (sim.day < FIRST_DAY) expect(sim.state.story.running, `day ${sim.day}`).toEqual([]);
      most = Math.max(most, sim.state.story.running.length);
    }
    expect(most).toBeLessThanOrEqual(CAP);
    // It does deal things out, though.
    expect(Object.keys(sim.state.story.cooldowns).length).toBeGreaterThan(0);
  }, 120_000);
});

describe('parties', () => {
  it('bring guests in the evening, noise late on, and a mess after', () => {
    const sim = Sim.create(2);
    at(sim, 12, 19);
    const flat = sim.layout.flats[0].id;
    const h = startParty(sim, flat)!;
    expect(h).toBeTruthy();
    sim.run(4 * TICKS_PER_HOUR);
    const guests = sim.state.pawns.filter((p) => p.kind === 'guest');
    expect(guests.length).toBeGreaterThan(1);
    const inside = guests.filter((g) => sim.layout.flatAt(Math.round(g.x), Math.round(g.s))?.id === flat);
    expect(inside.length).toBeGreaterThan(0);
    expect(sim.noise().get(flat) ?? 0).toBeGreaterThan(3);
    sim.run(h.until - sim.state.tick + 2 * TICKS_PER_HOUR);
    expect(running(sim, 'party')).toBeUndefined();
    expect(sim.state.pawns.some((p) => p.kind === 'guest')).toBe(false);
    expect(sim.state.dirt[flat]).toBeGreaterThan(0.3);
  });

  it('can be shut down early, and the host remembers', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const flat = sim.layout.flats[0].id;
    const h = startParty(sim, flat)!;
    sim.run(2 * TICKS_PER_HOUR);
    endParty(sim, h, true);
    const host = tenants(sim).find((p) => p.life!.flat === flat)!;
    expect(host.life!.memories.some((m) => m.id === 'partyShutDown')).toBe(true);
    sim.run(TICKS_PER_HOUR);
    expect(sim.state.pawns.some((p) => p.kind === 'guest')).toBe(false);
  });
});

describe('fights and affairs', () => {
  it('a row only turns into a fight between people who already can\'t stand each other', () => {
    const sim = Sim.create(1);
    at(sim, 12, 12);
    const [a, b] = tenants(sim);
    for (let i = 0; i < 30; i++) expect(maybeFight(sim, a, b)).toBe(false);
    startFight(sim, a, b);
    expect(opinion(sim, a, b)).toBeLessThanOrEqual(-30);
    expect(running(sim, 'fight')).toBeDefined();
    sim.run(30 * TICKS_PER_MINUTE);
    expect(running(sim, 'fight')).toBeUndefined();
  });

  it('an affair, found out, ends a couple', () => {
    const sim = Sim.create(1);
    at(sim, 12, 12);
    const [a, b] = tenants(sim);
    const c = newTenant(sim, 1);
    a.life!.partner = c.id;
    c.life!.partner = a.id;
    expect(startAffair(sim, a, b)).toBe(true);
    expect(a.life!.affair).toBe(b.id);
    found(sim, running(sim, 'affair')!, c);
    expect(c.life!.partner).toBeUndefined();
    expect(c.life!.exes).toContain(a.id);
    expect(opinion(sim, c, a)).toBeLessThan(-20);
    expect(a.life!.affair).toBeUndefined();
    expect(running(sim, 'affair')).toBeUndefined();
  });
});

describe('burglars', () => {
  it('come in by the street door or a low window, and locks and an alarm lower the risk', () => {
    const sim = Sim.create(1);
    expect(waysIn(sim).some((w) => w.entry === 'door')).toBe(true);
    const bare = burglaryRisk(sim);
    sim.state.security.locks = true;
    const locked = burglaryRisk(sim);
    sim.state.security.alarm = true;
    expect(locked).toBeLessThan(bare);
    expect(burglaryRisk(sim)).toBeLessThan(locked);
  });

  it('sometimes get away with something; with an alarm they never do', () => {
    let took = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const alarm of [false, true]) {
        const sim = Sim.create(seed);
        at(sim, 10, 2);
        sim.state.security.alarm = alarm;
        const before = sim.state.furniture.length;
        expect(startBurglary(sim)).toBe(true);
        sim.run(3 * TICKS_PER_HOUR);
        expect(sim.state.pawns.some((p) => p.kind === 'burglar'), `seed ${seed}`).toBe(false);
        if (alarm) expect(sim.state.furniture.length).toBe(before);
        else if (sim.state.notices.some((n) => /burgled|broke into/.test(n.text))) took++;
      }
    }
    expect(took).toBeGreaterThan(0);
  });
});

describe('wear and repairs', () => {
  it('things wear out and break; broken ones don\'t count, and mending puts them right', () => {
    const sim = Sim.create(1);
    const flat = sim.layout.flats[0];
    const cells = new Set(sim.layout.flatCells(flat));
    const loo = sim.state.furniture.find((f) => f.def === 'toilet' && cells.has(sim.layout.node(f.x, f.s)))!;
    const [p] = tenants(sim);
    loo.wear = 0.999;
    useUp(sim, loo, p);
    expect(loo.broken).toBeDefined();
    expect(scoreFor(sim, flat.id, 1).has.toilet).toBe(false);
    const money = sim.state.money;
    expect(mend(sim, loo.id)).toBeNull();
    expect(loo.broken).toBeUndefined();
    expect(sim.state.money).toBeLessThan(money);
    expect(scoreFor(sim, flat.id, 1).has.toilet).toBe(true);
  });

  it('tenants ask for broken things to be mended, and you can say yes in the chat', () => {
    const sim = Sim.create(1);
    at(sim, 10, 17);
    const flat = sim.layout.flats[0];
    const cells = new Set(sim.layout.flatCells(flat));
    const shower = sim.state.furniture.find((f) => f.def === 'shower' && cells.has(sim.layout.node(f.x, f.s)))!;
    for (const p of tenants(sim)) p.life!.traits = p.life!.traits.filter((t) => t !== 'handy');
    breakIt(sim, shower);
    let ask;
    for (let h = 0; h < 48 && !ask; h++) {
      sim.run(TICKS_PER_HOUR);
      ask = sim.state.chat.find((m) => m.choices?.some((c) => c.act === `mend:${shower.id}`));
    }
    expect(ask).toBeDefined();
    answer(sim, ask!.id, 0);
    expect(shower.broken).toBeUndefined();
  });
});

describe('the council', () => {
  it('inspects what is really wrong, gives notice, and fines you if it is not put right', () => {
    const sim = Sim.create(1);
    const flat = sim.layout.flats[0];
    const cells = new Set(sim.layout.flatCells(flat));
    for (const p of tenants(sim)) p.life!.traits = p.life!.traits.filter((t) => t !== 'handy');
    for (const f of sim.state.furniture) if (f.def === 'toilet' && cells.has(sim.layout.node(f.x, f.s))) breakIt(sim, f);
    bookInspection(sim, 1, 'Because');
    sim.run(2 * TICKS_PER_DAY);
    const notice = sim.state.post.find((l) => l.title === 'Improvement notice');
    expect(notice?.body).toMatch(/Flat 1 has no working toilet/);
    sim.run(15 * TICKS_PER_DAY);
    expect(sim.state.post.some((l) => l.title === 'Improvement notice not met')).toBe(true);
    expect(sim.state.ledger.some((e) => e.label.startsWith('Council fine'))).toBe(true);
  });

  it('finds nothing in a building that is fine', () => {
    const sim = Sim.create(1);
    sim.state.boiler = 2;
    bookInspection(sim, 1, 'Because');
    sim.run(2 * TICKS_PER_DAY);
    expect(sim.state.post.some((l) => l.title === 'Inspection result')).toBe(true);
  });
});

describe('listings and reviews', () => {
  it('estate agent speak draws more applicants than brutal honesty', () => {
    const count = (style: 'agent' | 'honest') => {
      let n = 0;
      for (const seed of [1, 2, 3, 4]) {
        const sim = Sim.create(seed);
        for (const f of sim.layout.flats) {
          const info = flatInfo(sim, f.id);
          if (info.lease) continue;
          info.style = style;
          info.asking = goingRate(sim, f.id);
        }
        for (let d = 0; d < 4; d++) {
          sim.run(TICKS_PER_DAY);
          n += sim.state.applicants.length;
        }
      }
      return n;
    };
    expect(count('agent')).toBeGreaterThan(count('honest'));
  });

  it('tenants leave a review that matches how they felt, and it sets your rating', () => {
    const sim = Sim.create(1);
    expect(landlordRating(sim)).toBeNull();
    const flat = sim.layout.flats[0].id;
    for (const p of tenants(sim)) if (p.life!.flat === flat) p.life!.liking = 95;
    moveOut(sim, flat);
    expect(sim.state.reviews).toHaveLength(1);
    expect(sim.state.reviews[0].stars).toBe(5);
    expect(landlordRating(sim)).toBe(5);
  });
});

describe('planning permission', () => {
  it('is needed above the roof, costs a fee, and the council decides in a few days', () => {
    const sim = Sim.create(1);
    const top = sim.state.planning.top;
    expect(needsPlanning(sim, sim.state.cells)).toBe(false);
    expect(needsPlanning(sim, { ...sim.state.cells, [`${sim.state.plot.x0 + 5},${top + 1}`]: 'wall' })).toBe(true);
    const money = sim.state.money;
    expect(applyForPlanning(sim, top + 4)).toBeNull();
    expect(sim.state.money).toBe(money - 250 * POUND);
    expect(applyForPlanning(sim, top + 4)).toMatch(/Waiting/);
    sim.run(4 * TICKS_PER_DAY);
    const decision = sim.state.post.find((l) => l.title.startsWith('Planning permission'));
    expect(decision).toBeDefined();
    expect(sim.state.planning.top).toBe(decision!.title.endsWith('granted') ? top + 4 : top);
    expect(sim.state.planning.applied).toBeUndefined();
  });
});

