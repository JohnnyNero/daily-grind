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
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, seconds, type Pawn } from './state';
import { MEMORIES, remember } from './thoughts';
import { has } from './traits';
import { maybeFight } from './events';
import { tale } from './tales';
import { GOSSIP, OPINION, ROMANCE, SOCIAL, TALK } from './tuning';
import { readFlags } from './flags';

// What each social memory is worth, and the odds of each kind of talk, are in tuning.ts.
export { SOCIAL, type SocialDef } from './tuning';

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
  if (life.partner === b.id) out.push({ label: 'Partner', value: OPINION.partner });
  if (life.exes?.includes(b.id)) out.push({ label: 'Ex', value: OPINION.ex });
  const groups = new Map<string, number[]>();
  for (const m of life.social) {
    if (m.about !== b.id) continue;
    const def = SOCIAL[m.id];
    if (!def) continue;
    const age = (now - m.at) / (def.hours * TICKS_PER_HOUR);
    if (age >= 1) continue;
    // Fades out over the last third of its life.
    const strength = age < OPINION.fadeFrom ? 1 : (1 - age) * 3;
    const list = groups.get(m.id) ?? [];
    list.push(strength);
    groups.set(m.id, list);
  }
  for (const [id, strengths] of groups) {
    const def = SOCIAL[id];
    const top = strengths.sort((x, y) => y - x).slice(0, def.stack);
    const value = top.reduce((n, s, i) => n + def.value * s * OPINION.stack ** i, 0);
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

/** Awake, around, and not busy: sitting down counts as free (you can talk on the sofa). */
function free(p: Pawn, tick: number): boolean {
  const life = p.life;
  if (!life || life.away || life.leaving || p.pose === 'sleep' || life.breakState) return false;
  if (life.using && life.using.until !== 0 && p.pose !== 'sit') return false;
  return !life.lastTalk || tick - life.lastTalk > TALK.gapMinutes * TICKS_PER_MINUTE;
}

/** Same room (or both on the stairs and landings), close enough to talk. */
function canTalk(sim: Sim, a: Pawn, b: Pawn): boolean {
  if (Math.abs(a.s - b.s) > 0.1 || Math.abs(a.x - b.x) > TALK.reach) return false;
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
    if (!free(a, st.tick) || random(st) > TALK.chance) continue;
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
    pos *= TALK.friendlyPos;
    neg *= TALK.friendlyNeg;
  }
  const W = TALK.weights;
  const canFlirt = single(a) && single(b) && !la.exes?.includes(b.id) && la.flat !== b.life!.flat;
  return [
    ['chat', W.chat],
    ['deepTalk', W.deepTalk * pos * (op > 10 ? 1.5 : 0.5)],
    ['slight', W.slight * neg],
    ['insult', W.insult * neg * (op < -20 ? 2 : 1)],
    ['flirt', canFlirt ? W.flirt * Math.max(0, chem + 0.2) * (op >= 10 ? 1 : 0.2) : 0],
    ['gossip', gossipFor(sim, a, b) ? W.gossip * (has(la, 'busybody') ? TALK.busybodyGossip : 1) : 0],
    ['moan', la.liking < TALK.moanUnder ? W.moan * (has(la, 'complainer') ? TALK.complainerMoan : 1) : 0],
    ['favour', (has(la, 'handy') || friendly) && op > 0 ? W.favour : 0],
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
  // Timed in real seconds, so a talk reads the same whatever the clock does.
  const length = seconds(kind === 'deepTalk' ? 5 : 3);
  for (const p of [a, b]) {
    const until = st.tick + length;
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
      if (random(st) < TALK.row * temper) row(sim, a, b);
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
      const worst = a.life!.memories.filter((m) => MEMORIES[m.id]?.gossip && MEMORIES[m.id].value < 0 && (m.hops ?? 0) < GOSSIP.hops).sort((x, y) => MEMORIES[x.id].value - MEMORIES[y.id].value)[0];
      if (worst && !b.life!.memories.some((m) => m.id === worst.id)) b.life!.memories.push({ id: worst.id, at: st.tick, from: a.id, hops: (worst.hops ?? 0) + 1 });
      if (random(st) < TALK.moanPost && !recently(sim, 'Is it just me')) post(sim, a, 'Is it just me or is this building getting worse');
      return;
    }
    case 'favour':
      rememberAbout(sim, b, 'favour', a);
      if (has(a.life!, 'handy')) {
        b.doing = `${aName} is fixing something of theirs`;
        if (random(st) < TALK.favourNotice) sim.notify(`${aName} has fixed ${bName}'s wobbly shelf. Nobody asked them to.`);
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
    p.talkUntil = st.tick + seconds(7);
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
  const chance = ROMANCE.flirtBase + chemistry(sim, a.id, b.id) * ROMANCE.flirtChemistry + opinion(sim, b, a) / ROMANCE.flirtOpinionPer;
  if (random(st) > chance) {
    rememberAbout(sim, a, 'rebuffed', b);
    return;
  }
  rememberAbout(sim, a, 'flirt', b);
  rememberAbout(sim, b, 'flirt', a);
  if (opinion(sim, a, b) >= ROMANCE.coupleOpinion && opinion(sim, b, a) >= ROMANCE.coupleOpinion && random(st) < ROMANCE.couple) {
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
    if (Math.min(opinion(sim, a, b), opinion(sim, b, a)) - OPINION.partner >= 0 || random(st) > readFlags(sim, 'story.split', ROMANCE.splitPerHour, { pawn: a, other: b })) continue;
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
    return def?.gossip && (m.hops ?? 0) < GOSSIP.hops && now - m.at < (def.hours * TICKS_PER_HOUR) / 2 && !b.life!.memories.some((n) => n.id === m.id);
  });
}

function gossip(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  // Sometimes it's about rent: who pays what.
  if (random(st) < GOSSIP.aboutRent && compareRent(sim, a, b)) return;
  const item = gossipFor(sim, a, b);
  if (item) b.life!.memories.push({ id: item.id, at: st.tick, from: a.id, hops: (item.hops ?? 0) + 1, ...(item.note ? { note: item.note } : {}) });
  // Busybodies talk about the neighbours too.
  if (has(a.life!, 'busybody')) {
    const rival = tenants(sim).find((o) => o !== a && o !== b && opinion(sim, a, o) <= GOSSIP.busybodyRival);
    if (rival) rememberAbout(sim, b, 'heardThings', rival);
  }
}

/** If one pays noticeably more than the other for a flat no better, they find out. */
function compareRent(sim: Sim, a: Pawn, b: Pawn): boolean {
  const la = flatInfo(sim, a.life!.flat).lease;
  const lb = flatInfo(sim, b.life!.flat).lease;
  if (!la || !lb || a.life!.flat === b.life!.flat) return false;
  const [hi, lo, hiLease, loLease] = la.rent >= lb.rent ? [a, b, la, lb] : [b, a, lb, la];
  if (hiLease.rent < loLease.rent * GOSSIP.paysMore) return false;
  // Only a grievance if the dearer flat isn't better.
  if (goingRate(sim, hi.life!.flat) > goingRate(sim, lo.life!.flat)) return false;
  const name = sim.layout.flat(lo.life!.flat)?.name ?? 'next door';
  if (hi.life!.memories.some((m) => m.id === 'paysMore')) return false;
  hi.life!.memories.push({ id: 'paysMore', at: sim.state.tick, note: `Pays more than ${name} for no better` });
  return true;
}

// ------------------------------------------------------------------ requests

/**
 * Once an hour. Tenants used to ask here for a pet, the heating or a lick of paint, in the
 * chat. Those asks are drip cards now (cards/tenant.ts: pet, heating, paint), so decisions
 * arrive in one place and wait their turn in the day's budget. Your answer still goes in the
 * chat for everyone to see. Kept as the hook the sim calls, in case asks come back here.
 */
export function requestsHour(_sim: Sim): void {}

/** Someone's moving out: their friends will miss them. */
export function friendsLeaving(sim: Sim, leaving: Pawn[]): void {
  for (const p of tenants(sim)) {
    if (leaving.includes(p)) continue;
    for (const l of leaving) if (opinion(sim, p, l) >= OPINION.friend) remember(sim, p.life!, 'friendLeft');
  }
}
