import { describe, expect, it } from 'vitest';
import { buildRoom, placeFurniture, placeSegment, placeSlab, placeStair, removeFurniture, removeSegment, removeSlab, removeStair } from '../src/sim/build';
import { FURNITURE } from '../src/sim/defs';
import { random } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { MAX_STOREYS, TICKS_PER_MINUTE, type Segment } from '../src/sim/state';

const SEGMENTS: Segment[] = ['wall', 'window', 'door', 'flatDoor', 'entrance'];

/** Builds and knocks down at random while people come and go; nothing should break. */
function fuzz(seed: number, rounds: number): void {
  let sim = Sim.create(seed);
  const rng = { rng: seed * 7919 };
  const r = (n: number) => Math.floor(random(rng) * n);
  for (let i = 0; i < rounds; i++) {
    const st = sim.state;
    const x = st.plot.x0 - 1 + r(st.plot.x1 - st.plot.x0 + 3);
    const s = r(5);
    switch (r(10)) {
      case 0: placeSegment(st, x, s, SEGMENTS[r(SEGMENTS.length)]); break;
      case 1: removeSegment(st, x, s); break;
      case 2: placeSlab(st, x, 1 + r(5)); break;
      case 3: removeSlab(st, x, 1 + r(5)); break;
      case 4: placeStair(st, x, s, r(2) ? 1 : -1); break;
      case 5: if (st.stairs.length) removeStair(st, st.stairs[r(st.stairs.length)].id); break;
      case 6: placeFurniture(st, FURNITURE[r(FURNITURE.length)].id, x, s, r(3)); break;
      case 7: if (st.furniture.length) removeFurniture(st, st.furniture[r(st.furniture.length)].id); break;
      case 8: buildRoom(st, x, s, x + r(8), Math.min(MAX_STOREYS - 2, s + r(2))); break;
      default: break;
    }
    sim.changed();
    sim.run(5 * TICKS_PER_MINUTE);
    const lay = sim.layout;
    for (const p of st.pawns) {
      const atNode = Number.isInteger(p.x) && Number.isInteger(p.s);
      if (atNode && p.path.length === 0) {
        expect(lay.standable[lay.node(p.x, p.s)], `${p.name} at ${p.x},${p.s}`).toBe(1);
      }
    }
    if (i % 50 === 49) sim = deserialize(serialize(sim));
  }
}

describe('fuzzing build mode', () => {
  for (const seed of [1, 2, 3]) {
    it(`survives seed ${seed}`, () => fuzz(seed, 400));
  }
});
