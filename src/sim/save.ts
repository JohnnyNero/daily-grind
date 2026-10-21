// Turning the game into text and back. Old saves are brought up to date here, and
// anything missing or broken is filled in or dropped rather than refusing to load.

import { isFurniture, isGraded } from './defs';
import { MORTGAGE, START_MONEY } from './economy';
import { EXPECT_START } from './expectations';
import { Sim } from './sim';
import { SAVE_VERSION, TICKS_PER_DAY, type State } from './state';
import { noWorks } from './works';
import { emptyDrip } from './drip';
import { scheduleFromJob } from './schedules';

export function serialize(sim: Sim): string {
  return JSON.stringify(sim.state);
}

export function deserialize(json: string): Sim {
  const raw = JSON.parse(json) as Partial<State>;
  if (typeof raw !== 'object' || raw === null || typeof raw.w !== 'number' || !raw.plot) {
    throw new Error("That doesn't look like a saved building.");
  }
  return new Sim(normalize(raw));
}

function normalize(raw: Partial<State>): State {
  const st = raw as State;
  if ((st.version ?? 0) > SAVE_VERSION) throw new Error('That save is from a newer version of the game.');
  // Version 5 made the building out of cells; older buildings can't be carried over.
  if ((st.version ?? 0) < 5) throw new Error('That save is from before walls were drawn cell by cell, so it can\'t be loaded.');
  const from = st.version ?? 0;
  st.version = SAVE_VERSION;
  st.cells ??= {};
  st.furniture = (st.furniture ?? []).filter((f) => isFurniture(f.def));
  // Grades came later: no grade (or one that makes no sense) is standard.
  for (const f of st.furniture) if ((f.grade !== 'cheap' && f.grade !== 'posh') || !isGraded(f.def)) delete f.grade;
  st.pawns ??= [];
  st.timers ??= { passerby: st.tick, agent: st.tick };
  // Version 2 added money, leases, letters and traits.
  st.money ??= START_MONEY;
  st.mortgage ??= { ...MORTGAGE, missed: 0, arrears: 0 };
  st.flats ??= {};
  st.applicants ??= [];
  st.post ??= [];
  st.ledger ??= [];
  st.notices ??= [];
  // Version 3 added the neighbours: insulation, the boiler, dirt, warmth, noise, the chat.
  st.insulated ??= {};
  st.boiler ??= 1;
  st.cleaner ??= false;
  st.dirt ??= {};
  st.temps ??= {};
  // Version 12 (the layout wave) added room temperatures and damp (heat.ts, damp.ts), started
  // empty and worked out afresh. Also new, and fine missing: the wet stack (`wet`: no record is
  // the one riser the building came with), the noise average, and dice of their own for the
  // storyteller, the burglars, each flat's applicants and the drip's week (all from the seed).
  st.roomTemps ??= {};
  st.damp ??= {};
  st.noiseAvg ??= {};
  st.chat ??= [];
  // Version 4 added the builders.
  st.works ??= noWorks();
  st.works.flats ??= [];
  // Version 6 added the storyteller, crime, wear, reviews, planning and the council.
  st.story ??= { busy: false, until: st.tick, cooldowns: {}, running: [] };
  st.security ??= { locks: false, alarm: false };
  st.reviews ??= [];
  st.planning ??= { top: Math.max(0, ...Object.keys(st.cells).map((k) => Number(k.split(',')[1]))) };
  st.council ??= {};
  // Version 7 added the handover; a building already under way doesn't need one.
  st.handover ??= { stop: -1, cast: [], met: [], done: [], skipped: true };
  // Version 8 added rising expectations, and tales for the weekly recap.
  st.expect ??= { level: EXPECT_START, good: 0 };
  st.chronicle ??= { next: 1, tales: [] };
  // Version 10 ran the clock three times faster: a tick in an older save is worth three now.
  if (from < 10) shrinkTicks(st);
  // Version 10 also added the drip, visitors, the project, schedules and habits.
  st.drip ??= emptyDrip(Math.floor(st.tick / TICKS_PER_DAY) + 1);
  st.drip.flags ??= [];
  st.visitors ??= { next: {} };
  st.project ??= {};
  for (const p of st.pawns) {
    if (!p.life) continue;
    p.life.social ??= [];
    p.life.needs.warmth ??= 1;
    p.life.needs.quiet ??= 1;
    p.life.traits ??= [];
    p.life.revealed ??= [];
    p.life.under ??= { minor: 0, major: 0, extreme: 0 };
    p.life.calmUntil ??= 0;
    p.life.since ??= 1;
    p.life.schedule ??= scheduleFromJob(p.life.job);
    p.life.habits ??= [];
  }
  // Version 11 added households: who moved in together, worked out from who lives with whom.
  if (from < 11) {
    for (const p of st.pawns) {
      if (!p.life || p.life.household) continue;
      const mates = st.pawns.filter((o) => o.life?.flat === p.life!.flat && !o.life.leaving);
      const partnered = mates.some((o) => o.life!.partner !== undefined && mates.some((q) => q.id === o.life!.partner));
      p.life.household = mates.length <= 1 ? 'single' : partnered ? (mates.length === 2 ? 'couple' : 'family') : 'sharers';
    }
    for (const a of st.applicants ?? []) a.household ??= a.people.length === 1 ? 'single' : a.people.length === 2 && a.people[0].name.split(' ').pop() === a.people[1].name.split(' ').pop() ? 'couple' : 'sharers';
  }
  for (const p of st.pawns) if (p.life) p.life.household ??= 'single';
  st.nextId = Math.max(st.nextId ?? 1, ...st.furniture.map((f) => f.id + 1), ...st.pawns.map((p) => p.id + 1));
  return st;
}

/**
 * Every stored tick divided by 3 (version 10 changed TICKS_PER_MINUTE from 60 to 20), so an
 * old save carries on at the same game time: the clock, timers, everything's `until`,
 * cooldowns, and when memories, messages and ledger lines happened. Days stay as they are.
 */
function shrinkTicks(st: State): void {
  const t = (n: number) => Math.round(n / 3);
  st.tick = t(st.tick);
  st.timers.passerby = t(st.timers.passerby);
  st.timers.agent = t(st.timers.agent);
  for (const f of Object.values(st.flats)) {
    f.nextApplicant = t(f.nextApplicant);
    if (f.belowSince !== undefined) f.belowSince = t(f.belowSince);
    if (f.lease?.withholdUntil !== undefined) f.lease.withholdUntil = t(f.lease.withholdUntil);
  }
  for (const a of st.applicants) a.until = t(a.until);
  for (const e of st.ledger) e.tick = t(e.tick);
  for (const n of st.notices) n.tick = t(n.tick);
  for (const m of st.chat) m.tick = t(m.tick);
  st.story.until = t(st.story.until);
  for (const k of Object.keys(st.story.cooldowns)) st.story.cooldowns[k] = t(st.story.cooldowns[k]);
  for (const h of st.story.running) {
    h.until = t(h.until);
    if (h.next !== undefined) h.next = t(h.next);
  }
  for (const tale of st.chronicle.tales) tale.tick = t(tale.tick);
  for (const p of st.pawns) {
    p.waitUntil = t(p.waitUntil);
    if (p.talkUntil !== undefined) p.talkUntil = t(p.talkUntil);
    if (p.bubble) p.bubble.until = t(p.bubble.until);
    if (p.burgle) p.burgle.until = t(p.burgle.until);
    const life = p.life;
    if (!life) continue;
    if (life.away) life.away.until = t(life.away.until);
    if (life.outing) life.outing.until = t(life.outing.until);
    if (life.using) life.using.until = t(life.using.until);
    if (life.breakState) life.breakState.until = t(life.breakState.until);
    if (life.under) for (const k of ['minor', 'major', 'extreme'] as const) life.under[k] = t(life.under[k] ?? 0);
    life.calmUntil = t(life.calmUntil ?? 0);
    if (life.lastTalk !== undefined) life.lastTalk = t(life.lastTalk);
    for (const m of life.memories ?? []) m.at = t(m.at);
    for (const m of life.social ?? []) m.at = t(m.at);
  }
}
