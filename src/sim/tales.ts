// Stories and the end-of-day recap.
//
// Notable log entries carry a story kind and an interest score. The recap picks the
// day's best stories, but a kind that has headlined before scores lower each time, so
// the recap keeps finding something new to say. Text comes from small phrase tables
// filled with real names, a tiny version of a text grammar.

import { withArticle } from './defs';
import { pick } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, type Pawn, type Recap, type Review } from './state';

const NOVELTY_FALLOFF = 0.5;
const STORIES_PER_RECAP = 3;

export function taleScore(sim: Sim, tale: string, interest: number): number {
  return interest / (1 + (sim.state.story.taleUses[tale] ?? 0) * NOVELTY_FALLOFF);
}

/** Picks a headline, avoiding yesterday's if there's any alternative. */
function headline(sim: Sim, topTale: string | null): string {
  const s = sim.state;
  const last = s.recaps[s.recaps.length - 1]?.headline;
  const choose = (options: readonly string[]) => pick(s, options.length > 1 ? options.filter((o) => o !== last) : options);
  const d = s.today;
  const visits = d.served + d.walkouts;
  const byTale: Record<string, string[]> = {
    couple: ['Love is brewing', 'Romance on the rota', 'Steamed milk and stolen glances'],
    quit: ['Apron on the floor', 'One fewer on the rota', 'The day someone walked'],
    row: ['Drama behind the counter', 'Words were exchanged', 'Tension you could cut with a cake knife'],
    break: ['Somebody snapped', 'Not everyone made it to close', 'A wobble behind the counter'],
    coachParty: ['The coach party cometh', 'Forty flat whites, no warning', 'Rush hour carnage'],
    machineBroken: ['The day the machine died', 'No espresso, no peace'],
    inspector: ['Inspection day', 'Clipboard at the door'],
    critic: ['The critic came', 'Reviewed'],
    criticRave: ['Rave review', 'The critic loved it', 'Five stars in the paper'],
    criticWalkout: ['The critic walked', 'Tomorrow\'s paper will hurt'],
    birthday: ['Happy birthday to you', 'Cake for a regular'],
    lostRegular: ['A regular walks away', 'Goodbye, old friend'],
    newRegular: ['A new face, a new regular'],
    grudge: ['Old grudges', 'A regular remembers'],
    sickCall: ['Short-staffed', 'One man down'],
    argueCustomer: ['The customer is not always right', 'Somebody said what we were all thinking'],
    breakup: ["It's over", 'Heartbreak hotel, table for two', 'Awkward at the coffee machine'],
    poached: ['Lured away', 'Off to the competition', 'Better offer down the road'],
    followedOut: ['Two through the door', 'Where one goes, the other follows'],
    burnout: ['Running on empty', 'Somebody needs a holiday'],
    milestone: ['Cake for the staff', 'A long time behind this counter'],
    wagesLate: ['Pay day came late', 'The money conversation'],
  };
  if (topTale && byTale[topTale]) return choose(byTale[topTale]);
  if (visits > 0 && d.walkouts / visits > 0.2) return choose(['A rough one', 'Queues out the door', 'Not our finest hour']);
  if (d.served > 110) return choose(['Record day', 'Absolutely flying', 'Ran off our feet, in a good way']);
  return choose(['Smooth sailing', 'Another day, another flat white', 'Business as usual', 'A quiet sort of day']);
}

/** Builds today's recap from the log, then marks the chosen story kinds as used. */
export function buildRecap(sim: Sim): Recap {
  const s = sim.state;
  const dayStart = Math.floor(s.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  const todays = s.log.filter((e) => e.tick >= dayStart && e.tale && e.interest > 0);
  const scored = todays
    .map((e) => ({ e, score: taleScore(sim, e.tale!, e.interest) }))
    .sort((a, b) => b.score - a.score || a.e.tick - b.e.tick);
  // One story per kind, best first.
  const seen = new Set<string>();
  const picked = scored.filter(({ e }) => (seen.has(e.tale!) ? false : (seen.add(e.tale!), true))).slice(0, STORIES_PER_RECAP);
  for (const { e } of picked) s.story.taleUses[e.tale!] = (s.story.taleUses[e.tale!] ?? 0) + 1;

  const staff = s.pawns.filter((p) => p.staff && !p.staff.quit);
  const star = staff.slice().sort((a, b) => b.staff!.tipsToday - a.staff!.tipsToday || b.staff!.servedToday - a.staff!.servedToday)[0];
  const reviews = s.today.reviews;
  const review = reviews.find((r) => r.critic) ?? (reviews.length > 0 ? pick(s, reviews) : null);

  return {
    day: sim.day,
    headline: headline(sim, picked[0]?.e.tale ?? null),
    stats: { ...s.today, reviews: [] },
    repStart: s.story.repAtOpen,
    repEnd: s.reputation,
    stories: picked.map(({ e }) => e.text),
    review,
    star: star && star.staff!.tipsToday > 0
      ? `${star.name}: £${(star.staff!.tipsToday / 100).toFixed(2)} in tips, ${star.staff!.servedToday} orders taken`
      : null,
  };
}

const REVIEW_LINES: Record<number, readonly string[]> = {
  5: [
    'Best {item} in town. {server} is a legend.',
    '{server} remembered my name. I never told them my name. Five stars.',
    'Perfect {item}. Would queue again.',
  ],
  4: [
    'Lovely {item}, friendly staff. Bit of a wait.',
    'Solid. The {item} was great, the queue less so.',
    'Good vibes, good {item}.',
  ],
  3: [
    'It was a {item}. It was fine.',
    'Fine. The {item} was warm, which is the main thing.',
    'Nice place, slow service.',
  ],
  2: [
    'Waited ages. The {item} was lukewarm by the time I got it.',
    "Staff looked like they'd rather be anywhere else.",
  ],
  1: [
    'Waited twenty minutes and left without my {item}. Never again.',
    'Someone was crying behind the counter. Also, no {item}.',
    'Asked for {aItem}. Got a lecture. One star.',
  ],
};

const CRITIC_LINES: Record<number, readonly string[]> = {
  5: ['"{AItem} of rare poise. {server} is wasted on this town." A rave.'],
  4: ['"{AnHonestItem}, served with real warmth." Very positive.'],
  3: ['"Competent. Unremarkable. The {item} exists." Lukewarm.'],
  2: ['"The {item} arrived eventually, as did my sense of despair." Ouch.'],
  1: ['"I have had better {item}s from a vending machine on a ferry." Brutal.'],
};

export function starsFor(satisfaction: number): number {
  if (satisfaction >= 0.85) return 5;
  if (satisfaction >= 0.72) return 4;
  if (satisfaction >= 0.58) return 3;
  if (satisfaction >= 0.4) return 2;
  return 1;
}

export function writeReview(sim: Sim, guest: Pawn, satisfaction: number, server: Pawn | undefined): Review {
  const stars = starsFor(satisfaction);
  const critic = guest.visit?.critic === true;
  const lines = critic ? CRITIC_LINES[stars] : REVIEW_LINES[stars];
  const item = guest.visit?.items[0] ?? 'drink';
  const aItem = withArticle(item);
  const text = pick(sim.state, lines)
    .replaceAll('{AItem}', aItem.charAt(0).toUpperCase() + aItem.slice(1))
    .replaceAll('{AnHonestItem}', `An honest ${item}`)
    .replaceAll('{aItem}', aItem)
    .replaceAll('{item}', item)
    .replaceAll('{server}', server?.name ?? 'the barista');
  return { name: guest.name, stars, text, critic };
}
