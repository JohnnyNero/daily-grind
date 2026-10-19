import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { computeAlerts } from '../src/sim/alerts';
import { answerLetter, onDecision, sendLetter } from '../src/sim/letters';
import { allHands, callProblem, makeCall } from '../src/sim/calls';
import { spawnGuest } from '../src/sim/guests';

describe('alerts, letters and calls', () => {
  it('alerts describe what is wrong now and go when it is fixed', () => {
    const sim = new Sim(2);
    sim.run(3 * TICKS_PER_HOUR);
    sim.state.sinkDirty = 12;
    expect(computeAlerts(sim).some((a) => a.id === 'dishes')).toBe(true);
    sim.state.sinkDirty = 0;
    expect(computeAlerts(sim).some((a) => a.id === 'dishes')).toBe(false);
    for (const p of sim.state.pawns) if (p.staff) p.staff.priorities.barista = 0;
    expect(computeAlerts(sim)[0].level).toBe('critical');
  });

  it('big stories arrive as letters; decisions lapse to their default', () => {
    const sim = new Sim(2);
    sim.log('Someone quit in a huff.', 'bad', null, 'quit', 9);
    expect(sim.state.letters.some((l) => l.title === 'Someone quit')).toBe(true);
    let answered = '';
    onDecision('test', (_s, _l, choice) => { answered = choice; });
    const l = sendLetter(sim, {
      title: 'Choose', text: 'Pick', tone: 'neutral', pawn: null, kind: 'test',
      choices: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }], expires: sim.state.tick + 5 * TICKS_PER_MINUTE,
    });
    expect(answerLetter(sim, l.id, 'maybe')).toMatch(/Pick one/);
    sim.run(10 * TICKS_PER_MINUTE);
    expect(answered).toBe('no');
    expect(sim.state.letters.some((x) => x.id === l.id)).toBe(false);
  });

  it('calls cost something, take effect, and need time before reuse', () => {
    const sim = new Sim(2);
    sim.run(3 * TICKS_PER_HOUR);
    expect(makeCall(sim, 'allHands')).toBeNull();
    expect(allHands(sim)).toBe(true);
    expect(callProblem(sim, 'allHands')).toMatch(/so soon/);
    expect(makeCall(sim, 'closeDoors')).toBeNull();
    const guests = sim.state.pawns.filter((p) => p.visit).length;
    sim.run(10 * TICKS_PER_MINUTE);
    // Nobody new walks in while the doors are shut (a few already inside may leave).
    expect(sim.state.pawns.filter((p) => p.visit).length).toBeLessThanOrEqual(guests);
    const g = spawnGuest(sim);
    g.visit!.state = 'waiting';
    g.visit!.patience = 0.3;
    const money = sim.state.money;
    expect(makeCall(sim, 'compRound')).toBeNull();
    expect(g.visit!.patience).toBeCloseTo(0.7);
    expect(sim.state.money).toBeLessThan(money);
  });
});
