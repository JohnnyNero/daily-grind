import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';
import { careersMorning, friendsMayFollow, setLead } from '../src/sim/careers';
import { answerLetter } from '../src/sim/letters';
import { moodReasons } from '../src/sim/thoughts';

describe('careers and cascades', () => {
  it('a raise request is a decision with consequences either way', () => {
    const sim = new Sim(6);
    sim.run(12 * TICKS_PER_DAY);
    const before = sim.state.letters.length;
    for (let i = 0; i < 200 && !sim.state.letters.some((l) => l.kind === 'raise'); i++) {
      for (const p of sim.state.pawns) if (p.staff) { p.staff.lastAskDay = -100; p.staff.hiredDay = -100; }
      careersMorning(sim);
    }
    const letter = sim.state.letters.find((l) => l.kind === 'raise')!;
    expect(sim.state.letters.length).toBeGreaterThan(before);
    const p = sim.pawnById(Number(letter.data!.pawn))!;
    const wage = p.staff!.wage;
    expect(answerLetter(sim, letter.id, 'yes')).toBeNull();
    expect(p.staff!.wage).toBe(wage + 100);
    expect(p.staff!.memories.some((m) => m.def === 'gotRaise')).toBe(true);
  });

  it('a close friend who is unhappy may follow someone out', () => {
    const sim = new Sim(6);
    sim.run(3 * TICKS_PER_HOUR);
    const [a, b] = sim.state.pawns.filter((p) => p.staff);
    // Close friends (opinion is normally built from shared memories).
    sim.opinion = (of, about) => (of === b && about === a ? 60 : 0);
    b.staff!.mood = 30;
    for (let i = 0; i < 20 && !sim.state.letters.some((l) => l.kind === 'followOut'); i++) friendsMayFollow(sim, a);
    const letter = sim.state.letters.find((l) => l.kind === 'followOut')!;
    expect(letter).toBeDefined();
    answerLetter(sim, letter.id, 'let');
    expect(b.staff!.quit).toBe(true);
  });

  it('one shift lead at a time, paid a little more, steadying the team', () => {
    const sim = new Sim(6);
    sim.run(3 * TICKS_PER_HOUR);
    const [a, b, c] = sim.state.pawns.filter((p) => p.staff && p.onMap);
    const wage = a.staff!.wage;
    setLead(sim, a);
    a.staff!.mood = 70;
    expect(a.staff!.wage).toBe(wage + 150);
    setLead(sim, b);
    expect(a.staff!.lead).toBe(false);
    expect(a.staff!.wage).toBe(wage);
    b.staff!.mood = 70;
    expect(moodReasons(sim, c).some((r) => r.label.includes('tight ship'))).toBe(true);
  });
});
