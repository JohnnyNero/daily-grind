// The overnight books: rent and rates, fame fading, the week's totals and its report.

import { addDayToWeek, dailyRent, emptyWeek, fadeFame, stars } from './business';
import type { Sim } from './sim';
import { debtMorning, stressMorning } from './stakes';
import { careersMorning } from './careers';
import { flatMorning } from './flat';
import { checkGoals, checkUnlocks, planDiary, topUpGoals, weeklyLetter } from './goals';

/** Called just after midnight, once yesterday's numbers are final and today's are blank. */
export function morningBooks(sim: Sim): void {
  const s = sim.state;
  if (s.yesterday) addDayToWeek(s.week, s.yesterday);

  const rent = dailyRent(sim);
  s.money -= rent;
  s.today.rent += rent;
  fadeFame(sim);
  debtMorning(sim);
  stressMorning(sim);
  careersMorning(sim);
  flatMorning(sim);

  // A new week starts every seventh morning: write up the one that just ended.
  if ((sim.day - 1) % 7 === 0 && sim.day > 1) {
    const w = s.week;
    w.fameEnd = s.fame;
    w.starsEnd = stars(sim);
    s.weeklyReports.push(w);
    if (s.weeklyReports.length > 12) s.weeklyReports.shift();
    s.week = emptyWeek(sim, w.week + 1, sim.day);
    weeklyLetter(sim, w);
    checkGoals(sim, w);
  }
  checkUnlocks(sim);
  planDiary(sim);
  topUpGoals(sim);
}
