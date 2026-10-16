// What can go wrong, slowly: stress that builds into burnout, and money trouble.
// Nothing here ends the game, but neglect costs staff, customers and money, and
// recovering takes days, not minutes.

import { DEBT_LIMIT } from './business';
import type { Sim } from './sim';
import type { Pawn } from './state';
import { addMemory } from './thoughts';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Day 1 is a Monday. */
export function weekday(day: number): number {
  return (day - 1) % 7;
}

export function isDayOff(sim: Sim, p: Pawn, day = sim.day): boolean {
  return p.staff?.daysOff.includes(weekday(day)) === true;
}

/** Stress levels at which it starts to show, and at which they're burnt out. */
export const STRESS_STRAINED = 60;
export const STRESS_BURNT_OUT = 85;

/** Once a minute for every member of staff, at work or not. */
export function stressEveryMinute(sim: Sim, p: Pawn): void {
  const staff = p.staff;
  if (!staff || staff.quit) return;
  let d: number;
  if (p.onMap) {
    d = 0.012;
    if ((sim.state.rushes ?? []).length > 0) d += 0.015;
    if (staff.mood < 35) d += 0.01;
    // Past eight hours on the clock it really starts to tell.
    if ((sim.minuteOfDay - p.shift.start) / 60 > 8) d += 0.03;
    if (staff.lead) d += 0.003;
  } else {
    d = -0.0015;
  }
  staff.stress = Math.max(0, Math.min(100, staff.stress + d));
}

/** Each morning: a day off does a lot of good, and the burnt out sometimes can't face it. */
export function stressMorning(sim: Sim): void {
  for (const p of sim.state.pawns) {
    const staff = p.staff;
    if (!staff || staff.quit) continue;
    // Yesterday was their day off.
    if (sim.day > 1 && isDayOff(sim, p, sim.day - 1)) {
      staff.stress = Math.max(0, staff.stress - 22);
      addMemory(sim, p, 'dayOff');
    }
    if (staff.stress >= STRESS_BURNT_OUT && !isDayOff(sim, p) && staff.sickDay !== sim.day && sim.chance(0.3)) {
      staff.sickDay = sim.day;
      staff.stress = Math.max(0, staff.stress - 15);
      sim.log(`${p.name} is off with stress. They've been running on empty for a while.`, 'bad', p.id, 'burnout', 7);
    }
  }
}

/** Each morning: interest on an overdraft, and wages paid late once it's deep. */
export function debtMorning(sim: Sim): void {
  const s = sim.state;
  if (s.money >= 0) {
    if (s.debtDays >= 3) sim.log('Back in the black. The bank manager stops ringing.', 'good', null, 'outOfDebt', 4);
    s.debtDays = 0;
    return;
  }
  s.debtDays++;
  const fee = Math.max(100, Math.round(-s.money * 0.01));
  s.money -= fee;
  s.today.other += fee;
  if (s.money < DEBT_LIMIT / 2) {
    for (const p of s.pawns) if (p.staff && !p.staff.quit) addMemory(sim, p, 'wagesLate');
    if (s.debtDays === 1 || s.debtDays % 3 === 0) sim.log("Wages went out late again. Nobody's said anything. Yet.", 'bad', null, 'wagesLate', 6);
  } else if (s.debtDays === 3) {
    sim.log("Three days in the red. The overdraft fees are adding up.", 'bad', null, 'debt', 5);
  }
}
