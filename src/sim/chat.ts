// The building group chat. Tenants post when something happens (a row on the stairs, a
// party, the bins), moan about you, and ask for things. Some posts are requests you can
// answer, and how you answer is seen by everyone.

import { POUND, book } from './economy';
import { household } from './leases';
import { pick, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, type ChatMessage, type Pawn } from './state';
import { remember } from './thoughts';
import { has } from './traits';

const MAX_MESSAGES = 150;

export function whoIs(sim: Sim, p: Pawn): string {
  const flat = p.life ? sim.layout.flat(p.life.flat)?.name : null;
  return `${p.name.split(' ')[0]}${flat ? ` · ${flat}` : ''}`;
}

export function post(sim: Sim, from: Pawn | null, text: string, choices?: ChatMessage['choices']): ChatMessage {
  const st = sim.state;
  const m: ChatMessage = { id: st.nextId++, tick: st.tick, from: from?.id ?? 0, who: from ? whoIs(sim, from) : 'You', text, ...(choices ? { choices } : {}) };
  st.chat.push(m);
  if (st.chat.length > MAX_MESSAGES) st.chat.splice(0, st.chat.length - MAX_MESSAGES);
  return m;
}

/** Has anyone posted something starting like this lately? (So the chat doesn't repeat itself.) */
export function recently(sim: Sim, start: string, days = 1): boolean {
  const since = sim.state.tick - days * TICKS_PER_DAY;
  return sim.state.chat.some((m) => m.tick >= since && m.text.startsWith(start));
}

/** Everyone in the building, on the map or not. */
export function tenants(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.life && !p.life.leaving);
}

/** A tenant who'd post about something: busybodies and complainers first. */
export function poster(sim: Sim, among: Pawn[] = tenants(sim)): Pawn | null {
  if (among.length === 0) return null;
  const keen = among.filter((p) => has(p.life!, 'busybody') || has(p.life!, 'complainer'));
  return pick(sim.state, keen.length > 0 && random(sim.state) < 0.7 ? keen : among);
}

/** You answer a request in the chat. */
export function answer(sim: Sim, messageId: number, index: number): void {
  const m = sim.state.chat.find((x) => x.id === messageId);
  if (!m?.choices || m.chosen !== undefined || !m.choices[index]) return;
  m.chosen = index;
  const c = m.choices[index];
  post(sim, null, c.label);
  act(sim, c.act, m.from);
}

/** Every morning: requests left unanswered for two days count as a no. */
export function chatMorning(sim: Sim): void {
  for (const m of sim.state.chat) {
    if (m.choices && m.chosen === undefined && sim.state.tick - m.tick > 2 * TICKS_PER_DAY) {
      m.chosen = m.choices.length - 1;
      m.ignored = true;
      act(sim, m.choices[m.chosen].act, m.from);
      const p = sim.state.pawns.find((x) => x.id === m.from);
      if (p?.life) remember(sim, p.life, 'ignored');
    }
  }
}

function act(sim: Sim, text: string, fromId: number): void {
  const st = sim.state;
  const p = st.pawns.find((x) => x.id === fromId);
  const [kind, arg] = text.split(':');
  const everyone = tenants(sim);
  switch (kind) {
    case 'pet':
      if (p?.life) {
        p.life.pet = arg;
        remember(sim, p.life, 'gotPet');
      }
      return;
    case 'noPet':
      if (p?.life) remember(sim, p.life, 'noPet');
      return;
    case 'boilerUp':
      st.boiler = Math.min(3, st.boiler + 1);
      for (const t of everyone) remember(sim, t.life!, 'landlordListened');
      return;
    case 'jumper':
      for (const t of everyone) remember(sim, t.life!, 'wearAJumper');
      return;
    case 'word': {
      // Have a word with the noisy flat.
      for (const t of household(sim, arg)) remember(sim, t.life!, 'toldOff');
      if (p?.life) remember(sim, p.life, 'landlordListened');
      return;
    }
    case 'notMine':
      if (p?.life) remember(sim, p.life, 'landlordShrugged');
      return;
    case 'radiator':
      if (st.money >= 120 * POUND && p?.life) {
        book(sim, 'Engineer: bled the radiators', -120 * POUND);
        for (const t of household(sim, p.life.flat)) remember(sim, t.life!, 'landlordListened');
      }
      return;
    case 'paint':
      if (p?.life) remember(sim, p.life, 'landlordListened');
      return;
    case 'noPaint':
      if (p?.life) remember(sim, p.life, 'landlordShrugged');
      return;
  }
}
