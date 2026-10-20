import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardDef } from '../src/sim/cards';
import { checkCard, fixtureSim, letFlat, sitting } from '../src/sim/cards/rule';
import { TENANT_CARDS } from '../src/sim/cards/tenant';
import type { Sim } from '../src/sim/sim';
import { readFlags } from '../src/sim/flags';
import { flatInfo } from '../src/sim/economy';
import { requestsHour } from '../src/sim/social';
import { TICKS_PER_DAY } from '../src/sim/state';

// The tenant cards (chunk 2a): every one keeps the consequence rule (test/cards.rule.test.ts
// checks the whole catalogue; this checks the tenant file on its own, so a failure names it),
// can't come where it can't be true, and the old chat requests don't come from the chat any more.

describe('tenant cards', () => {
  it('each keeps the consequence rule on its fixtures', () => {
    expect(TENANT_CARDS.flatMap((c) => checkCard(c))).toEqual([]);
  });

  it('are in the catalogue, from tenants, with the old chat requests among them', () => {
    for (const c of TENANT_CARDS) {
      expect(ALL_CARDS).toContain(c);
      expect(c.source).toBe('tenant');
    }
    for (const id of ['pet', 'heating', 'paint']) expect(cardDef(id)?.kind).toBe('ask');
  });

  it('only thread to follow-up cards that exist', () => {
    for (const def of TENANT_CARDS) {
      for (const fx of def.fixtures) {
        const { sim, subject } = fx.build(1);
        const card = { id: 1, def: def.id, tick: sim.state.tick, until: sim.state.tick + 1, ...subject };
        for (const answer of [0, 1, 'ignored'] as const) {
          for (const e of def.resolve(sim, card, answer).effects.filter((x) => x.startsWith('thread:'))) {
            const target = cardDef(e.split(':')[1]);
            expect(target, e).toBeTruthy();
            expect(target!.followUp, e).toBe(true);
          }
        }
      }
    }
  });

  it('don\'t come where they can\'t be true', () => {
    const plain = () => fixtureSim(1);
    // A building where each card can't happen: the plain starting one, unless that one could.
    const nowhere: Record<string, () => Sim> = {
      lockout: () => fixtureSim(1, 3, 23),
      drill: () => {
        const sim = plain();
        for (const p of sitting(sim)) p.life!.away = { until: sim.state.tick + TICKS_PER_DAY, why: 'At work' };
        return sim;
      },
      familyKey: () => {
        const sim = plain();
        sim.state.drip.flags.push({ id: 'familyKey' });
        return sim;
      },
      // Once the family has a key, there's no fall nobody hears.
      badTurn: () => {
        const sim = plain();
        sim.state.drip.flags.push({ id: 'familyKey' });
        return sim;
      },
      paint: () => {
        const sim = plain();
        for (const p of sitting(sim)) p.life!.traits = ['keenCook', 'easyGoing'];
        return sim;
      },
      heating: () => {
        const sim = plain();
        for (const p of sitting(sim)) p.life!.needs.warmth = 1;
        return sim;
      },
    };
    for (const def of TENANT_CARDS) {
      const sim = (nowhere[def.id] ?? plain)();
      const from = def.followUp ? { pawn: sitting(sim)[1].id } : undefined;
      expect(def.when(sim, from), def.id).toEqual([]);
      // And true on each fixture.
      for (const fx of def.fixtures) {
        const built = fx.build(1);
        expect(def.when(built.sim, def.followUp ? built.subject : undefined).length, `${def.id} on ${fx.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('fit the tray with the longest names in the game', () => {
    for (const def of TENANT_CARDS) {
      for (const fx of def.fixtures) {
        const { sim, subject } = fx.build(1);
        for (const p of sim.state.pawns) p.name = 'Gareth Featherstonehaugh';
        const card = { id: 1, def: def.id, tick: sim.state.tick, until: sim.state.tick + 1, ...subject };
        expect(def.hook(sim, card).length, def.hook(sim, card)).toBeLessThanOrEqual(40);
        expect(def.text(sim, card).length, def.text(sim, card)).toBeLessThanOrEqual(80);
      }
    }
  });

  it('a lockout is night only, and never once there\'s a key under the mat', () => {
    const lockout = cardDef('lockout')!;
    const { sim } = lockout.fixtures[0].build(1);
    expect(lockout.when(sim).length).toBeGreaterThan(0);
    sim.state.drip.flags.push({ id: 'keyUnderMat' });
    expect(lockout.when(sim)).toEqual([]);
  });
});

describe('the chat requests moved to the drip', () => {
  it('requestsHour asks for nothing, however keen the tenants', () => {
    const sim = fixtureSim(1);
    const [p] = letFlat(sim, 1, [['petOwner', 'houseProud']]);
    p.life!.since = -30;
    p.life!.needs.warmth = 0.1;
    const before = sim.state.chat.length;
    for (let i = 0; i < 24 * 14; i++) requestsHour(sim);
    expect(sim.state.chat.length).toBe(before);
  });

  it('a fortnight of play brings no pet, heating or paint asks into the chat', () => {
    const sim = fixtureSim(1, 1, 8);
    const [p] = letFlat(sim, 1, [['petOwner', 'houseProud']]);
    p.life!.since = -30;
    sim.run(14 * TICKS_PER_DAY);
    const asks = sim.state.chat.filter((m) => m.choices && /^(Would it be all right if I got|Is the heating on\? It's|Can I paint)/.test(m.text));
    expect(asks).toEqual([]);
  });
});

describe('the flags the tenant cards leave', () => {
  it('a lodger makes a small flat overcrowded, and only that flat', () => {
    const sim = fixtureSim(1);
    const [t] = letFlat(sim, 1, [['friendly'], ['friendly'], ['friendly']]);
    const name = sim.layout.flat(t.life!.flat)!.name;
    expect(readFlags(sim, 'council.issues', [])).toEqual([]);
    sim.state.drip.flags.push({ id: 'lodger', subject: t.life!.flat });
    const found = readFlags(sim, 'council.issues', []);
    const people = 4;
    const crowded = sim.layout.flatNodes(sim.layout.flat(t.life!.flat)!).length / people < 3;
    expect(found).toEqual(crowded ? [`${name} is overcrowded`] : []);
    expect(readFlags(sim, 'upkeep.wear', 1, { flat: t.life!.flat })).toBeGreaterThan(1);
    expect(readFlags(sim, 'upkeep.wear', 1, { flat: sitting(sim)[0].life!.flat })).toBe(1);
  });

  it('a painted flat lets slower once the painter has gone', () => {
    const sim = fixtureSim(1);
    const [p] = letFlat(sim, 1, [['houseProud']]);
    const flat = p.life!.flat;
    sim.state.drip.flags.push({ id: 'painted', subject: flat });
    expect(readFlags(sim, 'letting.hours', 10, { flat })).toBe(10);
    flatInfo(sim, flat).lease = null;
    expect(readFlags(sim, 'letting.hours', 10, { flat })).toBeGreaterThan(10);
  });

  it('a pet wears its own flat faster', () => {
    const sim = fixtureSim(1);
    const flat = sitting(sim)[0].life!.flat;
    sim.state.drip.flags.push({ id: 'petWear', subject: flat });
    expect(readFlags(sim, 'upkeep.wear', 1, { flat })).toBeGreaterThan(1);
    expect(readFlags(sim, 'upkeep.wear', 1, { flat: sitting(sim)[1].life!.flat })).toBe(1);
  });
});
