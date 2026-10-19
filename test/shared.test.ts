import { afterEach, describe, expect, it } from 'vitest';
import { placeFurniture, placeStairs } from '../src/sim/build';
import { skipHandover } from '../src/sim/handover';
import { flatScore } from '../src/sim/impressiveness';
import { makePerson, newApplicant } from '../src/sim/leases';
import { deserialize, serialize } from '../src/sim/save';
import { outdoorsOk, spaceAt, spacesOf } from '../src/sim/shared';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Pawn } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { BASELINE, likingTarget, thoughtsOf } from '../src/sim/thoughts';
import { SHARED_USE } from '../src/sim/tuning';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);
const labels = (sim: Sim, p: Pawn) => thoughtsOf(sim, p).map((t) => t.label);

/** A building with the handover out of the way, at this day and hour (day 92 is high summer; day 36 is the depths of winter). */
function building(seed: number, day: number, hour: number): Sim {
  const sim = Sim.create(seed);
  skipHandover(sim);
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  return sim;
}

const SATURDAY = 92 - ((92 - 1) % 7) + 5; // a Saturday around midsummer
const MONDAY = 92 - ((92 - 1) % 7) + 7;

function put(sim: Sim, def: string, dx: number, s: number): number {
  const f = placeFurniture(sim.state, def, sim.state.plot.x0 + dx, s);
  if (typeof f === 'string') throw new Error(`${def}: ${f}`);
  sim.changed();
  return f.id;
}

/** Stairs up to the roof, and a bench, planter, grill and table out on it. */
function roofGarden(sim: Sim): number[] {
  expect(placeStairs(sim.state, sim.state.plot.x0 + 9, 9)).toBeNull();
  return [put(sim, 'bench', 11, 13), put(sim, 'planter', 14, 13), put(sim, 'bbq', 16, 13), put(sim, 'parasolTable', 19, 13)];
}

/** A few more households, so there are neighbours to meet. */
function neighbours(sim: Sim): Pawn[] {
  const [, two, three] = sim.layout.flats;
  for (const f of [two, three]) {
    moveIn(sim, f.id, [{ ...makePerson(sim.state), traits: ['friendly'] }]);
    sim.state.flats[f.id] = { ...sim.state.flats[f.id], lease: { rent: 11000, startDay: 1, endDay: 999, deposit: 0, owed: 0, paid: 0, late: 0 }, listed: false };
  }
  return tenants(sim);
}

/** Runs a minute at a time for this long, calling `each` after every minute. */
function minutes(sim: Sim, n: number, each: () => void): void {
  for (let i = 0; i < n; i++) {
    sim.run(TICKS_PER_MINUTE);
    each();
  }
}

const usingNow = (sim: Sim, ids: number[]) => tenants(sim).filter((p) => p.life!.using && p.life!.using.until > 0 && ids.includes(p.life!.using.furniture));

const saved = { ...SHARED_USE };
afterEach(() => Object.assign(SHARED_USE, saved));

describe('shared spaces', () => {
  it('are told apart by what is in them', () => {
    const sim = building(1, SATURDAY, 11);
    put(sim, 'washer', 3, 1);
    put(sim, 'bikeRack', 4, 1);
    roofGarden(sim);
    const kinds = spacesOf(sim).map((s) => [s.kind, s.name]);
    expect(kinds).toContainEqual(['laundry', 'Laundry room']);
    expect(kinds).toContainEqual(['bikes', 'Bike store']);
    // Bike racks without a washing machine make a bike store.
    const other = building(1, SATURDAY, 11);
    put(other, 'bikeRack', 4, 1);
    expect(spaceAt(other, other.state.plot.x0 + 4, 1)?.name).toBe('Bike store');
    expect(kinds).toContainEqual(['garden', 'Roof terrace']);
    const x0 = sim.state.plot.x0;
    expect(spaceAt(sim, x0 + 2, 1)?.name).toBe('Laundry room');
    expect(spaceAt(sim, x0 + 14, 13)?.name).toBe('Roof terrace');
    expect(spaceAt(sim, x0 + 20, 20)).toBeUndefined();
    // A flat is not a shared space, whatever is in it.
    const flat = sim.layout.flats[0];
    const [x, s] = sim.layout.xs(flat.rooms.flatMap((r) => sim.layout.rooms[r].nodes)[0]);
    expect(spaceAt(sim, x, s)).toBeUndefined();
  });

  it('do not count when nobody can get to them, or they are broken', () => {
    const sim = building(1, SATURDAY, 11);
    // A bench on the roof with no stairs up.
    put(sim, 'bench', 11, 13);
    expect(spacesOf(sim).find((s) => s.kind === 'garden')?.working).toBe(false);
    const w = put(sim, 'washer', 3, 1);
    expect(spacesOf(sim).find((s) => s.kind === 'laundry')?.working).toBe(true);
    sim.state.furniture.find((f) => f.id === w)!.broken = sim.day;
    sim.changed();
    expect(spacesOf(sim).find((s) => s.kind === 'laundry')?.working).toBe(false);
  });

  it('send a tenant to a shared washing machine, who is pleased about it', () => {
    const sim = building(2, SATURDAY, 10);
    const washer = put(sim, 'washer', 3, 1);
    const p = tenants(sim)[0];
    expect(labels(sim, p)).not.toContain('Did the washing');
    let used = false;
    minutes(sim, 10 * 60, () => {
      if (usingNow(sim, [washer]).includes(p)) used = true;
    });
    expect(used).toBe(true);
    expect(p.life!.washedDay).toBeDefined();
    expect(labels(sim, p)).toContain('Did the washing');
  });

  it('do the washing at a machine in the flat if there is one, and do not pester the laundry room', () => {
    const sim = building(2, SATURDAY, 10);
    const p = tenants(sim)[0];
    const sofa = sim.state.furniture.find((f) => f.def === 'sofa')!;
    sim.state.furniture.splice(sim.state.furniture.indexOf(sofa), 1);
    put(sim, 'washer', sofa.x - sim.state.plot.x0, sofa.s);
    expect(labels(sim, p)).not.toContain('Nowhere to do the washing');
    expect(labels(sim, p)).not.toContain('Laundry downstairs');
  });

  it('send tenants out to the garden in daylight on a nice day', () => {
    let sat = 0;
    for (const seed of [1, 2, 3]) {
      const sim = building(seed, SATURDAY, 10);
      const garden = roofGarden(sim);
      const p = tenants(sim)[0];
      minutes(sim, 8 * 60, () => {
        // Bored enough to want something, not bored enough to go to the pub.
        if (sim.state.tick % (10 * TICKS_PER_MINUTE) === 0) {
          p.life!.needs.fun = Math.min(p.life!.needs.fun, 0.7);
          p.life!.needs.comfort = Math.min(p.life!.needs.comfort, 0.6);
        }
        if (usingNow(sim, garden).includes(p)) {
          sat++;
          expect(outdoorsOk(sim)).toBe(true);
        }
      });
    }
    expect(sat).toBeGreaterThan(0);
  });

  it('never use the garden after dark, or in the cold', () => {
    for (const [day, hour] of [[SATURDAY, 20], [SATURDAY, 22], [36 - ((36 - 1) % 7) + 5, 12]]) {
      const sim = building(1, day, hour);
      const ids = roofGarden(sim);
      expect(outdoorsOk(sim)).toBe(false);
      SHARED_USE.leisureChance = 1;
      SHARED_USE.bbqChance = 1;
      for (const p of tenants(sim)) {
        p.life!.needs.fun = 0.5;
        p.life!.needs.comfort = 0.5;
      }
      minutes(sim, 90, () => {
        for (const p of tenants(sim)) expect(p.life!.using ? ids.includes(p.life!.using.furniture) : false).toBe(false);
      });
    }
  });

  it('gather the neighbours round a barbecue', () => {
    const sim = building(3, SATURDAY, 12);
    const ids = roofGarden(sim);
    const people = neighbours(sim);
    expect(people.length).toBe(4);
    SHARED_USE.bbqChance = 1;
    SHARED_USE.joinChance = 1;
    const there = new Set<number>();
    minutes(sim, 6 * 60, () => {
      for (const p of usingNow(sim, ids)) if (p.doing === 'At the barbecue' || p.doing === 'Firing up the barbecue') there.add(p.id);
    });
    expect(there.size).toBeGreaterThanOrEqual(2);
    const memories = people.flatMap((p) => p.life!.memories.map((m) => m.id));
    expect(memories).toContain('firedUpBbq');
    expect(memories).toContain('gotBarbecue');
    // They talked, too.
    expect(people.some((p) => p.life!.social.some((m) => m.id === 'chat'))).toBe(true);
  });

  it('are thought well of, as labelled thoughts that add up', () => {
    const sim = building(1, SATURDAY, 11);
    const p = tenants(sim)[0];
    expect(labels(sim, p)).toContain('Nowhere to do the washing');
    expect(labels(sim, p)).not.toContain('Building has a roof terrace');
    const before = flatScore(sim, p.life!.flat).score;
    put(sim, 'washer', 3, 1);
    put(sim, 'bikeRack', 4, 1);
    roofGarden(sim);
    const after = labels(sim, p);
    expect(after).toContain('Laundry downstairs');
    expect(after).not.toContain('Nowhere to do the washing');
    expect(after).toContain('Building has a roof terrace');
    expect(p.life!.job).not.toBeNull();
    expect(after).toContain('Somewhere to keep the bike');
    expect(flatScore(sim, p.life!.flat).score).toBeGreaterThan(before);
    // Every point of liking is in the list.
    const thoughts = thoughtsOf(sim, p);
    expect(likingTarget(thoughts)).toBeCloseTo(Math.max(0, Math.min(100, BASELINE + thoughts.reduce((n, t) => n + t.value, 0))), 6);
  });

  it('send tenants cycling to work when there is somewhere for the bike', () => {
    const sim = building(1, MONDAY, 6);
    put(sim, 'bikeRack', 4, 1);
    SHARED_USE.cycleChance = 1;
    const p = tenants(sim).find((t) => t.life!.job)!;
    let cycled = false;
    let grim = false;
    minutes(sim, 15 * 60, () => {
      if (p.life!.memories.some((m) => m.id === 'cycledToWork')) cycled = true;
      if (p.life!.memories.some((m) => m.id === 'commute')) grim = true;
    });
    expect(cycled).toBe(true);
    expect(grim).toBe(false);
    expect(labels(sim, p).some((l) => l === 'Cycled to work')).toBe(cycled && p.life!.memories.some((m) => m.id === 'cycledToWork'));
  });

  it('get a mention in what applicants say', () => {
    const sim = building(1, SATURDAY, 11);
    put(sim, 'washer', 3, 1);
    const flat = sim.layout.flats[1].id;
    const hints = Array.from({ length: 30 }, () => newApplicant(sim, flat).hints).flat();
    expect(hints.some((h) => /laundry room|bike|roof terrace/.test(h))).toBe(true);
    const bare = building(1, SATURDAY, 11);
    expect(Array.from({ length: 30 }, () => newApplicant(bare, flat).hints).flat().some((h) => /laundry room|bike|roof terrace/.test(h))).toBe(false);
  });

  it('survive a save and load', () => {
    const sim = building(1, SATURDAY, 11);
    put(sim, 'washer', 3, 1);
    roofGarden(sim);
    sim.run(2 * TICKS_PER_HOUR);
    const back = deserialize(serialize(sim));
    expect(spacesOf(back).map((s) => s.name).sort()).toEqual(spacesOf(sim).map((s) => s.name).sort());
  });
});
