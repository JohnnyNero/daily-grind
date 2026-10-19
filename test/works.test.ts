import { describe, expect, it } from 'vitest';
import { placeFurniture, removeFurniture, type BuildParts } from '../src/sim/build';
import { furniturePrice } from '../src/sim/economy';
import { noiseReaching } from '../src/sim/environment';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type State } from '../src/sim/state';
import { copyParts, currentPiece, jobPieces, partsOf, piecesBetween, plannedParts, quote, signOff } from '../src/sim/works';

/** Draws plans the way build mode does: on a copy of the state, then stored as the plan. */
function plan(sim: Sim, draw: (draft: State) => void): BuildParts {
  const st = sim.state;
  const draft: State = { ...st, ...copyParts(plannedParts(st)) };
  draw(draft);
  st.nextId = Math.max(st.nextId, draft.nextId);
  st.works.plan = copyParts(partsOf(draft));
  return st.works.plan;
}

const runTo = (sim: Sim, day: number, hour: number) => sim.run((day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR - sim.state.tick);

describe('building work', () => {
  it('changes nothing and costs nothing while it is only plans', () => {
    const sim = Sim.create(3);
    const before = JSON.stringify(partsOf(sim.state));
    const money = sim.state.money;
    plan(sim, (d) => placeFurniture(d, 'plant', d.plot.x0 + 12, 0, 0));
    sim.run(TICKS_PER_DAY);
    expect(JSON.stringify(partsOf(sim.state))).toBe(before);
    expect(sim.state.money).toBeGreaterThanOrEqual(money - 1000 * 100);
    expect(sim.state.ledger.some((l) => l.label.startsWith('Bodge'))).toBe(false);
  });

  it('is done by the builders in working hours once signed off, a piece at a time, paid as they go', () => {
    const sim = Sim.create(4);
    const st = sim.state;
    const sofa = st.furniture.find((f) => f.def === 'sofa')!;
    const target = plan(sim, (d) => {
      placeFurniture(d, 'plant', d.plot.x0 + 12, 0, 0);
      removeFurniture(d, sofa.id);
    });
    const q = quote(piecesBetween(partsOf(st), target));
    expect(q.pieces).toBe(2);
    expect(q.cost).toBe(furniturePrice('plant') - Math.round(furniturePrice('sofa') * 0.3));
    // Signed off after they've gone home: nothing happens overnight.
    runTo(sim, 1, 18);
    expect(signOff(sim)).toBeNull();
    expect(st.works.plan).toBeNull();
    runTo(sim, 2, 7);
    expect(jobPieces(sim)).toHaveLength(2);
    expect(currentPiece(sim)).toBeNull();
    // By lunch it's done, the sofa's gone and the plant's in.
    runTo(sim, 2, 12);
    expect(st.works.job).toBeNull();
    expect(JSON.stringify(partsOf(st))).toBe(JSON.stringify(target));
    const paid = st.ledger.filter((l) => l.label.startsWith('Bodge')).reduce((n, l) => n - l.amount, 0);
    expect(paid).toBe(q.cost);
  });

  it("won't sign off what you can't pay for, and stops when the money runs out", () => {
    const sim = Sim.create(5);
    const st = sim.state;
    plan(sim, (d) => placeFurniture(d, 'plant', d.plot.x0 + 12, 0, 0));
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
    // Insulating the floor between Flat 1 and the flat over it.
    const lay = sim.layout;
    const [x] = lay.xs(lay.rooms[lay.flats[0].rooms[0]].nodes[0]);
    plan(sim, (d) => {
      d.insulated[`f:${x},1`] = true;
    });
    expect(signOff(sim)).toBeNull();
    sim.run(5 * TICKS_PER_MINUTE);
    const work = currentPiece(sim);
    expect(work).not.toBeNull();
    expect(sim.noise().get(lay.flats[0].id) ?? 0).toBeGreaterThanOrEqual(5);
    // The flat upstairs hears it.
    expect(lay.flats.slice(1).some((f) => noiseReaching(sim, sim.noise(), f.id).amount > 0)).toBe(true);
  });

  it('keeps plans and jobs through a save', () => {
    const sim = Sim.create(7);
    plan(sim, (d) => placeFurniture(d, 'plant', d.plot.x0 + 12, 0, 0));
    const back = deserialize(serialize(sim));
    expect(back.state.works.plan).toEqual(sim.state.works.plan);
    expect(back.state.nextId).toBe(sim.state.nextId);
  });
});
