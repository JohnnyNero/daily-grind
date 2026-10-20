// Carving it up (docs/specs/layout.md, part 1): rooms take a purpose from what's in them,
// a flat's size sets its going rate, households want the right size, and squeezing more
// bedrooms into the same space earns more and costs in how much people like living there.

import { describe, expect, it } from 'vitest';
import v9 from './fixtures/v9-save.json?raw';
import { placeFurniture } from '../src/sim/build';
import { flatInfo, goingRate, rateFor } from '../src/sim/economy';
import { rentScore } from '../src/sim/impressiveness';
import { makePerson, newApplicant } from '../src/sim/leases';
import { changeFacts } from '../src/sim/preview';
import { flatKind, householdsFor } from '../src/sim/rooms';
import { deserialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR, key, type State } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { thoughtsOf } from '../src/sim/thoughts';
import { landlord } from './policy';

/**
 * Fits out the right-hand flat on a storey (the bare first-floor one or the stripped top
 * one) as a one-bed with a living room, or carved: a wall across the big room, so it's a
 * kitchen and a second bedroom instead.
 */
function fit(st: State, storey: number, carve: boolean): void {
  const at = (dx: number) => st.plot.x0 + dx;
  const row = 1 + storey * 4;
  const put = (def: string, dx: number, r = 0) => {
    const f = placeFurniture(st, def, at(dx), row + r);
    if (typeof f === 'string') throw new Error(`${def}: ${f}`);
  };
  if (carve) {
    st.cells[key(at(16), row)] = 'door';
    delete st.cells[key(at(16), row + 1)];
    st.cells[key(at(16), row + 2)] = 'wall';
    put('cooker', 14);
    put('fridge', 15);
    put('bed', 17);
  } else {
    put('cooker', 14);
    put('sofa', 15);
    put('tv', 18);
  }
  put('doubleBed', 21);
  put('toilet', 25);
  put('shower', 26);
  if (storey === 2) {
    put('radiator', 19, 1);
    put('radiator', 23, 1);
  }
  put('smokeAlarm', carve ? 14 : 16, 2);
}

function fitted(seed: number, carve: boolean): { sim: Sim; ids: string[] } {
  const sim = Sim.create(seed);
  fit(sim.state, 1, carve);
  fit(sim.state, 2, carve);
  sim.changed();
  return { sim, ids: [sim.layout.flats[2].id, sim.layout.flats[4].id] };
}

describe('rooms and flats', () => {
  it('rooms take their purpose from what is in them, and the flat its size from its bedrooms', () => {
    const sim = Sim.create(1);
    const [groundOneBed, studio, bare] = sim.layout.flats.map((f) => flatKind(sim, f.id));
    expect(groundOneBed.type).toBe('oneBed');
    expect(groundOneBed.rooms.map((r) => r.name)).toEqual(['Kitchen and living room', 'Bedroom', 'Bathroom']);
    expect(groundOneBed.sleeps).toBe(2);
    // The studio's bed is in the room with the cooker and the loo: a bedsit, not a bedroom.
    expect(studio.type).toBe('studio');
    expect(studio.rooms.map((r) => r.name)).toEqual(['Bedsit']);
    expect(bare.type).toBe('bare');
    expect(bare.name).toBe('Unfurnished');
  });

  it('a wall across the living room makes a two-bed, and a bed in a room too small is a box room', () => {
    const { sim, ids } = fitted(1, true);
    const kind = flatKind(sim, ids[0]);
    expect(kind.type).toBe('twoBed');
    expect(kind.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Bedroom', 'Bedroom', 'Bathroom']);
    expect(kind.sitting).toBe(false);
    // Move the carving wall along one: the new bedroom is two tiles, a box room.
    const st = sim.state;
    const row = 5;
    for (const dx of [16, 17]) for (const r of [0, 1, 2]) delete st.cells[key(st.plot.x0 + dx, row + r)];
    st.furniture = st.furniture.filter((f) => !(f.def === 'bed' && f.s === row));
    st.cells[key(st.plot.x0 + 17, row)] = 'door';
    st.cells[key(st.plot.x0 + 17, row + 2)] = 'wall';
    expect(typeof placeFurniture(st, 'bed', st.plot.x0 + 18, row)).not.toBe('string');
    sim.changed();
    const boxed = flatKind(sim, ids[0]);
    expect(boxed.rooms.map((r) => r.name)).toContain('Box room');
    expect(boxed.type).toBe('oneBed');
    expect(boxed.sleeps).toBe(3);
  });
});

describe('the building preview', () => {
  it('says what a wall would do, in at most three facts, and changes nothing', () => {
    const { sim } = fitted(7, false);
    const st = sim.state;
    const row = 5;
    // A wall across the living room, and the sofa swapped for a bed behind it.
    const cells = { ...st.cells, [key(st.plot.x0 + 16, row)]: 'door' as const, [key(st.plot.x0 + 16, row + 2)]: 'wall' as const };
    delete cells[key(st.plot.x0 + 16, row + 1)];
    const before = JSON.stringify(st);
    const furniture = [...st.furniture.filter((f) => !(f.s === row && ['sofa', 'tv'].includes(f.def))), { id: -1, def: 'bed', x: st.plot.x0 + 17, s: row }];
    const facts = changeFacts(sim, {}, { cells, furniture });
    expect(facts.length).toBeLessThanOrEqual(3);
    expect(facts[0].text).toMatch(/^Going rates \+£\d+ a week$/);
    expect(facts.map((f) => f.text)).toContain('Flat 3: one-bed → two-bed');
    expect(JSON.stringify(st)).toBe(before);
  });
});

describe('the going rate', () => {
  it('comes from the size and how good it is: more bedrooms fetch more at the same tier', () => {
    for (const tier of ['Grim', 'Plain', 'Nice', 'Impressive']) {
      expect(rateFor('oneBed', tier)).toBeGreaterThan(rateFor('studio', tier));
      expect(rateFor('twoBed', tier)).toBeGreaterThan(rateFor('oneBed', tier));
      expect(rateFor('threeBed', tier)).toBeGreaterThan(rateFor('twoBed', tier));
    }
    expect(rateFor('studio', 'Nice')).toBeGreaterThan(rateFor('studio', 'Plain'));
  });

  it('the same space carved into two bedrooms is worth more a week than the one-bed with a living room', () => {
    const keep = fitted(2, false);
    const carve = fitted(2, true);
    for (const s of [keep.sim, carve.sim]) s.run(TICKS_PER_HOUR);
    expect(goingRate(carve.sim, carve.ids[0])).toBeGreaterThan(goingRate(keep.sim, keep.ids[0]));
    // ...though it isn't a better flat.
    expect(rentScore(carve.sim, carve.ids[0]).score).toBeLessThanOrEqual(rentScore(keep.sim, keep.ids[0]).score);
  });

  it('is a property of the flat: squeezing more people in doesn\'t change it', () => {
    const { sim, ids } = fitted(3, false);
    sim.run(TICKS_PER_HOUR);
    const before = goingRate(sim, ids[0]);
    moveIn(sim, ids[0], [makePerson(sim.state), makePerson(sim.state), makePerson(sim.state)]);
    sim.run(4 * 24 * TICKS_PER_HOUR);
    expect(flatInfo(sim, ids[0]).tier).toBe(rentScore(sim, ids[0]).tier);
    expect(goingRate(sim, ids[0])).toBe(before);
  });
});

describe('households', () => {
  it('a studio with a single bed draws people on their own; a two-bed draws sharers and families, never more than it sleeps', () => {
    const { sim, ids } = fitted(4, true);
    const studio = sim.layout.flats[1].id;
    for (let i = 0; i < 40; i++) {
      const a = newApplicant(sim, studio);
      expect(a.household).toBe('single');
      expect(a.people).toHaveLength(1);
    }
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const a = newApplicant(sim, ids[0]);
      kinds.add(a.household);
      expect(a.people.length).toBeLessThanOrEqual(flatKind(sim, ids[0]).sleeps);
      if (a.household === 'sharers') expect(a.people.length).toBeLessThanOrEqual(flatKind(sim, ids[0]).bedrooms);
    }
    expect(kinds.has('sharers')).toBe(true);
    expect(kinds.has('family')).toBe(true);
  });

  it('only offers a couple where there is a double bed', () => {
    const { sim, ids } = fitted(5, false);
    const options = householdsFor(flatKind(sim, ids[0]), false).map((o) => o.kind);
    expect(options).toEqual(['single', 'couple']);
    expect(householdsFor(flatKind(sim, sim.layout.flats[1].id), false).map((o) => o.kind)).toEqual(['single']);
  });

  it('households move in as what they are; sharers short of a bedroom say so', () => {
    const { sim, ids } = fitted(6, false);
    const [a, b] = moveIn(sim, ids[0], [makePerson(sim.state), makePerson(sim.state)], [], 'couple');
    expect(a.life!.household).toBe('couple');
    expect(b.life!.household).toBe('couple');
    const sharers = moveIn(sim, ids[1], [makePerson(sim.state), makePerson(sim.state)], [], 'sharers');
    expect(thoughtsOf(sim, sharers[0]).map((t) => t.label)).toContain('Not enough bedrooms');
    expect(thoughtsOf(sim, a).map((t) => t.label)).not.toContain('Not enough bedrooms');
  });

  it('an old save gets households from who lives with whom', () => {
    const sim = deserialize(v9);
    const tenants = sim.state.pawns.filter((p) => p.life);
    expect(tenants.length).toBeGreaterThan(0);
    for (const p of tenants) expect(['single', 'couple', 'sharers', 'family']).toContain(p.life!.household);
  });
});

describe('carving it up, over six weeks', () => {
  it('the carved flats bring in more rent, and the people in them like it less', () => {
    const totals = { keep: { rent: 0, liking: 0, n: 0 }, carve: { rent: 0, liking: 0, n: 0 } };
    for (const seed of [1, 2, 3]) {
      for (const carve of [false, true]) {
        const t = totals[carve ? 'carve' : 'keep'];
        const { sim, ids } = fitted(seed, carve);
        const names = ids.map((id) => sim.layout.flat(id)!.name);
        for (let h = 0; h < 42 * 24; h++) {
          const from = sim.state.tick;
          sim.run(TICKS_PER_HOUR);
          landlord(sim, 'decent');
          for (const e of sim.state.ledger) if (e.tick > from && names.some((n) => e.label === `Rent · ${n}`)) t.rent += e.amount;
          // Once a day, how the people in those two flats feel.
          if (h % 24 === 12) {
            for (const p of sim.state.pawns) {
              if (!p.life || p.life.leaving || !ids.includes(p.life.flat)) continue;
              t.liking += p.life.liking;
              t.n++;
            }
          }
        }
        expect(sim.state.repossessed, `seed ${seed}`).toBeUndefined();
      }
    }
    const keepLiking = totals.keep.liking / totals.keep.n;
    const carveLiking = totals.carve.liking / totals.carve.n;
    // The temptation is real: a good deal more coming in...
    expect(totals.carve.rent).toBeGreaterThan(totals.keep.rent * 1.2);
    // ...and so is the cost: cramped, nowhere to sit, more of them to keep happy.
    expect(keepLiking - carveLiking).toBeGreaterThan(4);
  }, 600000);
});
