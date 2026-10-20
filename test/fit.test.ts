// Who lives where (docs/specs/layout.md section 4): needs that read off the layout and the
// neighbours, facts on the applicant's card, lives that change, and the soak that proves it
// matters who you put where: the same night worker over a telly or under a quiet flat.

import { describe, expect, it } from 'vitest';
import { placeFurniture } from '../src/sim/build';
import { flatInfo, POUND } from '../src/sim/economy';
import { applicantNeeds, fitFacts, flightsUp, livesChange, needsOf } from '../src/sim/fit';
import { affordable, makePerson, newApplicant } from '../src/sim/leases';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, key, type Pawn, type Person, type State } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { thoughtsOf } from '../src/sim/thoughts';
import { landlord } from './policy';

/**
 * The right-hand flat on a storey as a one-bed with no telly: a hall off the landing, the
 * bedroom over the room below's living room, and a kitchen with an armchair beyond. Noise
 * goes room by room (acoustics.ts), so it's the bedroom that has to be over the telly; the
 * hall keeps the stairs out of it.
 */
function fitQuiet(st: State, storey: number): void {
  const at = (dx: number) => st.plot.x0 + dx;
  const row = 1 + storey * 4;
  const put = (def: string, dx: number, r = 0) => {
    const f = placeFurniture(st, def, at(dx), row + r);
    if (typeof f === 'string') throw new Error(`${def}: ${f}`);
  };
  st.cells[key(at(15), row)] = 'door';
  delete st.cells[key(at(15), row + 1)];
  st.cells[key(at(15), row + 2)] = 'wall';
  put('doubleBed', 16);
  put('cooker', 21);
  put('armchair', 22);
  put('toilet', 25);
  put('shower', 26);
  if (storey === 2) {
    put('radiator', 19, 1);
    put('radiator', 23, 1);
  }
  put('smokeAlarm', 17, 2);
}

function building(seed: number): { sim: Sim; flat3: string; flat5: string } {
  const sim = Sim.create(seed);
  fitQuiet(sim.state, 1);
  fitQuiet(sim.state, 2);
  sim.changed();
  return { sim, flat3: sim.layout.flats[2].id, flat5: sim.layout.flats[4].id };
}

function letTo(sim: Sim, flatId: string, person: Person): Pawn {
  const info = flatInfo(sim, flatId);
  const rent = 100 * POUND;
  info.lease = { rent, startDay: sim.day, endDay: sim.day + 60, deposit: rent * 4, owed: 0, paid: 0, late: 0 };
  info.listed = false;
  return moveIn(sim, flatId, [person], [person.traits[0]], 'single')[0];
}

describe('needs and facts', () => {
  it('needs come from hours, traits and circumstances; hidden traits stay hidden', () => {
    expect(needsOf({ schedule: 'nights', traits: ['friendly'] })).toEqual(['nights']);
    expect(needsOf({ schedule: 'office', traits: ['lightSleeper', 'musician'] }, ['musician'])).toEqual(['musician']);
    expect(needsOf({ schedule: 'retired', traits: [], circs: ['wontClimb', 'baby'] })).toEqual(['baby', 'wontClimb']);
    expect(needsOf({ traits: [], pet: 'a dog' })).toEqual(['dog']);
  });

  it('the start building reads differently for each need', () => {
    const { sim, flat3, flat5 } = building(1);
    const studio = sim.layout.flats[1].id;
    expect(flightsUp(sim, sim.layout.flats[0].id)).toBe(0);
    expect(flightsUp(sim, flat5)).toBe(2);
    // Flat 3 sits over Flat 1's telly; Flat 5 over nothing loud; the studio by the stairs.
    expect(fitFacts(sim, flat3, ['nights']).map((f) => f.text)).toEqual(['Telly through the wall']);
    expect(fitFacts(sim, flat5, ['nights']).map((f) => f.text)).toEqual(['Quiet by day']);
    expect(fitFacts(sim, studio, ['nights']).map((f) => f.text)).toEqual(['Stairs through the wall']);
    // Bad knees: the first floor is fine, the second isn't.
    expect(fitFacts(sim, flat3, ['wontClimb'])[0].good).toBe(true);
    expect(fitFacts(sim, flat5, ['wontClimb'])[0]).toMatchObject({ text: 'Two flights up', good: false });
    // A baby wants a second bedroom.
    expect(fitFacts(sim, flat3, ['baby']).map((f) => f.text)).toContain('No room for a cot');
  });

  it('every fact a tenant takes to heart is a labelled thought', () => {
    const { sim, flat3 } = building(2);
    const p = letTo(sim, flat3, { ...makePerson(sim.state, undefined, 'nights'), traits: ['friendly'] });
    p.life!.circs = ['wontClimb'];
    const labels = thoughtsOf(sim, p).map((t) => t.label);
    expect(labels).toContain("Flat 1's telly through the wall by day");
    expect(labels).toContain('Hardly any stairs');
  });
});

describe('applicants', () => {
  it('show what they let on, and an applicant who works nights weighs the telly below', () => {
    const { sim, flat3 } = building(3);
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      const a = newApplicant(sim, flat3);
      const needs = applicantNeeds(a);
      if (a.people.some((p) => p.schedule === 'nights')) {
        expect(needs).toContain('nights');
        seen++;
      }
      // A trait you don't know about isn't a need you can see.
      if (!a.people[0].traits.includes('lightSleeper') || a.shown !== 'lightSleeper') {
        if (a.people.length === 1) expect(needs).not.toContain('lightSleeper');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('bring babies, bad knees and dogs on their own dice, without moving the game\'s', () => {
    const { sim, flat3 } = building(4);
    const circs = new Set<string>();
    flatInfo(sim, flat3).style = 'pets';
    for (let i = 0; i < 400; i++) for (const c of newApplicant(sim, flat3).circs ?? []) circs.add(c);
    expect(circs.has('baby')).toBe(true);
    expect(circs.has('wontClimb')).toBe(true);
    // Same seed, same applicant, whether or not anyone looked at the circumstances.
    const a = building(5);
    const b = building(5);
    expect(JSON.stringify(newApplicant(a.sim, a.flat3).people)).toBe(JSON.stringify(newApplicant(b.sim, b.flat3).people));
  });

  it('nobody applies who couldn\'t pay it: singles least, couples more', () => {
    const { sim, flat3 } = building(6);
    const studio = sim.layout.flats[1].id;
    expect(affordable(sim, studio, 250 * POUND).map((o) => o.kind)).toEqual(['single']);
    expect(affordable(sim, studio, 350 * POUND)).toEqual([]);
    // A one-bed with a double bed at £450 a week: only a couple could pay that.
    flatInfo(sim, flat3).asking = 450 * POUND;
    for (let i = 0; i < 40; i++) expect(newApplicant(sim, flat3).household).toBe('couple');
  });
});

describe('lives change', () => {
  it('a couple has a baby, and someone goes onto nights, now and then', () => {
    const { sim, flat3, flat5 } = building(7);
    const couple = moveIn(sim, flat3, [makePerson(sim.state, undefined, 'office'), makePerson(sim.state, undefined, 'office')], [], 'couple');
    const worker = letTo(sim, flat5, makePerson(sim.state, undefined, 'office'));
    for (let day = 0; day < 2000 && !(couple[0].life!.circs?.includes('baby') && worker.life!.schedule === 'nights'); day++) {
      sim.state.tick = day * TICKS_PER_DAY;
      livesChange(sim);
    }
    expect(couple[0].life!.circs).toContain('baby');
    expect(couple[1].life!.circs).toContain('baby');
    expect(worker.life!.schedule).toBe('nights');
    // Now the one-bed doesn't suit them.
    expect(thoughtsOf(sim, couple[0]).map((t) => t.label)).toContain('No room for the baby');
  });
});

describe('who lives where, over three weeks', () => {
  it('the same night worker sleeps worse and likes it less over a telly than under a quiet flat; the office worker hardly minds', () => {
    // Flat 3 is over Flat 1's telly (Tom works from home); Flat 5 is on top, over Flat 3.
    const liking = { nightsOverTelly: 0, nightsQuiet: 0, officeOverTelly: 0, officeQuiet: 0 };
    const woken = { overTelly: 0, quiet: 0 };
    let n = 0;
    for (const seed of [1, 2, 3]) {
      for (const swap of [false, true]) {
        const { sim, flat3, flat5 } = building(seed);
        // The same two people either way.
        const dice = { rng: seed * 7919 };
        const night = { ...makePerson(dice, undefined, 'nights'), traits: ['friendly', 'paysEarly'] };
        const office = { ...makePerson(dice, undefined, 'office'), traits: ['friendly', 'paysEarly'] };
        const nightPawn = letTo(sim, swap ? flat5 : flat3, night);
        const officePawn = letTo(sim, swap ? flat3 : flat5, office);
        for (let h = 0; h < 21 * 24; h++) {
          sim.run(TICKS_PER_HOUR);
          landlord(sim, 'decent');
          if (h % 24 === 12 && h >= 48) {
            liking[swap ? 'nightsQuiet' : 'nightsOverTelly'] += nightPawn.life!.liking;
            liking[swap ? 'officeOverTelly' : 'officeQuiet'] += officePawn.life!.liking;
            if (!swap) n++;
          }
          if (h % 6 === 0) {
            const w = nightPawn.life!.memories.filter((m) => m.id === 'wokenByDay').length;
            woken[swap ? 'quiet' : 'overTelly'] += w;
          }
        }
        expect(sim.state.repossessed, `seed ${seed}`).toBeUndefined();
      }
    }
    for (const k of Object.keys(liking) as (keyof typeof liking)[]) liking[k] /= n;
    // Over the telly they're woken in the day, and like it a good deal less...
    expect(woken.overTelly).toBeGreaterThan(woken.quiet);
    const nightGain = liking.nightsQuiet - liking.nightsOverTelly;
    expect(nightGain).toBeGreaterThan(4);
    // ...while the office worker, out all day, gives up much less to take the flat over the telly.
    const officeCost = liking.officeQuiet - liking.officeOverTelly;
    expect(officeCost).toBeLessThan(nightGain / 2);
  }, 600000);
});
