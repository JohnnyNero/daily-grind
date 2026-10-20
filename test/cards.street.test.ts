import { describe, expect, it } from 'vitest';
import { checkCard } from '../src/sim/cards/rule';
import { STREET_CARDS } from '../src/sim/cards/street';
import { cardDef } from '../src/sim/cards';
import { setFlag } from '../src/sim/flags';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';

// Street cards (chunk 2c): the rule holds whichever way the dice fall, the follow-ups they
// thread to exist, and the cards only come when their conditions are true.

describe('street cards', () => {
  it('keep the consequence rule on every fixture, across many seeds (so the dice can\'t break it)', () => {
    const problems = STREET_CARDS.flatMap((c) => Array.from({ length: 12 }, (_, i) => checkCard(c, i + 1)).flat());
    expect([...new Set(problems)]).toEqual([]);
  });

  it('are all street cards, with unique ids, and the follow-ups never get drawn on their own', () => {
    expect(STREET_CARDS.every((c) => c.source === 'street')).toBe(true);
    expect(new Set(STREET_CARDS.map((c) => c.id)).size).toBe(STREET_CARDS.length);
    for (const id of ['vanBreak', 'meterAgain']) expect(cardDef(id)?.followUp).toBe(true);
    expect(cardDef('mattress')).toBeTruthy();
  });

  it('only come in the right hours', () => {
    const day = (id: string, hour: number) => {
      const def = cardDef(id)!;
      const { sim } = def.fixtures[0].build(1);
      sim.state.tick = Math.floor(sim.state.tick / TICKS_PER_DAY) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
      return def.when(sim).length;
    };
    expect(day('parcel', 10)).toBeGreaterThan(0);
    expect(day('parcel', 3)).toBe(0);
    expect(day('cat', 3)).toBe(0);
    expect(day('pizza', 21)).toBeGreaterThan(0);
    expect(day('pizza', 11)).toBe(0);
  });

  it('stop coming when they have been answered for good', () => {
    const cat = cardDef('cat')!;
    const { sim } = cat.fixtures[0].build(1);
    expect(cat.when(sim).length).toBeGreaterThan(0);
    setFlag(sim, 'buildingCat');
    expect(cat.when(sim)).toEqual([]);
    const scaff = cardDef('scaffolding')!;
    const s2 = scaff.fixtures[0].build(1).sim;
    expect(scaff.when(s2).length).toBeGreaterThan(0);
    setFlag(s2, 'scaffolding', undefined, s2.state.tick + TICKS_PER_DAY);
    expect(scaff.when(s2)).toEqual([]);
  });
});
