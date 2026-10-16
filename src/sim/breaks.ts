// When mood stays low, people snap; when it stays high, they get inspired.
// Three bands: minor, major, severe. A break only happens after mood has sat below a
// band for a while, then on a random roll that gets more likely the worse the band.
// Every break names its "final straw", the worst reason at the time.

import { random, pick, randInt } from './rng';
import type { Sim } from './sim';
import { witness } from './social';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, type BreakKind, type Pawn } from './state';
import { addMemory, finalStraw, hasTrait } from './thoughts';

const BANDS = { minor: 30, major: 20, severe: 10 } as const;
/** Mean hours between breaks once below a band for long enough. */
const MTB_HOURS = { minor: 6, major: 3, severe: 1.5 } as const;
const SUSTAIN_TICKS = 30 * TICKS_PER_MINUTE;
const INSPIRE_ABOVE = 80;
const INSPIRE_MTB_HOURS = 8;

const BREAKS: Record<keyof typeof BANDS, BreakKind[]> = {
  minor: ['sulk', 'slowWalk', 'snappy'],
  major: ['walkout', 'cry', 'argueGuest'],
  severe: ['quit'],
};

export const BREAK_LABELS: Record<BreakKind, string> = {
  sulk: 'Sulking in the staff room',
  slowWalk: 'Slow-walking every order',
  snappy: 'Snapping at everyone',
  walkout: 'Walked out mid-shift',
  cry: 'Crying in the walk-in',
  argueGuest: 'Arguing with a customer',
  quit: 'Quitting on the spot',
};

const BREAK_LOG: Record<BreakKind, (name: string) => string> = {
  sulk: (n) => `${n} has gone to sulk in the staff room.`,
  slowWalk: (n) => `${n} has decided every order can wait.`,
  snappy: (n) => `${n} is snapping at anyone who comes near.`,
  walkout: (n) => `${n} took off their apron and walked out.`,
  cry: (n) => `${n} is having a cry in the walk-in.`,
  argueGuest: (n) => `${n} is about to tell a customer exactly what they think.`,
  quit: (n) => `${n} quit on the spot.`,
};

function threshold(p: Pawn, band: keyof typeof BANDS): number {
  return BANDS[band] + (hasTrait(p, 'hotHeaded') ? 5 : 0) - (hasTrait(p, 'calm') ? 5 : 0);
}

/** Once per in-game minute for each staff member on site. */
export function checkBreaks(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const staff = p.staff!;
  if (staff.mentalBreak && s.tick >= staff.mentalBreak.until) endBreak(sim, p);
  if (staff.inspiration && s.tick >= staff.inspiration.until) staff.inspiration = null;

  for (const band of ['minor', 'major', 'severe'] as const) {
    if (staff.mood < threshold(p, band)) staff.belowSince[band] ??= s.tick;
    else staff.belowSince[band] = null;
  }
  if (staff.mentalBreak) return;

  for (const band of ['severe', 'major', 'minor'] as const) {
    const since = staff.belowSince[band];
    if (since === null || s.tick - since < SUSTAIN_TICKS) continue;
    if (random(s) < 1 / (MTB_HOURS[band] * 60)) startBreak(sim, p, pick(s, BREAKS[band]));
    return;
  }

  if (staff.mood > INSPIRE_ABOVE) staff.highSince ??= s.tick;
  else staff.highSince = null;
  if (!staff.inspiration && staff.highSince !== null && s.tick - staff.highSince > TICKS_PER_HOUR && random(s) < 1 / (INSPIRE_MTB_HOURS * 60)) {
    const kind = random(s) < 0.5 ? 'latteArt' : 'charm';
    staff.inspiration = { kind, until: s.tick + 4 * TICKS_PER_HOUR };
    sim.log(kind === 'latteArt' ? `${p.name} is on a roll: latte art streak.` : `${p.name} is turning on the charm. Tips incoming.`, 'good', p.id, 'inspiration', 3);
  }
}

export function startBreak(sim: Sim, p: Pawn, kind: BreakKind): void {
  const s = sim.state;
  const staff = p.staff!;
  const straw = finalStraw(sim, p);
  const minutes = kind === 'slowWalk' || kind === 'snappy' ? randInt(s, 45, 75) : randInt(s, 25, 45);
  staff.mentalBreak = { kind, until: s.tick + minutes * TICKS_PER_MINUTE, finalStraw: straw };
  // Cracking up takes something out of you.
  staff.stress = Math.min(100, staff.stress + 8);
  staff.belowSince = { minor: null, major: null, severe: null };
  sim.endJob(p);
  sim.log(`${BREAK_LOG[kind](p.name)} Final straw: ${straw}.`, 'bad', p.id, kind === 'quit' ? 'quit' : 'break', kind === 'quit' ? 10 : 6);
  s.story.breaksToday++;
  witness(sim, p, 'sawMeltdown', [p]);
  if (kind === 'walkout' || kind === 'quit') {
    if (kind === 'quit') staff.quit = true;
    p.job = sim.leaveJob(BREAK_LABELS[kind]);
  }
}

function endBreak(sim: Sim, p: Pawn): void {
  const staff = p.staff!;
  const kind = staff.mentalBreak!.kind;
  staff.mentalBreak = null;
  addMemory(sim, p, kind === 'walkout' ? 'walkedOut' : 'meltdown');
  if (p.job && p.job.label === BREAK_LABELS[kind]) sim.endJob(p);
}

/** What someone in the middle of a break does instead of working. Null means "carry on as normal". */
export function breakJob(sim: Sim, p: Pawn): ReturnType<Sim['makeJob']> | null {
  const s = sim.state;
  const b = p.staff?.mentalBreak;
  if (!b) return null;
  const label = BREAK_LABELS[b.kind];
  switch (b.kind) {
    case 'slowWalk':
    case 'snappy':
      return null;
    case 'walkout':
    case 'quit':
      return sim.leaveJob(label);
    case 'sulk':
    case 'cry': {
      const target = b.kind === 'cry' ? fridgeSpot(sim) : randomTile(sim, 'S');
      const steps: ReturnType<Sim['makeJob']>['steps'] = [];
      if (target) {
        const go = sim.gotoStep(target[0], target[1]);
        go.path = sim.pathFrom(p, target[0], target[1]);
        if (go.path) steps.push(go);
      }
      steps.push({ kind: 'wait', ticksLeft: Math.max(TICKS_PER_MINUTE, b.until - s.tick) });
      return sim.makeJob(label, steps);
    }
    case 'argueGuest': {
      const guests = s.pawns.filter((g) => g.visit && (g.visit.state === 'queuing' || g.visit.state === 'waiting'));
      if (guests.length === 0) return sim.makeJob(label, [{ kind: 'wait', ticksLeft: 5 * TICKS_PER_MINUTE }]);
      const g = pick(s, guests);
      const tx = Math.round(g.x);
      const ty = Math.round(g.y) - 1;
      const go = sim.gotoStep(tx, ty);
      go.path = sim.pathFrom(p, tx, ty) ?? sim.pathFrom(p, Math.round(g.x), Math.round(g.y));
      const steps: ReturnType<Sim['makeJob']>['steps'] = go.path ? [go] : [];
      steps.push({ kind: 'act', action: { type: 'argue', guestId: g.id }, work: 'counter', ticksLeft: TICKS_PER_MINUTE, total: TICKS_PER_MINUTE });
      return sim.makeJob(label, steps);
    }
  }
}

function fridgeSpot(sim: Sim): [number, number] | null {
  const fridge = sim.state.objects.find((o) => o.def === 'fridge');
  return fridge ? sim.world.spots(fridge)[0] : null;
}

function randomTile(sim: Sim, floor: string): [number, number] | null {
  const s = sim.state;
  for (let i = 0; i < 20; i++) {
    const x = randInt(s, 0, s.w - 1);
    const y = randInt(s, 0, s.h - 1);
    if (sim.world.passable(x, y) && sim.world.tile(x, y).floor === floor) return [x, y];
  }
  return null;
}
