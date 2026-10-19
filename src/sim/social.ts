// Neighbours. Tenants who end up near each other (on the stairs, in the lobby, at home
// with a flatmate) sometimes talk. What they say is a weighted pick shaped by what they
// think of each other, their hidden chemistry and their traits: a chat, a proper talk,
// something off, an insult that turns into a row, a flirt, a favour, a moan about you, or
// gossip. Each leaves memories, and what someone thinks of someone else is the sum of the
// memories they hold about them.
//
// Gossip passes on a weaker copy of something that happened (a rent rise, a row), at most
// two tellings away. It's how one tenant's grievance reaches the whole building, and how
// tenants find out what each other pay.

import { post, recently, tenants, whoIs } from './chat';
import { flatInfo, goingRate } from './economy';
import { pick, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, type Pawn } from './state';
import { MEMORIES, remember } from './thoughts';
import { has } from './traits';
import { maybeFight } from './events';
import { tale } from './tales';

export interface SocialDef {
  label: string;
  value: number;
  hours: number;
  stack: number;
}

export const SOCIAL: Record<string, SocialDef> = {
  chat: { label: 'Chats', value: 3, hours: 240, stack: 8 },
  deepTalk: { label: 'Had a proper talk', value: 9, hours: 336, stack: 3 },
  slight: { label: 'Was a bit off with me', value: -5, hours: 96, stack: 3 },
  insult: { label: 'Said something nasty', value: -10, hours: 144, stack: 3 },
  row: { label: 'Had a row', value: -15, hours: 192, stack: 2 },
  flirt: { label: 'Flirted', value: 8, hours: 120, stack: 3 },
  rebuffed: { label: 'Turned me down', value: -6, hours: 120, stack: 1 },
  favour: { label: 'Did me a favour', value: 10, hours: 192, stack: 3 },
  noise: { label: 'Keeps me up at night', value: -4, hours: 168, stack: 5 },
  heardThings: { label: 'Heard things about them', value: -4, hours: 120, stack: 2 },
  brokeUp: { label: 'Broke up with me', value: -25, hours: 336, stack: 1 },
  fight: { label: 'Had a fight', value: -30, hours: 336, stack: 1 },
  cheatedOn: { label: 'Went behind my back', value: -35, hours: 600, stack: 1 },
};

/** Each extra copy counts this much of the one before. */
const STACK = 0.75;
const PARTNER = 25;
const EX = -10;

// ------------------------------------------------------------------ opinions

/** Hidden, fixed chemistry between two people, -1 to 1. Shapes how often they talk and how. */
export function chemistry(sim: Sim, a: number, b: number): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let h = (sim.state.seed * 2654435761 + lo * 40503 + hi * 69069) >>> 0;
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    sum += (h >>> 0) / 4294967296;
  }
  return Math.max(-1, Math.min(1, (sum / 3 - 0.5) * 3 + 0.15));
}

export interface OpinionPart {
  label: string;
  value: number;
}

/** What `a` thinks of `b`, and why: every memory and relation, from -100 to 100. */
export function opinionParts(sim: Sim, a: Pawn, b: Pawn): OpinionPart[] {
  const life = a.life;
  if (!life) return [];
  const now = sim.state.tick;
  const out: OpinionPart[] = [];
  if (life.partner === b.id) out.push({ label: 'Partner', value: PARTNER });
  if (life.exes?.includes(b.id)) out.push({ label: 'Ex', value: EX });
  const groups = new Map<string, number[]>();
  for (const m of life.social) {
    if (m.about !== b.id) continue;
    const def = SOCIAL[m.id];
    if (!def) continue;
    const age = (now - m.at) / (def.hours * TICKS_PER_HOUR);
    if (age >= 1) continue;
    // Fades out over the last third of its life.
    const strength = age < 2 / 3 ? 1 : (1 - age) * 3;
    const list = groups.get(m.id) ?? [];
    list.push(strength);
    groups.set(m.id, list);
  }
  for (const [id, strengths] of groups) {
    const def = SOCIAL[id];
    const top = strengths.sort((x, y) => y - x).slice(0, def.stack);
    const value = top.reduce((n, s, i) => n + def.value * s * STACK ** i, 0);
    out.push({ label: top.length > 1 ? `${def.label} ×${top.length}` : def.label, value: Math.round(value * 10) / 10 });
  }
  return out;
}

export function opinion(sim: Sim, a: Pawn, b: Pawn): number {
  return Math.max(-100, Math.min(100, opinionParts(sim, a, b).reduce((n, p) => n + p.value, 0)));
}

export function rememberAbout(sim: Sim, a: Pawn, id: string, b: Pawn): void {
  if (!a.life) return;
  a.life.social.push({ id, about: b.id, at: sim.state.tick });
}

/** Drops social memories that have run out, now and then. */
export function forgetSocial(sim: Sim, p: Pawn): void {
  const now = sim.state.tick;
  p.life!.social = p.life!.social.filter((m) => SOCIAL[m.id] && now - m.at < SOCIAL[m.id].hours * TICKS_PER_HOUR);
}

/** Opinions this tenant holds of everyone else in the building, strongest first. */
export function relationships(sim: Sim, p: Pawn): { other: Pawn; opinion: number }[] {
  return tenants(sim)
    .filter((o) => o !== p)
    .map((o) => ({ other: o, opinion: Math.round(opinion(sim, p, o)) }))
    .filter((r) => r.opinion !== 0 || p.life!.partner === r.other.id)
    .sort((a, b) => Math.abs(b.opinion) - Math.abs(a.opinion));
}

// ------------------------------------------------------------------ meeting

/** Minutes between someone's conversations. */
const TALK_GAP = 25;

/** Awake, around, and not busy: sitting down counts as free (you can talk on the sofa). */
function free(p: Pawn, tick: number): boolean {
  const life = p.life;
  if (!life || life.away || life.leaving || p.pose === 'sleep') return false;
  if (life.using && life.using.until !== 0 && p.pose !== 'sit') return false;
  return !life.lastTalk || tick - life.lastTalk > TALK_GAP * TICKS_PER_MINUTE;
}

/** Same room (or both on the stairs and landings), close enough to talk. */
function canTalk(sim: Sim, a: Pawn, b: Pawn): boolean {
  if (Math.abs(a.s - b.s) > 0.1 || Math.abs(a.x - b.x) > 3) return false;
  const lay = sim.layout;
  const ra = lay.roomOf[lay.node(Math.round(a.x), Math.round(a.s))];
  const rb = lay.roomOf[lay.node(Math.round(b.x), Math.round(b.s))];
  if (ra === -1 || rb === -1) return false;
  return ra === rb || (lay.rooms[ra].shared && lay.rooms[rb].shared);
}

/** Once a game minute: people near each other might talk. */
export function socialMinute(sim: Sim): void {
  const st = sim.state;
  const people = tenants(sim).filter((p) => free(p, st.tick));
  for (const a of people) {
    if (!free(a, st.tick) || random(st) > 1 / 6) continue;
    const near = people.filter((b) => b !== a && free(b, st.tick) && canTalk(sim, a, b));
    if (near.length === 0) continue;
    talk(sim, a, pick(st, near));
  }
}

type Kind = 'chat' | 'deepTalk' | 'slight' | 'insult' | 'flirt' | 'gossip' | 'moan' | 'favour';

const BUBBLE: Record<Kind, string> = { chat: '…', deepTalk: '“”', slight: '~', insult: '#', flirt: '♥', gossip: '?', moan: '£', favour: '+' };

function single(p: Pawn): boolean {
  return p.life!.partner === undefined;
}

function weights(sim: Sim, a: Pawn, b: Pawn): [Kind, number][] {
  const op = opinion(sim, a, b);
  const chem = chemistry(sim, a.id, b.id);
  const la = a.life!;
  const friendly = has(la, 'friendly');
  let neg = (op < 0 ? 1 + -op / 25 : Math.max(0.15, 1 - op / 60)) * (1.2 - chem);
  let pos = (1 + Math.max(0, op) / 40) * (0.8 + chem);
  if (friendly) {
    pos *= 1.5;
    neg *= 0.4;
  }
  const canFlirt = single(a) && single(b) && !la.exes?.includes(b.id) && la.flat !== b.life!.flat;
  return [
    ['chat', 1],
    ['deepTalk', 0.12 * pos * (op > 10 ? 1.5 : 0.5)],
    ['slight', 0.05 * neg],
    ['insult', 0.015 * neg * (op < -20 ? 2 : 1)],
    ['flirt', canFlirt ? 0.12 * Math.max(0, chem + 0.2) * (op >= 10 ? 1 : 0.2) : 0],
    ['gossip', gossipFor(sim, a, b) ? 0.35 * (has(la, 'busybody') ? 3 : 1) : 0],
    ['moan', la.liking < 40 ? 0.25 * (has(la, 'complainer') ? 2 : 1) : 0],
    ['favour', (has(la, 'handy') || friendly) && op > 0 ? 0.06 : 0],
  ];
}

function talk(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  const options = weights(sim, a, b).filter(([, w]) => w > 0);
  const total = options.reduce((n, [, w]) => n + w, 0);
  let r = random(st) * total;
  const kind = (options.find(([, w]) => (r -= w) < 0) ?? options[0])[0];
  a.life!.lastTalk = st.tick;
  b.life!.lastTalk = st.tick;
  const minutes = kind === 'deepTalk' ? 6 : 3;
  for (const p of [a, b]) {
    const until = st.tick + minutes * TICKS_PER_MINUTE;
    p.bubble = { text: BUBBLE[kind], until };
    // People on the move stop to talk; people sitting down stay put.
    if (!p.life!.using || p.life!.using.until === 0) p.talkUntil = until;
  }
  const aName = a.name.split(' ')[0];
  const bName = b.name.split(' ')[0];
  if (a.talkUntil) a.doing = `Chatting with ${bName}`;
  if (b.talkUntil) b.doing = `Chatting with ${aName}`;
  switch (kind) {
    case 'chat':
      rememberAbout(sim, a, 'chat', b);
      rememberAbout(sim, b, 'chat', a);
      return;
    case 'deepTalk':
      rememberAbout(sim, a, 'deepTalk', b);
      rememberAbout(sim, b, 'deepTalk', a);
      return;
    case 'slight':
      rememberAbout(sim, b, 'slight', a);
      return;
    case 'insult': {
      rememberAbout(sim, b, 'insult', a);
      const temper = (opinion(sim, b, a) < -20 ? 2 : 1) * (has(b.life!, 'complainer') ? 1.5 : 1);
      if (random(st) < 0.25 * temper) row(sim, a, b);
      return;
    }
    case 'flirt':
      flirt(sim, a, b);
      return;
    case 'gossip':
      a.doing = `Gossiping with ${bName}`;
      b.doing = `Gossiping with ${aName}`;
      gossip(sim, a, b);
      return;
    case 'moan': {
      a.doing = `Moaning about the landlord to ${bName}`;
      // Only things they lived or heard first-hand go round: a moan travels two tellings at most, like any gossip.
      const worst = a.life!.memories.filter((m) => MEMORIES[m.id]?.gossip && MEMORIES[m.id].value < 0 && (m.hops ?? 0) < 2).sort((x, y) => MEMORIES[x.id].value - MEMORIES[y.id].value)[0];
      if (worst && !b.life!.memories.some((m) => m.id === worst.id)) b.life!.memories.push({ id: worst.id, at: st.tick, from: a.id, hops: (worst.hops ?? 0) + 1 });
      if (random(st) < 0.15 && !recently(sim, 'Is it just me')) post(sim, a, 'Is it just me or is this building getting worse');
      return;
    }
    case 'favour':
      rememberAbout(sim, b, 'favour', a);
      if (has(a.life!, 'handy')) {
        b.doing = `${aName} is fixing something of theirs`;
        if (random(st) < 0.3) sim.notify(`${aName} has fixed ${bName}'s wobbly shelf. Nobody asked them to.`);
      }
      return;
  }
}

// ------------------------------------------------------------------ rows

function row(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  rememberAbout(sim, a, 'row', b);
  rememberAbout(sim, b, 'row', a);
  for (const p of [a, b]) {
    p.talkUntil = st.tick + 8 * TICKS_PER_MINUTE;
    p.bubble = { text: '!', until: p.talkUntil };
  }
  a.doing = `Having a row with ${b.name.split(' ')[0]}`;
  b.doing = `Having a row with ${a.name.split(' ')[0]}`;
  if (maybeFight(sim, a, b)) return;
  // Anyone nearby saw it.
  const seen = tenants(sim).filter((w) => w !== a && w !== b && !w.life!.away && Math.abs(w.s - a.s) < 0.1 && Math.abs(w.x - a.x) <= 6);
  for (const w of seen) remember(sim, w.life!, 'sawRow');
  if (!recently(sim, 'Can whoever')) {
    const witness = seen[0] ?? null;
    if (witness) post(sim, witness, 'Can whoever is shouting on the stairs please not');
  }
  sim.notify(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} are having a row.`);
}

// ------------------------------------------------------------------ romance

function flirt(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  a.doing = `Flirting with ${b.name.split(' ')[0]}`;
  b.doing = `Flirting with ${a.name.split(' ')[0]}`;
  const chance = 0.5 + chemistry(sim, a.id, b.id) * 0.3 + opinion(sim, b, a) / 200;
  if (random(st) > chance) {
    rememberAbout(sim, a, 'rebuffed', b);
    return;
  }
  rememberAbout(sim, a, 'flirt', b);
  rememberAbout(sim, b, 'flirt', a);
  if (opinion(sim, a, b) >= 40 && opinion(sim, b, a) >= 40 && random(st) < 0.3) {
    a.life!.partner = b.id;
    b.life!.partner = a.id;
    sim.notify(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} are seeing each other.`);
    tale(sim, 'couple', [a, b]);
    const busy = tenants(sim).find((p) => p !== a && p !== b && has(p.life!, 'busybody'));
    if (busy) post(sim, busy, `Not to gossip but has anyone noticed ${whoIs(sim, a).split(' · ')[1] ?? 'someone'} and ${whoIs(sim, b).split(' · ')[1] ?? 'someone'} 👀`);
  }
}

/** Once an hour: couples who've gone off each other might split. */
export function romanceHour(sim: Sim): void {
  const st = sim.state;
  for (const a of tenants(sim)) {
    const life = a.life!;
    if (life.partner === undefined || a.id > life.partner) continue;
    const b = st.pawns.find((p) => p.id === life.partner);
    if (!b?.life) {
      delete life.partner;
      continue;
    }
    if (Math.min(opinion(sim, a, b), opinion(sim, b, a)) - PARTNER >= 0 || random(st) > 1 / 36) continue;
    delete life.partner;
    delete b.life.partner;
    life.exes = [...(life.exes ?? []), b.id];
    b.life.exes = [...(b.life.exes ?? []), a.id];
    rememberAbout(sim, b, 'brokeUp', a);
    rememberAbout(sim, a, 'brokeUp', b);
    remember(sim, life, 'brokeUp');
    remember(sim, b.life, 'brokeUp');
    sim.notify(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} have split up.`);
    tale(sim, 'breakup', [a, b]);
  }
}

// ------------------------------------------------------------------ gossip

/** Something `a` could tell `b`: a memory worth passing on that `b` hasn't heard. */
function gossipFor(sim: Sim, a: Pawn, b: Pawn) {
  const now = sim.state.tick;
  return a.life!.memories.find((m) => {
    const def = MEMORIES[m.id];
    return def?.gossip && (m.hops ?? 0) < 2 && now - m.at < (def.hours * TICKS_PER_HOUR) / 2 && !b.life!.memories.some((n) => n.id === m.id);
  });
}

function gossip(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  // Sometimes it's about rent: who pays what.
  if (random(st) < 0.35 && compareRent(sim, a, b)) return;
  const item = gossipFor(sim, a, b);
  if (item) b.life!.memories.push({ id: item.id, at: st.tick, from: a.id, hops: (item.hops ?? 0) + 1, ...(item.note ? { note: item.note } : {}) });
  // Busybodies talk about the neighbours too.
  if (has(a.life!, 'busybody')) {
    const rival = tenants(sim).find((o) => o !== a && o !== b && opinion(sim, a, o) <= -20);
    if (rival) rememberAbout(sim, b, 'heardThings', rival);
  }
}

/** If one pays noticeably more than the other for a flat no better, they find out. */
function compareRent(sim: Sim, a: Pawn, b: Pawn): boolean {
  const la = flatInfo(sim, a.life!.flat).lease;
  const lb = flatInfo(sim, b.life!.flat).lease;
  if (!la || !lb || a.life!.flat === b.life!.flat) return false;
  const [hi, lo, hiLease, loLease] = la.rent >= lb.rent ? [a, b, la, lb] : [b, a, lb, la];
  if (hiLease.rent < loLease.rent * 1.15) return false;
  // Only a grievance if the dearer flat isn't better.
  if (goingRate(sim, hi.life!.flat) > goingRate(sim, lo.life!.flat)) return false;
  const name = sim.layout.flat(lo.life!.flat)?.name ?? 'next door';
  if (hi.life!.memories.some((m) => m.id === 'paysMore')) return false;
  hi.life!.memories.push({ id: 'paysMore', at: sim.state.tick, note: `Pays more than ${name} for no better` });
  return true;
}

// ------------------------------------------------------------------ requests

/** Once a day per tenant (at a random hour): maybe ask for something in the chat. */
export function requestsHour(sim: Sim): void {
  const st = sim.state;
  for (const p of tenants(sim)) {
    const life = p.life!;
    if (random(st) > 1 / 24 || sim.day - life.since < 2) continue;
    if (has(life, 'petOwner') && life.pet === undefined && random(st) < 0.3) {
      const pet = pick(st, ['a cat', 'a small dog', 'a rabbit called Nigel']);
      life.pet = 'asked';
      post(sim, p, `Would it be all right if I got ${pet}? Very well behaved. Mostly.`, [
        { label: 'Yes, go on', note: `They'll love you for it`, act: `pet:${pet}` },
        { label: 'No pets, sorry', note: 'They won\'t', act: 'noPet' },
      ]);
      continue;
    }
    if (life.needs.warmth < 0.45 && !recently(sim, 'Is the heating on', 2)) {
      const temp = Math.round(st.temps[life.flat] ?? 15);
      post(sim, p, `Is the heating on? It's ${temp}° in here`, [
        { label: 'Turn the boiler up', note: 'Warmer, dearer gas', act: 'boilerUp' },
        { label: 'Try a jumper', note: 'Free. Unpopular.', act: 'jumper' },
      ]);
      continue;
    }
    if ((has(life, 'houseProud') || has(life, 'handy')) && random(st) < 0.1 && !recently(sim, 'Can I paint', 7)) {
      post(sim, p, 'Can I paint the bedroom? Thinking "Elephant\'s Breath". I\'ll do it myself.', [
        { label: 'Go for it', note: 'They\'ll be pleased', act: 'paint' },
        { label: 'Magnolia stays', note: 'They won\'t', act: 'noPaint' },
      ]);
    }
  }
}

/** Someone's moving out: their friends will miss them. */
export function friendsLeaving(sim: Sim, leaving: Pawn[]): void {
  for (const p of tenants(sim)) {
    if (leaving.includes(p)) continue;
    for (const l of leaving) if (opinion(sim, p, l) >= 30) remember(sim, p.life!, 'friendLeft');
  }
}
