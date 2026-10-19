// Money. Rent comes in every morning; the mortgage and the building's bills go out every
// Monday. Miss four mortgage payments in a row and the bank takes the building; pay it off
// and it's yours. All amounts are in pence. All the numbers to tune are at the top.

import { furnitureDef } from './defs';
import { flatScore, TIERS } from './impressiveness';
import type { Sim } from './sim';
import { CLEANER_WEEKLY, gasBill } from './environment';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type FlatInfo, type Letter, type CellKind } from './state';

export const POUND = 100;

export const START_MONEY = 1500 * POUND;
export const MORTGAGE = { balance: 30000 * POUND, payment: 250 * POUND, rate: 0.04 };
/** Payments missed in a row before the bank takes the building. */
export const MISSES_ALLOWED = 4;

/** Weekly going rate for a flat in each tier. */
export const TIER_RENT: Record<string, number> = {
  Grim: 60 * POUND,
  Shabby: 85 * POUND,
  Plain: 110 * POUND,
  Decent: 140 * POUND,
  Nice: 175 * POUND,
  Smart: 215 * POUND,
  Impressive: 260 * POUND,
};

/** Days below a tier before a flat's going rate drops to the one below. */
export const TIER_GRACE_DAYS = 3;

/** The building's own weekly bills. */
export const BILLS = { insurance: 25 * POUND, lighting: 8 * POUND, bins: 8 * POUND, emptyFlatTax: 20 * POUND };

/** Weeks of rent taken as a deposit, and how long a fixed lease runs. */
export const DEPOSIT_WEEKS = 4;
export const LEASE_WEEKS = 6;
/** Days' notice for a rent change, and before someone moves out. */
export const RENT_NOTICE_DAYS = 7;
export const MOVE_OUT_NOTICE_DAYS = 7;

/** What each cell costs to put in. */
export const CELL_PRICE: Record<CellKind, number> = {
  wall: 25 * POUND,
  window: 120 * POUND,
  door: 120 * POUND,
  flatDoor: 250 * POUND,
  entrance: 400 * POUND,
  stair: 200 * POUND,
};
export const DEMOLISH_PRICE = 10 * POUND;
export const INSULATE_PRICE = 40 * POUND;
/** What you get back for furniture you take out. */
export const RESALE = 0.3;

/** Security: new locks on the street door and ground-floor windows, and an alarm (fitted, then monitored weekly). */
export const LOCKS_PRICE = 180 * POUND;
export const ALARM_PRICE = 350 * POUND;
export const ALARM_WEEKLY = 4 * POUND;
/** Fine for an improvement notice not done in time, per problem, and the most for one visit. */
export const COUNCIL_FINE = 150 * POUND;
export const COUNCIL_FINE_CAP = 450 * POUND;
export const PLANNING_FEE = 250 * POUND;
/** What Denise will advance against a deposit if you're short in the first week. */
export const HANDOVER_ADVANCE = 300 * POUND;

export function furniturePrice(def: string): number {
  return Math.max(30, furnitureDef(def).value * 8) * POUND;
}

// ------------------------------------------------------------------ money in and out

export function pounds(pence: number, signed = false): string {
  const neg = pence < 0;
  const v = Math.abs(pence) / POUND;
  const text = `£${v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return neg ? `−${text}` : signed && pence > 0 ? `+${text}` : text;
}

export function book(sim: Sim, label: string, amount: number): void {
  const st = sim.state;
  st.money += amount;
  st.ledger.push({ tick: st.tick, label, amount });
  if (st.ledger.length > 300) st.ledger.splice(0, st.ledger.length - 300);
}

/** Spends money if there's enough. False (and nothing spent) if not. */
export function spend(sim: Sim, label: string, amount: number): boolean {
  if (amount <= 0) return true;
  if (sim.state.money < amount) return false;
  book(sim, label, -amount);
  return true;
}

export function letter(sim: Sim, l: Omit<Letter, 'id' | 'day' | 'read'>): Letter {
  const st = sim.state;
  const full: Letter = { id: st.nextId++, day: sim.day, read: false, ...l };
  st.post.push(full);
  if (st.post.length > 120) st.post.splice(0, st.post.length - 120);
  return full;
}

// ------------------------------------------------------------------ flats and going rates

export function flatInfo(sim: Sim, id: string): FlatInfo {
  const st = sim.state;
  let info = st.flats[id];
  if (!info) {
    const tier = flatScore(sim, id).tier;
    info = { asking: TIER_RENT[tier], listed: true, tier, lease: null, nextApplicant: st.tick + 6 * TICKS_PER_HOUR };
    st.flats[id] = info;
  }
  return info;
}

export function goingRate(sim: Sim, id: string): number {
  return TIER_RENT[flatInfo(sim, id).tier];
}

/** A flat's going-rate tier catches up with how impressive it is: straight away going up, after a few days going down. */
function updateTier(sim: Sim, id: string): void {
  const info = flatInfo(sim, id);
  const now = flatScore(sim, id).tier;
  const rank = (t: string) => TIERS.length - TIERS.findIndex((x) => x.name === t);
  if (rank(now) >= rank(info.tier)) {
    info.tier = now;
    delete info.belowSince;
  } else {
    info.belowSince ??= sim.state.tick;
    if (sim.state.tick - info.belowSince >= TIER_GRACE_DAYS * TICKS_PER_DAY) {
      info.tier = now;
      delete info.belowSince;
    }
  }
  if (!info.lease && info.listed && info.asking <= 0) info.asking = TIER_RENT[info.tier];
}

// ------------------------------------------------------------------ the week

/** Once a day, first thing: tiers catch up. Rent and leases are in leases.ts. */
export function morning(sim: Sim): void {
  for (const f of sim.layout.flats) updateTier(sim, f.id);
  // Flats that have gone (their door moved) drop their records, unless someone lives there.
  for (const id of Object.keys(sim.state.flats)) {
    if (!sim.layout.flat(id) && !sim.state.flats[id].lease) delete sim.state.flats[id];
  }
}

/** What Monday's bills come to (not the mortgage). */
export function billsDue(sim: Sim): number {
  const st = sim.state;
  const empty = sim.layout.flats.filter((f) => !flatInfo(sim, f.id).lease).length;
  return BILLS.insurance + BILLS.lighting + BILLS.bins + BILLS.emptyFlatTax * empty + gasBill(sim) + (st.cleaner ? CLEANER_WEEKLY : 0) + (st.security.alarm ? ALARM_WEEKLY : 0);
}

export function weeklyBills(sim: Sim): void {
  const st = sim.state;
  const empty = sim.layout.flats.filter((f) => !flatInfo(sim, f.id).lease).length;
  book(sim, 'Buildings insurance', -BILLS.insurance);
  book(sim, 'Stairwell lighting', -BILLS.lighting);
  book(sim, 'Bin collection', -BILLS.bins);
  if (empty > 0) book(sim, `Council tax on ${empty} empty flat${empty > 1 ? 's' : ''}`, -BILLS.emptyFlatTax * empty);
  const gas = gasBill(sim);
  if (gas > 0) book(sim, 'Gas for the central boiler', -gas);
  if (st.cleaner) book(sim, 'Cleaner for the stairs', -CLEANER_WEEKLY);
  if (st.security.alarm) book(sim, 'Alarm monitoring', -ALARM_WEEKLY);
  if (st.money < 0) book(sim, 'Overdraft charge', -10 * POUND);
}

export function mortgageDue(sim: Sim): void {
  const st = sim.state;
  const m = st.mortgage;
  if (m.paidOffDay !== undefined || st.repossessed !== undefined) return;
  m.balance += Math.round((m.balance * m.rate) / 52);
  const due = Math.min(m.balance, m.payment + m.arrears);
  if (st.money >= due) {
    book(sim, 'Mortgage', -due);
    m.balance -= due;
    if (m.missed > 0) letter(sim, { from: 'Northfold Building Society', title: 'Payment received', body: 'Thank you for bringing your account up to date. We have removed the note from your file. The note remains in our hearts.' });
    m.missed = 0;
    m.arrears = 0;
    checkPaidOff(sim);
    return;
  }
  m.missed++;
  m.arrears += m.payment;
  const left = MISSES_ALLOWED - m.missed;
  if (left <= 0) {
    st.repossessed = sim.day;
    letter(sim, { from: 'Northfold Building Society', title: 'Repossession', body: 'Following four missed payments, the building is now in our possession. Please leave the keys under the mat. We will be changing the mat.' });
    return;
  }
  const tone = [
    'We notice this week\'s payment did not arrive. We are sure it is an oversight. We are writing to say we are sure.',
    'This is the second payment we have not received. We would like to remind you that the building is, in a sense, ours.',
    'Final notice. One more missed payment and we will take possession of the building. We have already measured up.',
  ][Math.min(2, m.missed - 1)];
  letter(sim, { from: 'Northfold Building Society', title: `Missed payment (${m.missed} of ${MISSES_ALLOWED})`, body: `${tone} You now owe ${pounds(m.arrears)} in arrears on top of next week's payment.` });
}

/** Pays some of the mortgage off early. */
export function overpay(sim: Sim, amount: number): boolean {
  const m = sim.state.mortgage;
  const pay = Math.min(amount, m.balance);
  if (pay <= 0 || !spend(sim, 'Mortgage overpayment', pay)) return false;
  m.balance -= pay;
  checkPaidOff(sim);
  return true;
}

function checkPaidOff(sim: Sim): void {
  const m = sim.state.mortgage;
  if (m.balance > 0 || m.paidOffDay !== undefined) return;
  m.balance = 0;
  m.paidOffDay = sim.day;
  letter(sim, { from: 'Northfold Building Society', title: 'Mortgage redeemed', body: 'Your mortgage is paid in full. The building is yours. We will miss you, in a professional capacity.' });
}
