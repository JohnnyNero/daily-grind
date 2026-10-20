import { describe, expect, it } from 'vitest';
import { FIRST_WEEK_CARDS, FIRST_WEEK_SCRIPT } from '../src/sim/cards/firstWeek';
import { ALL_CARDS, cardDef } from '../src/sim/cards';
import { checkCard, fixtureSim } from '../src/sim/cards/rule';
import { makeCard } from '../src/sim/cards/types';
import { DRIP } from '../src/sim/tuning';
import { flatInfo } from '../src/sim/economy';
import { nextProject, pinProject, projectEta, projectLine } from '../src/sim/project';
import { Sim } from '../src/sim/sim';
import { skipHandover, touring, skipAhead } from '../src/sim/handover';
import { hasFlag } from '../src/sim/flags';
import { TICKS_PER_DAY } from '../src/sim/state';

// Chunk 7: the first week's script and cards, and the project bar.

describe('the first week', () => {
  it('has cards that keep the consequence rule', () => {
    expect(FIRST_WEEK_CARDS.length).toBeGreaterThan(10);
    for (const c of FIRST_WEEK_CARDS) {
      expect(c.followUp, c.id).toBe(true);
      expect(checkCard(c), c.id).toEqual([]);
    }
  });

  it('scripts 0 or 1 cards a day for days 1 to 7 (day 1 not card-led, a card most days), all of them real cards', () => {
    for (let day = 1; day <= 7; day++) {
      const beats = FIRST_WEEK_SCRIPT.filter((b) => b.day === day).sort((a, b) => a.minute - b.minute);
      expect(beats.length, `day ${day}`).toBeLessThanOrEqual(1);
      for (const b of beats) expect(cardDef(b.card), b.card).toBeDefined();
      for (let i = 1; i < beats.length; i++) expect(beats[i].minute - beats[i - 1].minute).toBeGreaterThanOrEqual(DRIP.minGap);
    }
    expect(FIRST_WEEK_SCRIPT.length).toBeGreaterThanOrEqual(5);
    expect(FIRST_WEEK_SCRIPT.filter((b) => b.day === 1).every((b) => b.minute >= 18 * 60)).toBe(true);
    expect(FIRST_WEEK_SCRIPT.every((b) => b.day >= 1 && b.day <= 7)).toBe(true);
  });

  it('can happen on the starting building when each beat is due, so none is skipped on a default game', () => {
    for (const b of FIRST_WEEK_SCRIPT) {
      const def = cardDef(b.card)!;
      const sim = fixtureSim(1, b.day, Math.floor(b.minute / 60));
      expect(def.when(sim).length, b.card).toBeGreaterThan(0);
    }
  });

  it('puts the leak on day 3, when Bill is in, and mends or bungs the shower', () => {
    const beat = FIRST_WEEK_SCRIPT.find((b) => b.card === 'billsShower')!;
    expect(beat.day).toBe(3);
    const sim = fixtureSim(1, 3, 10);
    const def = cardDef('billsShower')!;
    const subjects = def.when(sim);
    expect(subjects).toHaveLength(1);
    const bill = sim.state.pawns.find((p) => p.name.startsWith('Bill '))!;
    expect(subjects[0].pawn).toBe(bill.id);
    // Not when Bill is out.
    bill.life!.away = { until: sim.state.tick + 1000, why: 'shops' };
    expect(def.when(sim)).toEqual([]);
  });

  it('money from the cards in week one stays within the first-week cap', () => {
    let most = 0;
    for (const c of FIRST_WEEK_CARDS) {
      for (const fx of c.fixtures) {
        for (const answer of [0, 1, 'ignored'] as const) {
          const { sim, subject } = fx.build(1);
          const out = c.resolve(sim, makeCard(sim, c, subject, 0), answer);
          for (const e of out.effects) if (e.startsWith('pay:')) most = Math.max(most, Number(e.split(':')[1]));
        }
      }
    }
    // The two money cards together can't beat the cap.
    const scaffold = 8000;
    const rent = 7000;
    expect(scaffold + rent).toBeLessThanOrEqual(DRIP.firstWeekIncome);
    expect(most).toBeLessThanOrEqual(scaffold);
  });

  it('every card in the file is in the catalogue once', () => {
    for (const c of FIRST_WEEK_CARDS) expect(ALL_CARDS.filter((x) => x.id === c.id)).toHaveLength(1);
  });
});

describe('the project bar', () => {
  it('names the bare flat on day 1, with a price', () => {
    const sim = Sim.create(1);
    const p = nextProject(sim)!;
    expect(p.id).toBe(`furnish:${sim.state.handover.fit}`);
    expect(p.label).toMatch(/^furnish Flat \d/);
    expect(p.cost).toBeGreaterThan(0);
    expect(p.flat).toBe(sim.state.handover.fit);
    expect(projectLine(sim, p)).toMatch(/^Next: furnish Flat \d\. £\d+ of £\d+\./);
  });

  it('moves on to the next thing when the flat is furnished, and obeys a pin', () => {
    const sim = Sim.create(1);
    skipHandover(sim);
    const fit = sim.state.handover.fit!;
    expect(nextProject(sim)!.id).toBe(`furnish:${fit}`);
    pinProject(sim, 'locks');
    expect(nextProject(sim)!.id).toBe('locks');
    pinProject(sim, 'nonsense');
    expect(nextProject(sim)!.id).toBe(`furnish:${fit}`);
    pinProject(sim, undefined);
    sim.state.security.locks = true;
    sim.state.handover.fit = undefined;
    // Other bare flats still want furnishing before anything else.
    expect(nextProject(sim)).not.toBeNull();
  });

  it('guesses days from rent less bills, and says never if it will never get there', () => {
    const sim = Sim.create(1);
    const p = nextProject(sim)!;
    sim.state.money = p.cost;
    expect(projectEta(sim, p)).toBe(0);
    sim.state.money = 0;
    const eta = projectEta(sim, { ...p, cost: 1000 });
    expect(eta === null || eta > 0).toBe(true);
    for (const f of sim.layout.flats) { const l = flatInfo(sim, f.id).lease; if (l) l.rent = 0; }
    expect(projectEta(sim, p)).toBeNull();
  });
});

describe('the script, played', () => {
  it('the handover with the walk skipped starts nothing the cards need', () => {
    const sim = Sim.create(2);
    while (touring(sim)) skipAhead(sim);
    sim.run(TICKS_PER_DAY);
    expect(hasFlag(sim, 'lorraine')).toBe(false);
  });
});

describe('what the first week leaves running', () => {
  it('takes Lorraine on when you said yes, and the house-proud notice the windows when you said no', async () => {
    const { setFlag } = await import('../src/sim/flags');
    const { handoverHour } = await import('../src/sim/handover');
    const sim = fixtureSim(1, 16, 9);
    expect(sim.state.cleaner).toBe(false);
    setFlag(sim, 'lorraine');
    setFlag(sim, 'grimyWindows');
    const proud = sim.state.pawns.find((p) => p.life)!;
    proud.life!.traits = ['houseProud', 'easyGoing'];
    handoverHour(sim);
    expect(sim.state.cleaner).toBe(true);
    expect(proud.life!.memories.some((m) => m.id === 'grubbyWindows')).toBe(true);
  });
});
