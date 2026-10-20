// The drip: a thin stream of real, two-choice decisions, nought to two a game day (spec 1).
// Every morning it sets the day's budget; through waking hours it now and then draws a card
// whose `when` is true from the catalogue (cards/), and it resolves cards when you answer,
// when a moment passes, or when an ask has soured three times. Answers are lists of effects
// (cards/types.ts) that this file applies: memories, money, flags, threads, promises, risk.
//
// STUB from chunk 0: the entry points below are called by the sim, the UI and the tests, and
// do nothing yet. Chunk 1 owns this file and fills them in, keeping these signatures. The
// flags and their reader registry are in flags.ts (also chunk 1's), so the systems that read
// flags don't import the whole drip.

import type { Sim } from './sim';
import type { Card, Drip } from './state';
import type { Answer, CardSubject } from './cards/types';

export { clearFlag, expireFlags, flagsOf, hasFlag, readFlags, setFlag, FLAGS, READERS } from './flags';

/** A drip with nothing in it, for a new game and for old saves. */
export function emptyDrip(day = 1): Drip {
  return { open: [], budget: 0, day, lastCard: 0, ignoredRun: 0, cooldowns: {}, threads: [], promises: [], flags: [], log: [], income: 0 };
}

/** 07:00: the day's budget (1.2). Called from the sim's hour, before the other morning jobs that might open a card. */
export function dripMorning(_sim: Sim): void {}

/** Once a game hour: night cards, threads and promises falling due. */
export function dripHour(_sim: Sim): void {}

/** Once a game minute: tries for a card every DRIP.tryEvery minutes in waking hours, sours waiting asks, resolves cards whose time is up, expires flags. */
export function dripMinute(_sim: Sim): void {}

/** The cards in the tray, newest last. */
export function openCards(sim: Sim): Card[] {
  return sim.state.drip?.open ?? [];
}

/**
 * Opens a card now, on this subject, if it can (room in the tray, not already open). For the
 * first week's script, threads, and tests. Null if it can't.
 */
export function openCard(_sim: Sim, _def: string, _subject: CardSubject = {}): Card | null {
  return null;
}

/** You answered: 0 or 1 is the button. Applies that choice's effects and closes the card. An error message, or null. */
export function answerCard(_sim: Sim, _cardId: number, _choice: 0 | 1): string | null {
  return null;
}

/** Resolves a card as it stands (a button, or ignored), applying the effects. Shared by answering, timing out and the tests. */
export function resolveCard(_sim: Sim, _cardId: number, _answer: Answer): void {}

/**
 * The UI reports the tick at which a card has been up for DRIP.floorSeconds real seconds
 * (1.1). The card never resolves before it. Saves and replays keep it, like a button press.
 * Headless runs never call it: the drip then works it out as if at 1x.
 */
export function cardSeen(_sim: Sim, _cardId: number, _tick: number): void {}
