// Tales: the building's memory of what happened. Notable moments are written down as they
// happen (a fight, an affair found out, a burglary, someone moving in), each with how much
// people will talk about it. Every Sunday evening the best of the week goes in the post as
// a recap, and each telling makes a tale a bit less interesting, so old news fades.

import { letter, pounds } from './economy';
import type { Sim } from './sim';
import { TICKS_PER_DAY, type Pawn, type Tale, type TaleKind } from './state';

/** Most tales kept. */
export const MAX_TALES = 200;
/** Tales in a recap. */
const RECAP_SIZE = 5;
/** How far back a recap looks for news still worth repeating. */
const RECAP_DAYS = 28;
/** What a telling leaves of a tale's interest. */
const RETOLD = 0.5;

/** How much people talk about each kind of thing, to start with. */
export const INTEREST: Record<TaleKind, number> = {
  affair: 10,
  repossessed: 10,
  fight: 8,
  burglary: 7,
  councilFine: 6,
  missedMortgage: 6,
  breakup: 5,
  partyShutDown: 5,
  burglaryFoiled: 4,
  couple: 4,
  gaveNotice: 4,
  councilNotice: 4,
  partyDamage: 3,
  party: 2.5,
  moveIn: 3,
  moveOut: 3,
  grant: 2,
  broken: 1,
};

/**
 * Words for each kind: {a}, {b} and {c} are first names, {flat} the flat, {what} whatever
 * the thing was. Which one is picked goes by the tale's number, so it costs no dice.
 */
const TEMPLATES: Record<TaleKind, string[]> = {
  affair: ['{c} found out about {a} and {b}. The landing has not been the same since.', '{a} and {b} were caught whispering on the landing once too often. {c} was not amused.'],
  repossessed: ['The bank took the building. They changed the mat.'],
  fight: ['{a} and {b} had an actual fight on the stairs.', '{a} and {b} came to blows. Nobody is saying who started it. Everyone knows who started it.'],
  burglary: ['Someone broke into {flat} and took {what}.', '{flat} was burgled in the night. They took {what}.'],
  councilFine: ['The council came back, found things still not right, and fined you {what}.'],
  missedMortgage: ['The mortgage payment didn\'t go out. The building society wrote. Politely, for now.'],
  breakup: ['{a} and {b} split up.', '{a} and {b} are no longer a couple. They still share a stairwell.'],
  partyShutDown: ['{a}\'s party in {flat} was shut down early. Sulking ensued.', 'You told {a} to wrap up the party in {flat}. They did. Loudly.'],
  burglaryFoiled: ['A burglar tried their luck. {what} saw them off.', 'Someone tried to break in. {what} put paid to that.'],
  couple: ['{a} and {b} are seeing each other.', '{a} and {b} got together. The chat noticed before they did.'],
  gaveNotice: ['{a} handed in their notice. {what} was the last straw.'],
  councilNotice: ['The council inspected and left a list of things to put right.'],
  partyDamage: ['The {what} in {flat} didn\'t survive {a}\'s party.'],
  party: ['{a} had a party in {flat}.', '{a} had some people round in {flat}. Quite a lot of people.'],
  moveIn: ['{names} moved into {flat}.'],
  moveOut: ['{names} moved out of {flat}, leaving {what}.'],
  grant: ['The council sent you {what} you never applied for.'],
  broken: ['The {what} in {flat} gave up.', 'The {what} in {flat} broke.'],
};

const first = (name: string) => name.split(' ')[0];

/** "Sam", "Sam and Jo", "Sam, Jo and Alex". */
export function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? 'Someone') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Writes a moment down. `pawns` are who it's about, in the order the words name them. */
export function tale(sim: Sim, kind: TaleKind, pawns: Pawn[], extra: { flat?: string; what?: string; stars?: number } = {}): Tale {
  const st = sim.state;
  const c = st.chronicle;
  const id = c.next++;
  const flatName = extra.flat ? (sim.layout.flat(extra.flat)?.name ?? 'a flat') : 'the building';
  const options = TEMPLATES[kind];
  const firsts = pawns.map((p) => first(p.name));
  const text = options[id % options.length]
    .replace(/\{a\}/g, firsts[0] ?? 'Someone')
    .replace(/\{b\}/g, firsts[1] ?? 'someone')
    .replace(/\{c\}/g, firsts[2] ?? 'Someone')
    .replace('{names}', names(firsts))
    .replace(/\{flat\}/g, flatName)
    .replace('{what}', extra.what ?? 'something');
  const t: Tale = {
    id,
    tick: st.tick,
    kind,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    pawns: pawns.map((p) => ({ id: p.id, name: p.name })),
    interest: INTEREST[kind],
    ...(extra.flat ? { flat: extra.flat } : {}),
    ...(extra.stars !== undefined ? { stars: extra.stars } : {}),
  };
  c.tales.push(t);
  if (c.tales.length > MAX_TALES) c.tales.splice(0, c.tales.length - MAX_TALES);
  return t;
}

/** Someone's tales, newest first. */
export function talesOf(sim: Sim, pawnId: number): Tale[] {
  return sim.state.chronicle.tales.filter((t) => t.pawns.some((p) => p.id === pawnId)).reverse();
}

/** Told once more: a bit less worth repeating. */
export function retell(t: Tale): void {
  t.interest *= RETOLD;
  t.told = (t.told ?? 0) + 1;
}

/** Once an hour: on Sunday evening, the week's recap goes in the post. */
export function talesHour(sim: Sim): void {
  const hour = Math.floor(sim.minuteOfDay / 60);
  if (hour === 20 && (sim.day - 1) % 7 === 6) recap(sim);
}

/** The week at Albert Terrace: the money, who came and went, and what people will be talking about. */
export function recap(sim: Sim): void {
  const st = sim.state;
  const week = Math.floor((sim.day - 1) / 7) + 1;
  const since = (sim.day - 7) * TICKS_PER_DAY;
  const ledger = st.ledger.filter((e) => e.tick >= since);
  const moneyIn = ledger.filter((e) => e.amount > 0).reduce((n, e) => n + e.amount, 0);
  const moneyOut = -ledger.filter((e) => e.amount < 0).reduce((n, e) => n + e.amount, 0);
  const net = moneyIn - moneyOut;
  const lines: string[] = [];
  lines.push(`In: ${pounds(moneyIn)}. Out: ${pounds(moneyOut)}. ${net > 0 ? `Up ${pounds(net)} on the week.` : net < 0 ? `Down ${pounds(-net)} on the week, which is the wrong way.` : 'Exactly even, somehow.'}`);
  const thisWeek = st.chronicle.tales.filter((t) => t.tick >= since);
  const came = thisWeek.filter((t) => t.kind === 'moveIn');
  const went = thisWeek.filter((t) => t.kind === 'moveOut');
  if (came.length > 0 || went.length > 0) {
    const who = (ts: Tale[]) =>
      ts.map((t) => `${names(t.pawns.map((p) => first(p.name)))} (${[t.flat ? (sim.layout.flat(t.flat)?.name ?? 'a flat') : '', t.stars !== undefined ? `${t.stars} star${t.stars === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})`).join('; ');
    lines.push([came.length > 0 ? `Moved in: ${who(came)}.` : '', went.length > 0 ? `Moved out: ${who(went)}.` : ''].filter(Boolean).join(' '));
  }
  // The best of the week, and anything older that's still going round.
  const old = (sim.day - RECAP_DAYS) * TICKS_PER_DAY;
  const pool = st.chronicle.tales.filter((t) => t.tick >= old && t.interest >= 2 && t.kind !== 'moveIn' && t.kind !== 'moveOut');
  const best = [...pool].sort((a, b) => b.interest - a.interest || b.tick - a.tick).slice(0, RECAP_SIZE);
  if (best.length === 0) lines.push('Otherwise a quiet week. Nobody fought, nothing was stolen, and the boiler held. Make the most of it.');
  else {
    lines.push('What people are talking about:');
    for (const t of best) lines.push(`• ${t.tick < since ? `Still going on about: ${t.text.charAt(0).toLowerCase()}${t.text.slice(1)}` : t.text}`);
  }
  for (const t of best) retell(t);
  letter(sim, { from: 'Notes to self', title: `Week ${week} at Albert Terrace`, body: lines.join('\n') });
  sim.notify(`Week ${week} at Albert Terrace: the recap is in the post.`);
}
