// Money. Rent comes in every morning; the mortgage and the building's bills go out every
// Monday. Miss four mortgage payments in a row and the bank takes the building; pay it off
// and it's yours. All amounts are in pence. The numbers to tune are in tuning.ts.

import { furnitureDef, isGraded } from './defs';
import { rentScore, TIERS } from './impressiveness';
import { flatKind, type FlatType } from './rooms';
import type { Sim } from './sim';
import { gasBill } from './environment';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type FlatInfo, type Grade, type Letter, type CellKind } from './state';
import { tale } from './tales';
import {
  ALARM_WEEKLY,
  BILLS,
  CELL_PRICES,
  CLEANER_WEEKLY,
  FURNITURE_LEAST_POUNDS,
  FURNITURE_POUNDS_PER_VALUE,
  GRADES,
  LAYOUT,
  LETTING,
  MISSES_ALLOWED,
  OVERDRAFT_CHARGE,
  POUND,
  TIER_GRACE_DAYS,
  TIER_RENT,
} from './tuning';

// The money numbers live in tuning.ts; the rest of the game still gets them from here.
export {
  ALARM_PRICE,
  ALARM_WEEKLY,
  BILLS,
  COUNCIL_FINE,
  COUNCIL_FINE_CAP,
  DEMOLISH_PRICE,
  DEPOSIT_WEEKS,
  HANDOVER_ADVANCE,
  INSULATE_PRICE,
  LEASE_WEEKS,
  LOCKS_PRICE,
  MISSES_ALLOWED,
  MORTGAGE,
  MOVE_OUT_NOTICE_DAYS,
  PLANNING_FEE,
  POUND,
  RENT_NOTICE_DAYS,
  RESALE,
  START_MONEY,
  TIER_GRACE_DAYS,
  TIER_RENT,
} from './tuning';

/** What each cell costs to put in. */
export const CELL_PRICE: Record<CellKind, number> = CELL_PRICES;

/** What a piece costs new, at a grade (to the nearest pound). Pieces that don't come in grades ignore it. */
export function furniturePrice(def: string, grade: Grade = 'standard'): number {
  const base = Math.max(FURNITURE_LEAST_POUNDS, furnitureDef(def).value * FURNITURE_POUNDS_PER_VALUE);
  return Math.round(base * GRADES.price[isGraded(def) ? grade : 'standard']) * POUND;
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
    const tier = rentScore(sim, id).tier;
    info = { asking: rateFor(flatKind(sim, id).type, tier), listed: true, tier, lease: null, nextApplicant: st.tick + LETTING.firstLookHours * TICKS_PER_HOUR };
    st.flats[id] = info;
  }
  return info;
}

/** What a flat of this size and tier fetches a week: a studio's rate times its size, to the nearest £5. */
export function rateFor(type: FlatType, tier: string): number {
  return Math.round((TIER_RENT[tier] * (LAYOUT.sizeRent[type] ?? 1)) / (5 * POUND)) * 5 * POUND;
}

/** A flat's going rate: its size (studio, one-bed...) and how good it is. */
export function goingRate(sim: Sim, id: string): number {
  return rateFor(flatKind(sim, id).type, flatInfo(sim, id).tier);
}

/** A flat's going-rate tier catches up with how impressive it is: straight away going up, after a few days going down. */
function updateTier(sim: Sim, id: string): void {
  const info = flatInfo(sim, id);
  const now = rentScore(sim, id).tier;
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
  if (!info.lease && info.listed && info.asking <= 0) info.asking = goingRate(sim, id);
}

// ------------------------------------------------------------------ the week

/** Every hour: a flat that's been done up gets the going rate it now deserves. (Coming down waits for the morning.) */
export function raiseTiers(sim: Sim): void {
  const rank = (t: string) => TIERS.length - TIERS.findIndex((x) => x.name === t);
  for (const f of sim.layout.flats) {
    const info = flatInfo(sim, f.id);
    if (rank(rentScore(sim, f.id).tier) > rank(info.tier)) updateTier(sim, f.id);
  }
}

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
  if (st.money < 0) book(sim, 'Overdraft charge', -OVERDRAFT_CHARGE);
}

export function mortgageDue(sim: Sim): void {
  const st = sim.state;
  const m = st.mortgage;
  if (m.paidOffDay !== undefined || st.repossessed !== undefined) return;
  m.balance += Math.round((m.balance * m.rate) / 52);
  // This week's payment breaks a run of missed ones; arrears come off as well, as far as the money goes.
  const payment = Math.min(m.balance, m.payment);
  if (st.money >= payment) {
    const extra = Math.max(0, Math.min(m.arrears, st.money - payment, m.balance - payment));
    book(sim, 'Mortgage', -(payment + extra));
    m.balance -= payment + extra;
    m.arrears -= extra;
    if (m.missed > 0) {
      letter(sim, {
        from: 'Northfold Building Society',
        title: 'Payment received',
        body: m.arrears > 0
          ? `Thank you for this week's payment. You still owe ${pounds(m.arrears)} in arrears, which we will take as and when you have it. We will be watching.`
          : 'Thank you for bringing your account up to date. We have removed the note from your file. The note remains in our hearts.',
      });
    }
    m.missed = 0;
    checkPaidOff(sim);
    return;
  }
  m.missed++;
  m.arrears += m.payment;
  const left = MISSES_ALLOWED - m.missed;
  if (left <= 0) {
    st.repossessed = sim.day;
    tale(sim, 'repossessed', []);
    letter(sim, { from: 'Northfold Building Society', title: 'Repossession', body: 'Following four missed payments, the building is now in our possession. Please leave the keys under the mat. We will be changing the mat.' });
    return;
  }
  tale(sim, 'missedMortgage', []);
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
