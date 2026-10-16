// Guests follow a visit script (a small state machine, like RimWorld's group "lords"):
// queue → order → wait → collect → sit and eat, or take away → leave.
// Patience drains while they queue and wait; at zero they walk out.

import { reservationKey } from './ai';
import { BUSINESS, GUEST_CLOTHES, HAIR_COLOURS, HAIR_STYLES, NEEDS, SKIN_TONES, objectDef, type NeedValues } from './defs';
import { pick, randInt, random, randRange } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type Pawn, type Visit } from './state';
import { priceRatio } from './manage';
import { arrivalFactor } from './storyteller';
import { ambience, maybeSpill } from './ambience';
import { availableRegulars, makeRegular, maybeBecomeRegular, regularArrivalChance, regularServed, regularWronged } from './regulars';
import { writeReview } from './tales';
import { addMemory, hasTrait } from './thoughts';

/** Patience lost per minute. */
const PATIENCE_DRAIN = { queuing: 1 / 30, waiting: 1 / 20 } as const;
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
      v.patience = Math.max(0, v.patience - PATIENCE_DRAIN[v.state]);
      if (v.patience <= 0) walkOut(sim, p);
    }
  }
  maybeSpawn(sim);
}

function maybeSpawn(sim: Sim): void {
  const s = sim.state;
  // Pricier than usual puts people off; cheaper draws them in, up to a point.
  const priceDraw = Math.max(0.3, Math.min(1.3, 1 - (priceRatio(sim) - 1) * 1.2));
  const perHour = sim.venue.arrivals(sim.minuteOfDay) * (0.4 + s.reputation / 80) * arrivalFactor(sim) * priceDraw;
  if (perHour <= 0 || random(s) >= perHour / 60) return;
  tryArrive(sim);
}

/** A guest arrives if there's room; otherwise they see the queue and keep walking. */
export function tryArrive(sim: Sim): void {
  const s = sim.state;
  const canServe = s.menu.some((m) => m.enabled && (m.kind === 'drink' || !sim.hasCondition('noFood')));
  if (!canServe) return;
  const onSite = s.pawns.filter((p) => p.kind === 'guest').length;
  if (onSite >= BUSINESS.maxGuestsOnSite || s.queue.length >= sim.venue.positions.queue.length) {
    // They look in, see the chaos and keep walking.
    s.today.turnedAway++;
    judge(sim, 0.3);
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
  let foods = sim.hasCondition('noFood') ? [] : on.filter((m) => m.kind === 'food');
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
      const [qx, qy] = sim.venue.positions.queue[Math.min(index, sim.venue.positions.queue.length - 1)];
      if (!at(p, qx, qy)) goTo(sim, p, 'Queuing', qx, qy);
      return;
    }
    case 'ordering':
      return;
    case 'waiting': {
      const order = s.orders.find((o) => o.id === v.orderId);
      if (order && order.items.every((i) => i.status === 'ready')) {
        v.state = 'collecting';
        releaseWaitSpot(sim, p);
        goTo(sim, p, 'Collecting their order', sim.venue.positions.pickupGuest[0], sim.venue.positions.pickupGuest[1]);
        return;
      }
      if (!holdsWaitSpot(sim, p)) {
        const i = sim.venue.positions.wait.findIndex((_, n) => s.reservations[`wait:${n}`] === undefined);
        if (i >= 0) {
          s.reservations[`wait:${i}`] = p.id;
          goTo(sim, p, `Waiting for ${v.items.join(' and ')}`, sim.venue.positions.wait[i][0], sim.venue.positions.wait[i][1]);
        }
      }
      return;
    }
    case 'collecting': {
      if (!at(p, sim.venue.positions.pickupGuest[0], sim.venue.positions.pickupGuest[1])) {
        goTo(sim, p, 'Collecting their order', sim.venue.positions.pickupGuest[0], sim.venue.positions.pickupGuest[1]);
        return;
      }
      collect(sim, p);
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
        if (v.seatObject !== null) s.dirty[v.seatObject] = (s.dirty[v.seatObject] ?? 0) + v.items.length;
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
  const [dx, dy] = objectDef(o.def).spots[spot];
  return [o.x + dx, o.y + dy];
}

function holdsWaitSpot(sim: Sim, p: Pawn): boolean {
  return sim.venue.positions.wait.some((_, n) => sim.state.reservations[`wait:${n}`] === p.id);
}

function releaseWaitSpot(sim: Sim, p: Pawn): void {
  sim.venue.positions.wait.forEach((_, n) => {
    if (sim.state.reservations[`wait:${n}`] === p.id) delete sim.state.reservations[`wait:${n}`];
  });
}

function collect(sim: Sim, p: Pawn): void {
  const s = sim.state;
  const v = p.visit!;
  const order = s.orders.find((o) => o.id === v.orderId);
  if (!order) {
    leave(sim, p);
    return;
  }
  const quality = order.items.reduce((sum, i) => sum + i.quality, 0) / order.items.length;
  // Value for money: paying over the usual price stings more than a discount pleases.
  const paid = order.items.reduce((sum, i) => sum + i.price, 0);
  const usual = order.items.reduce((sum, i) => sum + (s.menu.find((m) => m.name === i.name)?.basePrice ?? i.price), 0);
  const ratio = paid / usual;
  const value = ratio > 1 ? -(ratio - 1) * 0.5 : (1 - ratio) * 0.15;
  // Regulars feel at home; everyone notices a dirty or dreary café.
  const familiar = v.regularId !== null ? 0.05 : 0;
  const feel = (ambience(sim) - 0.6) * 0.15;
  // Wanting to sit down and finding nowhere to sit sours the whole visit.
  const seat = v.eatIn ? findSeat(sim, p) : null;
  const noSeat = v.eatIn && !seat ? 0.12 : 0;
  const satisfaction = 0.45 + v.patience * 0.35 + (quality / 10) * 0.2 + value + familiar + feel - noSeat - (sim.hasCondition('noFood') ? 0.05 : 0);
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
  s.today.served++;
  if (v.critic || random(s) < REVIEW_CHANCE) {
    const review = writeReview(sim, p, satisfaction, server);
    s.today.reviews.push(review);
    if (v.critic) sim.log(`The critic's verdict, ${'★'.repeat(review.stars)}: ${review.text}`, review.stars >= 4 ? 'good' : 'bad', p.id, review.stars === 5 ? 'criticRave' : 'critic', 8);
  }
  regularServed(sim, p, satisfaction, server);
  maybeBecomeRegular(sim, p, satisfaction, server);
  s.orders = s.orders.filter((o) => o.id !== order.id);
  v.orderId = null;
  p.carrying = { kind: 'takeaway', item: order.items[0].kind };

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
    objectDef(o.def).spots.forEach((_, i) => {
      if (s.reservations[reservationKey(o.id, i)] === undefined) n++;
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
    const spots = objectDef(o.def).spots;
    spots.forEach(([dx, dy], i) => {
      const key = reservationKey(o.id, i);
      const x = o.x + dx;
      const y = o.y + dy;
      if (s.reservations[key] !== undefined || !sim.world.passable(x, y)) return;
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
  if (v.critic || random(s) < 0.5) {
    const review = writeReview(sim, p, 0, undefined);
    s.today.reviews.push(review);
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
