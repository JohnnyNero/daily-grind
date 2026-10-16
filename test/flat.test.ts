import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { FLAT_RENT, beds, buildStaffFlat, hasFlat, setLivesIn } from '../src/sim/flat';
import { deserialize, serialize } from '../src/sim/manage';
import { addPlotToSave } from '../src/sim/world';
import { venueDef } from '../src/sim/venues';

describe('the staff flat', () => {
  for (const venue of ['cafe', 'pub']) {
    it(`${venue}: build the flat, move people in, and they live there`, () => {
      const sim = new Sim(4, undefined, venue);
      expect(hasFlat(sim)).toBe(false);
      const p = sim.state.pawns.find((x) => x.staff)!;
      expect(setLivesIn(sim, p, true)).toMatch(/no staff flat/);
      expect(buildStaffFlat(sim)).toMatch(/bank/); // a mid-game investment
      sim.state.money = 300000;
      expect(buildStaffFlat(sim)).toBeNull();
      expect(hasFlat(sim)).toBe(true);
      expect(beds(sim)).toBe(3);
      const [a, b] = sim.state.pawns.filter((x) => x.staff);
      expect(setLivesIn(sim, a, true)).toBeNull();
      expect(setLivesIn(sim, b, true)).toBeNull();

      let slept = false;
      let homeAtNight = false;
      let quietAtNight = false;
      for (let t = 0; t < 3 * TICKS_PER_DAY; t++) {
        sim.step();
        if (t % TICKS_PER_MINUTE) continue;
        if (a.job?.label === 'Asleep' || a.staff!.memories.length >= 0 && a.job?.steps.some((st) => st.kind === 'use')) slept ||= a.job?.label.includes('Asleep') ?? false;
        const m = sim.minuteOfDay;
        if (m === 3 * 60) {
          homeAtNight ||= a.onMap;
          quietAtNight ||= sim.isQuiet();
        }
      }
      expect(homeAtNight).toBe(true);
      expect(quietAtNight).toBe(true);
      expect(slept).toBe(true);
      // They still turn up and work their shifts.
      expect(a.staff!.skills).toBeDefined();
      expect(sim.state.recaps.every((r) => r.stats.served > 20)).toBe(true);
    });
  }

  it('live-ins pay rent, cost no wages off shift, and survive a save', () => {
    const sim = new Sim(4);
    sim.state.money = 300000;
    expect(buildStaffFlat(sim)).toBeNull();
    const a = sim.state.pawns.find((x) => x.staff)!;
    setLivesIn(sim, a, true);
    sim.run(TICKS_PER_DAY - (sim.state.tick % TICKS_PER_DAY) + 3 * TICKS_PER_HOUR); // 3am, day 2
    expect(sim.state.today.takings).toBeGreaterThanOrEqual(FLAT_RENT);
    const wages = sim.state.today.wages;
    sim.run(2 * TICKS_PER_HOUR);
    expect(sim.state.today.wages).toBe(wages);
    const back = deserialize(serialize(sim));
    expect(back.state.pawns.find((x) => x.id === a.id)!.staff!.livesIn).toBe(true);
    back.run(TICKS_PER_DAY);
  });

  it('an old save gets the back plot added without moving anything', () => {
    const sim = new Sim(4);
    const old = JSON.parse(serialize(sim));
    const map = venueDef('cafe').map;
    const w = map[0].length;
    // Shrink it back to how saves looked before the plot.
    old.tiles = old.tiles.filter((_: unknown, i: number) => i % old.w < w);
    old.w = w;
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.state.w).toBe(sim.state.w);
    expect(JSON.stringify(loaded.state.tiles)).toBe(JSON.stringify(sim.state.tiles));
    addPlotToSave(loaded.state, map); // running it again changes nothing
    expect(loaded.state.w).toBe(sim.state.w);
  });
});
