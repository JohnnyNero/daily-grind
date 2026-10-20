import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useCatalogue } from '../src/sim/drip';
import { insulate } from '../src/sim/build';
import { tempOf } from '../src/sim/environment';
import { makePerson } from '../src/sim/leases';
import { Sim } from '../src/sim/sim';
import { opinion } from '../src/sim/social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, key } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { landlord } from './policy';
import { skipHandover } from '../src/sim/handover';

// These watch other systems on seeded games with nobody answering: the drip's cards (which an
// absent landlord ignores, at a cost) are left out so they don't decide the outcome.
beforeAll(() => useCatalogue([]));
afterAll(() => useCatalogue(null));

const tenantsOf = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

function soak(seed: number, policy: 'decent' | 'ruthless', days: number): Sim {
  const sim = Sim.create(seed);
  for (let h = 0; h < days * 24; h++) {
    sim.run(TICKS_PER_HOUR);
    landlord(sim, policy);
  }
  return sim;
}

/** A night-owl musician in Flat 2, and the light sleeper upstairs in Flat 4. */
function noisyNeighbours(insulated: boolean, seed = 11): { sim: Sim; sleeper: ReturnType<typeof tenantsOf>[number]; musician: ReturnType<typeof tenantsOf>[number] } {
  const sim = Sim.create(seed);
  skipHandover(sim);
  const [, two, , four] = sim.layout.flats;
  // Office hours, so they're in and playing in the evenings (an early shift has them asleep by ten).
  const person = { ...makePerson(sim.state, undefined, 'office'), traits: ['musician', 'nightOwl'] };
  const [musician] = moveIn(sim, two.id, [person]);
  sim.state.flats[two.id] = { ...sim.state.flats[two.id], lease: { rent: 11000, startDay: 1, endDay: 99, deposit: 0, owed: 0, paid: 0, late: 0 }, listed: false };
  const sleeper = tenantsOf(sim).find((p) => p.life!.flat === four.id)!;
  sleeper.life!.traits = ['lightSleeper'];
  // Bill's shower now starts nearly worn out (for the first week's leak), so the storyteller's
  // breakdowns, which nobody mends here, land on him and drown the noise out. This is about
  // noise: nothing breaks down.
  sim.state.story.cooldowns.repair = Number.MAX_SAFE_INTEGER;
  if (insulated) {
    // The floor between them: Flat 4's floor, over Flat 2.
    for (const n of four.rooms.flatMap((r) => sim.layout.rooms[r].nodes)) {
      const [x, s] = sim.layout.xs(n);
      insulate(sim.state, key(x, s - 1));
    }
    sim.changed();
  }
  return { sim, sleeper, musician };
}

describe('neighbours', () => {
  it('make friends without being told to', () => {
    let best = -100;
    for (const seed of [1, 2, 3]) {
      const sim = soak(seed, 'decent', 40);
      for (const a of tenantsOf(sim)) for (const b of tenantsOf(sim)) if (a !== b) best = Math.max(best, opinion(sim, a, b));
    }
    expect(best).toBeGreaterThanOrEqual(30);
  });

  it('a musician keeps the light sleeper above awake, and they go off each other', () => {
    const { sim, sleeper, musician } = noisyNeighbours(false);
    // Being kept awake is remembered for a night, so watch for it as the days go by.
    let keptAwake = false;
    for (let h = 0; h < 10 * 24; h++) {
      sim.run(TICKS_PER_HOUR);
      keptAwake ||= sleeper.life!.memories.some((m) => m.id === 'keptAwake');
    }
    expect(keptAwake).toBe(true);
    expect(opinion(sim, sleeper, musician)).toBeLessThan(0);
    expect(sim.state.chat.some((m) => m.text.startsWith('Some of us are trying to sleep'))).toBe(true);
  });

  it('insulating the floor between them makes the one above like it more', () => {
    // Over a few buildings, as how often their hours overlap varies from one to the next.
    const average = (insulated: boolean) => {
      let total = 0;
      let n = 0;
      for (const seed of [11, 12, 13]) {
        const { sim, sleeper } = noisyNeighbours(insulated, seed);
        for (let h = 0; h < 14 * 24; h++) {
          sim.run(TICKS_PER_HOUR);
          if (h > 48) {
            total += sleeper.life!.liking;
            n++;
          }
        }
      }
      return total / n;
    };
    expect(average(true)).toBeGreaterThan(average(false) + 3);
  });

  it('the boiler and radiators keep flats warm; with it off they go cold', () => {
    const warm = Sim.create(4);
    const cold = Sim.create(4);
    warm.state.boiler = 3;
    cold.state.boiler = 0;
    warm.run(20 * TICKS_PER_DAY);
    cold.run(20 * TICKS_PER_DAY);
    const id = warm.layout.flats[0].id;
    expect(tempOf(warm, id)).toBeGreaterThan(tempOf(cold, id) + 8);
    const chilly = tenantsOf(cold).flatMap((p) => p.life!.needs.warmth);
    expect(Math.min(...chilly)).toBeLessThan(0.5);
  });

  it('gossip spreads what the landlord did, and tenants ask for things in the chat', () => {
    // Heard things fade, so watch for them as the weeks go by.
    const sim = Sim.create(2);
    let heard = 0;
    for (let h = 0; h < 40 * 24; h++) {
      sim.run(TICKS_PER_HOUR);
      landlord(sim, 'ruthless');
      const now = tenantsOf(sim).flatMap((p) => p.life!.memories.filter((m) => m.from !== undefined));
      expect(now.every((m) => (m.hops ?? 0) <= 2)).toBe(true);
      heard += now.length;
    }
    expect(heard).toBeGreaterThan(0);
    expect(sim.state.chat.some((m) => m.choices)).toBe(true);
  });
});
