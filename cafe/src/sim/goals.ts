// Things to aim for: rotating goals with rewards, big days in the diary (a festival,
// the inspection, the local award), menu items that unlock with the stars, and the
// weekly report. They give a long game a shape: something is always coming up.

import { addFame, stars } from './business';
import { cleanliness } from './ambience';
import { WORK_TYPES } from './defs';
import { sendLetter } from './letters';
import { pick } from './rng';
import type { Sim } from './sim';
import type { Goal, WeeklyReport } from './state';
import { WEEKDAYS, weekday } from './stakes';

const ACTIVE_GOALS = 3;

function pounds(pence: number): string {
  return `£${Math.round(pence / 100).toLocaleString('en-GB')}`;
}

// ------------------------------------------------------------------ goals

type GoalMaker = (sim: Sim) => Goal | null;

function goal(sim: Sim, id: string, title: string, detail: string, days: number, reward: number): Goal {
  return { id, title, detail, byDay: sim.day + days, done: false, failed: false, reward };
}

const MAKERS: Readonly<Record<string, GoalMaker>> = {
  serve: (sim) => {
    const n = Math.round((70 + 15 * stars(sim)) / 5) * 5;
    return goal(sim, `serve:${n}`, `Serve ${n} in a day`, 'A big day, done properly.', 7, 10000 + 5000 * stars(sim));
  },
  calm: (sim) => goal(sim, 'calm:3', 'A day with no more than 3 walkouts', 'At least 40 served, hardly anyone giving up.', 7, 15000),
  star: (sim) => {
    const k = stars(sim) + 1;
    return k > 5 ? null : goal(sim, `star:${k}`, `Reach ${k} stars`, 'Fame and a good reputation, together.', 14, 25000 * k);
  },
  regulars: (sim) => {
    const now = sim.state.regulars.filter((r) => r.visits >= 3).length;
    return goal(sim, `regulars:${now + 3}`, `${now + 3} regulars`, 'People who keep coming back (three visits or more).', 10, 15000);
  },
  skill: (sim) => {
    const best = Math.max(0, ...sim.state.pawns.filter((p) => p.staff && !p.staff.quit).flatMap((p) => WORK_TYPES.map((w) => p.staff!.skills[w.id])));
    const target = Math.min(10, Math.floor(best) + 1);
    return best >= 9.5 ? null : goal(sim, `skill:${target}`, `Train someone to skill ${target}`, 'In anything. Passion helps a lot.', 14, 15000);
  },
  profit: (sim) => {
    const x = (300 + 150 * stars(sim)) * 100;
    return goal(sim, `profit:${x}`, `Make ${pounds(x)} profit in a week`, 'Takings minus every cost, Monday to Sunday.', 14, 20000);
  },
  happy: (sim) => goal(sim, 'happy:55', 'Close with everyone in a good mood', 'Everyone still on the team above 55 at closing time.', 7, 12000),
};

function goalKind(g: Goal): string {
  return g.id.split(':')[0];
}

/** Keeps three goals on the board, each a different kind. */
export function topUpGoals(sim: Sim): void {
  const s = sim.state;
  s.goals = s.goals.filter((g) => !g.done && !g.failed);
  const kinds = Object.keys(MAKERS);
  for (let tries = 0; s.goals.length < ACTIVE_GOALS && tries < 20; tries++) {
    const free = kinds.filter((k) => !s.goals.some((g) => goalKind(g) === k));
    if (free.length === 0) break;
    const made = MAKERS[pick(s, free)](sim);
    if (made) s.goals.push(made);
  }
}

function met(sim: Sim, g: Goal, week: WeeklyReport | null): boolean {
  const s = sim.state;
  const [kind, raw] = g.id.split(':');
  const n = Number(raw);
  const today = s.today;
  switch (kind) {
    case 'serve': return today.served >= n;
    case 'calm': return today.served >= 40 && today.walkouts <= n;
    case 'star': return stars(sim) >= n;
    case 'regulars': return s.regulars.filter((r) => r.visits >= 3).length >= n;
    case 'skill': return s.pawns.some((p) => p.staff && !p.staff.quit && WORK_TYPES.some((w) => p.staff!.skills[w.id] >= n));
    case 'profit': return week !== null && weekProfit(week) >= n;
    case 'happy': {
      const staff = s.pawns.filter((p) => p.staff && !p.staff.quit);
      return staff.length > 0 && staff.every((p) => p.staff!.mood > n);
    }
    default: return false;
  }
}

export function weekProfit(w: WeeklyReport): number {
  return w.takings - w.wages - w.ingredients - w.rent - w.repairs - w.other;
}

/** At the end of each day (and when a week closes): pay out goals met, drop the expired. */
export function checkGoals(sim: Sim, week: WeeklyReport | null = null): void {
  const s = sim.state;
  for (const g of s.goals) {
    if (g.done || g.failed) continue;
    if (met(sim, g, week)) {
      g.done = true;
      s.money += g.reward;
      s.today.takings += g.reward;
      addFame(sim, 2);
      sendLetter(sim, { title: 'Goal reached', text: `${g.title}: done. ${pounds(g.reward)} in the bank, and people are talking.`, tone: 'good', pawn: null });
      sim.log(`Goal reached: ${g.title}.`, 'good', null, 'goal', 4);
    } else if (g.byDay !== null && sim.day >= g.byDay) {
      g.failed = true;
    }
  }
  topUpGoals(sim);
}

// ------------------------------------------------------------------ the diary

const FESTIVAL_EVERY = 14;
const INSPECTION_EVERY = 21;
const AWARD_EVERY = 28;
const NOTICE_DAYS = 3;

/** Each morning: book the next big days and announce anything coming up soon. */
export function planDiary(sim: Sim): void {
  const s = sim.state;
  const day = sim.day;
  s.diary = s.diary.filter((d) => d.day >= day);
  const book = (kind: 'festival' | 'inspection' | 'award', first: number, every: number, title: string, text: string) => {
    let next = first;
    while (next < day) next += every;
    // Only the next one of each kind is booked, and only once it's close enough to announce.
    if (next - day > NOTICE_DAYS || s.diary.some((d) => d.kind === kind)) return;
    s.diary.push({ day: next, kind, title });
    const when = next === day ? 'today' : next === day + 1 ? 'tomorrow' : `on ${WEEKDAYS[weekday(next)]} (day ${next})`;
    sendLetter(sim, { title, text: `${title} is ${when}. ${text}`, tone: 'neutral', pawn: null });
  };
  book('festival', 10, FESTIVAL_EVERY, 'The food festival', 'The square will be heaving all day: expect far more customers than usual. Staff up.');
  book('inspection', 12, INSPECTION_EVERY, 'The health inspection', 'An inspector is coming at 11:00. Clean tables, empty sink, no spills. Pass and word gets round; fail and it really gets round.');
  book('award', AWARD_EVERY, AWARD_EVERY, 'Café of the Year judging', `The judges visit during the day. They want at least three stars, almost no walkouts and a spotless room.`);
}

export function diaryToday(sim: Sim, kind: 'festival' | 'inspection' | 'award'): boolean {
  return sim.state.diary.some((d) => d.kind === kind && d.day === sim.day);
}

/** Once a minute: the inspector arrives on time; the judges decide at closing. */
export function diaryMinute(sim: Sim, inspect: () => boolean): void {
  const m = sim.minuteOfDay;
  if (diaryToday(sim, 'inspection') && m === 11 * 60) {
    const passed = inspect();
    if (passed) {
      addFame(sim, 6);
      sim.state.money += 10000;
      sim.state.today.takings += 10000;
      sendLetter(sim, { title: 'Inspection passed', text: 'Top marks from the inspector. £100 from the council\'s good-practice scheme, and a sticker for the window.', tone: 'good', pawn: null });
    } else {
      addFame(sim, -6);
      sendLetter(sim, { title: 'Inspection failed', text: "The inspector wasn't impressed. It'll be on the council website for weeks.", tone: 'bad', pawn: null });
    }
  }
  if (diaryToday(sim, 'award') && m === sim.venue.hours.close) judgeAward(sim);
}

function judgeAward(sim: Sim): void {
  const s = sim.state;
  const d = s.today;
  const visits = d.served + d.walkouts;
  const walkRate = visits > 0 ? d.walkouts / visits : 1;
  const short: string[] = [];
  if (stars(sim) < 3) short.push('not enough stars');
  if (walkRate > 0.1) short.push('too many walkouts');
  if (cleanliness(sim) < 0.7) short.push('the room could have been cleaner');
  if (short.length === 0) {
    s.money += 50000;
    s.today.takings += 50000;
    addFame(sim, 15);
    sim.log(`${sim.venue.name} won Café of the Year! There's a plaque and everything.`, 'good', null, 'award', 10);
    sendLetter(sim, { title: 'Café of the Year!', text: 'You won. £500 prize, a plaque by the till and a queue of curious new customers.', tone: 'good', pawn: null });
    for (const p of s.pawns) if (p.staff && !p.staff.quit) p.staff.mood = Math.min(100, p.staff.mood + 10);
  } else {
    sendLetter(sim, { title: 'Not this year', text: `The judges went with someone else: ${short.join(', ')}. Next judging in four weeks.`, tone: 'bad', pawn: null });
  }
}

/** Arrivals multiplier for big days. */
export function diaryArrivals(sim: Sim): number {
  return diaryToday(sim, 'festival') ? 1.7 : 1;
}

// ------------------------------------------------------------------ unlocks and the week

/** New menu items as the stars go up. */
export function checkUnlocks(sim: Sim): void {
  const s = sim.state;
  const n = stars(sim);
  for (const u of sim.venue.unlocks) {
    if (u.stars > n || s.unlocked.includes(u.name)) continue;
    s.unlocked.push(u.name);
    if (!s.menu.some((m) => m.name === u.name)) s.menu.push({ name: u.name, kind: u.kind, basePrice: u.price, price: u.price, enabled: true });
    sendLetter(sim, {
      title: 'New on the menu', tone: 'good', pawn: null,
      text: `At ${n} stars you can do ${u.name} (£${(u.price / 100).toFixed(2)}). It's on the menu now; a bigger menu draws a few more people in.`,
    });
  }
}

/** The week's report, as a letter. */
export function weeklyLetter(sim: Sim, w: WeeklyReport): void {
  const profit = weekProfit(w);
  const costs = w.wages + w.ingredients + w.rent + w.repairs + w.other;
  const n = `${w.starsEnd} star${w.starsEnd === 1 ? '' : 's'}`;
  const starsText = w.starsEnd > w.starsStart ? `up to ${n}` : w.starsEnd < w.starsStart ? `down to ${n}` : `steady at ${n}`;
  sendLetter(sim, {
    title: `Week ${w.week} report`, tone: profit >= 0 ? 'good' : 'bad', pawn: null,
    text: `Takings ${pounds(w.takings)}, costs ${pounds(costs)} (wages ${pounds(w.wages)}, ingredients ${pounds(w.ingredients)}, rent ${pounds(w.rent)}${w.repairs ? `, repairs ${pounds(w.repairs)}` : ''}${w.other ? `, other ${pounds(w.other)}` : ''}). ${profit >= 0 ? 'Profit' : 'Loss'} ${pounds(Math.abs(profit))}. ${w.served} served, ${w.walkouts} walked out. ${starsText[0].toUpperCase()}${starsText.slice(1)}.`,
  });
}

