// Heat and damp by room (docs/specs/layout.md 2.2 to 2.4, chunk L3): radiators heat their
// room, heat rises and leaks out of the roof; damp comes from wet rooms with no window or
// fan, from the ground and from leaks, spreads and drips down, and over a line is mould.

import { describe, expect, it } from 'vitest';
import v9 from './fixtures/v9-save.json?raw';
import { placeFurniture } from '../src/sim/build';
import { INSULATE_PRICE, book, flatInfo, goingRate } from '../src/sim/economy';
import { flatDamp, roomDamp } from '../src/sim/damp';
import { hasFlag } from '../src/sim/flags';
import { roomShapes, roomTemp, livingRooms } from '../src/sim/heat';
import { flatScore, rentScore } from '../src/sim/impressiveness';
import { makePerson } from '../src/sim/leases';
import { changeFacts } from '../src/sim/preview';
import { flatKind } from '../src/sim/rooms';
import { deserialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, key, type State } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { thoughtsOf } from '../src/sim/thoughts';
import { issues } from '../src/sim/upkeep';
import { DAMP } from '../src/sim/tuning';
import { skipHandover } from '../src/sim/handover';
import { landlord } from './policy';

const BASE = 1;
const STOREY = 4;
const row = (storey: number) => BASE + storey * STOREY;

function put(st: State, def: string, dx: number, r: number): void {
  const f = placeFurniture(st, def, st.plot.x0 + dx, r);
  if (typeof f === 'string') throw new Error(`${def}: ${f}`);
}

/** The right-hand flat on a storey fitted as a one-bed: kitchen and living room, bedroom, bathroom. */
function fitOneBed(st: State, storey: number, radiators = true): void {
  const r = row(storey);
  put(st, 'cooker', 14, r);
  put(st, 'sofa', 15, r);
  put(st, 'tv', 18, r);
  put(st, 'doubleBed', 21, r);
  put(st, 'toilet', 25, r);
  put(st, 'shower', 26, r);
  put(st, 'smokeAlarm', 16, r + 2);
  if (radiators && !st.furniture.some((f) => f.def === 'radiator' && f.s === r + 1 && f.x === st.plot.x0 + 19)) {
    put(st, 'radiator', 19, r + 1);
    put(st, 'radiator', 23, r + 1);
  }
}

/** The layout room a cell is in. */
function roomAt(sim: Sim, dx: number, r: number): number {
  return sim.layout.roomOf[sim.layout.node(sim.state.plot.x0 + dx, r)];
}

function hours(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.run(TICKS_PER_HOUR);
}

/** The roof cells over the right-hand flats. */
function roofOverTop(st: State): string[] {
  return Array.from({ length: 13 }, (_, i) => key(st.plot.x0 + 14 + i, row(3) - 1));
}

describe('heat by room', () => {
  it('a radiator heats its own room: the bathroom without one is colder than the bedroom with one', () => {
    const sim = Sim.create(1);
    skipHandover(sim);
    sim.state.boiler = 2;
    hours(sim, 3 * 24);
    const r = row(0);
    expect(roomTemp(sim, roomAt(sim, 22, r))).toBeGreaterThan(roomTemp(sim, roomAt(sim, 25, r)) + 3);
  });

  it('a flat\'s warmth is its bedrooms\' and living rooms\' average', () => {
    const sim = Sim.create(2);
    skipHandover(sim);
    hours(sim, 2 * 24);
    const id = sim.layout.flats[0].id;
    const rooms = livingRooms(sim, id);
    expect(rooms.length).toBe(2);
    const avg = rooms.reduce((n, r) => n + roomTemp(sim, r), 0) / rooms.length;
    expect(sim.state.temps[id]).toBeCloseTo(avg, 5);
  });

  it('heat rises: a room over a heated flat is warmer than the same room over a cold one', () => {
    const run = (heatBelow: boolean) => {
      const sim = Sim.create(3);
      skipHandover(sim);
      sim.state.boiler = 2;
      // Take out the radiators below the bare first-floor one-bed, or not.
      if (!heatBelow) sim.state.furniture = sim.state.furniture.filter((f) => !(f.def === 'radiator' && f.s === row(0) + 1 && f.x >= sim.state.plot.x0 + 14));
      sim.changed();
      hours(sim, 4 * 24);
      return roomTemp(sim, roomAt(sim, 22, row(1)));
    };
    expect(run(true)).toBeGreaterThan(run(false) + 0.5);
  });

  it('the top floor loses heat through the roof, and insulating the roof keeps it in', () => {
    const run = (lagged: boolean) => {
      const sim = Sim.create(4);
      skipHandover(sim);
      fitOneBed(sim.state, 2);
      sim.state.boiler = 1;
      if (lagged) for (const k of roofOverTop(sim.state)) sim.state.insulated[k] = true;
      sim.changed();
      hours(sim, 5 * 24);
      return { top: sim.state.temps[sim.layout.flats[4].id], middle: sim.state.temps[sim.layout.flats[2].id] };
    };
    const bare = run(false);
    const lagged = run(true);
    expect(lagged.top).toBeGreaterThan(bare.top + 1);
  });

  it('a card that sets a flat\'s temperature moves its rooms with it', () => {
    const sim = Sim.create(5);
    skipHandover(sim);
    hours(sim, 24);
    const id = sim.layout.flats[0].id;
    const was = sim.state.temps[id];
    sim.state.temps[id] = 6;
    hours(sim, 1);
    expect(sim.state.temps[id]).toBeLessThan(was - 4);
    for (const r of livingRooms(sim, id)) expect(roomTemp(sim, r)).toBeLessThan(was - 3);
  });

  it('when the walls move, the rooms keep their warmth rather than starting again', () => {
    const sim = Sim.create(6);
    skipHandover(sim);
    sim.state.boiler = 3;
    hours(sim, 2 * 24);
    const id = sim.layout.flats[0].id;
    const before = sim.state.temps[id];
    // Knock the bedroom door through to the bathroom: two rooms become one.
    const st = sim.state;
    const x = st.plot.x0 + 24;
    for (const r of [0, 1, 2]) delete st.cells[key(x, row(0) + r)];
    sim.changed();
    hours(sim, 1);
    expect(Math.abs(sim.state.temps[id] - before)).toBeLessThan(3);
    expect(Object.keys(st.roomTemps!).length).toBe(roomShapes(sim).size);
  });
});

describe('damp', () => {
  /** A couple in the bare first-floor one-bed, fitted, with or without a window in the bathroom's wall or a fan. */
  function damp(opts: { window?: boolean; fan?: boolean; days?: number }): Sim {
    const sim = Sim.create(7);
    skipHandover(sim);
    const st = sim.state;
    fitOneBed(st, 1);
    // The end wall's window bricked up, unless asked for.
    const end = key(st.plot.x0 + 27, row(1) + 1);
    if (!opts.window) st.cells[end] = 'wall';
    if (opts.fan) put(st, 'extractorFan', 26, row(1) + 2);
    sim.changed();
    const id = sim.layout.flats[2].id;
    flatInfo(sim, id).lease = { rent: 100_00, startDay: sim.day, endDay: sim.day + 60, deposit: 0, owed: 0, paid: 0, late: 0 };
    moveIn(sim, id, [makePerson(st), makePerson(st)], [], 'couple');
    // Nothing breaks and leaks: this is about the steam.
    for (let h = 0; h < (opts.days ?? 21) * 24; h++) {
      for (const f of st.furniture) {
        f.wear = 0;
        delete f.broken;
      }
      sim.run(TICKS_PER_HOUR);
    }
    return sim;
  }

  it('a bathroom with no window and no fan goes mouldy; a window or a fan keeps it down', () => {
    const shut = damp({});
    const id = shut.layout.flats[2].id;
    const bath = roomAt(shut, 25, row(1));
    expect(roomDamp(shut, bath)).toBeGreaterThanOrEqual(DAMP.mould);
    expect(hasFlag(shut, 'mould', id)).toBe(true);
    expect(issues(shut).some((i) => i.includes('damp and mould'))).toBe(true);
    const people = shut.state.pawns.filter((p) => p.life?.flat === id);
    expect(people.every((p) => thoughtsOf(shut, p).some((t) => t.label === 'Mould on the walls'))).toBe(true);
    // It shows in how the flat comes across.
    expect(flatScore(shut, id).factors.clean).toBeLessThan(90);
    for (const opts of [{ window: true }, { fan: true }]) {
      const sim = damp(opts);
      expect(roomDamp(sim, roomAt(sim, 25, row(1)))).toBeLessThan(roomDamp(shut, bath) - 0.2);
      expect(flatDamp(sim, id)).toBeLessThan(DAMP.mould);
    }
  });

  it('rises from the ground where the plinth has no damp course', () => {
    const run = (course: boolean) => {
      const sim = Sim.create(8);
      skipHandover(sim);
      if (course) for (let x = sim.state.plot.x0; x <= sim.state.plot.x1; x++) sim.state.insulated[key(x, 0)] = true;
      sim.changed();
      hours(sim, 10 * 24);
      return roomDamp(sim, roomAt(sim, 22, row(0)));
    };
    const bare = run(false);
    expect(bare).toBeGreaterThan(0.05);
    expect(run(true)).toBeLessThan(bare / 2);
  });

  it('a leaking shower upstairs drips into the room below', () => {
    const run = (leak: boolean) => {
      const sim = Sim.create(9);
      skipHandover(sim);
      fitOneBed(sim.state, 1);
      if (leak) sim.state.furniture.find((f) => f.def === 'shower' && f.s === row(1) && f.x === sim.state.plot.x0 + 26)!.broken = 1;
      sim.changed();
      hours(sim, 7 * 24);
      return roomDamp(sim, roomAt(sim, 25, row(0)));
    };
    expect(run(true)).toBeGreaterThan(run(false) + 0.1);
  });

  it('a kitchen with no fan sends the tea up into the bedroom above; a fan stops it', () => {
    const run = (fan: boolean) => {
      const sim = Sim.create(10);
      skipHandover(sim);
      const st = sim.state;
      // Upstairs, the bed goes in the room over the ground-floor flat's kitchen.
      const r = row(1);
      put(st, 'doubleBed', 15, r);
      put(st, 'cooker', 21, r);
      put(st, 'toilet', 25, r);
      put(st, 'shower', 26, r);
      if (fan) put(st, 'extractorFan', 15, row(0) + 1);
      sim.changed();
      const up = sim.layout.flats[2].id;
      flatInfo(sim, up).lease = { rent: 100_00, startDay: sim.day, endDay: sim.day + 60, deposit: 0, owed: 0, paid: 0, late: 0 };
      const sniffer = moveIn(sim, up, [{ ...makePerson(st), traits: ['friendly'] }])[0];
      const cook = sim.state.pawns.find((p) => p.life?.flat === sim.layout.flats[0].id)!;
      let smelt = false;
      for (let h = 0; h < 2 * 24; h++) {
        sim.run(TICKS_PER_HOUR - 1);
        // The cook at the cooker, the neighbour in bed above, as the hour turns.
        cook.doing = 'Cooking';
        cook.x = st.plot.x0 + 14;
        cook.s = row(0);
        sniffer.x = st.plot.x0 + 16;
        sniffer.s = r;
        sim.run(1);
        smelt ||= sniffer.life!.memories.some((m) => m.id === 'smeltCooking');
      }
      return smelt;
    };
    expect(run(false)).toBe(true);
    expect(run(true)).toBe(false);
  });
});

describe('the building preview, warmth and damp', () => {
  it('says a fan makes the bathroom drier and a radiator the bedroom warmer, and changes nothing', () => {
    const sim = Sim.create(11);
    skipHandover(sim);
    const st = sim.state;
    fitOneBed(st, 1, false);
    fitOneBed(st, 2, false);
    st.cells[key(st.plot.x0 + 27, row(1) + 1)] = 'wall';
    sim.changed();
    const before = JSON.stringify(st);
    const fan = { id: -1, def: 'extractorFan', x: st.plot.x0 + 26, s: row(1) + 2 };
    expect(changeFacts(sim, {}, { furniture: [...st.furniture, fan] }).map((f) => f.text)).toContain('Flat 3 bathroom: drier');
    const rad = { id: -2, def: 'radiator', x: st.plot.x0 + 22, s: row(1) + 1 };
    expect(changeFacts(sim, {}, { furniture: [...st.furniture, rad] }).map((f) => f.text)).toContain('Flat 3 bedroom: warmer');
    const roof = Object.fromEntries(roofOverTop(st).map((k) => [k, true as const]));
    const lagged = changeFacts(sim, {}, { insulated: { ...st.insulated, ...roof } }).map((f) => f.text);
    expect(lagged.some((t) => /^Flat 5 .*: warmer$/.test(t))).toBe(true);
    expect(JSON.stringify(st)).toBe(before);
  });
});

describe('saves', () => {
  it('an old save without room warmth or damp loads and carries on', () => {
    const sim = deserialize(v9);
    expect(sim.state.roomTemps).toEqual({});
    sim.run(2 * TICKS_PER_HOUR);
    expect(Object.keys(sim.state.roomTemps!).length).toBe(roomShapes(sim).size);
    for (const f of sim.layout.flats) expect(Number.isFinite(sim.state.temps[f.id])).toBe(true);
    expect(flatKind(sim, sim.layout.flats[0].id).rooms.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ the trade-off

describe('the top flat, with and without roof insulation, over six weeks', () => {
  it('bare is colder and cheaper; insulated is warmer, better liked and dearer', () => {
    const runs = { bare: [] as Run[], lagged: [] as Run[] };
    for (const seed of [1, 2, 3]) for (const lagged of [false, true]) runs[lagged ? 'lagged' : 'bare'].push(roofRun(seed, lagged));
    const mean = (rs: Run[], k: keyof Run) => rs.reduce((n, r) => n + r[k], 0) / rs.length;
    const [bare, lagged] = [runs.bare, runs.lagged];
    console.log('roof soak', JSON.stringify(runs));
    expect(mean(lagged, 'temp')).toBeGreaterThan(mean(bare, 'temp') + 1.5);
    expect(mean(lagged, 'liking')).toBeGreaterThan(mean(bare, 'liking') + 2);
    expect(mean(lagged, 'score')).toBeGreaterThan(mean(bare, 'score'));
    expect(mean(lagged, 'rate')).toBeGreaterThanOrEqual(mean(bare, 'rate'));
    expect(mean(lagged, 'spent')).toBeGreaterThan(0);
    expect(mean(bare, 'spent')).toBe(0);
  }, 1_200_000);
});

interface Run {
  temp: number;
  /** How the flat comes across (impressiveness), on average. */
  score: number;
  liking: number;
  rate: number;
  spent: number;
}

/** Six weeks over the winter of the decent landlord with the boiler kept low, the top flat fitted out, its roof insulated or not. */
function roofRun(seed: number, lagged: boolean): Run {
  const sim = Sim.create(seed);
  skipHandover(sim);
  sim.state.tick = 20 * TICKS_PER_DAY;
  fitOneBed(sim.state, 2);
  sim.changed();
  const top = sim.layout.flats[4].id;
  let spent = 0;
  if (lagged) {
    const roof = roofOverTop(sim.state);
    for (const k of roof) sim.state.insulated[k] = true;
    spent = roof.length * INSULATE_PRICE;
    book(sim, 'Roof insulation', -spent);
    sim.changed();
  }
  let temp = 0;
  let rate = 0;
  let score = 0;
  let n = 0;
  let liking = 0;
  let liked = 0;
  for (let h = 0; h < 6 * 7 * 24; h++) {
    sim.run(TICKS_PER_HOUR);
    landlord(sim, 'decent');
    sim.state.boiler = 1;
    temp += sim.state.temps[top];
    rate += goingRate(sim, top);
    score += rentScore(sim, top).score;
    n++;
    for (const p of sim.state.pawns) {
      if (p.life?.flat !== top || p.life.leaving) continue;
      liking += p.life.liking;
      liked++;
    }
  }
  return { temp: temp / n, liking: liking / Math.max(1, liked), rate: rate / n / 100, score: score / n, spent: spent / 100 };
}
