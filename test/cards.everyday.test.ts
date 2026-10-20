import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardDef } from '../src/sim/cards';
import { EVERYDAY_CARDS } from '../src/sim/cards/everyday';
import { checkCard } from '../src/sim/cards/rule';

// The everyday cards (chunk b2): every one keeps the consequence rule on its fixtures, threads
// only to follow-ups that exist, and the words fit with the longest names there are.

describe('everyday cards', () => {
  it('each keeps the consequence rule on its fixtures', () => {
    expect(EVERYDAY_CARDS.flatMap((c) => checkCard(c))).toEqual([]);
  });

  it('are in the catalogue, mostly about tenants and the building, never the street', () => {
    for (const c of EVERYDAY_CARDS) expect(ALL_CARDS).toContain(c);
    const drawn = EVERYDAY_CARDS.filter((c) => !c.followUp);
    expect(drawn.filter((c) => c.source === 'street')).toEqual([]);
    expect(drawn.filter((c) => c.source === 'tenant').length).toBeGreaterThan(drawn.length / 2);
  });

  it('only thread to follow-up cards that exist, and a good share of them has one', () => {
    let threading = 0;
    for (const def of EVERYDAY_CARDS.filter((c) => !c.followUp)) {
      let any = false;
      for (const fx of def.fixtures) {
        const { sim, subject } = fx.build(1);
        const card = { id: 1, def: def.id, tick: sim.state.tick, until: sim.state.tick + 1, ...subject };
        for (const answer of [0, 1, 'ignored'] as const) {
          for (const e of def.resolve(sim, card, answer).effects.filter((x) => x.startsWith('thread:'))) {
            const target = cardDef(e.split(':')[1]);
            expect(target, e).toBeTruthy();
            expect(target!.followUp, e).toBe(true);
            any = true;
          }
        }
      }
      if (any) threading++;
    }
    expect(threading).toBeGreaterThanOrEqual(7);
  });

  it('hooks fit in 40 characters and texts in 80, with the longest first names', () => {
    for (const def of EVERYDAY_CARDS) {
      for (const fx of def.fixtures) {
        const { sim, subject } = fx.build(1);
        for (const p of sim.state.pawns) if (p.life) p.name = `Gareth ${p.name.split(' ').slice(1).join(' ')}`;
        const card = { id: 1, def: def.id, tick: sim.state.tick, until: sim.state.tick + 1, ...subject };
        expect(def.hook(sim, card).length, def.hook(sim, card)).toBeLessThanOrEqual(40);
        expect(def.text(sim, card).length, def.text(sim, card)).toBeLessThanOrEqual(80);
      }
    }
  });

  it('notes give facts (a price, free, when), never judgements or predictions', () => {
    for (const def of ALL_CARDS) {
      for (const fx of def.fixtures) {
        const { sim, subject } = fx.build(1);
        const card = { id: 1, def: def.id, tick: sim.state.tick, until: sim.state.tick + 1, ...subject };
        for (const c of def.choices(sim, card)) {
          expect(c.note, `${def.id}: ${c.note}`).not.toMatch(/'ll\b|\bwill\b|won't|\bmight\b|\bunwise\b|\bunpopular\b|\btrusting\b|\bsafe\b/i);
          expect(c.note.length, `${def.id}: ${c.note}`).toBeLessThanOrEqual(24);
        }
      }
    }
  });
});
