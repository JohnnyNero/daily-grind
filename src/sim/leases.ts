// Letting flats. Empty flats you've listed draw applicants, more for impressive, fairly
// priced flats. You pick one; they pay a deposit, move in and pay rent every morning (or
// don't). Leases run a few weeks and then renew or end. Rent changes need a week's notice.

import { DEPOSIT_WEEKS, LEASE_WEEKS, MOVE_OUT_NOTICE_DAYS, POUND, RENT_NOTICE_DAYS, TIER_RENT, book, flatInfo, goingRate, letter, pounds } from './economy';
import { scoreFor } from './impressiveness';
import { FIRST, LAST } from './pawns';
import { pick, randInt, random, type RngHolder } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Applicant, type Lease, type ListingStyle, type Pawn, type Schedule } from './state';
import { jobFor, rollSchedule } from './schedules';
import { moveIn, type Person } from './tenants';
import { friendsLeaving } from './social';
import { amenities } from './shared';
import { post } from './chat';
import { expectGrade, expectThought } from './expectations';
import { likingTarget, missingThoughts, rentThought, thoughtsOf, tierThought, type Thought } from './thoughts';
import { rollTraits, traitDef, touchiness, has } from './traits';
import { tale } from './tales';
import { EVICTION_ARREARS_WEEKS, EVICTION_NOTICE_DAYS, LETTING as L, LISTING_PACE, MEMORIES, RENT as R } from './tuning';
import { readFlags } from './flags';

// ------------------------------------------------------------------ listings

export interface ListingDef {
  name: string;
  /** How it reads on the property site. */
  blurb: string;
  /** Hours between applicants, times this. */
  pace: number;
}

export const LISTINGS: Record<ListingStyle, ListingDef> = {
  plain: { name: 'Plain', blurb: 'Flat to let. Furnished. Rent weekly.', pace: LISTING_PACE.plain },
  agent: { name: 'Estate agent', blurb: 'Bijou. Characterful. Moments from transport. Viewing essential!', pace: LISTING_PACE.agent },
  honest: { name: 'Brutally honest', blurb: 'Small. Brown. The boiler has moods. Neighbours mostly fine.', pace: LISTING_PACE.honest },
  professionals: { name: 'Professionals only', blurb: 'Would suit a working professional. No students, no bands, no exceptions.', pace: LISTING_PACE.professionals },
  pets: { name: 'Pets considered', blurb: 'Pets considered. Within reason. Not a horse.', pace: LISTING_PACE.pets },
};

// ------------------------------------------------------------------ reviews

/** Your rating from the last few tenants to leave (null before anyone has). */
export function landlordRating(sim: Sim): number | null {
  const recent = sim.state.reviews.slice(-L.reviewsCounted);
  if (recent.length === 0) return null;
  return recent.reduce((n, r) => n + r.stars, 0) / recent.length;
}

/** Good reviews bring applicants quicker; bad ones put people off. */
function ratingPace(sim: Sim): number {
  const r = landlordRating(sim);
  return r === null ? 1 : L.ratingPaceBase - L.ratingPacePerStar * r;
}

const REVIEW_TEXT: Record<number, string[]> = {
  1: ['Avoid. {straw}. The landlord could not care less.', 'Zero stars if I could. {straw}.', 'Lived here so you don\'t have to. {straw}.'],
  2: ['{straw}. Wouldn\'t rush back.', 'Not the worst. Not far off. {straw}.'],
  3: ['It was fine. {straw}, but fine.', 'Does the job. Bring a jumper.'],
  4: ['Good place, decent landlord. {best}.', 'Would recommend. {best}.'],
  5: ['Best flat I\'ve had. {best}. Sad to go.', 'Genuinely lovely. {best}. Ten out of ten landlord.'],
};

/** They're leaving: they say what they thought, for everyone to read. */
function review(sim: Sim, flatId: string, people: Pawn[]): number | undefined {
  if (people.length === 0) return undefined;
  const st = sim.state;
  const liking = people.reduce((n, p) => n + p.life!.liking, 0) / people.length;
  const stars = Math.max(1, Math.min(5, Math.round(liking / 20 + 0.5)));
  const thoughts = thoughtsOf(sim, people[0]).filter((t) => t.value !== 0);
  const worst = [...thoughts].sort((a, b) => a.value - b.value)[0];
  const best = [...thoughts].sort((a, b) => b.value - a.value)[0];
  const clean = (t: Thought | undefined, fallback: string) => (t ? t.label.replace(/ ×\d+$/, '').replace(/^Heard: /, '') : fallback);
  const text = pick(st, REVIEW_TEXT[stars]).replace('{straw}', clean(worst, 'Everything')).replace('{best}', clean(best, 'Nice place'));
  st.reviews.push({ day: sim.day, who: people.map((p) => p.name.split(' ')[0]).join(' & '), flat: sim.layout.flat(flatId)?.name ?? 'A flat', stars, text: text.charAt(0).toUpperCase() + text.slice(1) });
  if (st.reviews.length > 40) st.reviews.splice(0, st.reviews.length - 40);
  sim.notify(`${people[0].name.split(' ')[0]} left a ${stars}-star review.`);
  return stars;
}

// ------------------------------------------------------------------ people

/**
 * Someone new. Their schedule (when they're in) is rolled in its share unless `working` says
 * otherwise: true for someone with work (hours away, or from home), false for someone retired,
 * or a schedule outright.
 */
export function makePerson(rng: RngHolder, surname?: string, working?: boolean | Schedule): Person {
  const schedule = typeof working === 'string' ? working : rollSchedule(rng, working);
  const { job, note } = jobFor(rng, schedule);
  return {
    name: `${pick(rng, FIRST)} ${surname ?? pick(rng, LAST)}`,
    job,
    schedule,
    note,
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
    // Word that nobody answers the door gets round (flags.ts).
    const meanHours = readFlags(sim, 'letting.hours', Math.max(L.fewestHours, Math.min(L.mostHours, L.meanHours * ratio ** 3)) * (liveable ? 1 : L.unliveableSlower) * LISTINGS[info.style ?? 'plain'].pace * ratingPace(sim), { flat: f.id });
    info.nextApplicant = st.tick + Math.round(-Math.log(1 - random(st) * 0.999) * meanHours * TICKS_PER_HOUR);
    if (waiting < L.maxWaiting && ratio < L.tooDear - L.tooDearPerGrade * expectGrade(sim)) st.applicants.push(newApplicant(sim, f.id, undefined, !liveable));
  }
}

export function newApplicant(sim: Sim, flatId: string, friendOf?: Pawn, mustBeDesperate = false): Applicant {
  const st = sim.state;
  const lay = sim.layout;
  const flat = lay.flat(flatId)!;
  const info = flatInfo(sim, flatId);
  const roomFor = Math.max(1, Math.min(3, Math.floor(flat.area / L.tilesPerPerson)));
  const size = Math.min(roomFor, random(st) < L.single ? 1 : random(st) < L.couple ? 2 : 3);
  const surname = pick(st, LAST);
  const people: Person[] = [];
  for (let i = 0; i < size; i++) {
    const professional = info.style === 'professionals';
    let person = makePerson(st, i === 0 || random(st) < L.sameSurname ? surname : undefined, professional || undefined);
    if (professional) person.traits = person.traits.filter((t) => t !== 'partyAnimal' && t !== 'musician');
    if (info.style === 'pets' && i === 0 && !person.traits.includes('petOwner') && random(st) < L.petsListing) person.traits = [...person.traits.slice(0, 2), 'petOwner'];
    if (person.traits.length === 0) person.traits = ['easyGoing'];
    // Nobody shares a first name with someone they live with.
    for (let tries = 0; tries < 10 && people.some((o) => o.name.split(' ')[0] === person.name.split(' ')[0]); tries++) person = { ...person, name: `${pick(st, FIRST)} ${person.name.split(' ').slice(1).join(' ')}` };
    people.push(person);
  }
  const lead = people[0];
  const shown = pick(st, lead.traits);
  const hidden = lead.traits.filter((t) => t !== shown);
  const hints = hidden.slice(0, random(st) < 0.5 ? 1 : 2).map((t) => `Previous landlord: “${traitDef(t).hint}”`);
  const desperate = mustBeDesperate || ((info.tier === 'Grim' || info.tier === 'Shabby') && random(st) < L.desperate);
  if (desperate) hints.push('Can move in today. Any flat, honestly.');
  // What the building has gets a mention (no dice: it's just what they notice).
  const have = amenities(sim);
  if (have.bikes && lead.job) hints.push('Asked where the bike goes before asking about the rent.');
  else if (have.garden) hints.push(`Keeps mentioning the ${have.garden.name.toLowerCase()}.`);
  else if (have.laundry) hints.push('Pleased there is a laundry room. Said so twice.');
  if (friendOf) hints.unshift(`A friend of ${friendOf.name.split(' ')[0]}, who lives here already.`);
  const offer = has(lead, 'haggler') ? Math.round((info.asking * L.hagglerOffer) / (5 * POUND)) * 5 * POUND : info.asking;
  return { id: st.nextId++, flat: flatId, people, traits: lead.traits, shown, hints, offer, until: st.tick + L.applicantDays * TICKS_PER_DAY, ...(desperate ? { desperate: true } : {}) };
}

/** Roughly how much an applicant would like the flat, from what you know: the flat, the rent, the basics. */
export function likelyLiking(sim: Sim, a: Applicant): number {
  const score = scoreFor(sim, a.flat, a.people.length);
  const thoughts: Thought[] = [];
  const tier = tierThought(score.tier, has({ traits: [a.shown] }, 'houseProud'));
  if (tier) thoughts.push(tier);
  const grade = expectGrade(sim);
  const hoped = expectThought(score.tier, grade);
  if (hoped) thoughts.push(hoped);
  thoughts.push(...missingThoughts(score));
  const rent = rentThought(a.offer, TIER_RENT[score.tier], grade);
  if (rent) thoughts.push(rent);
  thoughts.push({ label: MEMORIES.newPlace.label, value: MEMORIES.newPlace.value });
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
  tale(sim, 'moveIn', pawns, { flat: a.flat });
  for (const p of pawns) p.life!.memories.push({ id: 'newPlace', at: st.tick });
  // What the listing promised colours the first week.
  if (info.style === 'agent') for (const p of pawns) p.life!.memories.push({ id: 'notAsAdvertised', at: st.tick });
  if (info.style === 'honest') for (const p of pawns) p.life!.memories.push({ id: 'betterThanExpected', at: st.tick });
  const greeter = st.pawns.find((p) => p.life && !p.life.leaving && !pawns.includes(p) && has(p.life, 'friendly'));
  if (greeter) post(sim, greeter, `Welcome to ${flatName}, ${pawns.map((p) => p.name.split(' ')[0]).join(' and ')}! Bins go out Sunday night. Don't ask about the boiler.`);
  if (a.desperate) for (const p of pawns) p.life!.desperate = true;
  // Word gets round: fewer applicants for a while after someone moves in.
  for (const f of Object.values(st.flats)) f.nextApplicant = Math.max(f.nextApplicant, st.tick + L.afterMoveInHours * TICKS_PER_HOUR);
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
    let lateChance = liking < R.lateUnhappy.under ? R.lateUnhappy.chance : liking < R.lateFedUp.under ? R.lateFedUp.chance : R.lateUsual;
    if (early) lateChance *= liking < R.paysEarlyUnhappy.under ? R.paysEarlyUnhappy.factor : R.paysEarly;
    if (lease.prepaid && lease.prepaid > 0) {
      lease.prepaid--;
      lease.paid++;
    } else if ((lease.withholdUntil ?? 0) > st.tick || random(st) < lateChance) {
      lease.owed += daily;
      lease.late++;
    } else {
      // On time, and catching up a bit on anything owed.
      const catchUp = lease.owed > 0 && liking >= R.catchUpLiking ? Math.min(lease.owed, daily) : 0;
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
  if (liking >= R.renewLiking + touchy / 2) {
    lease.endDay = sim.day + LEASE_WEEKS * 7;
    const haggler = people.find((p) => has(p.life!, 'haggler'));
    const going = goingRate(sim, id);
    if (haggler && lease.rent > going * R.renewHaggleAbove) {
      const ask = Math.round((Math.min(lease.rent, going) * R.renewHaggleAsk) / (5 * POUND)) * 5 * POUND;
      letter(sim, {
        from: `${haggler.name}, ${name}`,
        title: 'About the renewal',
        body: `Happy to stay on. Bit of a cheeky one, but would you do ${pounds(ask)} a week? Similar flats round here are going for less. (They aren't.)`,
        choices: [
          { label: `Agree to ${pounds(ask)}`, note: '', act: `rent:${id}:${ask}` },
          { label: 'Keep it as it is', note: '', act: `refuse:${id}` },
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
    const id = change > R.bigRise ? 'rentRiseBig' : change > 0 ? 'rentRiseSmall' : 'rentCut';
    p.life!.memories.push({ id, at: sim.state.tick });
  }
}

/** You give notice. Only for rent arrears of two weeks or more. */
export function noticeProblem(sim: Sim, flatId: string): string | null {
  const lease = flatInfo(sim, flatId).lease;
  if (!lease) return 'Nobody lives there';
  if (lease.notice) return 'Notice has already been given';
  if (lease.owed < lease.rent * EVICTION_ARREARS_WEEKS) return 'You can only give notice for two weeks\' rent arrears';
  return null;
}

export function giveNotice(sim: Sim, flatId: string): string | null {
  const problem = noticeProblem(sim, flatId);
  if (problem) return problem;
  flatInfo(sim, flatId).lease!.notice = { by: 'landlord', why: 'Rent arrears', day: sim.day + EVICTION_NOTICE_DAYS };
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
  const going = leaving.filter((q) => !q.life!.leaving);
  const stars = review(sim, flatId, going);
  if (going.length > 0) tale(sim, 'moveOut', going, { flat: flatId, what: stars === undefined ? 'no review' : `a ${stars}-star review`, stars });
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
  info.nextApplicant = st.tick + L.relistHours * TICKS_PER_HOUR;
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
