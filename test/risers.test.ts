// The wet stack (docs/specs/layout.md, section 3): kitchens and bathrooms plumb into the
// nearest riser. Near is free; far costs more to fit and wears faster. More risers can go
// in, once building control say yes, at a price; and a riser can leak down the building.

import { describe, expect, it } from 'vitest';
import v9 from './fixtures/v9-save.json?raw';
import { placeFurniture } from '../src/sim/build';
import { MORTGAGE, POUND } from '../src/sim/economy';
import { buyFurniture, fittedPrice, shiftFurniture } from '../src/sim/furnish';
import { changeFacts } from '../src/sim/preview';
import { applyForRisers, farCells, pipeCost, pipeWear, riserLeak, riserPrice, risersOf, unapproved, wetOf, wetRooms } from '../src/sim/risers';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, key, type BuildPartsData, type State } from '../src/sim/state';
import { RISERS } from '../src/sim/tuning';
import { copyParts, partsOf, piecesBetween, quote, signOff } from '../src/sim/works';
import { fixtureSim } from '../src/sim/cards/rule';
import { landlord } from './policy';

const at = (st: State, dx: number) => st.plot.x0 + dx;
/** The floor row of a storey's rooms. */
const floorRow = (storey: number) => 1 + storey * 4;

/** Runs until building control have answered (and applies again if they say no). */
function waitForControl(sim: Sim, cols: number[]): void {
  for (let day = 0; day < 30 && unapproved(sim.state, [...risersOf(sim.state), ...cols]).length > 0; day++) {
    if (!sim.state.wet?.applied) expect(applyForRisers(sim, cols)).toBeNull();
    sim.run(TICKS_PER_DAY);
  }
  expect(unapproved(sim.state, [...risersOf(sim.state), ...cols])).toEqual([]);
}

describe('the wet stack', () => {
  it('the building comes with one riser, by the stairs, and an old save gets it too', () => {
    const sim = Sim.create(1);
    expect(risersOf(sim.state)).toEqual([at(sim.state, RISERS.startColumn)]);
    // Up the stairwell, beside the flights, against the one-beds' front rooms.
    const x = risersOf(sim.state)[0];
    for (const storey of [0, 1, 2]) expect(sim.layout.rooms[sim.layout.roomOf[sim.layout.node(x, floorRow(storey))]].shared).toBe(true);
    expect(pipeCost(sim.state, 'cooker', at(sim.state, 14))).toBe(0);
    expect(pipeCost(sim.state, 'shower', at(sim.state, 26))).toBeGreaterThan(0);
    const old = deserialize(v9);
    expect(risersOf(old.state)).toEqual([old.state.plot.x0 + RISERS.startColumn]);
    // And a game saved with a second riser keeps it.
    wetOf(sim.state).risers.push(at(sim.state, 26));
    expect(risersOf(deserialize(serialize(sim)).state)).toEqual([x, at(sim.state, 26)]);
  });

  it('near the pipes costs nothing extra to plumb in; far costs more a cell, and says so', () => {
    const sim = fixtureSim(1);
    const st = sim.state;
    st.money = 5000 * POUND;
    const row = floorRow(1);
    // Two cells from the riser is free; each cell further costs; and past a point, no more.
    const r = risersOf(st)[0];
    expect(pipeCost(st, 'toilet', r + RISERS.freeReach)).toBe(0);
    expect(pipeCost(st, 'toilet', r - RISERS.freeReach)).toBe(0);
    expect(pipeCost(st, 'toilet', r + RISERS.freeReach + 3)).toBe(3 * RISERS.perCell);
    expect(farCells(risersOf(st), 'toilet', r + 40)).toBe(RISERS.mostCells);
    // A wide piece counts from its nearest end.
    expect(pipeCost(st, 'bath', r - RISERS.freeReach - 2)).toBe(RISERS.perCell);
    // Things that don't need water don't care.
    expect(pipeCost(st, 'doubleBed', at(st, 21))).toBe(0);
    expect(fittedPrice(st, 'toilet', at(st, 25))).toBeGreaterThan(fittedPrice(st, 'toilet', at(st, 14)));
    // The preview says it, as a fact; and nothing about it near the riser.
    const far = { id: -1, def: 'toilet', x: at(st, 25), s: row };
    const near = { id: -1, def: 'toilet', x: r + 1, s: row };
    expect(changeFacts(sim, {}, { furniture: [...st.furniture, far] }).map((f) => f.text)).toContain('Far from the pipes: dearer to fit');
    expect(changeFacts(sim, {}, { furniture: [...st.furniture, near] }).map((f) => f.text)).not.toContain('Far from the pipes: dearer to fit');
    // Buying it far books the plumbing on its own line.
    const before = st.money;
    const f = buyFurniture(sim, 'toilet', at(st, 25), row, false);
    expect(typeof f).not.toBe('string');
    expect(before - st.money).toBe(fittedPrice(st, 'toilet', at(st, 25)));
    expect(st.ledger.some((e) => e.label === 'Plumbing in the toilet')).toBe(true);
    // Moving it means plumbing it in again where it goes.
    const id = (f as { id: number }).id;
    const was = st.money;
    expect(shiftFurniture(sim, id, at(st, 14), row)).toBeNull();
    expect(was - st.money).toBe(pipeCost(st, 'toilet', at(st, 14)));
    expect(pipeCost(st, 'toilet', at(st, 14))).toBeLessThan(pipeCost(st, 'toilet', at(st, 25)));
  });

  it('far from the pipes, things wear out faster', () => {
    const st = Sim.create(1).state;
    const row = floorRow(1);
    const near = placeFurniture(st, 'shower', at(st, 14), row);
    const far = placeFurniture(st, 'shower', at(st, 26), row);
    const bed = placeFurniture(st, 'bed', at(st, 21), row);
    if (typeof near === 'string' || typeof far === 'string' || typeof bed === 'string') throw new Error('placing');
    expect(pipeWear(st, near)).toBeCloseTo(1 + farCells(risersOf(st), 'shower', near.x) * RISERS.wearPerCell);
    expect(pipeWear(st, far)).toBeCloseTo(1 + RISERS.mostCells * RISERS.wearPerCell);
    expect(pipeWear(st, far)).toBeGreaterThan(pipeWear(st, near));
    expect(pipeWear(st, bed)).toBe(1);
  });

  it('a new riser waits on building control, then the builders put it in, a storey at a time in the price', () => {
    const sim = fixtureSim(2);
    const st = sim.state;
    st.money = 5000 * POUND;
    const x = at(st, 26);
    const plan: BuildPartsData = { ...copyParts(partsOf(st)), risers: [...risersOf(st), x] };
    st.works.plan = plan;
    const pieces = piecesBetween(partsOf(st), plan);
    expect(pieces).toHaveLength(1);
    expect(quote(pieces).cost).toBe(riserPrice(st.cells));
    expect(riserPrice(st.cells)).toBe(3 * RISERS.perStorey);
    // Not until building control have said yes.
    expect(signOff(sim)).toMatch(/building control/i);
    const fee = st.money;
    expect(applyForRisers(sim, [x])).toBeNull();
    expect(fee - st.money).toBe(RISERS.controlFee);
    expect(applyForRisers(sim, [x])).toMatch(/Waiting on building control/);
    expect(st.post.some((l) => l.from.includes('Building Control'))).toBe(true);
    waitForControl(sim, [x]);
    expect(st.post.some((l) => l.title === 'Approved')).toBe(true);
    // Now the builders can have it.
    st.works.plan = { ...copyParts(partsOf(st)), risers: [...risersOf(st), x] };
    expect(signOff(sim)).toBeNull();
    for (let h = 0; h < 24 * 6 && st.works.job; h++) sim.run(TICKS_PER_HOUR);
    expect(st.works.job).toBeNull();
    expect(risersOf(st)).toContain(x);
    // And the end room is near the pipes now.
    expect(pipeCost(st, 'toilet', at(st, 25))).toBe(0);
    expect(st.ledger.some((e) => e.label.includes('riser'))).toBe(true);
  });

  it('a leaking riser wets the room it runs through on its floor and every floor below', () => {
    const sim = fixtureSim(3);
    const st = sim.state;
    // A riser up the end of the one-bed: through the bathrooms on every floor.
    const x = at(st, 26);
    wetOf(st).risers.push(x);
    sim.changed();
    const lay = sim.layout;
    const rooms = wetRooms(sim, x, 1);
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => lay.rooms[r].flat)).toEqual([lay.flats[0].id, lay.flats[2].id]);
    // Somebody downstairs to notice: the ground floor's sitting tenant.
    const ground = st.pawns.find((p) => p.life?.flat === lay.flats[0].id)!;
    const bathroom = new Set(lay.rooms[rooms[0]].cells);
    const wear = () => st.furniture.filter((f) => bathroom.has(lay.node(f.x, f.s))).reduce((n, f) => n + (f.wear ?? 0), 0);
    const before = wear();
    const money = st.money;
    // Whichever floor it starts on, it runs down to the ground.
    riserLeak(sim, x);
    expect(st.wet?.leak?.x).toBe(x);
    expect(ground.life!.memories.some((m) => m.id === 'riserLeak')).toBe(true);
    expect(money - st.money).toBe(RISERS.leakPlumber);
    expect(wear()).toBeGreaterThan(before);
  });
});

// ------------------------------------------------------------------ the two layouts

/**
 * Two ways to fit out the bare one-bed on the first floor and the stripped one on the
 * second (docs/specs/layout.md, section 3's test):
 *
 * - **stacked**: the bathroom moves next to the stairs, as near the riser the building came
 *   with as the flat reaches (a new wall and door, and the old wall at the far end comes
 *   out). The kitchen and living room go to the far end, a long way from the pipes.
 * - **riser**: the rooms stay where the shell has them, bathroom at the far end, and a
 *   second riser goes up the end of the building for it (which the ground-floor flat's
 *   bathroom, at the same end, gets the good of too).
 *
 * Everything is paid for the way a player would pay: the building work, the riser, the
 * furniture and the plumbing.
 */
function fitOut(sim: Sim, stacked: boolean): number {
  const st = sim.state;
  const target = copyParts(partsOf(st));
  for (const storey of [1, 2]) {
    const row = floorRow(storey);
    if (stacked) {
      // A wall and a door at 16; the wall at 24 comes out.
      target.cells[key(at(st, 16), row)] = 'door';
      target.cells[key(at(st, 16), row + 2)] = 'wall';
      delete target.cells[key(at(st, 24), row)];
      delete target.cells[key(at(st, 24), row + 2)];
    }
  }
  if (!stacked) target.risers = [...risersOf(st), at(st, 26)];
  const cost = quote(piecesBetween(partsOf(st), target)).cost;
  st.money -= cost;
  st.cells = target.cells;
  if (target.risers) wetOf(st).risers = target.risers;
  sim.changed();
  let pipes = 0;
  for (const storey of [1, 2]) {
    const row = floorRow(storey);
    const put = (def: string, dx: number, r = 0) => {
      pipes += pipeCost(st, def, at(st, dx));
      const f = buyFurniture(sim, def, at(st, dx), row + r, false);
      if (typeof f === 'string') throw new Error(`${def}: ${f}`);
    };
    if (stacked) {
      put('toilet', 14);
      put('shower', 15);
      put('doubleBed', 17);
      put('cooker', 21);
      put('sofa', 22);
      put('tv', 25);
      put('smokeAlarm', 22, 2);
    } else {
      put('cooker', 14);
      put('sofa', 15);
      put('tv', 18);
      put('doubleBed', 21);
      put('toilet', 25);
      put('shower', 26);
      put('smokeAlarm', 16, 2);
    }
    if (storey === 2) {
      put('radiator', 19, 1);
      put('radiator', 23, 1);
    }
  }
  return pipes;
}

interface Run {
  money: number;
  liking: number;
  n: number;
  pipes: number;
  riser: number;
}

function twelveWeeks(seed: number, stacked: boolean, days: number): Run {
  const sim = Sim.create(seed);
  const st = sim.state;
  // The same purse for both, enough to do either.
  st.money += 4000 * POUND;
  const x = at(st, 26);
  // Building control take the same days for both: the stacked landlord waits too, so the
  // only difference is the layout.
  if (!stacked) waitForControl(sim, [x]);
  else sim.run(days * TICKS_PER_DAY);
  const out: Run = { money: 0, liking: 0, n: 0, pipes: fitOut(sim, stacked), riser: 0 };
  for (let h = 0; h < 84 * 24; h++) {
    sim.run(TICKS_PER_HOUR);
    landlord(sim, 'decent');
    if (h % 24 === 12) {
      for (const p of st.pawns) {
        if (!p.life || p.life.leaving) continue;
        out.liking += p.life.liking;
        out.n++;
      }
    }
  }
  expect(st.repossessed, `seed ${seed}`).toBeUndefined();
  // What's yours: cash and what you've paid off the mortgage, less the deposits you're
  // holding (they go back when people leave, so one turnover near the end isn't a swing).
  const deposits = Object.values(st.flats).reduce((n, f) => n + (f.lease?.deposit ?? 0), 0);
  out.money = st.money + (MORTGAGE.balance - st.mortgage.balance) - deposits;
  out.riser = stacked ? 0 : riserPrice(st.cells);
  return out;
}

describe('the wet stack, over twelve weeks', () => {
  it('bathrooms stacked by the riser, or at the far end with a second riser: about the same money and liking', () => {
    const sum = { stacked: { money: 0, liking: 0, n: 0, pipes: 0, riser: 0 }, riser: { money: 0, liking: 0, n: 0, pipes: 0, riser: 0 } };
    for (const seed of [1, 2, 3, 4]) {
      // How long building control took for this seed (the stacked landlord waits as long).
      const probe = Sim.create(seed);
      const day0 = probe.day;
      waitForControl(probe, [at(probe.state, 26)]);
      const days = probe.day - day0;
      for (const stacked of [true, false]) {
        const r = twelveWeeks(seed, stacked, days);
        console.log(`seed ${seed} ${stacked ? 'stacked' : 'riser  '} money ${r.money / POUND} liking ${(r.liking / r.n).toFixed(1)}`);
        const t = sum[stacked ? 'stacked' : 'riser'];
        t.money += r.money;
        t.liking += r.liking;
        t.n += r.n;
        t.pipes += r.pipes;
        t.riser += r.riser;
      }
    }
    const like = (t: typeof sum.stacked) => t.liking / t.n;
    console.log('stacked', sum.stacked.money / POUND, like(sum.stacked).toFixed(1), 'pipes', sum.stacked.pipes / POUND, '| riser', sum.riser.money / POUND, like(sum.riser).toFixed(1), 'riser', sum.riser.riser / POUND);
    // Each has its price: the stacked one plumbs in a long way from the pipes, the other
    // buys a riser.
    expect(sum.stacked.pipes).toBeGreaterThan(sum.riser.pipes * 2);
    expect(sum.riser.riser).toBeGreaterThan(sum.stacked.pipes);
    // And neither wins: within 5% on money and on liking.
    const near = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
    expect(near(sum.stacked.money, sum.riser.money)).toBeLessThan(0.05);
    expect(near(like(sum.stacked), like(sum.riser))).toBeLessThan(0.05);
  }, 1200000);
});
