// Letting flats. Empty flats you've listed draw applicants, more for impressive, fairly
// priced flats. You pick one; they pay a deposit, move in and pay rent every morning (or
// don't). Leases run a few weeks and then renew or end. Rent changes need a week's notice.

import { DEPOSIT_WEEKS, LEASE_WEEKS, MOVE_OUT_NOTICE_DAYS, POUND, RENT_NOTICE_DAYS, TIER_RENT, book, flatInfo, goingRate, letter, pounds } from './economy';
import { scoreFor } from './impressiveness';
import { FIRST, LAST } from './pawns';
import { pick, randInt, random, type RngHolder } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Applicant, type Lease, type Pawn } from './state';
import { moveIn, type Person } from './tenants';
import { friendsLeaving } from './social';
import { post } from './chat';
import { likingTarget, rentThought, tierThought, type Thought } from './thoughts';
import { rollTraits, traitDef, touchiness, has } from './traits';

const JOBS: { title: string; leave: number; back: number }[] = [
  { title: 'Office manager', leave: 8 * 60, back: 17 * 60 + 30 },
  { title: 'Nurse', leave: 7 * 60, back: 15 * 60 + 30 },
  { title: 'Barista', leave: 6 * 60 + 15, back: 14 * 60 + 30 },
  { title: 'Civil servant', leave: 8 * 60 + 15, back: 17 * 60 + 15 },
  { title: 'Delivery driver', leave: 7 * 60 + 30, back: 18 * 60 },
  { title: 'Teaching assistant', leave: 8 * 60, back: 16 * 60 },
  { title: 'Software tester', leave: 8 * 60 + 45, back: 17 * 60 + 45 },
  { title: 'Estate agent', leave: 8 * 60 + 30, back: 18 * 60 + 15 },
  { title: 'Junior solicitor', leave: 7 * 60 + 45, back: 19 * 60 },
  { title: 'Bike courier', leave: 9 * 60, back: 17 * 60 },
];
const NO_JOBS = ['Retired', 'Student', 'Works from home', '"Between things"'];

/** Most applicants waiting for one flat at a time. */
const MAX_WAITING = 3;
/** How long an applicant waits for an answer. */
const APPLICANT_DAYS = 2;

// ------------------------------------------------------------------ people

export function makePerson(rng: RngHolder, surname?: string, working = random(rng) < 0.75): Person {
  const job = working ? pick(rng, JOBS) : null;
  return {
    name: `${pick(rng, FIRST)} ${surname ?? pick(rng, LAST)}`,
    job: job ? { ...job } : null,
    note: job ? job.title : pick(rng, NO_JOBS),
    look: { skin: randInt(rng, 0, 5), hair: randInt(rng, 0, 7), top: randInt(rng, 0, 9), legs: randInt(rng, 0, 5) },
    traits: rollTraits(rng),
  };
}

// ------------------------------------------------------------------ applicants

/** Every hour: applicants turn up for listed empty flats, and old ones give up. */
export function applicantsHour(sim: Sim): void {
  const st = sim.state;
  st.applicants = st.applicants.filter((a) => a.until > st.tick && sim.layout.flat(a.flat) && !flatInfo(sim, a.flat).lease);
  for (const f of sim.layout.flats) {
    const info = flatInfo(sim, f.id);
    if (info.lease || !info.listed || st.tick < info.nextApplicant) continue;
    const waiting = st.applicants.filter((a) => a.flat === f.id).length;
    // Dear flats draw fewer people: the price against the going rate, cubed.
    const ratio = info.asking / Math.max(1, goingRate(sim, f.id));
    // A flat without the basics (a bed, a loo, a wash, a kitchen) only draws the desperate, and rarely.
    const basics = scoreFor(sim, f.id, 1).has;
    const liveable = basics.bed && basics.toilet && basics.wash && basics.kitchen;
    const meanHours = Math.max(3, Math.min(120, 14 * ratio ** 3)) * (liveable ? 1 : 4);
    info.nextApplicant = st.tick + Math.round(-Math.log(1 - random(st) * 0.999) * meanHours * TICKS_PER_HOUR);
    if (waiting < MAX_WAITING && ratio < 1.6) st.applicants.push(newApplicant(sim, f.id, undefined, !liveable));
  }
}

export function newApplicant(sim: Sim, flatId: string, friendOf?: Pawn, mustBeDesperate = false): Applicant {
  const st = sim.state;
  const lay = sim.layout;
  const flat = lay.flat(flatId)!;
  const info = flatInfo(sim, flatId);
  const roomFor = Math.max(1, Math.min(3, Math.floor(flat.area / 5)));
  const size = Math.min(roomFor, random(st) < 0.55 ? 1 : random(st) < 0.7 ? 2 : 3);
  const surname = pick(st, LAST);
  const people: Person[] = [];
  for (let i = 0; i < size; i++) {
    let person = makePerson(st, i === 0 || random(st) < 0.6 ? surname : undefined, i === 0 ? random(st) < 0.8 : random(st) < 0.5);
    // Nobody shares a first name with someone they live with.
    for (let tries = 0; tries < 10 && people.some((o) => o.name.split(' ')[0] === person.name.split(' ')[0]); tries++) person = { ...person, name: `${pick(st, FIRST)} ${person.name.split(' ').slice(1).join(' ')}` };
    people.push(person);
  }
  const lead = people[0];
  const shown = pick(st, lead.traits);
  const hidden = lead.traits.filter((t) => t !== shown);
  const hints = hidden.slice(0, random(st) < 0.5 ? 1 : 2).map((t) => `Previous landlord: “${traitDef(t).hint}”`);
  const desperate = mustBeDesperate || ((info.tier === 'Grim' || info.tier === 'Shabby') && random(st) < 0.2);
  if (desperate) hints.push('Can move in today. Any flat, honestly.');
  if (friendOf) hints.unshift(`A friend of ${friendOf.name.split(' ')[0]}, who lives here already.`);
  const offer = has(lead, 'haggler') ? Math.round((info.asking * 0.9) / (5 * POUND)) * 5 * POUND : info.asking;
  return { id: st.nextId++, flat: flatId, people, traits: lead.traits, shown, hints, offer, until: st.tick + APPLICANT_DAYS * TICKS_PER_DAY, ...(desperate ? { desperate: true } : {}) };
}

/** Roughly how much an applicant would like the flat, from what you know: the flat, the rent, the basics. */
export function likelyLiking(sim: Sim, a: Applicant): number {
  const score = scoreFor(sim, a.flat, a.people.length);
  const thoughts: Thought[] = [];
  const tier = tierThought(score.tier, has({ traits: [a.shown] }, 'houseProud'));
  if (tier) thoughts.push(tier);
  if (!score.has.bed) thoughts.push({ label: '', value: -12 });
  if (!score.has.toilet) thoughts.push({ label: '', value: -15 });
  if (!score.has.wash) thoughts.push({ label: '', value: -8 });
  if (!score.has.kitchen) thoughts.push({ label: '', value: -6 });
  if (score.perPerson < 5) thoughts.push({ label: '', value: -5 });
  const rent = rentThought(a.offer, TIER_RENT[score.tier]);
  if (rent) thoughts.push(rent);
  thoughts.push({ label: '', value: 5 }); // new place
  return Math.round(likingTarget(thoughts));
}

/** You pick an applicant: they pay a deposit and move in. */
export function accept(sim: Sim, applicantId: number): string | null {
  const st = sim.state;
  const a = st.applicants.find((x) => x.id === applicantId);
  if (!a) return 'They\'ve found somewhere else';
  const info = flatInfo(sim, a.flat);
  if (info.lease) return 'Someone already lives there';
  const lease: Lease = {
    rent: a.offer,
    startDay: sim.day,
    endDay: sim.day + LEASE_WEEKS * 7,
    deposit: a.offer * DEPOSIT_WEEKS,
    owed: 0,
    paid: 0,
    late: 0,
  };
  info.lease = lease;
  info.listed = false;
  st.applicants = st.applicants.filter((x) => x.flat !== a.flat);
  const flatName = sim.layout.flat(a.flat)?.name ?? 'the flat';
  book(sim, `Deposit · ${flatName}`, lease.deposit);
  const pawns = moveIn(sim, a.flat, a.people, [a.shown]);
  for (const p of pawns) p.life!.memories.push({ id: 'newPlace', at: st.tick });
  const greeter = st.pawns.find((p) => p.life && !p.life.leaving && !pawns.includes(p) && has(p.life, 'friendly'));
  if (greeter) post(sim, greeter, `Welcome to ${flatName}, ${pawns.map((p) => p.name.split(' ')[0]).join(' and ')}! Bins go out Sunday night. Don't ask about the boiler.`);
  if (a.desperate) for (const p of pawns) p.life!.desperate = true;
  // Word gets round: fewer applicants for a while after someone moves in.
  for (const f of Object.values(st.flats)) f.nextApplicant = Math.max(f.nextApplicant, st.tick + 18 * TICKS_PER_HOUR);
  return null;
}

export function turnAway(sim: Sim, applicantId: number): void {
  sim.state.applicants = sim.state.applicants.filter((a) => a.id !== applicantId);
}

// ------------------------------------------------------------------ rent

export function household(sim: Sim, flatId: string): Pawn[] {
  return sim.state.pawns.filter((p) => p.life?.flat === flatId && !p.life.leaving);
}

/** Their mood as a household: the average of how much each likes it here. */
export function householdLiking(sim: Sim, flatId: string): number {
  const h = household(sim, flatId);
  return h.length === 0 ? 50 : h.reduce((n, p) => n + p.life!.liking, 0) / h.length;
}

/** First thing every morning: rent comes in (or doesn't), rises take effect, leases end or renew. */
export function rentMorning(sim: Sim): void {
  const st = sim.state;
  for (const [id, info] of Object.entries(st.flats)) {
    const lease = info.lease;
    if (!lease) continue;
    const people = household(sim, id);
    const name = sim.layout.flat(id)?.name ?? 'Flat';
    if (lease.rise && sim.day >= lease.rise.from) {
      lease.rent = lease.rise.rent;
      delete lease.rise;
    }
    if (lease.notice && sim.day >= lease.notice.day) {
      moveOut(sim, id);
      continue;
    }
    if (people.length === 0) continue;
    const daily = Math.round(lease.rent / 7);
    const liking = householdLiking(sim, id);
    const early = people.some((p) => has(p.life!, 'paysEarly'));
    let lateChance = liking < 20 ? 0.4 : liking < 35 ? 0.15 : 0.03;
    if (early) lateChance *= liking < 15 ? 0.5 : 0.1;
    if (lease.prepaid && lease.prepaid > 0) {
      lease.prepaid--;
      lease.paid++;
    } else if ((lease.withholdUntil ?? 0) > st.tick || random(st) < lateChance) {
      lease.owed += daily;
      lease.late++;
    } else {
      // On time, and catching up a bit on anything owed.
      const catchUp = lease.owed > 0 && liking >= 30 ? Math.min(lease.owed, daily) : 0;
      lease.owed -= catchUp;
      lease.paid++;
      book(sim, `Rent · ${name}`, daily + catchUp);
    }
    leaseEnd(sim, id, lease, liking, people);
  }
}

function leaseEnd(sim: Sim, id: string, lease: Lease, liking: number, people: Pawn[]): void {
  if (lease.endDay === null || lease.notice || sim.day < lease.endDay) return;
  const name = sim.layout.flat(id)?.name ?? 'the flat';
  const touchy = people.reduce((n, p) => n + touchiness(p.life!), 0) / people.length;
  const lead = people[0];
  if (liking >= 40 + touchy / 2) {
    lease.endDay = sim.day + LEASE_WEEKS * 7;
    const haggler = people.find((p) => has(p.life!, 'haggler'));
    const going = goingRate(sim, id);
    if (haggler && lease.rent > going * 0.95) {
      const ask = Math.round((Math.min(lease.rent, going) * 0.9) / (5 * POUND)) * 5 * POUND;
      letter(sim, {
        from: `${haggler.name}, ${name}`,
        title: 'About the renewal',
        body: `Happy to stay on. Bit of a cheeky one, but would you do ${pounds(ask)} a week? Similar flats round here are going for less. (They aren't.)`,
        choices: [
          { label: `Agree to ${pounds(ask)}`, note: 'They like you more', act: `rent:${id}:${ask}` },
          { label: 'Keep it as it is', note: 'They\'ll grumble', act: `refuse:${id}` },
        ],
        dueDay: sim.day + 3,
        fallback: 1,
        flat: id,
        pawn: haggler.id,
      });
    } else letter(sim, { from: `${lead.name}, ${name}`, title: 'Lease renewed', body: `We'd like to stay on for another ${LEASE_WEEKS} weeks, if that's all right. It's all right, it's automatic.`, flat: id });
    return;
  }
  lease.notice = { by: 'tenant', why: 'Not renewing', day: sim.day + MOVE_OUT_NOTICE_DAYS };
  letter(sim, { from: `${lead.name}, ${name}`, title: 'Not renewing', body: `We won't be renewing. We'll be out in ${MOVE_OUT_NOTICE_DAYS} days. Please don't take it personally. (Do.)`, flat: id });
}

/** You change the rent on a let flat: it takes a week's notice, and they won't like a rise. */
export function changeRent(sim: Sim, flatId: string, rent: number): void {
  const info = flatInfo(sim, flatId);
  const lease = info.lease;
  if (!lease) {
    info.asking = rent;
    return;
  }
  const current = lease.rise?.rent ?? lease.rent;
  if (rent === current) return;
  lease.rise = { rent, from: sim.day + RENT_NOTICE_DAYS };
  const change = (rent - lease.rent) / lease.rent;
  for (const p of household(sim, flatId)) {
    const id = change > 0.1 ? 'rentRiseBig' : change > 0 ? 'rentRiseSmall' : 'rentCut';
    p.life!.memories.push({ id, at: sim.state.tick });
  }
}

/** You give notice. Only for rent arrears of two weeks or more. */
export function noticeProblem(sim: Sim, flatId: string): string | null {
  const lease = flatInfo(sim, flatId).lease;
  if (!lease) return 'Nobody lives there';
  if (lease.notice) return 'Notice has already been given';
  if (lease.owed < lease.rent * 2) return 'You can only give notice for two weeks\' rent arrears';
  return null;
}

export function giveNotice(sim: Sim, flatId: string): string | null {
  const problem = noticeProblem(sim, flatId);
  if (problem) return problem;
  flatInfo(sim, flatId).lease!.notice = { by: 'landlord', why: 'Rent arrears', day: sim.day + 14 };
  return null;
}

/** They're off: the deposit goes back, less anything owed, and the flat goes back on the market. */
export function moveOut(sim: Sim, flatId: string): void {
  const st = sim.state;
  const info = flatInfo(sim, flatId);
  const lease = info.lease;
  if (!lease) return;
  const name = sim.layout.flat(flatId)?.name ?? 'Flat';
  const back = lease.deposit - lease.owed;
  if (back > 0) book(sim, `Deposit back · ${name}`, -back);
  const leaving = st.pawns.filter((q) => q.life?.flat === flatId);
  friendsLeaving(sim, leaving);
  for (const p of leaving) {
    p.life!.leaving = true;
    p.life!.using = null;
    // Whoever they were with stays single.
    const partner = st.pawns.find((q) => q.id === p.life!.partner);
    if (partner?.life && partner.life.flat !== flatId) delete partner.life.partner;
  }
  info.lease = null;
  info.listed = true;
  info.asking = goingRate(sim, flatId);
  info.nextApplicant = st.tick + 4 * TICKS_PER_HOUR;
}

/** Sitting tenants: the ones the building came with, on an old, cheap rolling tenancy. */
export function sittingTenants(sim: Sim, flatId: string, people: Person[], weekly: number): Pawn[] {
  const info = flatInfo(sim, flatId);
  info.lease = { rent: weekly, startDay: -400, endDay: null, deposit: 0, owed: 0, paid: 0, late: 0, sitting: true };
  info.listed = false;
  const pawns = moveIn(sim, flatId, people, people[0].traits.slice(0, 1));
  for (const p of pawns) p.life!.since = -400;
  return pawns;
}
