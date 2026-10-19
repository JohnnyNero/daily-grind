import { describe, expect, it } from 'vitest';
import { inspirations, startBreak } from '../src/sim/breaks';
import { SHARED, dirtOf, noiseOf } from '../src/sim/environment';
import { skipHandover } from '../src/sim/handover';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, type BreakKind, type Pawn } from '../src/sim/state';
import { breakIt } from '../src/sim/upkeep';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life);

/** A building at ten in the morning on a weekday (or a Saturday, when everyone's in), handover out of the way. */
function morning(seed = 4, saturday = false): Sim {
  const sim = Sim.create(seed);
  skipHandover(sim);
  while (sim.minuteOfDay !== 10 * 60 || (saturday ? (sim.day - 1) % 7 !== 5 : (sim.day - 1) % 7 >= 5)) sim.run(TICKS_PER_MINUTE);
  return sim;
}

/** Runs minute by minute until the check passes (or the time is up). */
function until(sim: Sim, mins: number, check: () => boolean): boolean {
  for (let i = 0; i < mins; i++) {
    if (check()) return true;
    sim.run(TICKS_PER_MINUTE);
  }
  return check();
}

function breaker(sim: Sim, kind: BreakKind, level: 'minor' | 'major' | 'extreme' = 'major'): Pawn {
  const p = tenants(sim)[0];
  p.life!.away = null;
  expect(startBreak(sim, p, level, 'The boiler', false, kind)).toBe(kind);
  return p;
}

describe('breaks you can see', () => {
  it('a fed-up tenant kicks off and the break shows on the map', () => {
    for (const seed of [1, 2, 3]) {
      const sim = morning(seed, true);
      const p = tenants(sim)[0];
      let got: string | undefined;
      for (let i = 0; i < 24 * 6 * 6 && !got; i++) {
        p.life!.liking = 18;
        p.life!.under.major = 10 * TICKS_PER_HOUR;
        sim.run(10 * TICKS_PER_MINUTE);
        got = p.life!.breakState?.kind;
      }
      expect(got, `seed ${seed}`).toBeDefined();
      expect(p.life!.breakState!.straw).toBeTruthy();
      expect(p.life!.memories.some((m) => m.id === 'letOffSteam')).toBe(true);
      expect(until(sim, 120, () => !!p.bubble && p.bubble.until > sim.state.tick)).toBe(true);
    }
  });

  it('an easy-going tenant sulks or sleeps it off, never smashes things', () => {
    const sim = morning(4, true);
    const p = tenants(sim)[0];
    p.life!.traits = ['easyGoing', 'friendly'];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      delete p.life!.breakState;
      seen.add(startBreak(sim, p, 'major', 'x', false)!);
    }
    expect([...seen].every((k) => ['sulk', 'bed'].includes(k))).toBe(true);
  });

  it('sulking happens on the landing, outside the flat', () => {
    const sim = morning();
    const p = breaker(sim, 'sulk');
    expect(until(sim, 180, () => p.doing === 'Sulking on the landing' && p.path.length === 0)).toBe(true);
    const lay = sim.layout;
    expect(lay.rooms[lay.roomOf[lay.node(Math.round(p.x), Math.round(p.s))]].shared).toBe(true);
  });

  it('slamming doors is a noise burst the neighbours can hear', () => {
    const sim = morning();
    const p = breaker(sim, 'slam');
    expect(until(sim, 120, () => p.doing === 'Slamming doors')).toBe(true);
    expect(noiseOf(p)).toBeGreaterThan(4);
    let loud = 0;
    for (let i = 0; i < 40; i++) {
      sim.run(TICKS_PER_MINUTE);
      loud = Math.max(loud, ...sim.noise().values());
    }
    expect(loud).toBeGreaterThanOrEqual(6);
  });

  it('kicking the bins dirties the lobby', () => {
    const sim = morning();
    const before = dirtOf(sim, SHARED);
    const p = breaker(sim, 'bins');
    expect(until(sim, 240, () => p.doing === 'Kicking the bins')).toBe(true);
    sim.run(20 * TICKS_PER_MINUTE);
    expect(dirtOf(sim, SHARED)).toBeGreaterThan(before + 0.05);
  });

  it('refusing to get up means a bed, and no work today', () => {
    const sim = morning();
    const p = breaker(sim, 'bed');
    expect(p.life!.workedDay).toBe(sim.day);
    expect(until(sim, 120, () => p.pose === 'sleep' && p.doing === 'Refusing to get up')).toBe(true);
    expect(p.life!.away).toBeNull();
  });

  it('a tantrum breaks something in their flat', () => {
    const sim = morning();
    const p = breaker(sim, 'tantrum');
    const cells = new Set(sim.layout.flatCells(sim.layout.flat(p.life!.flat)!));
    const broken = () => sim.state.furniture.filter((f) => f.broken !== undefined && cells.has(sim.layout.node(f.x, f.s))).length;
    const before = broken();
    expect(until(sim, 300, () => broken() > before)).toBe(true);
    expect(sim.state.notices.some((n) => n.text.includes('In a temper'))).toBe(true);
  });

  it('a tenant giving notice carries boxes out', () => {
    const sim = morning();
    const p = breaker(sim, 'boxes', 'extreme');
    expect(until(sim, 180, () => p.doing === 'Carrying boxes out')).toBe(true);
    expect(p.bubble?.text).toBe('Boxes');
  });

  it('the break ends and life goes on, and survives a save', () => {
    const sim = morning();
    const p = breaker(sim, 'slam', 'minor');
    sim.run(5 * TICKS_PER_MINUTE);
    const copy = deserialize(serialize(sim));
    expect(tenants(copy)[0].life!.breakState?.kind).toBe('slam');
    sim.run(4 * TICKS_PER_HOUR);
    expect(p.life!.breakState).toBeUndefined();
    expect(p.doing).not.toBe('Slamming doors');
  });
});

describe('inspirations', () => {
  /** Runs option `i` on a copy of the building. */
  function tryOption(base: Sim, i: number) {
    const sim = deserialize(serialize(base));
    const p = tenants(sim)[0];
    inspirations(sim, p)[i]();
    return { sim, p, kind: p.life!.breakState?.kind };
  }
  const count = (base: Sim) => inspirations(base, tenants(base)[0]).length;

  it('a happy tenant has good turns to choose from, by day only', () => {
    const sim = morning(4, true);
    expect(count(sim)).toBeGreaterThanOrEqual(3);
    while (sim.minuteOfDay !== 23 * 60) sim.run(TICKS_PER_MINUTE);
    expect(count(sim)).toBe(0);
  });

  it('tidying the stairwell clears shared dirt', () => {
    const base = morning(4, true);
    base.state.dirt[SHARED] = 0.6;
    const r = [...Array(count(base)).keys()].map((i) => tryOption(base, i)).find((x) => x.kind === 'tidy')!;
    expect(r).toBeDefined();
    r.sim.run(2 * TICKS_PER_HOUR);
    expect(dirtOf(r.sim, SHARED)).toBeLessThan(0.5);
    expect(tenants(r.sim).every((p) => p.life!.memories.some((m) => m.id === 'stairsDone'))).toBe(true);
  });

  it('a barbecue brings guests, who get a good memory and a friend', () => {
    const base = morning(4, true);
    const r = [...Array(count(base)).keys()].map((i) => tryOption(base, i)).find((x) => x.kind === 'bbq')!;
    expect(r).toBeDefined();
    const { sim, p } = r;
    const guest = tenants(sim).find((o) => o !== p)!;
    expect(guest.life!.breakState?.kind).toBe('bbq');
    expect(sim.state.chat.some((m) => m.text.startsWith('Small barbecue'))).toBe(true);
    expect(until(sim, 240, () => p.doing === 'At the barbecue')).toBe(true);
    expect(noiseOf(p)).toBeGreaterThan(0);
    sim.run(3 * TICKS_PER_HOUR);
    expect(guest.life!.memories.some((m) => m.id === 'gotBarbecue')).toBe(true);
    expect(guest.life!.social.some((m) => m.id === 'chat' && m.about === p.id)).toBe(true);
  });

  it('painting gives everyone a good thought; a plant stays in the lobby', () => {
    const base = morning(4, true);
    const kinds = new Set<string>();
    for (let i = 0; i < count(base); i++) {
      const { sim, p, kind } = tryOption(base, i);
      kinds.add(kind!);
      if (kind === 'paint') {
        sim.run(4 * TICKS_PER_HOUR);
        expect(tenants(sim).every((o) => o.life!.memories.some((m) => m.id === 'freshPaint'))).toBe(true);
      }
      if (kind === 'plant') {
        const plants = () => sim.state.furniture.filter((f) => f.def === 'plant').length;
        const before = plants();
        sim.run(4 * TICKS_PER_HOUR);
        expect(plants()).toBe(before + 1);
        expect(p.life!.breakState).toBeUndefined();
      }
    }
    expect(kinds.has('paint')).toBe(true);
    expect(kinds.has('plant')).toBe(true);
  });

  it('a handy tenant mends a neighbour\'s broken thing', () => {
    const base = morning(4, true);
    const [a, b] = tenants(base);
    a.life!.traits = ['handy', 'friendly'];
    const theirs = base.state.furniture.find((f) => base.layout.flatAt(f.x, f.s)?.id === b.life!.flat && !f.broken)!;
    breakIt(base, theirs);
    const r = [...Array(count(base)).keys()].map((i) => tryOption(base, i)).find((x) => x.kind === 'mend')!;
    expect(r).toBeDefined();
    r.sim.run(3 * TICKS_PER_HOUR);
    expect(r.sim.state.furniture.find((o) => o.id === theirs.id)!.broken).toBeUndefined();
    expect(tenants(r.sim)[1].life!.memories.some((m) => m.id === 'mendedForMe')).toBe(true);
  });
});
