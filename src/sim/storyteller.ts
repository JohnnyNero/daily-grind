// The storyteller: decides when something happens, and what.
//
// - Rhythm: busy stretches (two days) alternate with quiet ones (one day). Events come
//   on average every few open hours in a busy stretch, rarely in a quiet one.
// - Scale: rushes grow with reputation (success brings pressure).
// - Adaptation: a hidden counter rises through calm days and drops after disasters
//   (walkout-heavy days, breaks, quits). Pressure scales with it, so the café gets a
//   breather after a bad day and a shake-up after a long calm.

import { spawnGuest } from './guests';
import { availableRegulars, birthdayVisit } from './regulars';
import { pick, random, randInt } from './rng';
import type { Sim } from './sim';
import { addFame, worstWear } from './business';
import { TICKS_PER_MINUTE, TICKS_PER_HOUR, type ConditionId, type Pawn } from './state';
import { addMemory } from './thoughts';

type Category = 'pressure' | 'social' | 'good';

interface EventDef {
  id: string;
  category: Category;
  /** How likely, against the others; can depend on the state (a worn machine breaks more). */
  weight: number | ((sim: Sim) => number);
  canFire: (sim: Sim) => boolean;
  fire: (sim: Sim) => void;
}

const MEAN_HOURS_BETWEEN = { busy: 2.5, quiet: 7 } as const;

export function pressureScale(sim: Sim): number {
  return Math.max(0.4, Math.min(2, 1 + sim.state.story.adaptation / 15));
}

function addCondition(sim: Sim, id: ConditionId, hours: number): void {
  const s = sim.state;
  s.conditions = s.conditions.filter((c) => c.id !== id);
  s.conditions.push({ id, until: s.tick + Math.round(hours * TICKS_PER_HOUR) });
}

function staffOnSite(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff && p.onMap && !p.staff.quit);
}

function mess(sim: Sim): number {
  const s = sim.state;
  return Object.values(s.dirty).reduce((a, b) => a + b, 0) + s.sinkDirty;
}

const EVENTS: readonly EventDef[] = [
  {
    id: 'coachParty', category: 'pressure', weight: 3,
    canFire: (sim) => sim.state.story.pendingArrivals === 0 && !sim.state.story.incoming,
    fire: (sim) => {
      const s = sim.state;
      // Bigger the better known you are. Announced ahead, like a raid on the horizon.
      const n = Math.max(4, Math.round(randInt(s, 6, 10) * (0.6 + s.fame / 80) * pressureScale(sim)));
      const minutes = randInt(s, 15, 30);
      s.story.incoming = { at: s.tick + minutes * TICKS_PER_MINUTE, n, what: 'coachParty' };
      sim.log(sim.venue.text.rushWarning(n, minutes), 'bad', null, null, 0);
    },
  },
  {
    id: 'machineBroken', category: 'pressure', weight: (sim) => 0.3 + (worstWear(sim) / 100) * 3,
    canFire: (sim) => !sim.hasCondition('stationBroken'),
    fire: (sim) => {
      addCondition(sim, 'stationBroken', 3);
      sim.log(sim.venue.text.stationBroken, 'bad', null, 'machineBroken', 7);
    },
  },
  {
    id: 'lateDelivery', category: 'pressure', weight: 2,
    canFire: (sim) => !sim.hasCondition('noFood'),
    fire: (sim) => {
      addCondition(sim, 'noFood', 3);
      sim.log(sim.venue.text.noFood, 'bad', null, 'lateDelivery', 4);
    },
  },
  {
    id: 'sickCall', category: 'pressure', weight: 2,
    canFire: (sim) => laterToday(sim).length > 0,
    fire: (sim) => {
      const p = pick(sim.state, laterToday(sim));
      p.staff!.sickDay = sim.day;
      const excuse = pick(sim.state, [
        '"Definitely not hungover."', '"Something I ate."', '"My cat is unwell."',
        '"I\'ve lost my voice," they said, loudly.', '"Car won\'t start." It\'s a bus route.',
      ]);
      sim.log(`${p.name} called in sick. ${excuse}`, 'bad', p.id, 'sickCall', 5);
    },
  },
  {
    id: 'inspector', category: 'pressure', weight: 1.5,
    canFire: (sim) => staffOnSite(sim).length > 0,
    fire: (sim) => {
      const s = sim.state;
      const m = mess(sim);
      const passed = m <= 4;
      const delta = passed ? 4 : m > 10 ? -8 : -3;
      s.reputation = Math.max(0, Math.min(100, s.reputation + delta));
      addFame(sim, passed ? 2 : delta);
      for (const p of staffOnSite(sim)) addMemory(sim, p, passed ? 'passedInspection' : 'failedInspection');
      sim.log(
        passed
          ? 'A health inspector dropped in, ran a finger along the counter and left happy. Five stars on the door.'
          : `A health inspector dropped in and counted ${m} dirty cups. That sticker on the door is not good news.`,
        passed ? 'good' : 'bad', null, 'inspector', passed ? 5 : 8,
      );
    },
  },
  {
    id: 'critic', category: 'pressure', weight: 1.5,
    canFire: (sim) => !sim.state.pawns.some((p) => p.visit?.critic),
    fire: (sim) => {
      const g = spawnGuest(sim);
      g.visit!.critic = true;
      g.look.shirt = '#6c5a8e';
      g.look.hairStyle = 'beanie';
      g.look.hair = '#2a2a2a';
      sim.log(sim.venue.text.critic(g.name), 'neutral', g.id, null, 0);
    },
  },
  {
    id: 'heatwave', category: 'pressure', weight: 1,
    canFire: (sim) => !sim.hasCondition('heatwave'),
    fire: (sim) => {
      addCondition(sim, 'heatwave', 6);
      sim.log(sim.venue.text.heatwave, 'neutral', null, 'heatwave', 3);
    },
  },
  {
    id: 'busker', category: 'social', weight: 2,
    canFire: (sim) => !sim.hasCondition('busker'),
    fire: (sim) => {
      addCondition(sim, 'busker', 2);
      for (const p of staffOnSite(sim)) addMemory(sim, p, 'niceMusic');
      sim.log(sim.venue.text.busker, 'good', null, 'busker', 3);
    },
  },
  {
    id: 'birthday', category: 'social', weight: 2,
    canFire: (sim) => availableRegulars(sim).some((r) => r.visits >= 3),
    fire: (sim) => {
      birthdayVisit(sim, () => spawnGuest(sim));
    },
  },
  {
    id: 'freePastries', category: 'good', weight: 2,
    canFire: (sim) => staffOnSite(sim).length > 0,
    fire: (sim) => {
      for (const p of staffOnSite(sim)) addMemory(sim, p, 'freePastries');
      sim.log(sim.venue.text.freebies, 'good', null, 'freePastries', 3);
    },
  },
  {
    id: 'shoutOut', category: 'good', weight: 1.5,
    canFire: () => true,
    fire: (sim) => {
      addFame(sim, 5);
      sim.log(sim.venue.text.shoutOut, 'good', null, 'shoutOut', 5);
    },
  },
  {
    id: 'quietSpell', category: 'good', weight: 1.5,
    canFire: (sim) => !sim.hasCondition('quietSpell') && sim.minuteOfDay >= 13 * 60,
    fire: (sim) => {
      addCondition(sim, 'quietSpell', 2);
      for (const p of staffOnSite(sim)) addMemory(sim, p, 'quietAfternoon');
      sim.log(sim.venue.text.quietSpell, 'good', null, 'quietSpell', 2);
    },
  },
];

/** Staff due in later today who haven't arrived yet. */
function laterToday(sim: Sim): Pawn[] {
  const m = sim.minuteOfDay;
  return sim.state.pawns.filter((p) => p.staff && !p.staff.quit && !p.onMap && p.arrivedDay !== sim.day && p.shift.start > m + 30 && p.staff.sickDay !== sim.day);
}

function scheduleNext(sim: Sim): void {
  const s = sim.state;
  // Exponential gap: memoryless, so events feel surprising rather than clockwork.
  const mean = MEAN_HOURS_BETWEEN[s.story.phase] * TICKS_PER_HOUR;
  s.story.nextEventAt = s.tick + Math.round(-Math.log(1 - random(s)) * mean);
}

export function storytellerEveryMinute(sim: Sim): void {
  const s = sim.state;
  const story = s.story;
  s.conditions = s.conditions.filter((c) => c.until > s.tick);

  // A rush that was announced lands.
  if (story.incoming && s.tick >= story.incoming.at) {
    story.pendingArrivals = story.incoming.n;
    sim.log(sim.venue.text.rush(story.incoming.n), 'bad', null, 'coachParty', 6);
    story.incoming = null;
  }
  // A machine worn right down gives up on its own.
  if (worstWear(sim) >= 100 && !sim.hasCondition('stationBroken')) {
    addCondition(sim, 'stationBroken', 3);
    sim.log(sim.venue.text.stationBroken, 'bad', null, 'machineBroken', 7);
  }
  // Coach party arrivals trickle in a couple a minute.
  if (story.pendingArrivals > 0) {
    const n = Math.min(story.pendingArrivals, randInt(s, 1, 2));
    story.pendingArrivals -= n;
    for (let i = 0; i < n; i++) sim.arriveGuest();
  }

  if (story.nextEventAt === 0) scheduleNext(sim);
  const m = sim.minuteOfDay;
  if (s.tick < story.nextEventAt) return;
  if (m < sim.venue.hours.open + 30 || m > sim.venue.hours.close - 60) return;
  fireEvent(sim);
  scheduleNext(sim);
}

export function fireEvent(sim: Sim, forceId?: string): void {
  const s = sim.state;
  const story = s.story;
  if (forceId) {
    // Even forced events need their preconditions (no sick call with nobody due in).
    const e = EVENTS.find((x) => x.id === forceId);
    if (e?.canFire(sim)) e.fire(sim);
    return;
  }
  const calmBonus = Math.max(0, story.adaptation) / 30;
  const reliefBonus = Math.max(0, -story.adaptation) / 20;
  const categoryWeights: [Category, number][] = [
    ['pressure', (story.phase === 'busy' ? 0.6 : 0.25) + calmBonus],
    ['social', 0.25],
    ['good', 0.15 + reliefBonus],
  ];
  const total = categoryWeights.reduce((a, [, w]) => a + w, 0);
  let r = random(s) * total;
  let category: Category = 'social';
  for (const [c, w] of categoryWeights) {
    r -= w;
    if (r <= 0) {
      category = c;
      break;
    }
  }
  const options = EVENTS.filter((e) => e.category === category && e.canFire(sim));
  if (options.length === 0) return;
  const weightOf = (e: EventDef) => (typeof e.weight === 'function' ? e.weight(sim) : e.weight);
  const weightSum = options.reduce((a, e) => a + weightOf(e), 0);
  let roll = random(s) * weightSum;
  for (const e of options) {
    roll -= weightOf(e);
    if (roll <= 0) {
      e.fire(sim);
      return;
    }
  }
}

/** Morning bookkeeping: move the rhythm on and adjust adaptation from yesterday. */
export function storytellerNewDay(sim: Sim): void {
  const s = sim.state;
  const story = s.story;
  const y = s.yesterday;
  if (y) {
    const visits = y.served + y.walkouts;
    const walkoutRate = visits > 0 ? y.walkouts / visits : 0;
    let delta = 1;
    if (walkoutRate > 0.25) delta -= 3;
    else if (walkoutRate > 0.15) delta -= 1;
    delta -= story.breaksToday * 0.5;
    delta -= story.quitsToday * 4;
    story.adaptation = Math.max(-10, Math.min(15, story.adaptation + delta));
  }
  story.breaksToday = 0;
  story.quitsToday = 0;
  story.repAtOpen = s.reputation;
  if (sim.day >= story.phaseUntilDay) {
    story.phase = story.phase === 'busy' ? 'quiet' : 'busy';
    story.phaseUntilDay = sim.day + (story.phase === 'busy' ? 2 : 1);
  }
  scheduleNext(sim);
}


/** Arrival rate multiplier from active conditions. */
export function arrivalFactor(sim: Sim): number {
  let f = 1;
  if (sim.hasCondition('heatwave')) f *= 1.25;
  if (sim.hasCondition('busker')) f *= 1.15;
  if (sim.hasCondition('quietSpell')) f *= 0.5;
  return f;
}

