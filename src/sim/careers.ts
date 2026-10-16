// Careers: staff who stay get better, ask for more, get noticed by rivals, and mark
// the years. Most of it arrives as a decision in the Inbox, and every answer costs
// something: money now, or goodwill later.

import { stars } from './business';
import { WORK_TYPES } from './defs';
import { onDecision, sendLetter } from './letters';
import { pick } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type Pawn } from './state';
import { addMemory } from './thoughts';

const RAISE = 100;
const MATCH = 200;
const LEAD_BONUS = 150;
const TALK_ROUND_BONUS = 5000;
/** Days between anyone asking (or being asked) about money. */
const ASK_GAP = 10;

const RIVALS = ['The Bean Machine', 'Grind Central', 'Brew & Co.', 'The Daily Roast', 'Steamed', 'Crema Corner'];

/** Decisions wait until closing time tomorrow, so the overnight skip can't swallow them. */
function decideBy(sim: Sim): number {
  const dayStart = Math.floor(sim.state.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  return dayStart + TICKS_PER_DAY + sim.venue.hours.close * TICKS_PER_MINUTE;
}

function staffList(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff && !p.staff.quit && !p.staff.fired);
}

function avgSkill(p: Pawn): number {
  return WORK_TYPES.reduce((n, w) => n + p.staff!.skills[w.id], 0) / WORK_TYPES.length;
}

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function quitFor(sim: Sim, p: Pawn, text: string, tale: string): void {
  const staff = p.staff!;
  staff.quit = true;
  staff.mentalBreak = null;
  sim.log(text, 'bad', p.id, tale, 9);
  if (p.onMap) {
    sim.endJob(p);
    p.job = sim.leaveJob('Clearing out their locker');
  } else {
    sim.removeStaff(p);
  }
}

/** Each morning: raises asked for, rivals sniffing about, anniversaries marked. */
export function careersMorning(sim: Sim): void {
  const s = sim.state;
  const day = sim.day;
  const staff = staffList(sim);
  const pending = new Set(s.letters.filter((l) => l.kind && l.data?.pawn !== undefined).map((l) => Number(l.data!.pawn)));

  for (const p of staff) {
    const st = p.staff!;
    const tenure = day - st.hiredDay;
    if (tenure > 0 && tenure % 30 === 0) {
      addMemory(sim, p, 'anniversary');
      sim.log(`${p.name} has been here ${tenure} days. Somebody get a cake.`, 'good', p.id, 'milestone', 6);
    }
  }

  // At most one money conversation a day, and not with anyone who has one open.
  const askers = staff.filter((p) => !pending.has(p.id) && day - p.staff!.lastAskDay >= ASK_GAP && day - p.staff!.hiredDay >= ASK_GAP);
  if (askers.length === 0) return;

  // A rival tries to poach the best people once the place is known for good staff.
  const poachable = askers.filter((p) => avgSkill(p) >= 5);
  if (stars(sim) >= 2 && poachable.length > 0 && sim.chance(0.06)) {
    const p = poachable.sort((a, b) => avgSkill(b) - avgSkill(a))[0];
    p.staff!.lastAskDay = day;
    const rival = pick(s, RIVALS);
    const offer = p.staff!.wage + MATCH;
    sendLetter(sim, {
      title: `${rival} wants ${p.name}`, tone: 'bad', pawn: p.id, kind: 'poach',
      text: `${rival} has offered ${p.name} ${money(offer)} an hour to come and work for them. ${p.name} is tempted.`,
      choices: [{ id: 'let', label: 'Wish them well' }, { id: 'match', label: `Match it (+${money(MATCH)}/h)` }],
      expires: decideBy(sim),
      data: { pawn: p.id, rival },
    });
    return;
  }

  // Someone who's been here a while, and is good at it or simply fed up, asks for more.
  const keen = askers.filter((p) => avgSkill(p) >= 4.5 || p.staff!.mood < 45);
  if (keen.length > 0 && sim.chance(0.2)) {
    const p = pick(s, keen);
    p.staff!.lastAskDay = day;
    sendLetter(sim, {
      title: `${p.name} wants a word`, tone: 'neutral', pawn: p.id, kind: 'raise',
      text: `${p.name} asks for a raise, from ${money(p.staff!.wage)} to ${money(p.staff!.wage + RAISE)} an hour. "I've been here ${day - p.staff!.hiredDay} days and I do a lot round here."`,
      choices: [{ id: 'no', label: 'Not right now' }, { id: 'yes', label: `Give it (+${money(RAISE)}/h)` }],
      expires: decideBy(sim),
      data: { pawn: p.id },
    });
  }
}

/** Called when someone leaves for good: close friends who are fed up may follow. */
export function friendsMayFollow(sim: Sim, leaver: Pawn): void {
  for (const p of staffList(sim)) {
    if (p.id === leaver.id) continue;
    if (sim.opinion(p, leaver) < 40 || p.staff!.mood >= 50 || !sim.chance(0.4)) continue;
    sendLetter(sim, {
      title: `${p.name} might follow ${leaver.name}`, tone: 'bad', pawn: p.id, kind: 'followOut',
      text: `${p.name} and ${leaver.name} were close, and ${p.name} hasn't been happy either. They're thinking of handing in their notice.`,
      choices: [{ id: 'let', label: 'Let them go' }, { id: 'talk', label: `Talk them round (a ${money(TALK_ROUND_BONUS)} bonus)` }],
      expires: decideBy(sim),
      data: { pawn: p.id, leaver: leaver.name },
    });
  }
}

/** Makes someone shift lead (or nobody, with null). One at a time; they're paid a bit more. */
export function setLead(sim: Sim, p: Pawn | null): string | null {
  for (const o of staffList(sim)) {
    if (o.staff!.lead && o !== p) {
      o.staff!.lead = false;
      o.staff!.wage -= LEAD_BONUS;
    }
  }
  if (!p) return null;
  if (!p.staff || p.staff.quit) return "They're not on the team.";
  if (p.staff.lead) return null;
  p.staff.lead = true;
  p.staff.wage += LEAD_BONUS;
  addMemory(sim, p, 'madeLead');
  sim.log(`${p.name} is the new shift lead.`, 'good', p.id, 'lead', 4);
  return null;
}

onDecision('raise', (sim, letter, choice) => {
  const p = sim.pawnById(Number(letter.data!.pawn));
  if (!p?.staff || p.staff.quit) return;
  if (choice === 'yes') {
    p.staff.wage += RAISE;
    addMemory(sim, p, 'gotRaise');
    sim.log(`${p.name} got their raise.`, 'good', p.id, 'raise', 3);
  } else {
    addMemory(sim, p, 'raiseRefused');
    p.staff.stress = Math.min(100, p.staff.stress + 5);
  }
});

onDecision('poach', (sim, letter, choice) => {
  const p = sim.pawnById(Number(letter.data!.pawn));
  if (!p?.staff || p.staff.quit) return;
  if (choice === 'match') {
    p.staff.wage += MATCH;
    addMemory(sim, p, 'valued');
    sim.log(`You matched ${letter.data!.rival}'s offer. ${p.name} is staying.`, 'good', p.id, 'keptStaff', 5);
  } else {
    quitFor(sim, p, `${p.name} has gone to ${letter.data!.rival}. They'll be missed.`, 'poached');
  }
});

onDecision('followOut', (sim, letter, choice) => {
  const p = sim.pawnById(Number(letter.data!.pawn));
  if (!p?.staff || p.staff.quit) return;
  if (choice === 'talk') {
    sim.state.money -= TALK_ROUND_BONUS;
    sim.state.today.other += TALK_ROUND_BONUS;
    addMemory(sim, p, 'talkedRound');
  } else {
    quitFor(sim, p, `${p.name} followed ${letter.data!.leaver} out the door.`, 'followedOut');
  }
});
