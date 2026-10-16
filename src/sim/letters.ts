// Letters: the big news and the decisions that wait for the manager. News stays in the
// inbox until read; a decision lapses to its default if left too long.

import type { Sim } from './sim';
import type { Letter } from './state';

/** Story kinds big enough to arrive as a letter as well as in the log. */
const LETTER_TALES: Readonly<Record<string, string>> = {
  quit: 'Someone quit',
  criticRave: 'The critic loved it',
  critic: 'The critic has spoken',
  criticWalkout: 'The critic walked out',
  burnout: 'Off with stress',
  wagesLate: 'Wages went out late',
  debt: 'In the red',
  outOfDebt: 'Back in the black',
  couple: "There's a new couple",
  machineBroken: 'Machine down',
  lostRegular: 'A regular has had enough',
  followedOut: 'Following a friend out',
  poached: 'Poached',
};

const MAX_LETTERS = 30;

export function sendLetter(sim: Sim, l: Omit<Letter, 'id' | 'tick'>): Letter {
  const s = sim.state;
  const letter: Letter = { ...l, id: s.nextId++, tick: s.tick };
  s.letters.push(letter);
  // Old news makes way; decisions are never dropped unanswered.
  while (s.letters.length > MAX_LETTERS) {
    const i = s.letters.findIndex((x) => !x.choices);
    if (i < 0) break;
    s.letters.splice(i, 1);
  }
  return letter;
}

/** Called from Sim.log: big stories also arrive as letters. */
export function letterFromLog(sim: Sim, text: string, tone: Letter['tone'], pawn: number | null, tale: string | null): void {
  if (!tale) return;
  const title = LETTER_TALES[tale] ?? (tale === 'inspector' && tone === 'bad' ? 'Failed the inspection' : null);
  if (title) sendLetter(sim, { title, text, tone, pawn });
}

export type DecisionHandler = (sim: Sim, letter: Letter, choice: string) => void;
const handlers = new Map<string, DecisionHandler>();

/** Systems that ask the manager things (raises, rival offers) register how to act on the answer. */
export function onDecision(kind: string, handler: DecisionHandler): void {
  handlers.set(kind, handler);
}

/** Dismisses news, or answers a decision. */
export function answerLetter(sim: Sim, id: number, choice: string | null = null): string | null {
  const s = sim.state;
  const letter = s.letters.find((l) => l.id === id);
  if (!letter) return 'That letter has gone.';
  if (letter.choices) {
    if (!choice || !letter.choices.some((c) => c.id === choice)) return 'Pick one of the options.';
    handlers.get(letter.kind!)?.(sim, letter, choice);
  }
  s.letters = s.letters.filter((l) => l.id !== id);
  return null;
}

/** Decisions left too long take their first (default) choice. */
export function lapseDecisions(sim: Sim): void {
  for (const l of [...sim.state.letters]) {
    if (l.choices && l.expires !== undefined && sim.state.tick >= l.expires) answerLetter(sim, l.id, l.choices[0].id);
  }
}
