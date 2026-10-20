// Decor curve (docs/specs/layout.md, section 5): the second of a kind in a room counts
// half, the third a quarter, so impressive can't be bought with a skip of pot plants.
// Variety, or spreading it across rooms, is the way round it.

import { describe, expect, it } from 'vitest';
import { placeFurniture } from '../src/sim/build';
import { flatScore } from '../src/sim/impressiveness';
import { Sim } from '../src/sim/sim';

// The bare first-floor flat, one room.
function decorWith(defs: [string, number][]): number {
  const sim = Sim.create(1);
  const st = sim.state;
  const id = sim.layout.flats[2].id;
  for (const [def, dx] of defs) {
    const f = placeFurniture(st, def, st.plot.x0 + dx, 5);
    if (typeof f === 'string') throw new Error(`${def} at ${dx}: ${f}`);
  }
  sim.changed();
  return flatScore(sim, id).factors.decor;
}

describe('the decor curve', () => {
  const base = decorWith([]);

  it('counts repeats of a kind in one room for less: whole, half, a quarter', () => {
    const one = decorWith([['plant', 14]]) - base;
    const two = decorWith([['plant', 14], ['plant', 15]]) - base;
    const three = decorWith([['plant', 14], ['plant', 15], ['plant', 16]]) - base;
    expect(two).toBeCloseTo(one * 1.5);
    expect(three).toBeCloseTo(one * 1.75);
  });

  it('is a real trade-off: three different things beat three of the same', () => {
    const same = decorWith([['plant', 14], ['plant', 15], ['plant', 16]]);
    const mixed = decorWith([['plant', 14], ['rug', 15], ['bookshelf', 17]]);
    expect(mixed).toBeGreaterThan(same);
  });
});
