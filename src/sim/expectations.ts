// What tenants expect. Do well and people want more: the better your reviews, the nicer
// your flats and the longer the building has been going well, the more the tenants expect
// of it. It creeps up a little each morning and eases back down faster if things go badly,
// so a bad patch gives you room to recover. The effects are all labelled thoughts (a flat
// that used to be fine feels shabby, the fair-rent band narrows); the numbers are up here.

import { flatInfo } from './economy';
import { landlordRating } from './leases';
import type { Sim } from './sim';
import type { Thought } from './thoughts';

export const EXPECT_NAMES = ['Low', 'Moderate', 'High', 'Very high'] as const;

/** Where the level starts (out of 100). */
export const EXPECT_START = 12;
/** Most it moves in a morning, going up and coming down. */
const RISE_PER_DAY = 1.5;
const FALL_PER_DAY = 3;
/** The level is a grade each time it passes one of these. */
const GRADE_LINES = [25, 50, 75];

const TIER_ORDER = ['Grim', 'Shabby', 'Plain', 'Decent', 'Nice', 'Smart', 'Impressive'];

/** 0 (low) to 3 (very high). */
export function expectGrade(sim: Sim): number {
  const level = sim.state.expect?.level ?? EXPECT_START;
  return GRADE_LINES.filter((l) => level >= l).length;
}

export function expectName(sim: Sim): string {
  return EXPECT_NAMES[expectGrade(sim)];
}

/** Average tier of the flats, 0 (grim) to 6 (impressive). */
function averageTier(sim: Sim): number {
  const flats = sim.layout.flats;
  if (flats.length === 0) return 0;
  return flats.reduce((n, f) => n + Math.max(0, TIER_ORDER.indexOf(flatInfo(sim, f.id).tier)), 0) / flats.length;
}

/** The pieces the target level is made of, each out of its own maximum. */
export function expectParts(sim: Sim): { label: string; points: number }[] {
  const rating = landlordRating(sim);
  return [
    { label: 'your reviews', points: rating === null ? 8 : Math.max(0, Math.min(30, (rating - 2) * 10)) },
    { label: 'how nice the flats are', points: averageTier(sim) * 4 },
    { label: 'how long it has been going well', points: Math.min(30, (sim.state.expect?.good ?? 0) * 0.75) },
  ];
}

export function expectTarget(sim: Sim): number {
  return expectParts(sim).reduce((n, p) => n + p.points, 0);
}

/** One line on why tenants expect what they do. */
export function expectNote(sim: Sim): string {
  const grade = expectGrade(sim);
  const parts = expectParts(sim);
  const top = [...parts].filter((p) => p.label !== 'your reviews' || landlordRating(sim) !== null).sort((a, b) => b.points - a.points)[0];
  const target = expectTarget(sim);
  const level = sim.state.expect?.level ?? EXPECT_START;
  const trend = target > level + 2 ? 'Rising' : target < level - 2 ? 'Easing' : 'Steady';
  const base = ['Nobody expects much of a place like this.', 'Tenants want a decent flat for a fair price.', 'Tenants have seen what you can do, and want it everywhere.', 'Tenants expect the earth. Possibly with a view.'][grade];
  return `${base} ${trend}, mostly because of ${top.label}.`;
}

/** Every morning: the level eases towards where it ought to be, and the building's run of good days is counted. */
export function expectationsMorning(sim: Sim): void {
  const st = sim.state;
  st.expect ??= { level: EXPECT_START, good: 0 };
  const e = st.expect;
  const tenants = st.pawns.filter((p) => p.life && !p.life.leaving);
  if (tenants.length > 0) {
    const liking = tenants.reduce((n, p) => n + p.life!.liking, 0) / tenants.length;
    if (liking >= 55 && st.money >= 0 && st.mortgage.missed === 0) e.good++;
    else if (liking < 40 || st.mortgage.missed > 0) e.good = Math.max(0, e.good - 3);
  }
  const target = expectTarget(sim);
  if (target > e.level) e.level = Math.min(target, e.level + RISE_PER_DAY);
  else e.level = Math.max(target, e.level - FALL_PER_DAY);
}

/** A flat below what they expect feels it: three points for each tier short. Low expectations feel nothing. */
export function expectThought(tier: string, grade: number): Thought | null {
  if (grade < 1) return null;
  const gap = grade + 1 - TIER_ORDER.indexOf(tier);
  if (gap <= 0) return null;
  return { label: `Expected better than a ${tier.toLowerCase()} flat`, value: -3 * Math.min(gap, 3) };
}
