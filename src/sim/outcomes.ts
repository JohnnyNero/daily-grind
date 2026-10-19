// What tenants do about how they feel. Below three lines (fed up, angry, done) a tenant
// can kick off: they have to stay below a line for a while, then there's a chance each
// hour, then they calm down for a day and feel better for having let off steam. Their
// traits pick what they do: a complainer writes to you, someone who knows their rights
// writes to the council, an easy-going one just sulks. The message names the last straw.
//
// It works the other way too: someone who loves living here now and then pays early,
// sends a friend your way or fixes something.

import { POUND, book, flatInfo, letter, pounds } from './economy';
import { newApplicant } from './leases';
import { pick, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Pawn } from './state';
import { remember, thoughtsOf, type Thought } from './thoughts';
import { has, reveal, touchiness, traitDef } from './traits';

/** The three lines, before traits move them. */
export const LINES = { minor: 35, major: 25, extreme: 15 };
/** Hours below a line before anything can happen. */
const WAIT_HOURS = 2;
/** Average days between incidents while below each line. */
const MEAN_DAYS = { minor: 3, major: 1.5, extreme: 1 };

type Level = keyof typeof LINES;

/** Where someone's lines sit, allowing for their traits. */
export function linesFor(p: Pawn): Record<Level, number> {
  const t = touchiness(p.life!);
  return { minor: LINES.minor + t, major: LINES.major + t, extreme: LINES.extreme + t };
}

/** Once an hour for each tenant. */
export function outcomesHour(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const st = sim.state;
  if (life.leaving || life.away) return;
  const lines = linesFor(p);
  for (const level of ['minor', 'major', 'extreme'] as Level[]) {
    life.under[level] = life.liking < lines[level] ? life.under[level] + TICKS_PER_HOUR : 0;
  }
  // Getting to know them: a hidden trait shows itself every week or so.
  if (sim.day - life.since >= 3 && random(st) < 1 / (6 * 24)) {
    const hidden = life.traits.filter((t) => !life.revealed.includes(t));
    if (hidden.length > 0) noticeTrait(sim, p, pick(st, hidden));
  }
  if (st.tick < life.calmUntil) return;
  const level = (['extreme', 'major', 'minor'] as Level[]).find((l) => life.under[l] >= WAIT_HOURS * TICKS_PER_HOUR);
  if (level) {
    if (random(st) < 1 / (MEAN_DAYS[level] * 24)) kickOff(sim, p, level);
    return;
  }
  if (life.liking >= 65) {
    const meanDays = 5 + ((100 - life.liking) / 35) * 15;
    if (random(st) < 1 / (meanDays * 24)) goodTurn(sim, p);
  }
}

/** A trait shows itself: a short notice for the player. */
export function noticeTrait(sim: Sim, p: Pawn, trait: string): void {
  if (!reveal(p.life!, trait)) return;
  sim.notify(`Getting to know ${p.name.split(' ')[0]}: ${traitDef(trait).name}. ${traitDef(trait).says}`);
}

/** The worst of their bad thoughts, picked with the worst most likely. */
function lastStraw(sim: Sim, p: Pawn): Thought | null {
  const bad = thoughtsOf(sim, p).filter((t) => t.value < 0);
  if (bad.length === 0) return null;
  const total = bad.reduce((n, t) => n - t.value, 0);
  let r = random(sim.state) * total;
  return bad.find((t) => (r += t.value) < 0) ?? bad[0];
}

interface Outcome {
  level: Level;
  /** Only for tenants with this trait (it shows itself when it happens). */
  trait?: string;
  /** Not for tenants with this trait. */
  not?: string;
  run(sim: Sim, p: Pawn, straw: string): void;
}

const from = (sim: Sim, p: Pawn) => `${p.name}, ${sim.layout.flat(p.life!.flat)?.name ?? 'your building'}`;

const OUTCOMES: Outcome[] = [
  {
    level: 'minor',
    run(sim, p, straw) {
      letter(sim, { from: from(sim, p), title: 'A note under your door', body: `Just to say: ${straw.toLowerCase()}. That's all. Thanks.`, flat: p.life!.flat, pawn: p.id });
    },
  },
  {
    level: 'minor',
    trait: 'complainer',
    run(sim, p, straw) {
      letter(sim, { from: from(sim, p), title: 'Formal complaint (3 pages)', body: `Further to my previous correspondence, I wish to raise the following: ${straw.toLowerCase()}. I have kept copies. I have kept copies of the copies.`, flat: p.life!.flat, pawn: p.id });
    },
  },
  {
    level: 'minor',
    trait: 'easyGoing',
    run(sim, p) {
      sim.notify(`${p.name.split(' ')[0]} is having a quiet sulk. They won't say about what.`);
    },
  },
  {
    level: 'major',
    not: 'paysEarly',
    run(sim, p, straw) {
      const lease = flatInfo(sim, p.life!.flat).lease;
      if (lease) lease.withholdUntil = sim.state.tick + 3 * TICKS_PER_DAY;
      letter(sim, { from: from(sim, p), title: 'Rent', body: `I'm holding back the rent until something's done. ${straw}. You know what you did. (Or didn't.)`, flat: p.life!.flat, pawn: p.id });
    },
  },
  {
    level: 'major',
    trait: 'haggler',
    run(sim, p, straw) {
      const lease = flatInfo(sim, p.life!.flat).lease;
      if (!lease) return;
      const ask = Math.round((lease.rent * 0.85) / (5 * POUND)) * 5 * POUND;
      letter(sim, {
        from: from(sim, p),
        title: 'Money off',
        body: `Given everything (${straw.toLowerCase()}, mostly), I think ${pounds(ask)} a week is fairer. Let me know.`,
        choices: [
          { label: `Agree to ${pounds(ask)}`, note: 'They like you more', act: `rent:${p.life!.flat}:${ask}` },
          { label: 'No', note: 'They\'ll grumble', act: `refuse:${p.life!.flat}` },
        ],
        dueDay: sim.day + 3,
        fallback: 1,
        flat: p.life!.flat,
        pawn: p.id,
      });
    },
  },
  {
    level: 'extreme',
    run(sim, p, straw) {
      const lease = flatInfo(sim, p.life!.flat).lease;
      if (!lease || lease.notice) return;
      lease.notice = { by: 'tenant', why: straw, day: sim.day + 7 };
      letter(sim, { from: from(sim, p), title: 'Notice', body: `We're leaving. Seven days. ${straw} was the last straw.`, flat: p.life!.flat, pawn: p.id });
    },
  },
  {
    level: 'extreme',
    trait: 'knowsRights',
    run(sim, p, straw) {
      letter(sim, {
        from: 'Harrowgate City Council, Private Sector Housing',
        title: 'Complaint from a tenant',
        body: `A tenant has complained to us (${straw.toLowerCase()}). We will be inspecting. In the meantime you may pay a fixed penalty of £300, or wait for the inspection, which may find more.`,
        choices: [
          { label: 'Pay £300', note: 'Done with', act: 'fine:30000' },
          { label: 'Wait for the inspection', note: 'Might be nothing. Might be £600.', act: 'inspect' },
        ],
        dueDay: sim.day + 5,
        fallback: 1,
        flat: p.life!.flat,
        pawn: p.id,
      });
    },
  },
];

function kickOff(sim: Sim, p: Pawn, level: Level): void {
  const life = p.life!;
  const order: Level[] = level === 'extreme' ? ['extreme', 'major', 'minor'] : level === 'major' ? ['major', 'minor'] : ['minor'];
  for (const l of order) {
    const pool = OUTCOMES.filter((o) => o.level === l && (!o.trait || has(life, o.trait)) && (!o.not || !has(life, o.not)));
    if (pool.length === 0) continue;
    // A trait's own outcome wins when there is one.
    const own = pool.filter((o) => o.trait);
    const o = pick(sim.state, own.length > 0 ? own : pool);
    const straw = lastStraw(sim, p)?.label.replace(/ ×\d+$/, '') ?? 'Everything';
    o.run(sim, p, straw);
    if (o.trait) noticeTrait(sim, p, o.trait);
    // Two days to calm down; a week after going to the council.
    life.calmUntil = sim.state.tick + (o.trait === 'knowsRights' ? 7 : 2) * TICKS_PER_DAY;
    remember(sim, life, 'letOffSteam');
    return;
  }
}

function goodTurn(sim: Sim, p: Pawn): void {
  const st = sim.state;
  const life = p.life!;
  const lease = flatInfo(sim, life.flat).lease;
  const name = p.name.split(' ')[0];
  const options: (() => void)[] = [];
  if (lease && !lease.prepaid) {
    const early = () => {
      lease.prepaid = 7;
      book(sim, `Rent paid a week early · ${sim.layout.flat(life.flat)?.name ?? 'Flat'}`, lease.rent);
      sim.notify(`${name} paid next week's rent early.`);
      noticeTrait(sim, p, 'paysEarly');
    };
    options.push(early);
    if (has(life, 'paysEarly')) options.push(early, early);
  }
  const empty = sim.layout.flats.find((f) => {
    const info = flatInfo(sim, f.id);
    return !info.lease && info.listed;
  });
  if (empty) {
    options.push(() => {
      st.applicants.push(newApplicant(sim, empty.id, p));
      sim.notify(`${name} has sent a friend to look at ${empty.name}.`);
    });
  }
  if (has(life, 'handy')) {
    options.push(() => {
      sim.notify(`${name} fixed the dripping tap in the lobby. Nobody asked. It's fixed.`);
      noticeTrait(sim, p, 'handy');
    });
  }
  options.push(() => {
    letter(sim, { from: from(sim, p), title: 'A card', body: 'Just a card to say thanks. The flat\'s lovely. Well, it\'s fine. Thanks.', flat: life.flat, pawn: p.id });
  });
  pick(st, options)();
}
