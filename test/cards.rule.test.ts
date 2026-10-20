import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/sim/cards';
import { checkCard, fixtureSim, isBadMark, isCosmetic, letFlat, score, signature, sitting } from '../src/sim/cards/rule';
import type { CardDef, Outcome } from '../src/sim/cards/types';
import { FLAGS } from '../src/sim/flags';
import { MEMORIES, SOCIAL } from '../src/sim/tuning';

// The consequence rule (spec 1.0): every card's two choices differ in kind, each leaves
// something that lasts, ignoring is worst, and what it turns on changes how it plays. Every
// card in the catalogue is checked on every one of its fixtures.

describe('the consequence rule', () => {
  it('holds for every card in the catalogue (and runs on an empty one)', () => {
    const problems = ALL_CARDS.flatMap((c) => checkCard(c));
    expect(problems).toEqual([]);
  });

  it('every card has a unique id', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every flag a card can set has a reader, and every new memory has a label', () => {
    for (const [id, f] of Object.entries(FLAGS)) expect(f.readBy.length, id).toBeGreaterThan(0);
    for (const id of ['leftToIt', 'keptWaiting', 'tookParcel', 'brokePromise', 'keptPromise', 'noPetButCat']) expect(MEMORIES[id]?.label, id).toBeTruthy();
    expect(SOCIAL.leakedOnMe?.label).toBeTruthy();
  });
});

describe('the rule helpers', () => {
  const out = (...effects: string[]): Outcome => ({ effects, notice: '' });

  it('sign effects by kind and subject, without amounts', () => {
    expect(signature('mem:42:tookParcel')).toBe('mem:tookParcel@42');
    expect(signature('pay:-8000:Plumber')).toBe('pay');
    expect(signature('pay:-2000:Plumber')).toBe(signature('pay:-4000:Plumber'));
    expect(signature('risk:burglary:1:3')).toBe('risk:burglary');
    expect(signature('flag:bigBins')).toBe('flag:bigBins');
    expect(signature('flag:slowLet:flat-2:3')).toBe('flag:slowLet@flat-2');
    expect(signature('soc:42:leakedOnMe:17')).toBe('soc:leakedOnMe@42>17');
    expect(signature('thread:cowboyBack:72')).toBe('thread:cowboyBack');
  });

  it('call money and chat on their own cosmetic', () => {
    expect(isCosmetic(out('pay:-2000:Biscuits', 'chat:Landlord sent biscuits.'))).toBe(true);
    expect(isCosmetic(out('pay:-2000:Biscuits', 'mem:3:landlordListened'))).toBe(false);
  });

  it('score memories, money, risk and breakages, so ignoring can be shown to be worst', () => {
    expect(score(out('mem:3:ignored'))).toBe(MEMORIES.ignored.value);
    expect(score(out('pay:-8000:Plumber'))).toBe(-8);
    expect(score(out('risk:burglary:2:3'))).toBe(-6);
    expect(score(out('wear:31:1'))).toBe(-5);
    expect(score(out('lose:57'))).toBe(-4);
  });

  it('count being ignored, being left to it, and an outsider\'s grudge as bad marks', () => {
    expect(isBadMark('mem:ignored@3')).toBe(true);
    expect(isBadMark('mem:leftToIt@3')).toBe(true);
    expect(isBadMark('flag:nextDoorSore')).toBe(true);
    expect(isBadMark('flag:bigBins')).toBe(false);
    expect(isBadMark('mem:landlordListened@3')).toBe(false);
  });
});

/** A worked example of a card that passes (a cut-down parcel card), for the card chunks to copy the shape of. */
const example: CardDef = {
  id: 'exampleParcel',
  source: 'street',
  kind: 'door',
  cooldownDays: 3,
  turnsOn: ['locks'],
  when: (sim) => sitting(sim).slice(0, 1).map((p) => ({ pawn: p.id })),
  hook: () => 'Parcel for Dave.',
  text: () => 'Parcel for Dave. He\'s at work.',
  choices: () => [
    { label: 'Take it in', note: 'He\'ll be glad' },
    { label: 'Lobby will do', note: 'Might walk' },
  ],
  resolve(sim, card, answer) {
    const p = card.pawn!;
    if (answer === 0) return { effects: [`mem:${p}:tookParcel`], notice: 'You took the parcel in.' };
    if (answer === 1) return sim.state.security.locks ? { effects: [`mem:${p}:missedParcel`], notice: 'It sat in the lobby. Nobody took it.' } : { effects: [`mem:${p}:parcelNicked`, 'risk:burglary:1:3', `tale:parcelNicked:${p}`], notice: 'It walked.' };
    return { effects: [`mem:${p}:leftToIt`, `mem:${p}:parcelNicked`, 'risk:burglary:1:3'], notice: 'Left on the step. It walked.' };
  },
  fixtures: [
    { name: 'no locks', build: (seed) => { const sim = fixtureSim(seed); return { sim, subject: { pawn: sitting(sim)[0].id } }; } },
    { name: 'locks', build: (seed) => { const sim = fixtureSim(seed); sim.state.security.locks = true; return { sim, subject: { pawn: sitting(sim)[0].id } }; } },
  ],
};

describe('checking a card', () => {
  it('passes a card that keeps the rule', () => {
    expect(checkCard(example)).toEqual([]);
  });

  it('fails one whose choices only differ in money, that leaves nothing, and plays the same everywhere', () => {
    const bad: CardDef = {
      ...example,
      id: 'exampleBad',
      resolve: (_sim, _card, answer) => ({ effects: answer === 'ignored' ? [] : [`pay:${answer === 0 ? -2000 : -4000}:Van man`], notice: '' }),
    };
    const problems = checkCard(bad).join('\n');
    expect(problems).toMatch(/differ only in size/);
    expect(problems).toMatch(/leaves nothing that lasts/);
    expect(problems).toMatch(/ignoring isn't the worst/);
    expect(problems).toMatch(/fixtures all play out the same/);
  });

  it('builds fixtures: the starting building, handover skipped, with flats let to whoever you like', () => {
    const sim = fixtureSim(1);
    expect(sitting(sim)).toHaveLength(2);
    const [a, b] = letFlat(sim, 2, [['complainer', 'lightSleeper'], ['easyGoing']]);
    expect(a.life!.traits).toEqual(['complainer', 'lightSleeper']);
    expect(b.life!.flat).toBe(sim.layout.flats[2].id);
    expect(sim.minuteOfDay).toBe(10 * 60);
  });
});
