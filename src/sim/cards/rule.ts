// The consequence rule (spec 1.0), as code: helpers that hold a card to it, and helpers to
// build the small seeded buildings (fixtures) a card is checked on. test/cards.rule.test.ts
// runs `checkCard` on every card in the catalogue; a card chunk can call it in its own
// tests too.
//
// An effect's signature is its kind and subject without amounts ("mem:tookParcel@42",
// "risk:burglary", "flag:slowLet@flat-2", "pay"), so "£20 or £40" comes out the same.

import { FLAGS } from '../flags';
import { flatInfo, POUND } from '../economy';
import { skipHandover } from '../handover';
import { makePerson } from '../leases';
import { Sim } from '../sim';
import type { Pawn, Person } from '../state';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../state';
import { moveIn } from '../tenants';
import { INTEREST, MEMORIES, SOCIAL } from '../tuning';
import { cardDef } from './index';
import { LASTING, effectKind, makeCard, type Answer, type CardDef, type CardFixture, type Effect, type Outcome } from './types';

// ------------------------------------------------------------------ signatures

/** Kind and subject, no amounts. */
export function signature(e: Effect): string {
  const [kind, a = '', b = '', c = ''] = e.split(':');
  switch (kind) {
    case 'mem':
      return `mem:${b}@${a}`;
    case 'soc':
      return `soc:${b}@${a}>${c}`;
    case 'mend':
    case 'wear':
    case 'rent':
    case 'reveal':
      return `${kind}@${a}`;
    case 'flag':
      return b ? `flag:${a}@${b}` : `flag:${a}`;
    case 'risk':
    case 'tale':
    case 'thread':
      return `${kind}:${a}`;
    case 'promise':
      return `promise:${a}@${b}`;
    case 'act':
      return `act:${a}`;
    default:
      return kind;
  }
}

export const isLasting = (e: Effect): boolean => LASTING[effectKind(e)] ?? false;

/** Only money, chat lines and notices: not a choice (1.0, point 3). */
export const isCosmetic = (o: Outcome): boolean => !o.effects.some(isLasting);

/**
 * How good an outcome is for the landlord, to check ignoring is worst (1.6): memory values
 * (one per tenant holding it), plus a point per £10 (a rent change counts as four weeks
 * of it), less 3 a risk step, 5 a broken thing, 4 a lost applicant.
 */
export function score(o: Outcome): number {
  let n = 0;
  for (const e of o.effects) {
    const [kind, a = '', b = ''] = e.split(':');
    if (kind === 'mem') n += MEMORIES[b]?.value ?? 0;
    else if (kind === 'soc') n += SOCIAL[b]?.value ?? 0;
    else if (kind === 'pay') n += Number(a) / (10 * POUND);
    else if (kind === 'risk') n -= 3 * Number(b || 1);
    else if (kind === 'wear' && Number(b) >= 1) n -= 5;
    else if (kind === 'lose') n -= 4;
    else if (kind === 'rent') n += (Number(b) / (10 * POUND)) * 4;
  }
  return n;
}

/** A bad lasting mark that only ignoring leaves: the person remembers being ignored or left to it, or someone outside holds a grudge. */
export function isBadMark(sig: string): boolean {
  if (sig.startsWith('mem:ignored@') || sig.startsWith('mem:leftToIt@')) return true;
  const flag = sig.match(/^flag:([^@]+)/)?.[1];
  return flag !== undefined && FLAGS[flag]?.grudge === true;
}

// ------------------------------------------------------------------ resolving on fixtures

export interface Resolved {
  fixture: string;
  outcomes: Record<'a' | 'b' | 'ignored', Outcome>;
}

/** Each answer on a fresh copy of the fixture, with the same seed. */
export function resolveOn(def: CardDef, fixture: CardFixture, seed = 1): Resolved {
  const one = (answer: Answer): Outcome => {
    const { sim, subject } = fixture.build(seed);
    const card = makeCard(sim, def, subject, sim.state.tick + TICKS_PER_HOUR);
    return def.resolve(sim, card, answer);
  };
  return { fixture: fixture.name, outcomes: { a: one(0), b: one(1), ignored: one('ignored') } };
}

const sigs = (o: Outcome) => new Set(o.effects.map(signature));

/**
 * Everything wrong with a card under the consequence rule, as plain sentences. Empty if it
 * passes. Checks the fixtures, `when`, the words' lengths, and on every fixture: kind,
 * lasting, not cosmetic, seen later, ignored is worst; and across fixtures: tied.
 */
export function checkCard(def: CardDef, seed = 1): string[] {
  const out: string[] = [];
  const bad = (why: string) => out.push(`${def.id}: ${why}`);
  if (def.turnsOn.length === 0) bad('names nothing it turns on');
  if (def.fixtures.length < 2) bad('needs at least two fixtures');
  const all: Resolved[] = [];
  for (const fx of def.fixtures) {
    const { sim, subject } = fx.build(seed);
    if (def.when(sim, def.followUp ? subject : undefined).length === 0) bad(`its when is false on fixture "${fx.name}"`);
    const card = makeCard(sim, def, subject, sim.state.tick + TICKS_PER_HOUR);
    const hook = def.hook(sim, card);
    const text = def.text(sim, card);
    if (hook.length > 40) bad(`hook is over 40 characters: "${hook}"`);
    if (text.length > 80) bad(`text is over 80 characters: "${text}"`);
    for (const c of def.choices(sim, card)) {
      const words = c.label.trim().split(/\s+/).length;
      if (words < 1 || words > 4) bad(`label "${c.label}" isn't one to four words`);
    }
    const r = resolveOn(def, fx, seed);
    all.push(r);
    const { a, b, ignored } = r.outcomes;
    const at = ` on fixture "${fx.name}"`;
    // Kind: A and B differ by something other than money and chat.
    const sa = sigs(a);
    const sb = sigs(b);
    const diff = [...sa].filter((s) => !sb.has(s)).concat([...sb].filter((s) => !sa.has(s)));
    if (!diff.some((s) => s !== 'pay' && s !== 'chat')) bad(`A and B differ only in size${at}`);
    for (const [name, o] of [['A', a], ['B', b], ['ignored', ignored]] as const) {
      if (isCosmetic(o)) bad(`${name} leaves nothing that lasts${at}`);
      for (const e of o.effects) seenLater(e, (why) => bad(`${name}: ${why}${at}`));
    }
    // Ignored is worst: below both, with a bad mark neither choice has.
    if (!(score(ignored) < score(a) && score(ignored) < score(b))) bad(`ignoring isn't the worst outcome${at} (${score(a)}, ${score(b)}, ignored ${score(ignored)})`);
    const only = [...sigs(ignored)].filter((s) => !sa.has(s) && !sb.has(s));
    if (!only.some(isBadMark)) bad(`ignoring leaves no bad mark of its own${at}`);
  }
  // Tied: what it turns on changes at least one outcome.
  if (all.length >= 2) {
    const key = (r: Resolved) => (['a', 'b', 'ignored'] as const).map((k) => [...sigs(r.outcomes[k])].sort().join(',')).join('|');
    if (new Set(all.map(key)).size < 2) bad('its fixtures all play out the same');
  }
  return out;
}

/** Memories, flags, threads and tales all have to exist, and flags have to be read. */
function seenLater(e: Effect, bad: (why: string) => void): void {
  const [kind, a = '', b = ''] = e.split(':');
  if (kind === 'mem' && !MEMORIES[b]?.label) bad(`memory "${b}" isn't in MEMORIES`);
  if (kind === 'soc' && !SOCIAL[b]?.label) bad(`memory "${b}" isn't in SOCIAL`);
  if (kind === 'thread' && !cardDef(a)) bad(`thread "${a}" isn't a card`);
  if (kind === 'flag' && !(FLAGS[a]?.readBy.length > 0)) bad(`flag "${a}" isn't in FLAGS with a reader`);
  if (kind === 'tale' && !(a in INTEREST)) bad(`tale kind "${a}" doesn't exist`);
  if (!(kind in LASTING)) bad(`"${e}" isn't an effect`);
}

// ------------------------------------------------------------------ fixture builders

/** The starting building at a time of day (default 10:00 on day 3, a Wednesday), handover out of the way. */
export function fixtureSim(seed: number, day = 3, hour = 10): Sim {
  const sim = Sim.create(seed);
  skipHandover(sim);
  sim.state.pawns = sim.state.pawns.filter((p) => p.life);
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  return sim;
}

/** The sitting tenants: [Flat 1's, Bill]. */
export function sitting(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.life?.flat && flatInfo(sim, p.life.flat).lease?.sitting);
}

/**
 * Lets a flat (by its index in the layout) to a household: one person per entry, with these
 * traits (and anything else given). Puts them in at home, on an ordinary lease.
 */
export function letFlat(sim: Sim, flatIndex: number, people: (string[] | Partial<Person>)[], rent = 100 * POUND): Pawn[] {
  const f = sim.layout.flats[flatIndex];
  const info = flatInfo(sim, f.id);
  info.lease = { rent, startDay: sim.day, endDay: sim.day + 42, deposit: rent * 4, owed: 0, paid: 0, late: 0 };
  info.listed = false;
  const persons = people.map((p) => {
    const base = makePerson(sim.state, undefined, false);
    return Array.isArray(p) ? { ...base, traits: p } : { ...base, ...p };
  });
  return moveIn(sim, f.id, persons, persons[0]?.traits ?? []);
}
