// Fills in anything a state is missing: new games get their defaults here, and older
// saves pick up new systems without a version bump. Safe to run more than once.

import { STARTING_FAME, askingWage, emptyDay, emptyWeek } from './business';
import { WORK_TYPES, type WorkType } from './defs';
import type { Sim } from './sim';
import { topUpGoals } from './goals';
import type { Applicant, DayStats, StaffInfo } from './state';

/** A stable pseudo-random number from an id, so old saves get the same passions every load. */
function hash(n: number, salt: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function passionsFor(id: number): WorkType[] {
  const first = WORK_TYPES[Math.floor(hash(id, 1) * WORK_TYPES.length)].id;
  const out: WorkType[] = [first];
  if (hash(id, 2) < 0.45) {
    const second = WORK_TYPES[Math.floor(hash(id, 3) * WORK_TYPES.length)].id;
    if (second !== first) out.push(second);
  }
  return out;
}

function fillDay(d: DayStats): void {
  const blank = emptyDay();
  for (const k of Object.keys(blank) as (keyof DayStats)[]) (d as unknown as Record<string, unknown>)[k] ??= blank[k];
}

export function fillStaff(staff: StaffInfo, id: number, day: number): void {
  staff.passions ??= passionsFor(id);
  staff.wage ??= askingWage(staff.skills);
  staff.stress ??= 0;
  staff.daysOff ??= [Math.floor(hash(id, 4) * 7)];
  staff.hiredDay ??= day;
  staff.lead ??= false;
  staff.rushStation ??= null;
  staff.catchphrases ??= [];
  staff.livesIn ??= false;
  staff.lastWork ??= null;
  staff.lastAskDay ??= day;
  staff.station ??= null;
  staff.focus ??= null;
}

export function fillApplicant(a: Applicant, salt: number): void {
  a.passions ??= passionsFor(salt);
  a.wage ??= askingWage(a.skills);
}

export function normalize(sim: Sim): void {
  const s = sim.state;
  const day = sim.day;
  s.fame ??= STARTING_FAME;
  s.wear ??= {};
  s.debtDays ??= 0;
  s.letters ??= [];
  s.goals ??= [];
  s.calls ??= { allHandsUntil: 0, closedUntil: 0, ready: {} };
  s.diary ??= [];
  s.unlocked ??= [];
  s.weeklyReports ??= [];
  s.week ??= emptyWeek(sim, Math.floor((day - 1) / 7) + 1, day);
  s.story.incoming ??= null;
  fillDay(s.today);
  if (s.yesterday) fillDay(s.yesterday);
  for (const r of s.recaps) fillDay(r.stats);
  for (const p of s.pawns) if (p.staff) fillStaff(p.staff, p.id, day);
  s.applicants.forEach((a, i) => fillApplicant(a, s.nextId * 31 + i));
  if (s.goals.length === 0) topUpGoals(sim);
}
