// The handover: the first week, which teaches the game by playing it. Denise from the
// letting agent walks you round (any tap moves her on), the last landlord's notes and her
// to-do list come in the post, and a few beats land on their own days: Bill asks for the
// heating up, the first mortgage payment, and in week two an idea for the stripped flat.
//
// Every item on the list is a real goal that ticks itself off when it's true, so ignoring
// it breaks nothing. It can be skipped from the menu.

import { post } from './chat';
import { HANDOVER_ADVANCE as ADVANCE, POUND, billsDue, book, flatInfo, letter } from './economy';
import { scoreFor } from './impressiveness';
import { household, newApplicant } from './leases';
import { setGoal } from './pawns';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, type Pawn } from './state';

/** Minutes Denise talks at each stop before moving on by herself. */
const TALK_MINUTES = 4;

const DENISE = 'Denise from the letting agent';
const AGENT = 'Denise, Harrowgate Lettings';

interface Stop {
  /** A flat by its place in the list (0 is Flat 1), or the lobby. */
  flat: number | 'lobby';
  say(sim: Sim): string;
}

const first = (p: Pawn | undefined) => p?.name.split(' ')[0] ?? 'nobody';

function tenantOf(sim: Sim, flat: number): Pawn | undefined {
  const f = sim.layout.flats[flat];
  return f ? household(sim, f.id)[0] : undefined;
}

export const TOUR: readonly Stop[] = [
  { flat: 'lobby', say: () => "Morning! Denise, from the letting agent. Welcome to Albert Terrace. This is the lobby: bins, post, and the smell. Let's have a look round." },
  { flat: 0, say: (sim) => `Flat 1. That's ${first(tenantOf(sim, 0))}. Pays on the dot, keeps to themselves. Long may it last.` },
  { flat: 1, say: () => "Flat 2. Empty, but there's a bed and a loo, so it's ready to let. I'd get someone in this week." },
  { flat: 2, say: () => "Flat 3. Bare boards. Nobody will live in it without a bed, a loo, somewhere to wash and a kitchen. Do that and it'll let." },
  { flat: 3, say: (sim) => `Flat 4, that's ${first(tenantOf(sim, 3))}. Been here longer than the carpets. Feels the cold.` },
  { flat: 4, say: () => "Flat 5. Ah. The last owner had it stripped, and then lost interest. One for later." },
  { flat: 'lobby', say: () => "That's the lot. Mr Pritchard left you some notes, and I've written you a list. It's all in the post. Good luck!" },
];

// ------------------------------------------------------------------ starting

/** A new game: Denise is in the lobby, and the last landlord's notes are on the mat. */
export function startHandover(sim: Sim): void {
  const st = sim.state;
  const h = st.handover;
  const flats = sim.layout.flats;
  h.cast = st.pawns.filter((p) => p.life).map((p) => p.id);
  h.toLet = flats[1]?.id;
  h.fit = flats[2]?.id;
  h.gutted = flats[4]?.id;
  // Made by hand rather than rolled, so a seed plays out the same with or without her.
  const d: Pawn = {
    id: st.nextId++,
    name: DENISE,
    kind: 'agent',
    x: st.plot.x0 + 2,
    s: 0,
    path: [],
    goal: null,
    task: 'go',
    exit: 0,
    doing: 'Showing you round',
    waitUntil: 0,
    flat: null,
    look: { skin: 2, hair: 5, top: 6, legs: 2 },
    facing: 1,
  };
  st.pawns.push(d);
  h.guide = d.id;
  h.stop = 0;
  const lines = flats.map((f, i) => `${f.name}: ${pritchard(sim, i)}`);
  letter(sim, {
    from: 'R. Pritchard (the last owner)',
    title: 'Handover notes',
    body: `To whoever's daft enough to buy it. One line per flat, as asked.\n${lines.join('\n')}\nThe boiler has moods. Mondays the bank wants its money. Good luck. R.P.`,
  });
}

function pritchard(sim: Sim, i: number): string {
  switch (i) {
    case 0:
      return `${tenantOf(sim, 0)?.name ?? 'Empty'}. Pays on the dot. Keeps to themselves.`;
    case 1:
      return 'Empty since March. Nothing wrong with it. Let it.';
    case 2:
      return 'Sold the furniture. Damp in the corner, paint over it.';
    case 3:
      return `${tenantOf(sim, 3)?.name ?? 'Empty'}. Here since 1987. Will ask about the heating. Will ask again.`;
    case 4:
      return 'Stripped it to do it up. Didn\'t.';
    default:
      return 'Not mine. Must be new.';
  }
}

// ------------------------------------------------------------------ the walk round

export function touring(sim: Sim): boolean {
  return sim.state.handover.stop >= 0;
}

export function guide(sim: Sim): Pawn | undefined {
  const id = sim.state.handover.guide;
  return id === undefined ? undefined : sim.state.pawns.find((p) => p.id === id);
}

/** What Denise is saying right now (once she's got there). */
export function saying(sim: Sim): string | null {
  const h = sim.state.handover;
  if (h.stop < 0 || !h.at) return null;
  return TOUR[h.stop]?.say(sim) ?? null;
}

/** The flat the walk is at (for the camera), or null for the lobby. */
export function stopFlat(sim: Sim): string | null {
  const h = sim.state.handover;
  const stop = TOUR[h.stop];
  if (!stop || stop.flat === 'lobby') return null;
  return sim.layout.flats[stop.flat]?.id ?? null;
}

/** Where she stands at a stop: the middle of the flat, or just inside the street door. */
function spotFor(sim: Sim, stop: Stop): [number, number] {
  const lay = sim.layout;
  const flat = stop.flat === 'lobby' ? undefined : lay.flats[stop.flat];
  if (!flat) return [sim.state.plot.x0 + 2, 0];
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n)).map((n) => lay.xs(n));
  nodes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return nodes[Math.floor(nodes.length / 2)] ?? [sim.state.plot.x0 + 2, 0];
}

/** Denise's next move on the walk. False once it's over (she's off, like any agent). */
export function guideThink(sim: Sim, p: Pawn): boolean {
  const st = sim.state;
  const h = st.handover;
  if (p.id !== h.guide) return false;
  if (h.stop < 0) {
    // Off down the street, and gone (without a dice roll, so a seed plays out the same either way).
    const edge = p.exit === 0 ? 0 : st.w - 1;
    if (Math.round(p.x) === edge && Math.round(p.s) === 0) {
      st.pawns.splice(st.pawns.indexOf(p), 1);
      delete h.guide;
      st.timers.agent = Math.max(st.timers.agent, st.tick + 3 * TICKS_PER_HOUR);
      return true;
    }
    p.doing = 'Off to the next viewing';
    if (!setGoal(sim, p, [edge, 0])) p.waitUntil = st.tick + 5 * TICKS_PER_MINUTE;
    return true;
  }
  const stop = TOUR[h.stop];
  const [x, s] = spotFor(sim, stop);
  if (h.at) {
    // Said her piece: on to the next.
    next(sim);
    return touring(sim);
  }
  if (Math.round(p.x) === x && Math.round(p.s) === s) {
    arrive(sim, p);
    return true;
  }
  p.doing = 'Showing you round';
  // Can't get there (you've built something in the way): skip that stop.
  if (!setGoal(sim, p, [x, s])) next(sim);
  return true;
}

function arrive(sim: Sim, p: Pawn): void {
  const st = sim.state;
  st.handover.at = true;
  p.path = [];
  p.goal = null;
  p.waitUntil = st.tick + TALK_MINUTES * TICKS_PER_MINUTE;
  p.bubble = { text: '…', until: p.waitUntil };
}

function next(sim: Sim): void {
  const h = sim.state.handover;
  h.at = false;
  h.stop++;
  if (h.stop >= TOUR.length) endWalk(sim);
}

/** A tap: she's there already at the next stop (or the walk's over, at the last). */
export function skipAhead(sim: Sim): void {
  const h = sim.state.handover;
  if (h.stop < 0) return;
  if (!h.at) {
    // Still walking: she gets there now.
    const p = guide(sim);
    if (p) {
      [p.x, p.s] = spotFor(sim, TOUR[h.stop]);
      arrive(sim, p);
    } else next(sim);
    return;
  }
  next(sim);
  const p = guide(sim);
  if (h.stop >= 0 && p) {
    [p.x, p.s] = spotFor(sim, TOUR[h.stop]);
    arrive(sim, p);
  }
}

/** The walk's over: Denise heads off, her list comes, and the first applicants are on their way. */
function endWalk(sim: Sim): void {
  const st = sim.state;
  const h = st.handover;
  h.stop = -1;
  h.at = false;
  const p = guide(sim);
  if (p) {
    p.task = 'leave';
    p.path = [];
    p.waitUntil = 0;
    p.doing = 'Off to the next viewing';
  }
  if (h.skipped) return;
  const toLet = h.toLet ? sim.layout.flat(h.toLet) : undefined;
  const fit = h.fit ? sim.layout.flat(h.fit) : undefined;
  letter(sim, {
    from: AGENT,
    title: 'Your list',
    body: `As promised. It ticks itself off.\n• Meet your tenants: tap them, or their faces at the bottom.\n• Let ${toLet?.name ?? 'an empty flat'}: it's listed, and people will apply. Look past the rent at what their last landlord says.\n• Furnish ${fit?.name ?? 'the bare flat'}: Build shows you what it needs, and ticks it off as you go.\n• Make Monday's payment: keep £${Math.round((st.mortgage.payment + billsDue(sim)) / POUND)} in the bank for day 8.\nD.`,
  });
  // Someone's already keen on the flat, and a bit cheeky with it.
  if (toLet && !flatInfo(sim, toLet.id).lease) {
    const info = flatInfo(sim, toLet.id);
    const a = newApplicant(sim, toLet.id);
    a.offer = Math.round((info.asking * 0.8) / (5 * POUND)) * 5 * POUND;
    a.hints.unshift('Offered less than you asked. Said it was "a starting point".');
    st.applicants.push(a);
    info.nextApplicant = Math.min(info.nextApplicant, st.tick + 2 * TICKS_PER_HOUR);
  }
}

/** From the menu: no walk, no list, no nudges. */
export function skipHandover(sim: Sim): void {
  const h = sim.state.handover;
  h.skipped = true;
  if (h.stop >= 0) endWalk(sim);
}

// ------------------------------------------------------------------ the list

export interface Todo {
  id: string;
  label: string;
  done: boolean;
}

/** Denise's list, each item true or not from the game as it is. */
export function todo(sim: Sim): Todo[] {
  const st = sim.state;
  const h = st.handover;
  const lay = sim.layout;
  const toLet = h.toLet ? lay.flat(h.toLet) : undefined;
  const fit = h.fit ? lay.flat(h.fit) : undefined;
  const basics = fit ? scoreFor(sim, fit.id, 1).has : null;
  const cast = h.cast.filter((id) => st.pawns.some((p) => p.id === id && p.life && !p.life.leaving));
  return [
    { id: 'meet', label: 'Meet your tenants', done: cast.every((id) => h.met.includes(id)) },
    { id: 'let', label: `Let ${toLet?.name ?? 'an empty flat'}`, done: !toLet || flatInfo(sim, toLet.id).lease !== null },
    { id: 'fit', label: `Furnish ${fit?.name ?? 'the bare flat'}`, done: !basics || (basics.bed && basics.toilet && basics.wash && basics.kitchen) },
    { id: 'pay', label: "Make Monday's payment", done: st.ledger.some((e) => e.label === 'Mortgage') },
  ];
}

/** Show the list: after the walk, until it's all done (and a little after), unless skipped. */
export function showTodo(sim: Sim): boolean {
  const h = sim.state.handover;
  return !h.skipped && h.stop < 0 && !h.done.includes('list');
}

/** Everything on the list is done. */
export function listDone(sim: Sim): boolean {
  return todo(sim).every((t) => t.done);
}

/** You looked at a tenant. */
export function meet(sim: Sim, pawnId: number): void {
  const h = sim.state.handover;
  if (h.cast.includes(pawnId) && !h.met.includes(pawnId)) h.met.push(pawnId);
}

// ------------------------------------------------------------------ the beats

/** Once an hour, through the first fortnight. */
export function handoverHour(sim: Sim): void {
  const st = sim.state;
  const h = st.handover;
  if (h.skipped || sim.day > 21) return;
  const hour = Math.floor(sim.minuteOfDay / 60);
  const beat = (name: string) => {
    if (h.done.includes(name)) return false;
    h.done.push(name);
    return true;
  };
  // The advance comes back out of the deposit, once the flat's let.
  if (h.advance && h.toLet && flatInfo(sim, h.toLet).lease) {
    book(sim, 'Advance paid back to the agent', -h.advance);
    delete h.advance;
  }
  if (h.stop >= 0) return;
  // The list, all done: a word from Denise, and it goes away.
  if (listDone(sim) && beat('list')) {
    letter(sim, { from: AGENT, title: 'All done', body: 'That\'s my list ticked off. You\'re on your own now. Ring if the boiler does anything new.' });
  }
  // Day 2: Bill wants the heating up. Everyone sees what you say.
  const bill = st.pawns.find((p) => h.cast.includes(p.id) && p.name.startsWith('Bill ') && p.life && !p.life.away && !p.life.leaving);
  if (sim.day >= 2 && hour >= 10 && hour < 18 && bill && beat('boiler')) {
    const temp = Math.round(st.temps[bill.life!.flat] ?? 16);
    post(sim, bill, `Is the heating on? It's ${temp}° in here. I've got two cardigans on.`, [
      { label: 'Turn the boiler up', note: 'Warmer for everyone, dearer gas', act: 'boilerUp' },
      { label: 'Try a jumper', note: 'Free. Unpopular.', act: 'jumper' },
    ]);
  }
  // Short for Monday before the flat's let: Denise offers some of the deposit up front.
  const toLetFree = h.toLet && !flatInfo(sim, h.toLet).lease;
  if (sim.day >= 5 && sim.day < 8 && hour === 9 && toLetFree && st.money < st.mortgage.payment + billsDue(sim) && beat('advance')) {
    letter(sim, {
      from: AGENT,
      title: 'Monday',
      body: `You're looking short for Monday. I can advance you £${ADVANCE / POUND} against the deposit on the flat you're letting; it comes back out when someone moves in. Don't tell my manager.`,
      choices: [
        { label: `Take the £${ADVANCE / POUND}`, note: 'Paid back from the deposit', act: `advance:${ADVANCE}` },
        { label: "I'll manage", note: 'Nothing happens', act: 'none' },
      ],
      dueDay: sim.day + 2,
      fallback: 1,
    });
  }
  // Week two: an idea for the stripped flat, which is the way into building.
  const gutted = h.gutted ? sim.layout.flat(h.gutted) : undefined;
  if (sim.day >= 9 && hour === 9 && gutted && beat('split')) {
    letter(sim, {
      from: AGENT,
      title: `An idea for ${gutted.name}`,
      body: `It's big for one. Two studios would let for more. Open Build, pick Walls, and draw a wall down the middle with your finger: it's only a plan until you sign it off, and nothing's paid till then. Anything red isn't held up. Each half needs its own front door (Doors & windows), and a bed, a loo, a shower and a cooker. Then Sign off.`,
      flat: gutted.id,
    });
  }
}

/** The storyteller waits until the list's done, or day 8, whichever's first. */
export function quietFor(sim: Sim, firstDay: number): boolean {
  if (sim.day >= firstDay) return false;
  const h = sim.state.handover;
  return h.skipped || !listDone(sim);
}

/** Taking the advance (from Denise's letter). */
export function takeAdvance(sim: Sim, amount: number): void {
  const h = sim.state.handover;
  if (h.advance) return;
  h.advance = amount;
  book(sim, 'Advance from the letting agent', amount);
}
