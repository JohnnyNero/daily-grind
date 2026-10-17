// Guests follow a visit script (a small state machine, like RimWorld's group "lords"):
// queue → order → wait → collect → sit and eat, or take away → leave.
// Patience drains while they queue and wait; at zero they walk out.

import { MISSED_AFTER, doorsOpen, filmArrivals, findScreenSeat } from './cinema';
import { canCook } from './kitchen';
import { guestBarred } from './service';
import { reservationKey } from './ai';
import { GUEST_CLOTHES, HAIR_COLOURS, HAIR_STYLES, NEEDS, SKIN_TONES, type NeedValues } from './defs';
import { pick, randInt, random, randRange } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type FilmTicket, type Pawn, type Visit } from './state';
import { addFame, demandFactor, guestCapacity, noteVisit, priceTolerance } from './business';
import { arrivalFactor } from './storyteller';
import { ambience, maybeSpill } from './ambience';
import { availableRegulars, makeRegular, maybeBecomeRegular, regularArrivalChance, regularServed, regularWronged } from './regulars';
import { writeReview } from './tales';
import { addMemory, hasTrait } from './thoughts';

/** Patience lost per minute. */
const PATIENCE_DRAIN = { queuing: 1 / 30, waiting: 1 / 26 } as const;
/** How much one guest's verdict moves reputation (a rolling average of satisfaction). */
const REP_WEIGHT = 0.04;
const EAT_IN_CHANCE = 0.55;

/** Folds one guest's satisfaction (0-1) into reputation. A critic counts many times over. */
function judge(sim: Sim, satisfaction: number, weight = 1): void {
  const s = sim.state;
  const w = Math.min(0.5, REP_WEIGHT * weight);
  s.reputation = Math.max(0, Math.min(100, s.reputation * (1 - w) + satisfaction * 100 * w));
}

const REVIEW_CHANCE = 0.2;

function at(p: Pawn, x: number, y: number): boolean {
  return Math.abs(p.x - x) < 0.05 && Math.abs(p.y - y) < 0.05;
}

export function guestsEveryMinute(sim: Sim): void {
  const s = sim.state;
  for (const p of [...s.pawns]) {
    const v = p.visit;
    if (!v || !p.onMap) continue;
    // The clock starts once they're actually standing in line, not while they walk in.
    if ((v.state === 'queuing' && !p.moving) || v.state === 'waiting') {
      // Anyone who ordered something cooked expects to wait a bit longer for it.
      const hot = v.state === 'waiting' && v.items.some((name) => s.menu.find((m) => m.name === name)?.kind === 'hot');
      v.patience = Math.max(0, v.patience - PATIENCE_DRAIN[v.state] * (hot ? 0.55 : 1));
      if (v.patience <= 0) walkOut(sim, p);
    }
    // Still not served well after the film started: they've missed it, and want their money back.
    if (v.film && (v.state === 'queuing' || v.state === 'ordering' || v.state === 'waiting' || v.state === 'collecting') && s.tick > v.film.start + MISSED_AFTER * TICKS_PER_MINUTE) {
      if (random(s) < 0.3) sim.log(`${p.name} missed the start of ${v.film.title} stuck at the counter, and left.`, 'bad', null, 'missedFilm', 2);
      walkOut(sim, p);
    }
  }
  maybeSpawn(sim);
  if (s.calls.closedUntil <= s.tick && sim.canTrade) filmArrivals(sim, (t) => arriveForFilm(sim, t));
}

/** Someone here for a film: a ticket, and often a drink or something to eat to take in. */
function arriveForFilm(sim: Sim, t: FilmTicket): void {
  const s = sim.state;
  const c = sim.venue.cinema!;
  if (s.queue.length >= sim.positions.queue.length) {
    // The queue's out the door: they'll stream it at home instead.
    s.today.turnedAway++;
    judge(sim, 0.3);
    noteVisit(sim, 'turnedAway');
    return;
  }
  const g = spawnGuest(sim, false);
  const v = g.visit!;
  const on = s.menu.filter((m) => m.enabled);
  const snacks = sim.hasCondition('noFood') ? [] : on.filter((m) => m.kind === 'food' || (m.kind === 'hot' && canCook(sim)));
  const drinks = on.filter((m) => m.kind === 'drink');
  v.items = [c.ticket];
  if (snacks.length > 0 && random(s) < 0.5) v.items.push(pick(s, snacks).name);
  if (drinks.length > 0 && random(s) < 0.6) v.items.push(pick(s, drinks).name);
  v.film = t;
  // With a film to catch, people are a little more patient in the queue.
  v.patience = Math.min(1, v.patience + 0.1);
}

function maybeSpawn(sim: Sim): void {
  const s = sim.state;
  // Fame brings people, quality and fair prices keep them coming (see business.ts).
  if (s.calls.closedUntil > s.tick) return;
  const perHour = sim.venue.arrivals(sim.minuteOfDay) * demandFactor(sim) * arrivalFactor(sim);
  if (perHour <= 0 || random(s) >= perHour / 60) return;
  tryArrive(sim);
}

/** A guest arrives if there's room; otherwise they see the queue and keep walking. */
export function tryArrive(sim: Sim): void {
  const s = sim.state;
  const canServe = s.menu.some((m) => m.enabled && (m.kind === 'drink' || !sim.hasCondition('noFood')));
  if (!canServe || !sim.canTrade) return;
  // Film-goers have their own seats; it's the lounge and the queue that fill up.
  const onSite = s.pawns.filter((p) => p.kind === 'guest' && !p.visit?.film).length;
  if (onSite >= guestCapacity(sim) || s.queue.length >= sim.positions.queue.length) {
    // They look in, see the chaos and keep walking, and tell their friends it's always rammed.
    s.today.turnedAway++;
    judge(sim, 0.3);
    noteVisit(sim, 'turnedAway');
    return;
  }
  // People wanting to sit in glance through the window first; a full room sends most of them on.
  const wantsSeat = random(s) < EAT_IN_CHANCE;
  if (wantsSeat && freeSeats(sim) === 0 && random(s) < 0.7) {
    // They never came in, so it's lost trade rather than a bad review.
    s.today.turnedAway++;
    return;
  }
  const g = spawnGuest(sim, wantsSeat);
  const regulars = availableRegulars(sim);
  if (regulars.length > 0 && random(s) < regularArrivalChance(sim)) makeRegular(sim, g, pick(s, regulars));
}

export function spawnGuest(sim: Sim, eatIn?: boolean): Pawn {
  const s = sim.state;
  const on = s.menu.filter((m) => m.enabled);
  const drinks = on.filter((m) => m.kind === 'drink');
  // Hot food only while the kitchen can cook it.
  const cooking = canCook(sim);
  let foods = sim.hasCondition('noFood') ? [] : on.filter((m) => m.kind === 'food' || (m.kind === 'hot' && cooking));
  // Storyteller visitors (the critic, a birthday) can turn up when the only thing on the menu
  // is food that hasn't been delivered; they order it anyway rather than order nothing.
  if (drinks.length === 0 && foods.length === 0) foods = on.length > 0 ? on : s.menu;
  const roll = random(s);
  let items: string[];
  if (drinks.length === 0) items = [pick(s, foods).name];
  else if (roll < 0.7 || foods.length === 0) items = [pick(s, drinks).name];
  else if (roll < 0.9) items = [pick(s, drinks).name, pick(s, foods).name];
  else items = [pick(s, foods).name];
  const sittingIn = eatIn ?? false;
  // Sitting in, people treat themselves: often a second thing to go with the first.
  if (sittingIn && items.length === 1 && random(s) < 0.3) {
    const other = (items[0] && drinks.some((d) => d.name === items[0])) ? foods : drinks;
    if (other.length > 0) items.push(pick(s, other).name);
  }
  const visit: Visit = {
    state: 'queuing',
    patience: randRange(s, 0.75, 1),
    orderId: null,
    eatIn: eatIn ?? false,
    seatKey: null,
    seatObject: null,
    eatTicks: 0,
    items,
    mood: 'fine',
    critic: false,
    regularId: null,
    spilt: false,
  };
  const p: Pawn = {
    id: s.nextId++,
    name: sim.uniqueName(),
    kind: 'guest',
    look: {
      skin: pick(s, SKIN_TONES),
      hair: pick(s, HAIR_COLOURS),
      hairStyle: pick(s, HAIR_STYLES),
      shirt: pick(s, GUEST_CLOTHES),
      apron: null,
    },
    x: 0,
    y: 0,
    onMap: true,
    moving: false,
    needs: Object.fromEntries(NEEDS.map((n) => [n.id, 1])) as NeedValues,
    job: null,
    shift: { start: 0, end: 0 },
    leftAt: 0,
    arrivedDay: sim.day,
    carrying: null,
    staff: null,
    visit,
  };
  sim.placeAtEntry(p);
  s.pawns.push(p);
  s.queue.push(p.id);
  return p;
}

/** Runs when a guest has nothing to do this tick: moves the visit script on. */
export function guestTick(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const v = p.visit!;
  switch (v.state) {
    case 'queuing': {
      const index = s.queue.indexOf(p.id);
      const [qx, qy] = sim.positions.queue[Math.min(index, sim.positions.queue.length - 1)];
      if (!at(p, qx, qy)) goTo(sim, p, 'Queuing', qx, qy);
      return;
    }
    case 'ordering':
      return;
    case 'waiting': {
      const order = s.orders.find((o) => o.id === v.orderId);
      // Just a ticket: nothing to collect, straight on.
      if (order && order.items.every((i) => i.kind === 'ticket')) {
        releaseWaitSpot(sim, p);
        collect(sim, p);
        return;
      }
      if (order && order.items.every((i) => i.status === 'ready')) {
        v.state = 'collecting';
        releaseWaitSpot(sim, p);
        goTo(sim, p, 'Collecting their order', sim.positions.pickupGuest[0], sim.positions.pickupGuest[1]);
        return;
      }
      if (!holdsWaitSpot(sim, p)) {
        const i = sim.positions.wait.findIndex((_, n) => s.reservations[`wait:${n}`] === undefined);
        if (i >= 0) {
          s.reservations[`wait:${i}`] = p.id;
          goTo(sim, p, `Waiting for ${v.items.join(' and ')}`, sim.positions.wait[i][0], sim.positions.wait[i][1]);
        } else {
          const aside = standAside(sim, p);
          if (aside) goTo(sim, p, `Waiting for ${v.items.join(' and ')}`, aside[0], aside[1]);
          else p.job = sim.makeJob(`Waiting for ${v.items.join(' and ')}`, [{ kind: 'wait', ticksLeft: TICKS_PER_MINUTE }]);
        }
      }
      return;
    }
    case 'collecting': {
      if (!at(p, sim.positions.pickupGuest[0], sim.positions.pickupGuest[1])) {
        goTo(sim, p, 'Collecting their order', sim.positions.pickupGuest[0], sim.positions.pickupGuest[1]);
        return;
      }
      collect(sim, p);
      return;
    }
    case 'lobby': {
      const film = v.film!;
      if (s.tick >= film.end) {
        leave(sim, p);
        return;
      }
      if (doorsOpen(sim, film)) {
        const seat = findScreenSeat(sim, p, film);
        if (!seat) {
          if (random(s) < 0.3) sim.log(`${p.name} couldn't find a seat for ${film.title}. Not a happy customer.`, 'bad', p.id, 'noSeat', 2);
          noteVisit(sim, 'annoyed');
          leave(sim, p);
          return;
        }
        // Nobody likes sitting in the last lot's popcorn.
        if (seat.dirty) {
          judge(sim, 0.35);
          if (random(s) < 0.1) sim.log(`${p.name} sat down in someone else's popcorn. The seats in ${film.title} need clearing between films.`, 'neutral', p.id, 'stickySeats', 2);
        }
        s.reservations[seat.key] = p.id;
        v.seatKey = seat.key;
        v.seatObject = seat.objectId;
        v.state = 'toSeat';
        goTo(sim, p, `Going in to ${film.title}`, seat.x, seat.y);
        return;
      }
      // Doors not open yet: hang about in the lobby, out of the queue.
      const aside = standAside(sim, p);
      if (aside) goTo(sim, p, `Waiting for ${film.title}`, aside[0], aside[1]);
      else p.job = sim.makeJob(`Waiting for ${film.title}`, [{ kind: 'wait', ticksLeft: TICKS_PER_MINUTE }]);
      return;
    }
    case 'toSeat': {
      const seat = seatTile(sim, v.seatKey);
      if (!seat) {
        leave(sim, p);
        return;
      }
      if (at(p, seat[0], seat[1])) {
        v.state = 'eating';
        // In for the film: they stay until the credits.
        if (v.film) v.eatTicks = Math.max(1, v.film.end - s.tick);
        return;
      }
      const go = sim.gotoStep(seat[0], seat[1]);
      go.path = sim.pathFrom(p, seat[0], seat[1]);
      // The way to the seat got blocked (furniture moved, a wall went up): take it away instead.
      if (!go.path) {
        leave(sim, p);
        return;
      }
      p.job = sim.makeJob('Finding a seat', [go]);
      return;
    }
    case 'eating': {
      maybeSpill(sim, p);
      v.eatTicks--;
      if (v.eatTicks <= 0) {
        // Cups and tubs left behind (a ticket stub doesn't count).
        const litter = v.items.filter((name) => s.menu.find((m) => m.name === name)?.kind !== 'ticket').length;
        if (v.seatObject !== null && litter > 0) s.dirty[v.seatObject] = (s.dirty[v.seatObject] ?? 0) + litter;
        p.carrying = null;
        leave(sim, p);
      }
      return;
    }
    case 'leaving':
      p.job = sim.leaveJob(v.mood === 'furious' ? 'Storming out' : 'Leaving');
      return;
  }
}

function goTo(sim: Sim, p: Pawn, label: string, x: number, y: number): void {
  const go = sim.gotoStep(x, y);
  go.path = sim.pathFrom(p, x, y);
  // Can't get there right now (someone's building, say): wait a moment and retry.
  p.job = go.path ? sim.makeJob(label, [go]) : sim.makeJob(label, [{ kind: 'wait', ticksLeft: TICKS_PER_MINUTE }]);
}

/** Seat keys look like "obj:12:0"; returns that spot's tile. */
function seatTile(sim: Sim, key: string | null): [number, number] | null {
  if (!key) return null;
  const [, objectId, spot] = key.split(':').map(Number);
  const o = sim.world.objectById(objectId);
  if (!o) return null;
  return sim.world.spots(o)[spot] ?? null;
}

function holdsWaitSpot(sim: Sim, p: Pawn): boolean {
  return sim.positions.wait.some((_, n) => sim.state.reservations[`wait:${n}`] === p.id);
}

/** Lets go of any waiting spot, including one the pickup area no longer has (it was repainted). */
function releaseWaitSpot(sim: Sim, p: Pawn): void {
  const r = sim.state.reservations;
  for (const key of Object.keys(r)) if (key.startsWith('wait:') && r[key] === p.id) delete r[key];
}

/**
 * No waiting spot free (or no pickup area at all): step out of the queue to the nearest
 * open tile that isn't a queue or service spot and nobody else is standing on.
 */
function standAside(sim: Sim, p: Pawn): [number, number] | null {
  const s = sim.state;
  const pos = sim.positions;
  const busy = new Set([...pos.queue, pos.tillStaff, pos.pickupStaff, pos.foodStaff, pos.pickupGuest].map(([x, y]) => y * s.w + x));
  for (const o of s.pawns) if (o !== p && o.onMap && (o.visit?.state === 'waiting' || o.visit?.state === 'lobby')) busy.add(Math.round(o.y) * s.w + Math.round(o.x));
  const [sx, sy] = pos.pickupGuest;
  const here = Math.round(p.y) * s.w + Math.round(p.x);
  if (!busy.has(here) && Math.abs(p.x - sx) + Math.abs(p.y - sy) <= 6) return null;
  const seen = new Set([sy * s.w + sx]);
  let frontier: [number, number][] = [[sx, sy]];
  for (let d = 0; d < 12 && frontier.length > 0; d++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const i = ny * s.w + nx;
        if (seen.has(i) || !sim.world.passable(nx, ny)) continue;
        seen.add(i);
        if (!busy.has(i) && s.tiles[i].floor !== 'P') return [nx, ny];
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}

function collect(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const v = p.visit!;
  const order = s.orders.find((o) => o.id === v.orderId);
  if (!order) {
    leave(sim, p);
    return;
  }
  // Tickets aren't made, so they don't count towards how good it all was.
  const made = order.items.filter((i) => i.kind !== 'ticket');
  const quality = made.length > 0 ? made.reduce((sum, i) => sum + i.quality, 0) / made.length : 6;
  // Value for money: paying over the usual price stings more than a discount pleases.
  const paid = order.items.reduce((sum, i) => sum + i.price, 0);
  const usual = order.items.reduce((sum, i) => sum + (s.menu.find((m) => m.name === i.name)?.basePrice ?? i.price), 0);
  // A well-rated place can charge more before anyone minds.
  const ratio = paid / usual / priceTolerance(sim);
  const value = ratio > 1 ? -(ratio - 1) * 0.5 : (1 - ratio) * 0.15;
  // Regulars feel at home; everyone notices a dirty or dreary café.
  const familiar = v.regularId !== null ? 0.05 : 0;
  const feel = (ambience(sim) - 0.6) * 0.15;
  // Wanting to sit down and finding nowhere to sit sours the whole visit.
  const seat = v.eatIn ? findSeat(sim, p) : null;
  const noSeat = v.eatIn && !seat ? 0.12 : 0;
  const satisfaction = 0.4 + v.patience * 0.35 + (quality / 10) * 0.3 + value + familiar + feel - noSeat - (sim.hasCondition('noFood') ? 0.05 : 0);
  v.mood = satisfaction > 0.8 ? 'happy' : satisfaction > 0.55 ? 'fine' : 'annoyed';
  const server = sim.pawnById(order.takenBy);
  if (satisfaction > 0.72) {
    let tip = Math.round((satisfaction - 0.72) * 1000) + 50;
    if (server && hasTrait(server, 'peoplePerson')) tip = Math.round(tip * 1.3);
    if (server?.staff?.inspiration?.kind === 'charm') tip *= 2;
    if (server?.staff) {
      server.staff.tipsToday += tip;
      server.staff.tipsTotal += tip;
      if (tip >= 250) addMemory(sim, server, 'massiveTip');
      else if (tip >= 100) addMemory(sim, server, 'decentTip');
    }
    s.today.tips += tip;
  }
  if (server && v.mood === 'happy' && hasTrait(server, 'peoplePerson')) addMemory(sim, server, 'madeTheirDay');
  judge(sim, satisfaction, v.critic ? 10 : 1);
  noteVisit(sim, v.mood, v.critic ? 150 : v.influencer ? 250 : v.regularId !== null ? 1.5 : 1);
  s.today.served++;
  if (v.critic || random(s) < REVIEW_CHANCE) {
    const review = writeReview(sim, p, satisfaction, server);
    s.today.reviews.push(review);
    // Reviews outlive the visit: a stinker online costs custom for weeks.
    if (!v.critic) addFame(sim, review.stars <= 2 ? -0.08 : review.stars === 5 ? 0.06 : 0);
    if (v.critic) sim.log(`The critic's verdict, ${'★'.repeat(review.stars)}: ${review.text}`, review.stars >= 4 ? 'good' : 'bad', p.id, review.stars === 5 ? 'criticRave' : 'critic', 8);
  }
  regularServed(sim, p, satisfaction, server);
  maybeBecomeRegular(sim, p, satisfaction, server);
  s.orders = s.orders.filter((o) => o.id !== order.id);
  v.orderId = null;
  p.carrying = made.length > 0 ? { kind: 'takeaway', item: made[0].kind } : null;
  if (v.film) {
    // Ticket in hand: into the lobby until the doors open.
    v.state = 'lobby';
    p.job = null;
    return;
  }

  if (!seat) {
    if (noSeat && random(s) < 0.15) sim.log(`${p.name} wanted to sit down but every seat was taken. They took it to go, grumbling.`, 'neutral', p.id, 'noSeat', 2);
    leave(sim, p);
    return;
  }
  s.reservations[seat.key] = p.id;
  v.seatKey = seat.key;
  v.seatObject = seat.objectId;
  v.eatTicks = randInt(s, 10, 25) * TICKS_PER_MINUTE;
  v.state = 'toSeat';
  goTo(sim, p, 'Finding a seat', seat.x, seat.y);
}

/** How many guest seats are free (no one sitting there, no dirty cups). */
export function freeSeats(sim: Sim): number {
  const s = sim.state;
  let n = 0;
  for (const o of s.objects) {
    if (!sim.venue.guestSeating.includes(o.def) || (s.dirty[o.id] ?? 0) > 0) continue;
    sim.world.spots(o).forEach(([x, y], i) => {
      if (s.reservations[reservationKey(o.id, i)] === undefined && !guestBarred(sim, x, y)) n++;
    });
  }
  return n;
}

function findSeat(sim: Sim, p: Pawn): { key: string; objectId: number; x: number; y: number } | null {
  const s = sim.state;
  let best: { key: string; objectId: number; x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const o of s.objects) {
    if (!sim.venue.guestSeating.includes(o.def)) continue;
    // Nobody sits down at a table full of someone else's dirty cups.
    if ((s.dirty[o.id] ?? 0) > 0) continue;
    sim.world.spots(o).forEach(([x, y], i) => {
      const key = reservationKey(o.id, i);
      // Seats out the back (staff only, the flat) aren't for customers.
      if (s.reservations[key] !== undefined || !sim.world.passable(x, y) || guestBarred(sim, x, y)) return;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { key, objectId: o.id, x, y };
      }
    });
  }
  return best;
}

function leave(sim: Sim, p: Pawn): void {
  const v = p.visit!;
  if (v.seatKey && sim.state.reservations[v.seatKey] === p.id) delete sim.state.reservations[v.seatKey];
  v.seatKey = null;
  v.state = 'leaving';
  p.job = null;
}

/** Ran out of patience (or got told off): they leave, and if they'd paid they want their money back. */
export function walkOut(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const v = p.visit!;
  sim.endJob(p);
  s.queue = s.queue.filter((id) => id !== p.id);
  releaseWaitSpot(sim, p);
  const order = s.orders.find((o) => o.id === v.orderId);
  regularWronged(sim, p, order ? sim.pawnById(order.takenBy) : undefined, 'being kept waiting');
  if (order) {
    const server = sim.pawnById(order.takenBy);
    if (server && !hasTrait(server, 'calm')) addMemory(sim, server, 'stormedOut');
    const refund = order.items.reduce((sum, i) => sum + i.price, 0);
    s.money -= refund;
    s.today.takings -= refund;
    s.orders = s.orders.filter((o) => o.id !== order.id);
  }
  v.orderId = null;
  v.mood = 'furious';
  judge(sim, 0, v.critic ? 10 : 1);
  noteVisit(sim, 'walkout', v.critic ? 150 : v.influencer ? 250 : 1);
  if (v.items.length >= 5) addFame(sim, -3);
  if (v.critic || random(s) < 0.5) {
    const review = writeReview(sim, p, 0, undefined);
    s.today.reviews.push(review);
    if (!v.critic) addFame(sim, -0.08);
    if (v.critic) sim.log(`The critic walked out. Tomorrow's paper: ${review.text}`, 'bad', null, 'criticWalkout', 9);
  }
  s.today.walkouts++;
  leave(sim, p);
}

/** At closing time anyone still queuing is turned away politely. */
export function closeUp(sim: Sim): void {
  const s = sim.state;
  for (const id of [...s.queue]) {
    const p = sim.pawnById(id);
    if (!p?.visit || p.visit.state !== 'queuing') continue;
    sim.endJob(p);
    s.queue = s.queue.filter((q) => q !== id);
    leave(sim, p);
  }
}

export function removeGuest(sim: Sim, p: Pawn): void {
  const s = sim.state;
  s.queue = s.queue.filter((id) => id !== p.id);
  sim.releaseAll(p);
  s.pawns = s.pawns.filter((x) => x.id !== p.id);
}
