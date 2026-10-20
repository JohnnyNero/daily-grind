import { describe, expect, it } from 'vitest';
import '../src/sim/cards';
import { BUILDING_CARDS } from '../src/sim/cards/building';
import { checkCard, fixtureSim, resolveOn } from '../src/sim/cards/rule';
import { FLAGS } from '../src/sim/flags';

describe('building cards (chunk 2b)', () => {
  it('there are five, and each passes the rule on its fixtures', () => {
    expect(BUILDING_CARDS.map((c) => c.id)).toEqual(['ceilingDrip', 'ceilingDripAgain', 'bins', 'chirping', 'windowGone']);
    for (const c of BUILDING_CARDS) {
      expect(c.fixtures.length, c.id).toBeGreaterThanOrEqual(2);
      expect(checkCard(c), c.id).toEqual([]);
    }
  });

  it('none can happen in the starting building', () => {
    const sim = fixtureSim(1);
    for (const c of BUILDING_CARDS.filter((x) => !x.followUp && x.id !== 'windowGone')) expect(c.when(sim), c.id).toEqual([]);
  });

  it('the window is rare until there has been a break-in', () => {
    const sim = fixtureSim(1);
    const w = BUILDING_CARDS.find((c) => c.id === 'windowGone')!;
    expect(w.when(sim)[0].weight).toBeLessThan(1);
  });

  it('every effect in every outcome is lasting-checked and flags exist', () => {
    for (const c of BUILDING_CARDS) for (const fx of c.fixtures) {
      const r = resolveOn(c, fx);
      for (const o of Object.values(r.outcomes)) for (const e of o.effects) if (e.startsWith('flag:')) expect(FLAGS[e.split(':')[1]], e).toBeTruthy();
    }
  });
});
