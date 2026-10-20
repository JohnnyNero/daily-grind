// What a drip card is (spec 1.4 to 1.6). The catalogue is split by source so parallel work
// doesn't collide: tenant.ts (chunk 2a), building.ts (2b), street.ts (2c), firstWeek.ts (7).
// Each exports an array of CardDef; index.ts gathers them; drip.ts (chunk 1) deals them out
// and applies what they return; rule.ts and test/cards.rule.test.ts hold every card to the
// consequence rule (1.0).
//
// A card never changes the state itself. `when` reads the building and says who and what a
// card could be about; `resolve` reads it again and returns, for one answer, a list of
// effects as strings (so they save and replay) and the line the toast shows. The drip
// applies the effects. `resolve` may roll dice (rng.ts, on sim.state), and nothing else.

import type { Sim } from '../sim';
import type { Card } from '../state';

// ------------------------------------------------------------------ effects

/**
 * One thing an answer does, as text (1.5). Pawn ids are numbers, flats their ids, furniture
 * ids numbers; amounts are pence, days and game hours. The kinds:
 *
 * | Effect | Example | What it does | Lasting |
 * | --- | --- | --- | --- |
 * | mem | `mem:42:tookParcel` | a memory for a tenant (MEMORIES; reuses `remember`) | yes |
 * | soc | `soc:42:leakedOnMe:17` | 42 remembers something about 17 (SOCIAL; reuses `rememberAbout`) | yes |
 * | pay | `pay:-8000:Plumber` | money in or out, with its ledger label (reuses `book`) | no |
 * | mend | `mend:31` | mends a thing (reuses upkeep's `mend`, at its cost) | yes |
 * | wear | `wear:31:0.9` | sets a thing's wear (1 breaks it) | yes |
 * | rent | `rent:flat-2:-500` | a lease's weekly rent changes for good, by this much | yes |
 * | flag | `flag:keyUnderMat`, `flag:slowLet:flat-2:3`, `flag:estimated::14` | sets a flag (flags.ts): `flag:<id>:<subject>:<days>`, subject and days optional (no days is for good) | yes |
 * | reveal | `reveal:42:handy` | a hidden trait shows (reuses `noticeTrait`) | yes |
 * | tale | `tale:cowboy:42:17` | writes a tale (tales.ts) about these pawns | yes |
 * | chat | `chat:Landlord took Dave's parcel in.` | a line in the building chat, from you | no |
 * | thread | `thread:cowboyBack:72` | a follow-up card due in this many game hours, keeping this card's subject | yes |
 * | promise | `promise:mend:31:7` | something you said you'd do (a kind, its argument) by day + n; kept or broken is a memory | yes |
 * | risk | `risk:burglary:1:3` | a storyteller weight a step up (or down, -1) for some days | yes |
 * | inspect | `inspect:5:A tenant has written to us` | books a council visit in n days (reuses `bookInspection`) | yes |
 * | expect | `expect:2` | nudges the expectations level | yes |
 * | lose | `lose:57` | an applicant goes, off the list | no |
 * | act | `act:word:flat-3` | any existing chat or post act (chat.ts, post.ts), so nothing's written twice | yes |
 *
 * Risk kinds: `burglary`, `fight`, `breakup`, `party`. Promise kinds chunk 1 checks on the
 * day: `mend:<furnitureId>` (working and worn under UPKEEP.worn). Add more with chunk 1.
 */
export type Effect = string;

export type EffectKind = 'mem' | 'soc' | 'pay' | 'mend' | 'wear' | 'rent' | 'flag' | 'reveal' | 'tale' | 'chat' | 'thread' | 'promise' | 'risk' | 'inspect' | 'expect' | 'lose' | 'act';

/** Kinds that leave something you can find again (1.0, point 2). Money, a chat line and a lost applicant don't, on their own. */
export const LASTING: Record<EffectKind, boolean> = {
  mem: true, soc: true, pay: false, mend: true, wear: true, rent: true, flag: true, reveal: true, tale: true,
  chat: false, thread: true, promise: true, risk: true, inspect: true, expect: true, lose: false, act: true,
};

export const effectKind = (e: Effect): EffectKind => e.split(':')[0] as EffectKind;

// ------------------------------------------------------------------ cards

/** Where a card comes from (1.3): a tenant, the building, the street. First-week cards say which they are too. */
export type CardSource = 'tenant' | 'building' | 'street';

/**
 * How long it lasts (1.1, 1.6), in DRIP.life: `door` a moment at the door, `moment` any other
 * moment (both resolve at their worst when the time's up), `ask` a tenant's ask, which waits
 * and sours in three steps, `promise` a follow-up you promised something on, which waits
 * until the promised day.
 */
export type CardKind = 'door' | 'moment' | 'ask' | 'promise';

/** Who and what a card is about. `when` finds these; the drip copies them onto the open Card. */
export interface CardSubject {
  pawn?: number;
  flat?: string;
  furniture?: number;
  visitor?: number;
  data?: Record<string, string | number>;
  /** How true it is: the drip weighs candidates by this (1 if missing), and prefers ones touching something live. */
  weight?: number;
}

export interface CardChoice {
  /** One to four words. */
  label: string;
  /** A hint under the button, like the chat's notes ("He'll be glad", "£80", "Might walk"). Never a liking number. */
  note: string;
}

/** Button 0 (A), button 1 (B), or nobody answered. */
export type Answer = 0 | 1 | 'ignored';

/** What one answer does. */
export interface Outcome {
  effects: Effect[];
  /** The toast: what you did ("You took Dave's parcel in."), or for ignored, what the world did. */
  notice: string;
}

/**
 * A small seeded building where a card's `when` is true, differing from the card's other
 * fixtures in what it turns on (a complainer and an easy-going tenant; a Grim flat and a Nice
 * one; locks and none). rule.ts has helpers to build them.
 */
export interface CardFixture {
  /** What this one varies, in a word or two ("complainer", "locks"). */
  name: string;
  build(seed: number): { sim: Sim; subject: CardSubject };
}

export interface CardDef {
  /** Unique, camelCase: 'parcel', 'manInAVan'. Threads name cards by this. */
  id: string;
  source: CardSource;
  kind: CardKind;
  /** Can come between 23:00 and 07:00. */
  night?: boolean;
  /** The answers that can open a thread or a promise: something that comes back. The drip leans on these after a quiet spell (DRIP.tailDays). */
  opens?: Answer[];
  /** Only ever comes as a follow-up (a thread, a promise, the first week's script), never drawn by the drip. */
  followUp?: boolean;
  /** Days before it can come again. */
  cooldownDays: number;
  /** What changes how it plays (1.0, point 4): 'trait:complainer', 'locks', 'tier', 'whoIsHome'. */
  turnsOn: string[];
  /** A pixel icon for the slim card when it isn't about a person: 'cat', 'van', 'bins', 'water'. */
  icon?: string;
  /**
   * Who and what it could be about right now; empty if it can't happen. For a follow-up, the
   * drip passes the subject it was set up with, and `when` says whether it still holds.
   */
  when(sim: Sim, from?: CardSubject): CardSubject[];
  /** The slim line in the tray: at most 40 characters ("Parcel for Dave."). */
  hook(sim: Sim, card: Card): string;
  /** The full text when it's open: at most 80 characters, two lines. */
  text(sim: Sim, card: Card): string;
  /** The name line when it's open ("Dave · Flat 1"); the drip makes one from the pawn if missing. */
  name?(sim: Sim, card: Card): string;
  /** The two buttons. */
  choices(sim: Sim, card: Card): [CardChoice, CardChoice];
  /** What an answer does, worked out from who and what is involved. Rolls dice on sim.state only; changes nothing else. */
  resolve(sim: Sim, card: Card, answer: Answer): Outcome;
  /** At least two, differing in what it turns on. */
  fixtures: CardFixture[];
}

/** A first-week beat (spec 3): this card, on this day, at about this minute of the day. */
export interface ScriptBeat {
  day: number;
  minute: number;
  card: string;
}

/** An open Card for a def and subject, not yet in the tray (the drip puts it there). Uses an id. */
export function makeCard(sim: Sim, def: CardDef, subject: CardSubject, until: number): Card {
  const st = sim.state;
  const c: Card = { id: st.nextId++, def: def.id, tick: st.tick, until };
  if (def.kind === 'ask') {
    c.waits = true;
    c.step = 0;
  }
  if (subject.pawn !== undefined) c.pawn = subject.pawn;
  if (subject.flat !== undefined) c.flat = subject.flat;
  if (subject.furniture !== undefined) c.furniture = subject.furniture;
  if (subject.visitor !== undefined) c.visitor = subject.visitor;
  if (subject.data) c.data = { ...subject.data };
  return c;
}
