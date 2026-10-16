// Staff work. Each work type has a scanner that finds tasks; a staff member takes
// the nearest task at their highest-priority level (RimWorld-style work givers), but
// sticks to their station or current kind of work rather than hopping between them.
// Tasks are jobs made of steps; "act" steps change the world when they finish.

import { reservationKey } from './ai';
import { TASK_MINUTES, WORK_TYPES, withArticle, type WorkType } from './defs';
import { spillAt } from './ambience';
import { walkOut } from './guests';
import { regularWronged } from './regulars';
import { pick } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type Action, type Job, type Pawn, type Step } from './state';
import { addMemory, hasTrait } from './thoughts';

const MAX_WASH_BATCH = 6;

interface Task {
  work: WorkType;
  x: number;
  y: number;
  build: () => Job | null;
}

const CLUMSY_DROP_CHANCE = 0.08;
const RUDE_CUSTOMER_CHANCE = 0.06;

/** 0.6x speed at skill 0, 1x at skill 5, 1.4x at skill 10, then traits and mood breaks. */
export function workSpeed(p: Pawn, work: WorkType): number {
  let speed = 0.6 + (p.staff?.skills[work] ?? 0) * 0.08;
  if (hasTrait(p, 'hardWorker')) speed *= 1.15;
  if (hasTrait(p, 'lazy')) speed *= 0.85;
  if (hasTrait(p, 'perfectionist')) speed *= 0.9;
  if (p.staff?.mentalBreak?.kind === 'slowWalk') speed *= 0.5;
  return speed;
}

/** Quality of what someone makes, 0-10: skill plus traits and inspiration. */
export function workQuality(p: Pawn, work: WorkType): number {
  let q = p.staff?.skills[work] ?? 0;
  if (hasTrait(p, 'perfectionist')) q += 1;
  if (work === 'barista' && hasTrait(p, 'coffeeSnob')) q += 2;
  if (work === 'barista' && p.staff?.inspiration?.kind === 'latteArt') q += 3;
  return Math.min(10, q);
}

function actStep(p: Pawn, work: WorkType, action: Action, minutes: number): Step {
  const total = Math.max(1, Math.round((minutes * TICKS_PER_MINUTE) / workSpeed(p, work)));
  return { kind: 'act', action, work, ticksLeft: total, total };
}

function at(p: Pawn, x: number, y: number): boolean {
  return Math.abs(p.x - x) < 0.05 && Math.abs(p.y - y) < 0.05;
}

// At 1x an in-game minute passes in a real second, so these are roughly real seconds too.
/** Station staff wait this long with nothing to do at their station before helping elsewhere. */
export const STATION_HELP_AFTER = 8 * TICKS_PER_MINUTE;
/** Staff without a station settle into what they're doing, and move on after this long without any. */
export const FOCUS_HELP_AFTER = 4 * TICKS_PER_MINUTE;

/** Without a station, a stint at one kind of work lasts at least this long before a better one wins. */
export const MIN_STINT = 20 * TICKS_PER_MINUTE;

/**
 * Backlog at which each kind of work counts as a rush, and the lower level at which
 * the rush is over (so it doesn't flicker on and off at the threshold).
 */
const RUSH: Record<WorkType, { start: number; end: number; backlog: (sim: Sim) => number }> = {
  counter: { start: 4, end: 2, backlog: (sim) => sim.state.queue.length },
  barista: {
    start: 4, end: 2,
    backlog: (sim) => sim.state.orders.reduce((n, o) => n + o.items.filter((i) => i.status === 'todo' && i.kind !== 'food').length, 0),
  },
  floor: { start: 3, end: 1, backlog: (sim) => Object.values(sim.state.dirty).filter((n) => n > 0).length },
  dishes: { start: 8, end: 4, backlog: (sim) => sim.state.sinkDirty },
  cleaning: { start: 2, end: 1, backlog: (sim) => sim.state.spills.length },
};

/** Updates which kinds of work are in a rush. Called once a tick by the sim. */
export function updateRushes(sim: Sim): void {
  const s = sim.state;
  const now = new Set(s.rushes ?? []);
  for (const w of WORK_TYPES) {
    const r = RUSH[w.id];
    const n = r.backlog(sim);
    if (n >= r.start) now.add(w.id);
    else if (n < r.end) now.delete(w.id);
  }
  s.rushes = WORK_TYPES.map((w) => w.id).filter((id) => now.has(id));
}

function rushes(sim: Sim): Set<WorkType> {
  return new Set(sim.state.rushes ?? []);
}

/** The work someone sticks to: their station, or else what they've settled into. */
export function homeWork(p: Pawn): WorkType | null {
  return p.staff?.station ?? p.staff?.focus?.work ?? null;
}

/**
 * Picks the next task. Staff stick to their home work (their station, or what they've
 * settled into) while there's any; when it's quiet they wait a little before helping
 * elsewhere, unless somewhere else is in a rush. Without a station, a strictly higher
 * priority job still wins straight away. Helping uses the usual priorities, nearest first.
 */
export function findWork(sim: Sim, p: Pawn): Job | null {
  const staff = p.staff;
  if (!staff) return null;
  const tasks = scanTasks(sim, p);
  const home = homeWork(p);
  const station = staff.station ?? null;
  const priorityOf = (w: WorkType) => (w === station ? 1 : staff.priorities[w]);
  const nearest = (list: Task[]) => list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  const take = (list: Task[]): Job | null => {
    for (const t of nearest(list)) {
      const job = t.build();
      if (!job) continue;
      if (t.work !== home && home) job.label += ' (helping out)';
      const now = sim.state.tick;
      const work = station ?? t.work;
      if (t.work === home || !station) {
        staff.focus = { work, lastDone: now, since: staff.focus?.work === work ? staff.focus.since : now };
      }
      return job;
    }
    return null;
  };

  if (home) {
    const homeTasks = tasks.filter((t) => t.work === home && (t.work === station || staff.priorities[t.work] > 0));
    // Without a station, a better-priority job wins once they've given this one a fair go.
    const settled = sim.state.tick - (staff.focus?.since ?? -Infinity) >= MIN_STINT;
    const better = station || !settled ? [] : tasks.filter((t) => staff.priorities[t.work] > 0 && staff.priorities[t.work] < staff.priorities[home]);
    const job = take(better) ?? take(homeTasks);
    if (job) return job;
    // Home is quiet. Help straight away where there's a rush or nobody else covers that
    // work; anywhere else only after a wait, so people don't hop between jobs.
    const rush = rushes(sim);
    const covered = new Set(sim.state.pawns.filter((o) => o !== p && o.onMap && o.staff && !o.staff.mentalBreak).map(homeWork));
    const urgent = tasks.filter((t) => (rush.has(t.work) || !covered.has(t.work)) && priorityOf(t.work) > 0);
    const rushJob = take(urgent);
    if (rushJob) return rushJob;
    const waited = sim.state.tick - (staff.focus?.lastDone ?? -Infinity);
    if (waited < (station ? STATION_HELP_AFTER : FOCUS_HELP_AFTER)) return null;
  }

  for (let priority = 1; priority <= 4; priority++) {
    const job = take(tasks.filter((t) => priorityOf(t.work) === priority));
    if (job) return job;
  }
  return null;
}

/** Somewhere to wait for the next bit of home work: by the till, the machine or the sink. */
function postFor(sim: Sim, work: WorkType): [number, number] | null {
  const s = sim.state;
  if (work === 'counter') return [...sim.venue.positions.tillStaff] as [number, number];
  const def = work === 'barista' ? sim.venue.drinkStation : work === 'dishes' ? 'sink' : null;
  const o = def ? s.objects.find((x) => x.def === def) : undefined;
  const spot = o ? sim.world.spots(o).find(([x, y]) => sim.world.passable(x, y)) : undefined;
  return spot ? [spot[0], spot[1]] : null;
}

const POST_LABELS: Partial<Record<WorkType, string>> = {
  counter: 'Waiting at the till',
  barista: 'Waiting by the machine',
  dishes: 'Waiting by the sink',
};

/** A staff member with nothing to do waits at their post instead of wandering off. */
export function standByJob(sim: Sim, p: Pawn): Job | null {
  const home = homeWork(p);
  if (!home) return null;
  const post = postFor(sim, home);
  if (!post) return null;
  const wait: Step = { kind: 'wait', ticksLeft: TICKS_PER_MINUTE };
  const near = Math.hypot(post[0] - p.x, post[1] - p.y) <= 1.5;
  const steps: Step[] = [];
  if (!near) {
    const go = sim.gotoStep(post[0], post[1]);
    go.path = sim.pathFrom(p, post[0], post[1]);
    if (!go.path) return null;
    steps.push(go);
  }
  steps.push(wait);
  return { ...sim.makeJob(POST_LABELS[home] ?? 'Waiting for work', steps), idle: true };
}

function scanTasks(sim: Sim, p: Pawn): Task[] {
  const s = sim.state;
  const tasks: Task[] = [];
  const enabled = new Set(WORK_TYPES.filter((w) => (p.staff!.priorities[w.id] ?? 0) > 0).map((w) => w.id));

  // Barista (or counter): get a broken espresso machine going again.
  const machineForRepair = s.objects.find((o) => o.def === sim.venue.drinkStation);
  if (sim.hasCondition('stationBroken') && machineForRepair && (enabled.has('barista') || enabled.has('counter')) && !sim.isReservedByOther('repair', p)) {
    const [rx, ry] = sim.world.spots(machineForRepair)[0];
    const work = enabled.has('barista') ? 'barista' : 'counter';
    tasks.push({
      work, x: rx, y: ry,
      build: () => withPath(sim, p, sim.venue.text.repairJob, rx, ry, (job) => {
        sim.reserve(job, p, 'repair');
        return [actStep(p, work, { type: 'repair' }, TASK_MINUTES.repair)];
      }),
    });
  }

  // Cleaning: mop up spills, nearest first.
  if (enabled.has('cleaning')) {
    for (const spill of s.spills) {
      const key = `spill:${spill.x}:${spill.y}`;
      if (sim.isReservedByOther(key, p)) continue;
      tasks.push({
        work: 'cleaning', x: spill.x, y: spill.y,
        build: () => withPath(sim, p, 'Mopping up a spill', spill.x, spill.y, (job) => {
          sim.reserve(job, p, key);
          return [actStep(p, 'cleaning', { type: 'mop', x: spill.x, y: spill.y }, TASK_MINUTES.mop)];
        }),
      });
    }
  }

  // Counter: serve the guest at the front of the queue.
  if (enabled.has('counter') && !sim.isReservedByOther('till', p)) {
    const front = s.queue.length > 0 ? sim.pawnById(s.queue[0]) : undefined;
    const [qx, qy] = sim.venue.positions.queue[0];
    if (front?.visit?.state === 'queuing' && at(front, qx, qy)) {
      const [tx, ty] = sim.venue.positions.tillStaff;
      tasks.push({
        work: 'counter', x: tx, y: ty,
        build: () => withPath(sim, p, 'Taking an order', tx, ty, (job) => {
          sim.reserve(job, p, 'till');
          return [actStep(p, 'counter', { type: 'takeOrder', guestId: front.id }, TASK_MINUTES.takeOrder)];
        }),
      });
    }
  }

  // Counter (cake) and barista (coffee): make each open order item.
  for (const order of s.orders) {
    order.items.forEach((item, index) => {
      if (item.status !== 'todo') return;
      const key = `item:${order.id}:${index}`;
      if (sim.isReservedByOther(key, p)) return;
      if (item.kind === 'food') {
        if (!enabled.has('counter') || sim.isReservedByOther('cake', p)) return;
        const [cx, cy] = sim.venue.positions.foodStaff;
        tasks.push({
          work: 'counter', x: cx, y: cy,
          build: () => withPath(sim, p, `Plating ${withArticle(item.name)}`, cx, cy, (job) => {
            sim.reserve(job, p, key);
            sim.reserve(job, p, 'cake');
            return [
              actStep(p, 'counter', { type: 'makeItem', orderId: order.id, index }, TASK_MINUTES.plateCake),
              sim.gotoStep(sim.venue.positions.pickupStaff[0], sim.venue.positions.pickupStaff[1]),
              actStep(p, 'counter', { type: 'placeItem', orderId: order.id, index }, TASK_MINUTES.placeItem),
            ];
          }),
        });
      } else {
        if (!enabled.has('barista') || sim.hasCondition('stationBroken')) return;
        // Any machine with a free group head will do; nearest wins when tasks are sorted.
        for (const machine of s.objects.filter((o) => o.def === sim.venue.drinkStation)) {
          const spots = sim.world.spots(machine);
          const spotIndex = spots.findIndex(([sx, sy], i) => sim.world.passable(sx, sy) && !sim.isReservedByOther(reservationKey(machine.id, i), p));
          if (spotIndex < 0) continue;
          const [mx, my] = spots[spotIndex];
          tasks.push({
            work: 'barista', x: mx, y: my,
            build: () => withPath(sim, p, `Making ${withArticle(item.name)}`, mx, my, (job) => {
              sim.reserve(job, p, key);
              sim.reserve(job, p, reservationKey(machine.id, spotIndex));
              return [
                actStep(p, 'barista', { type: 'makeItem', orderId: order.id, index }, sim.venue.drinkMinutes),
                sim.gotoStep(sim.venue.positions.pickupStaff[0], sim.venue.positions.pickupStaff[1]),
                actStep(p, 'barista', { type: 'placeItem', orderId: order.id, index }, TASK_MINUTES.placeItem),
              ];
            }),
          });
        }
      }
    });
  }

  const sinks = s.objects.filter((o) => o.def === 'sink').map((o) => ({ o, spot: sim.world.spots(o)[0] }))
    .filter(({ spot }) => sim.world.passable(spot[0], spot[1]));

  // Floor: clear dirty cups from tables, taking them to the nearest sink.
  if (enabled.has('floor') && sinks.length > 0) {
    for (const o of s.objects) {
      if (!(s.dirty[o.id] > 0)) continue;
      const key = `dish:${o.id}`;
      if (sim.isReservedByOther(key, p)) continue;
      const spot = nearestPassableSpot(sim, o.id, p);
      if (!spot) continue;
      const [dx, dy] = spot;
      const sinkSpot = sinks.reduce((best, k) => (Math.hypot(k.spot[0] - dx, k.spot[1] - dy) < Math.hypot(best[0] - dx, best[1] - dy) ? k.spot : best), sinks[0].spot);
      tasks.push({
        work: 'floor', x: dx, y: dy,
        build: () => withPath(sim, p, 'Clearing a table', dx, dy, (job) => {
          sim.reserve(job, p, key);
          return [
            actStep(p, 'floor', { type: 'pickDishes', objectId: o.id }, TASK_MINUTES.pickDishes),
            sim.gotoStep(sinkSpot[0], sinkSpot[1]),
            actStep(p, 'floor', { type: 'dropDishes' }, TASK_MINUTES.dropDishes),
          ];
        }),
      });
    }
  }

  // Dishes: wash what's piled up, at any free sink.
  if (enabled.has('dishes') && s.sinkDirty > 0) {
    const count = Math.min(MAX_WASH_BATCH, s.sinkDirty);
    for (const { o, spot } of sinks) {
      const key = `sink:${o.id}`;
      if (sim.isReservedByOther(key, p)) continue;
      const [sx, sy] = spot;
      tasks.push({
        work: 'dishes', x: sx, y: sy,
        build: () => withPath(sim, p, 'Washing up', sx, sy, (job) => {
          sim.reserve(job, p, key);
          return [actStep(p, 'dishes', { type: 'wash', count }, TASK_MINUTES.washPerDish * count)];
        }),
      });
    }
  }

  return tasks;
}

/** Builds a job that walks to (x, y) and then runs the given steps; null if unreachable. */
function withPath(sim: Sim, p: Pawn, label: string, x: number, y: number, rest: (job: Job) => Step[]): Job | null {
  const go = sim.gotoStep(x, y);
  go.path = sim.pathFrom(p, x, y);
  if (!go.path) return null;
  const job = sim.makeJob(label, [go]);
  job.steps.push(...rest(job));
  return job;
}

function nearestPassableSpot(sim: Sim, objectId: number, p: Pawn): [number, number] | null {
  const o = sim.world.objectById(objectId);
  if (!o) return null;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const [x, y] of sim.world.spots(o)) {
    if (!sim.world.passable(x, y)) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return best;
}

/**
 * Checked every tick of an act step. `starting` is true on its first tick,
 * which is when a guest notices they're being served.
 */
export function validateAction(sim: Sim, p: Pawn, a: Action, starting: boolean): boolean {
  const s = sim.state;
  switch (a.type) {
    case 'takeOrder': {
      const g = sim.pawnById(a.guestId);
      if (!g?.visit || s.queue[0] !== g.id) return false;
      if (g.visit.state !== 'queuing' && g.visit.state !== 'ordering') return false;
      if (starting) {
        g.visit.state = 'ordering';
        g.job = null;
      }
      return true;
    }
    case 'makeItem': {
      const item = s.orders.find((o) => o.id === a.orderId)?.items[a.index];
      return item?.status === 'todo';
    }
    case 'placeItem': {
      const c = p.carrying;
      const order = s.orders.find((o) => o.id === a.orderId);
      return !!order && !!c && 'orderId' in c && c.orderId === a.orderId && c.index === a.index;
    }
    case 'pickDishes':
      return (s.dirty[a.objectId] ?? 0) > 0;
    case 'dropDishes':
      return p.carrying?.kind === 'dishes';
    case 'wash':
      return s.sinkDirty > 0;
    case 'argue': {
      const g = sim.pawnById(a.guestId);
      return !!g?.visit && g.visit.state !== 'leaving';
    }
    case 'repair':
      return sim.hasCondition('stationBroken');
    case 'mop':
      return s.spills.some((sp) => sp.x === a.x && sp.y === a.y);
  }
}

export function performAction(sim: Sim, p: Pawn, a: Action): void {
  const s = sim.state;
  switch (a.type) {
    case 'takeOrder': {
      const g = sim.pawnById(a.guestId)!;
      const v = g.visit!;
      const items = v.items.map((name) => {
        const item = sim.menuItem(name);
        return { name, kind: item.kind, price: item.price, status: 'todo' as const, quality: 0 };
      });
      const id = s.nextId++;
      s.orders.push({ id, guestId: g.id, takenBy: p.id, items, placedAt: s.tick });
      const total = items.reduce((sum, i) => sum + i.price, 0);
      s.money += total;
      s.today.takings += total;
      s.queue.shift();
      v.state = 'waiting';
      v.orderId = id;
      if (p.staff) p.staff.servedToday++;
      if (sim.chance(RUDE_CUSTOMER_CHANCE) && !hasTrait(p, 'calm')) {
        addMemory(sim, p, 'rudeCustomer');
        if (sim.chance(0.25)) sim.log(`${g.name} ${pick(s, sim.venue.text.rudeLines)} ${p.name} is not impressed.`, 'neutral', p.id, 'rude', 2);
      }
      return;
    }
    case 'makeItem': {
      const item = s.orders.find((o) => o.id === a.orderId)!.items[a.index];
      item.status = 'carried';
      item.quality = workQuality(p, item.kind === 'drink' ? 'barista' : 'counter');
      p.carrying = { kind: item.kind, orderId: a.orderId, index: a.index };
      return;
    }
    case 'placeItem': {
      const item = s.orders.find((o) => o.id === a.orderId)!.items[a.index];
      p.carrying = null;
      if (hasTrait(p, 'clumsy') && sim.chance(CLUMSY_DROP_CHANCE)) {
        item.status = 'todo';
        spillAt(sim, Math.round(p.x), Math.round(p.y));
        addMemory(sim, p, 'droppedSomething');
        if (sim.chance(0.4)) sim.log(`${p.name} dropped ${withArticle(item.name)}. Again.`, 'neutral', p.id, 'clumsy', 2);
        return;
      }
      item.status = 'ready';
      return;
    }
    case 'pickDishes': {
      const count = s.dirty[a.objectId];
      delete s.dirty[a.objectId];
      p.carrying = { kind: 'dishes', count, fromObject: a.objectId };
      return;
    }
    case 'dropDishes': {
      if (p.carrying?.kind === 'dishes') s.sinkDirty += p.carrying.count;
      p.carrying = null;
      return;
    }
    case 'wash':
      s.sinkDirty = Math.max(0, s.sinkDirty - a.count);
      return;
    case 'argue': {
      const g = sim.pawnById(a.guestId)!;
      regularWronged(sim, g, p, 'what was said about their order');
      sim.log(`${p.name} told ${g.name} exactly where they could put their ${g.visit!.items[0]}.`, 'bad', p.id, 'argueCustomer', 7);
      walkOut(sim, g);
      // Said their piece; that's the break done.
      if (p.staff?.mentalBreak) p.staff.mentalBreak.until = s.tick;
      return;
    }
    case 'repair':
      s.conditions = s.conditions.filter((c) => c.id !== 'stationBroken');
      sim.log(sim.venue.text.stationFixed(p.name), 'good', p.id, 'repair', 2);
      return;
    case 'mop':
      s.spills = s.spills.filter((sp) => !(sp.x === a.x && sp.y === a.y));
      return;
  }
}

/**
 * Called when a job ends early. With an action: undoes its half-done effect.
 * With null: deals with whatever the pawn is holding.
 */
export function abandonAction(sim: Sim, p: Pawn, a: Action | null): void {
  const s = sim.state;
  if (a) {
    if (a.type === 'takeOrder') {
      const g = sim.pawnById(a.guestId);
      if (g?.visit?.state === 'ordering') g.visit.state = 'queuing';
    }
    return;
  }
  const c = p.carrying;
  if (!c) return;
  if (c.kind === 'dishes') {
    // Put them back where they came from, so someone else clears them.
    if (c.fromObject !== null && sim.world.objectById(c.fromObject)) s.dirty[c.fromObject] = (s.dirty[c.fromObject] ?? 0) + c.count;
    else s.sinkDirty += c.count;
  } else if ('orderId' in c) {
    // A made item that never reached the pass: it gets remade.
    const item = s.orders.find((o) => o.id === c.orderId)?.items[c.index];
    if (item?.status === 'carried') item.status = 'todo';
  }
  p.carrying = null;
}
