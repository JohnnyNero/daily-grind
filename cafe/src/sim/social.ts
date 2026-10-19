// Staff interactions. Nearby colleagues chat, banter, vent, compliment, insult and flirt.
// Who does what depends on opinion, mood and traits; each interaction leaves memories,
// and opinion is the sum of those memories, so grudges and friendships emerge and fade.

import { random, pick } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type Pawn } from './state';
import { addMemory, hasTrait } from './thoughts';

/** Chance per minute that an on-site staff member starts an interaction with someone nearby. */
const BASE_CHANCE = 0.06;
const RANGE = 4;
const ROMANCE_TO_COUPLE = 3;

const ROW_TOPICS = [
  'the rota', 'who left the milk out', "whose turn it is on dishes", 'the music', 'the last brownie',
  'who broke the steam wand', 'oat milk', 'the thermostat', 'how to load the dishwasher',
] as const;

type InteractionKind = 'chat' | 'banter' | 'vent' | 'compliment' | 'insult' | 'flirt';

function available(p: Pawn): boolean {
  if (!p.onMap || !p.staff || p.staff.quit || p.job?.label === 'Asleep') return false;
  const b = p.staff.mentalBreak?.kind;
  return b !== 'walkout' && b !== 'quit' && b !== 'cry';
}

export function socialEveryMinute(sim: Sim): void {
  const s = sim.state;
  const staff = s.pawns.filter(available);
  for (const actor of staff) {
    let chance = BASE_CHANCE;
    if (hasTrait(actor, 'chatty')) chance *= 2;
    if (hasTrait(actor, 'introvert')) chance *= 0.5;
    if (actor.staff!.mentalBreak?.kind === 'snappy') chance *= 3;
    if (random(s) >= chance) continue;
    const near = staff.filter((o) => o.id !== actor.id && Math.hypot(o.x - actor.x, o.y - actor.y) <= RANGE);
    if (near.length === 0) continue;
    const target = pick(s, near);
    interact(sim, actor, target, chooseKind(sim, actor, target));
  }
}

function chooseKind(sim: Sim, a: Pawn, b: Pawn): InteractionKind {
  const s = sim.state;
  if (a.staff!.mentalBreak?.kind === 'snappy') return 'insult';
  const op = sim.opinion(a, b);
  const mood = a.staff!.mood;
  const rel = sim.relation(a.id, b.id);
  const weights: [InteractionKind, number][] = [
    ['chat', 1],
    ['banter', op > 10 ? 0.6 : 0.1],
    ['vent', mood < 35 ? 0.5 : 0],
    ['compliment', (op > 20 ? 0.3 : 0.05) * (hasTrait(a, 'peoplePerson') ? 2 : 1)],
    ['insult', (0.03 + (op < -10 ? 0.4 : 0) + (mood < 30 ? 0.3 : 0)) * (hasTrait(a, 'hotHeaded') ? 2 : 1) * (hasTrait(a, 'calm') ? 0.5 : 1)],
    ['flirt', rel.together ? 0.3 : (op > 15 ? 0.08 : 0.01) * (hasTrait(a, 'flirt') ? 4 : 1)],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let r = random(s) * total;
  for (const [kind, w] of weights) {
    r -= w;
    if (r <= 0) return kind;
  }
  return 'chat';
}

function interact(sim: Sim, a: Pawn, b: Pawn, kind: InteractionKind): void {
  const s = sim.state;
  switch (kind) {
    case 'chat':
      addMemory(sim, a, 'niceChat', b);
      addMemory(sim, b, 'niceChat', a);
      sayCatchphrase(sim, a);
      return;
    case 'banter':
      addMemory(sim, a, 'banter', b);
      addMemory(sim, b, 'banter', a);
      sayCatchphrase(sim, a, 0.3);
      return;
    case 'vent':
      addMemory(sim, a, 'gotItOffChest');
      addMemory(sim, b, 'ventedTo', a);
      return;
    case 'compliment':
      addMemory(sim, b, 'complimented', a);
      return;
    case 'insult': {
      addMemory(sim, b, 'insulted', a);
      const grudge = sim.opinion(b, a) < -15;
      const rowChance = (grudge ? 0.35 : 0.08) * (hasTrait(b, 'hotHeaded') ? 2 : 1) * (hasTrait(b, 'calm') ? 0.3 : 1);
      if (random(s) < rowChance) row(sim, a, b);
      return;
    }
    case 'flirt':
      flirt(sim, a, b);
      return;
  }
}

/** Now and then someone comes out with one of their lines (set in the character editor). */
export function sayCatchphrase(sim: Sim, p: Pawn, chance = 0.12): void {
  const lines = p.staff?.catchphrases ?? [];
  if (lines.length === 0 || random(sim.state) >= chance) return;
  sim.log(`${p.name}: "${pick(sim.state, lines)}"`, 'neutral', p.id, null, 0);
}

/** A full-blown row. Both stop working briefly; customers nearby get uncomfortable. */
function row(sim: Sim, a: Pawn, b: Pawn): void {
  const s = sim.state;
  const topic = pick(s, ROW_TOPICS);
  addMemory(sim, a, 'row', b);
  addMemory(sim, b, 'row', a);
  for (const p of [a, b]) {
    sim.endJob(p);
    p.job = sim.makeJob(`Having a row about ${topic}`, [{ kind: 'wait', ticksLeft: Math.round(1.5 * TICKS_PER_MINUTE) }]);
  }
  for (const g of s.pawns) {
    if (g.visit && Math.hypot(g.x - a.x, g.y - a.y) < 6) g.visit.patience = Math.max(0, g.visit.patience - 0.1);
  }
  witness(sim, a, 'witnessedRow', [a, b]);
  sayCatchphrase(sim, b, 0.5);
  sim.log(`${a.name} and ${b.name} had a row about ${topic}.`, 'bad', a.id, 'row', 5);
  // A couple who row enough stop being a couple.
  const rel = sim.relation(a.id, b.id);
  if (rel.together && (sim.opinion(a, b) < 0 || sim.opinion(b, a) < 0)) breakUp(sim, a, b);
}

/** Colleagues close enough to see something ugly carry a little of it with them. */
export function witness(sim: Sim, at: Pawn, memory: string, involved: Pawn[]): void {
  for (const o of sim.state.pawns) {
    if (!o.staff || !o.onMap || involved.includes(o) || o.staff.quit) continue;
    if (Math.hypot(o.x - at.x, o.y - at.y) <= 6) addMemory(sim, o, memory);
  }
}

function breakUp(sim: Sim, a: Pawn, b: Pawn): void {
  const rel = sim.relation(a.id, b.id);
  rel.together = false;
  rel.exes = true;
  rel.romance = 0;
  addMemory(sim, a, 'brokeUp', b);
  addMemory(sim, b, 'brokeUp', a);
  sim.log(`${a.name} and ${b.name} have split up. Shifts together are going to be fun.`, 'bad', a.id, 'breakup', 8);
}

function flirt(sim: Sim, a: Pawn, b: Pawn): void {
  const s = sim.state;
  const rel = sim.relation(a.id, b.id);
  const bPartner = sim.partnerOf(b);
  const aPartner = sim.partnerOf(a);
  const keen = rel.together || (sim.compatibility(a.id, b.id) > 0.2 && sim.opinion(b, a) > 15 && !bPartner);
  if (!keen) {
    addMemory(sim, a, 'rebuffed', b);
    addMemory(sim, b, 'triedItOn', a);
    if (random(s) < 0.5) sim.log(`${a.name} tried a line on ${b.name}. It did not land.`, 'neutral', a.id, 'flirtFail', 3);
  } else {
    addMemory(sim, a, 'flirted', b);
    addMemory(sim, b, 'flirted', a);
    if (!rel.together) {
      rel.romance++;
      if (rel.romance >= ROMANCE_TO_COUPLE && sim.opinion(a, b) > 30 && sim.opinion(b, a) > 30 && !aPartner) {
        rel.together = true;
        sim.log(`Rumour has it ${a.name} and ${b.name} are seeing each other.`, 'good', a.id, 'couple', 9);
      }
    }
  }
  // Partners notice.
  for (const partner of [aPartner, bPartner]) {
    if (!partner || partner.id === a.id || partner.id === b.id || !partner.onMap) continue;
    if (Math.hypot(partner.x - a.x, partner.y - a.y) > RANGE + 2) continue;
    addMemory(sim, partner, 'flirtedWithPartner', partner === aPartner ? b : a);
    sim.log(`${partner.name} saw ${a.name} flirting with ${b.name}. Oh dear.`, 'bad', partner.id, 'jealousy', 7);
    // Caught once too often, and that's it.
    const other = partner === aPartner ? a : b;
    if (sim.opinion(partner, other) < -10) breakUp(sim, partner, other);
  }
}

/** A couple on shift together sometimes sneak off for a moment, which nobody covers. */
export function canoodle(sim: Sim): void {
  const s = sim.state;
  for (const a of s.pawns) {
    if (!available(a) || a.staff!.mentalBreak) continue;
    const b = sim.partnerOf(a);
    if (!b || b.id < a.id || !available(b) || b.staff!.mentalBreak) continue;
    if (random(s) >= 0.004) continue;
    for (const p of [a, b]) {
      sim.endJob(p);
      p.job = sim.makeJob(`Sneaking a moment with ${p === a ? b.name : a.name}`, [{ kind: 'wait', ticksLeft: 3 * TICKS_PER_MINUTE }]);
    }
    if (random(s) < 0.5) sim.log(`${a.name} and ${b.name} have both vanished from the floor. Again.`, 'neutral', a.id, 'canoodle', 3);
  }
}
