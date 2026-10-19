import { describe, expect, it } from 'vitest';
import type { BuildParts } from '../src/sim/build';
import { INSULATE_PRICE, furniturePrice } from '../src/sim/economy';
import { noiseReaching } from '../src/sim/environment';
import { buyFurniture, resaleOf, sellFurniture, shiftFurniture } from '../src/sim/furnish';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, key, type State } from '../src/sim/state';
import { copyParts, currentPiece, jobPieces, partsOf, piecesBetween, plannedParts, quote, signOff } from '../src/sim/works';

/** Draws plans the way build mode does: on a copy of the state, then stored as the plan. */
function plan(sim: Sim, draw: (draft: State) => void): BuildParts {
  const st = sim.state;
  const draft: State = { ...st, ...copyParts(plannedParts(st)), furniture: st.furniture };
  draw(draft);
  st.nextId = Math.max(st.nextId, draft.nextId);
  st.works.plan = copyParts(partsOf(draft));
  return st.works.plan;
}

/** Insulates the floor over the first `n` columns of Flat 1. */
function insulateOverFlat1(sim: Sim, n: number): (d: State) => void {
  const lay = sim.layout;
  const cols = lay.rooms[lay.flats[0].rooms[0]].nodes.map((node) => lay.xs(node)[0]).slice(0, n);
  return (d) => {
    for (const x of cols) d.insulated[`f:${key(x, 1)}`] = true;
  };
}

const runTo = (sim: Sim, day: number, hour: number) => sim.run((day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR - sim.state.tick);
const paidBuilders = (st: State) => st.ledger.filter((l) => l.label.startsWith('Bodge')).reduce((n, l) => n - l.amount, 0);

describe('building work', () => {
  it('changes nothing and costs nothing while it is only plans', () => {
    const sim = Sim.create(3);
    const before = JSON.stringify(partsOf(sim.state));
    plan(sim, insulateOverFlat1(sim, 2));
    sim.run(TICKS_PER_DAY);
    expect(JSON.stringify(partsOf(sim.state))).toBe(before);
    expect(paidBuilders(sim.state)).toBe(0);
  });

  it('is done by the builders in working hours once signed off, a piece at a time, paid as they go', () => {
    const sim = Sim.create(4);
    const st = sim.state;
    // Signed off after they've gone home: nothing happens overnight.
    runTo(sim, 1, 18);
    const target = plan(sim, insulateOverFlat1(sim, 2));
    const q = quote(piecesBetween(partsOf(st), target));
    expect(q.pieces).toBe(2);
    expect(q.cost).toBe(2 * INSULATE_PRICE);
    expect(signOff(sim)).toBeNull();
    expect(st.works.plan).toBeNull();
    runTo(sim, 2, 7);
    expect(jobPieces(sim)).toHaveLength(2);
    expect(currentPiece(sim)).toBeNull();
    // By lunch it's done.
    runTo(sim, 2, 12);
    expect(st.works.job).toBeNull();
    expect(JSON.stringify(st.insulated)).toBe(JSON.stringify(target.insulated));
    expect(paidBuilders(st)).toBe(q.cost);
  });

  it("won't sign off what you can't pay for, and stops when the money runs out", () => {
    const sim = Sim.create(5);
    const st = sim.state;
    plan(sim, insulateOverFlat1(sim, 1));
    st.money = 0;
    expect(signOff(sim)).toMatch(/you have/);
    st.money = 100_000;
    expect(signOff(sim)).toBeNull();
    st.money = 0;
    runTo(sim, 1, 12);
    expect(st.works.waiting).toBe(true);
    expect(st.works.job).not.toBeNull();
    st.money = 100_000;
    sim.run(2 * TICKS_PER_MINUTE);
    expect(st.works.job).toBeNull();
  });

  it('makes a racket next door while they work', () => {
    const sim = Sim.create(6);
    const lay = sim.layout;
    plan(sim, insulateOverFlat1(sim, 1));
    expect(signOff(sim)).toBeNull();
    sim.run(5 * TICKS_PER_MINUTE);
    expect(currentPiece(sim)).not.toBeNull();
    expect(sim.noise().get(lay.flats[0].id) ?? 0).toBeGreaterThanOrEqual(5);
    // The flat upstairs hears it.
    expect(lay.flats.slice(1).some((f) => noiseReaching(sim, sim.noise(), f.id).amount > 0)).toBe(true);
  });

  it('keeps plans and jobs through a save', () => {
    const sim = Sim.create(7);
    plan(sim, insulateOverFlat1(sim, 2));
    const back = deserialize(serialize(sim));
    expect(back.state.works.plan).toEqual(sim.state.works.plan);
    expect(back.state.nextId).toBe(sim.state.nextId);
  });
});

describe('furniture', () => {
  it('goes in, moves and sells straight away, with no builders', () => {
    const sim = Sim.create(8);
    const st = sim.state;
    const money = st.money;
    const f = buyFurniture(sim, 'plant', st.plot.x0 + 12, 0, 0, false);
    if (typeof f === 'string') throw new Error(f);
    expect(st.money).toBe(money - furniturePrice('plant'));
    expect(shiftFurniture(sim, f.id, st.plot.x0 + 11, 0, 0)).toBeNull();
    expect(f.x).toBe(st.plot.x0 + 11);
    sellFurniture(sim, f.id);
    expect(st.furniture.some((o) => o.id === f.id)).toBe(false);
    expect(st.money).toBe(money - furniturePrice('plant') + resaleOf('plant'));
    expect(st.works.job).toBeNull();
  });

  it("can't go where a planned wall will stand", () => {
    const sim = Sim.create(9);
    const st = sim.state;
    const x = st.plot.x0 + 12;
    let draft!: State;
    plan(sim, (d) => {
      d.walls[key(x, 0)] = 'wall';
      draft = d;
    });
    expect(buyFurniture(sim, 'plant', x, 0, 0, false, draft)).toBe('A wall or door is in the way');
  });

  it('gets whoever is using a piece up when it moves', () => {
    const sim = Sim.create(10);
    const st = sim.state;
    sim.run(TICKS_PER_DAY);
    const user = st.pawns.find((p) => p.life?.using && st.furniture.some((f) => f.id === p.life!.using!.furniture));
    if (!user) return;
    const f = st.furniture.find((o) => o.id === user.life!.using!.furniture)!;
    sellFurniture(sim, f.id);
    expect(user.life!.using).toBeNull();
  });
});
