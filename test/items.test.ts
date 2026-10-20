import { describe, expect, it } from 'vitest';
import { furnitureAt, placeFurniture, removeFurniture } from '../src/sim/build';
import { burglaryRisk } from '../src/sim/crime';
import { FURNITURE, furnitureDef } from '../src/sim/defs';
import { dirtOf, itemsIn, noiseMade, noiseThrough, SHARED } from '../src/sim/environment';
import { skipHandover } from '../src/sim/handover';
import { flatNeeds } from '../src/sim/impressiveness';
import { makePerson } from '../src/sim/leases';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type NeedId, type Pawn } from '../src/sim/state';
import { choices, moveIn } from '../src/sim/tenants';
import { thoughtsOf } from '../src/sim/thoughts';
import { ITEMS, NOISE } from '../src/sim/tuning';
import { issues } from '../src/sim/upkeep';
import type { Flat } from '../src/sim/layout';
import { homeAndAwake } from './stage';

/** A bare first-floor one-bed, the one with the room to try things in. */
function bareFlat(sim: Sim): Flat {
  return sim.layout.flats[2];
}

/** Puts a piece in the biggest room of a flat (or the lobby, for SHARED), wherever it fits. */
function put(sim: Sim, where: Flat | 'shared', def: string): void {
  const lay = sim.layout;
  const rooms = where === 'shared' ? lay.rooms.filter((r) => r.shared) : where.rooms.map((r) => lay.rooms[r]);
  const room = [...rooms].sort((a, b) => b.cells.length - a.cells.length)[0];
  const ok = room.cells.some((n) => {
    const [x, s] = lay.xs(n);
    return typeof placeFurniture(sim.state, def, x, s) !== 'string';
  });
  expect(ok, def).toBe(true);
  sim.changed();
}

function lodger(sim: Sim, flat: Flat, traits: string[] = []): Pawn {
  const person = { ...makePerson(sim.state), traits };
  const [p] = moveIn(sim, flat.id, [person]);
  return p;
}

/** A Saturday lunchtime, so nobody's at work or in bed. */
function saturday(sim: Sim): void {
  sim.state.tick = 5 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
}

function start(seed = 4): { sim: Sim; flat: Flat } {
  const sim = Sim.create(seed);
  skipHandover(sim);
  return { sim, flat: bareFlat(sim) };
}

describe('in-flat items', () => {
  it('are all in the build palette groups, with names and sizes', () => {
    const ids = ['dishwasher', 'console', 'bigTv', 'bookshelf', 'diningSet', 'rug', 'curtains', 'smokeAlarm', 'cctv', 'intercom'];
    for (const id of ids) {
      const d = furnitureDef(id);
      expect(['sleep', 'sit', 'kitchen', 'bathroom', 'storage', 'decor']).toContain(d.group);
      expect(d.w).toBeGreaterThan(0);
    }
    expect(new Set(FURNITURE.map((d) => d.id)).size).toBe(FURNITURE.length);
  });

  it('a dishwasher means less dirt, a memory of not washing up, and some noise after tea', () => {
    const run = (withDishwasher: boolean) => {
      const { sim, flat } = start();
      lodger(sim, flat);
      put(sim, flat, 'cooker');
      put(sim, flat, 'sofa');
      if (withDishwasher) put(sim, flat, 'dishwasher');
      saturday(sim);
      let remembered = false;
      for (let h = 0; h < 30; h++) {
        sim.run(TICKS_PER_HOUR);
        remembered ||= sim.state.pawns.some((p) => p.life?.flat === flat.id && p.life.memories.some((m) => m.id === 'noWashUp'));
      }
      return { dirt: dirtOf(sim, flat.id), remembered };
    };
    const without = run(false);
    const dishwasher = run(true);
    expect(dishwasher.dirt).toBeLessThan(without.dirt);
    expect(without.remembered).toBe(false);
    expect(dishwasher.remembered).toBe(true);

    // After tea, with someone home, it hums.
    const quietly = (withDishwasher: boolean) => {
      const { sim, flat } = start();
      const p = lodger(sim, flat);
      if (withDishwasher) put(sim, flat, 'dishwasher');
      saturday(sim);
      sim.state.tick += 8.5 * TICKS_PER_HOUR;
      p.doing = 'Settling in';
      return noiseMade(sim).get(flat.id) ?? 0;
    };
    expect(quietly(true) - quietly(false)).toBeCloseTo(ITEMS.dishwasherNoise, 6);
  });

  it('a games console is strong fun, but only with a telly in the room', () => {
    const { sim, flat } = start();
    const p = lodger(sim, flat);
    put(sim, flat, 'console');
    const games = () => choices(sim, p, flat, (o) => o.doing === 'Playing on the console');
    expect(games()).toHaveLength(0);
    put(sim, flat, 'tv');
    expect(games().length).toBeGreaterThan(0);
    expect(furnitureDef('console').valuable).toBe(true);
    const fun = furnitureDef('console').offers![0];
    expect(fun.rate).toBeGreaterThan(furnitureDef('sofa').offers![0].rate);
  });

  it('a big telly counts as a telly for the sofa, is more fun and louder', () => {
    const { sim, flat } = start();
    const p = lodger(sim, flat);
    put(sim, flat, 'sofa');
    const watching = () => choices(sim, p, flat, (o) => o.doing === 'Watching telly');
    expect(watching()).toHaveLength(0);
    put(sim, flat, 'bigTv');
    expect(watching().length).toBeGreaterThan(0);
    expect(furnitureDef('bigTv').valuable).toBe(true);
    expect(furnitureDef('bigTv').value).toBeGreaterThan(furnitureDef('tv').value);

    // Louder, with the same person watching.
    const noise = (tv: string) => {
      const s = start();
      const q = lodger(s.sim, s.flat);
      put(s.sim, s.flat, tv);
      q.doing = 'Watching telly';
      return s.sim.noise().get(s.flat.id) ?? 0;
    };
    expect(noise('bigTv')).toBeCloseTo(NOISE.telly * ITEMS.bigTellyNoise, 6);
    expect(noise('tv')).toBeCloseTo(NOISE.telly, 6);

    // And the fun comes in faster.
    const fun = (tv: string) => {
      const s = start();
      const q = lodger(s.sim, s.flat);
      put(s.sim, s.flat, 'sofa');
      put(s.sim, s.flat, tv);
      saturday(s.sim);
      const sofa = s.sim.state.furniture.find((f) => f.def === 'sofa')!;
      q.life!.using = { furniture: sofa.id, spot: 0, offer: 0, until: s.sim.state.tick + 100 * TICKS_PER_MINUTE };
      q.life!.needs.fun = 0.1;
      s.sim.run(30 * TICKS_PER_MINUTE);
      return q.life!.needs.fun;
    };
    expect(fun('bigTv')).toBeGreaterThan(fun('tv'));
  });

  it('a bookshelf is quiet fun: keen readers get more from it and party animals avoid it', () => {
    const reading = (traits: string[]) => {
      const { sim, flat } = start();
      const p = lodger(sim, flat, traits);
      put(sim, flat, 'bookshelf');
      saturday(sim);
      for (const k of Object.keys(p.life!.needs) as NeedId[]) p.life!.needs[k] = 0.95;
      p.life!.needs.fun = 0.2;
      let read = false;
      for (let m = 0; m < 240 && !read; m++) {
        sim.run(TICKS_PER_MINUTE);
        read = p.doing === 'Reading';
      }
      return read;
    };
    expect(reading(['easyGoing'])).toBe(true);
    expect(reading(['partyAnimal'])).toBe(false);

    const { sim, flat } = start();
    const keen = lodger(sim, flat, ['lightSleeper']);
    const other = lodger(sim, flat, ['friendly']);
    for (const p of [keen, other]) p.life!.memories.push({ id: 'goodRead', at: sim.state.tick });
    const good = (p: Pawn) => thoughtsOf(sim, p).find((t) => t.label === 'Had a good read')!.value;
    expect(good(keen)).toBe(good(other) * ITEMS.keenReadingFeel);
  });

  it('a dining set is a table and chairs in one: eating at it is remembered', () => {
    const { sim, flat } = start();
    const p = lodger(sim, flat);
    put(sim, flat, 'diningSet');
    saturday(sim);
    for (const k of Object.keys(p.life!.needs) as NeedId[]) p.life!.needs[k] = 0.95;
    p.life!.needs.food = 0.3;
    p.life!.meal = true;
    let ate = false;
    for (let m = 0; m < 120 && !ate; m++) {
      sim.run(TICKS_PER_MINUTE);
      ate = p.life!.memories.some((x) => x.id === 'ateAtTable');
    }
    expect(ate).toBe(true);
  });

  it('a rug can lie under other furniture, and soaks up noise going down to the flat below', () => {
    const { sim, flat } = start();
    const lay = sim.layout;
    const below = lay.flats.find((f) => f.id !== flat.id && noiseThrough(sim, flat.id, f.id) > 0 && lay.xs(lay.flatCells(f)[0])[1] < lay.xs(lay.flatCells(flat)[0])[1])!;
    expect(below).toBeDefined();
    const loud = noiseThrough(sim, flat.id, below.id);
    put(sim, flat, 'rug');
    const one = noiseThrough(sim, flat.id, below.id);
    expect(one).toBeCloseTo(loud * ITEMS.rugBelow, 6);
    put(sim, flat, 'rug');
    expect(noiseThrough(sim, flat.id, below.id)).toBeLessThan(one);
    // It doesn't muffle the flat above, nor the neighbours' noise coming up.
    expect(noiseThrough(sim, below.id, flat.id)).toBeGreaterThan(0);
    expect(itemsIn(sim, below.id, 'rug')).toBe(0);

    // Floor furniture goes on top of it, but not a second rug in the same place.
    const rug = sim.state.furniture.find((f) => f.def === 'rug')!;
    expect(typeof placeFurniture(sim.state, 'drawers', rug.x, rug.s)).not.toBe('string');
    expect(furnitureAt(sim.state, rug.x, rug.s)!.def).toBe('drawers');
    expect(typeof placeFurniture(sim.state, 'rug', rug.x, rug.s)).toBe('string');
  });

  it('curtains make for a dark bedroom and better sleep', () => {
    /** A tired lodger with no job to get up for goes to bed at ten; what's on their mind when they wake? */
    const night = (curtains: boolean) => {
      const { sim, flat } = start();
      const p = lodger(sim, flat);
      p.life!.schedule = 'home';
      p.life!.job = null;
      // Nothing else on their mind tonight: no kicking off, no outings.
      p.life!.calmUntil = Number.MAX_SAFE_INTEGER;
      put(sim, flat, 'bed');
      if (curtains) put(sim, flat, 'curtains');
      while (sim.minuteOfDay !== 22 * 60) sim.run(TICKS_PER_MINUTE);
      homeAndAwake(sim, p);
      p.life!.needs.sleep = 0.1;
      let inBed = false;
      let woke = false;
      let dark = false;
      for (let m = 0; m < 18 * 60 && !woke; m++) {
        sim.run(TICKS_PER_MINUTE);
        inBed ||= p.pose === 'sleep' && p.life!.sleptOn === 'bed';
        woke = inBed && p.pose !== 'sleep';
        dark ||= p.life!.memories.some((x) => x.id === 'darkBedroom');
      }
      expect(woke, 'a night in their bed').toBe(true);
      return dark;
    };
    expect(night(false)).toBe(false);
    expect(night(true)).toBe(true);
  });

  it('the council wants a smoke alarm in every flat people live in; the furnished ones start with one', () => {
    const sim = Sim.create(4);
    expect(issues(sim).filter((i) => i.includes('smoke alarm'))).toEqual([]);
    const flat = sim.layout.flats[0];
    expect(itemsIn(sim, flat.id, 'smokeAlarm')).toBe(1);
    const alarm = sim.state.furniture.find((f) => f.def === 'smokeAlarm' && sim.layout.flatAt(f.x, f.s)?.id === flat.id)!;
    removeFurniture(sim.state, alarm.id);
    sim.changed();
    expect(issues(sim)).toContain(`${flat.name} has no smoke alarm`);
    // It's on the checklist for a flat, and cheap.
    expect(flatNeeds(sim, flat.id).find((n) => n.label.startsWith('A smoke alarm'))!.done).toBe(false);
    put(sim, flat, 'smokeAlarm');
    expect(issues(sim).filter((i) => i.includes('smoke alarm'))).toEqual([]);
    // Empty flats aren't checked.
    expect(issues(sim).some((i) => i.includes(bareFlat(sim).name))).toBe(false);
  });

  it('a CCTV camera and an intercom lower the burglary risk, and tenants have opinions', () => {
    const sim = Sim.create(1);
    skipHandover(sim);
    const bare = burglaryRisk(sim);
    put(sim, 'shared', 'cctv');
    const watched = burglaryRisk(sim);
    expect(watched).toBeLessThan(bare);
    put(sim, 'shared', 'intercom');
    expect(burglaryRisk(sim)).toBeLessThan(watched);
    // A camera in a flat isn't watching the street.
    const other = Sim.create(1);
    put(other, other.layout.flats[0], 'cctv');
    expect(burglaryRisk(other)).toBe(bare);

    const flat = bareFlat(sim);
    const rights = lodger(sim, flat, ['knowsRights']);
    const nosy = lodger(sim, flat, ['busybody']);
    const plain = lodger(sim, flat, ['friendly']);
    const label = (p: Pawn, text: string) => thoughtsOf(sim, p).find((t) => t.label === text)?.value;
    expect(label(rights, 'Camera pointed at the lobby')).toBeLessThan(0);
    expect(label(nosy, 'Can see who comes and goes')).toBeGreaterThan(0);
    expect(label(plain, 'Can see who comes and goes')).toBeUndefined();
    for (const p of [rights, nosy, plain]) expect(label(p, 'Intercom on the street door')).toBe(ITEMS.intercomLikes);
    expect(itemsIn(sim, SHARED, 'cctv')).toBe(1);
  });
});
