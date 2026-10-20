// What a change would do, said while you're making it: up to three short facts about the
// flats it touches ("Flat 3: one-bed → two-bed", "Going rates +£45 a week", "Flat 3: box
// room, too small for a bedroom"). Facts, never advice; how people will take it shows once
// they live there. Worked out on a throwaway copy of the building, nothing saved. A
// bedroom's noise is how open it is to its neighbours as built, not who's in.

import { bedroomExposure } from './acoustics';
import { POUND, rateFor } from './economy';
import { rentScore } from './impressiveness';
import { flatKind, type FlatKind } from './rooms';
import { Sim } from './sim';
import type { CellKind, Furniture } from './state';
import { ACOUSTICS, PREVIEW } from './tuning';
import { settledTemps } from './heat';
import { settledDamp } from './damp';

export interface Fact {
  text: string;
  /** Up (more rent, a room gained), down (a room lost), or neither. */
  tone?: 'up' | 'down';
}

/** The building as it would be: other cells, other furniture, or both. */
export interface Change {
  cells?: Record<string, CellKind>;
  furniture?: Furniture[];
  insulated?: Record<string, true>;
}

interface Seen {
  name: string;
  kind: FlatKind;
  rate: number;
  /** How much noise its loudest bedroom is open to, as built (acoustics.ts). */
  loud: number;
  /** Layout L3: each room's settled warmth and damp, by room name ("Bedroom"). */
  rooms: Map<string, { temp: number; damp: number; living: boolean }>;
}

function look(sim: Sim, change: Change): Map<string, Seen> {
  const copy = new Sim({ ...sim.state, cells: change.cells ?? sim.state.cells, furniture: change.furniture ?? sim.state.furniture, insulated: change.insulated ?? sim.state.insulated });
  const temps = settledTemps(copy);
  const damp = settledDamp(copy);
  const out = new Map<string, Seen>();
  for (const f of copy.layout.flats) {
    const kind = flatKind(copy, f.id);
    // The going rate as the flat stands (not waiting out the days a tier takes to drop).
    const rate = rateFor(kind.type, rentScore(copy, f.id).tier);
    const rooms = new Map<string, { temp: number; damp: number; living: boolean }>();
    for (const r of kind.rooms) {
      if (rooms.has(r.name)) continue;
      rooms.set(r.name, { temp: temps.get(r.room) ?? 0, damp: damp.get(r.room) ?? 0, living: r.uses.includes('sleep') || r.uses.includes('sit') });
    }
    out.set(f.id, { name: f.name, kind, rate, rooms, loud: bedroomExposure(copy, f.id) });
  }
  return out;
}

/** Layout L3: the room that got most colder or warmer, and most damper or drier. */
function climateFacts(a: Map<string, Seen>, b: Map<string, Seen>): Fact[] {
  let heat: { fact: Fact; by: number } | null = null;
  let wet: { fact: Fact; by: number } | null = null;
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was) continue;
    for (const [name, r] of now.rooms) {
      const o = was.rooms.get(name);
      if (!o) continue;
      const room = `${now.name} ${lower(name)}`;
      const dt = r.temp - o.temp;
      if (r.living && Math.abs(dt) >= PREVIEW.warmer && (!heat || Math.abs(dt) > heat.by)) heat = { by: Math.abs(dt), fact: { text: `${room}: ${dt > 0 ? 'warmer' : 'colder'}`, tone: dt > 0 ? 'up' : 'down' } };
      const dd = r.damp - o.damp;
      if (Math.abs(dd) >= PREVIEW.damper && (!wet || Math.abs(dd) > wet.by)) wet = { by: Math.abs(dd), fact: { text: `${room}: ${dd > 0 ? 'damper' : 'drier'}`, tone: dd > 0 ? 'down' : 'up' } };
    }
  }
  return [heat?.fact, wet?.fact].filter((f): f is Fact => !!f);
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Up to three facts about going from one version of the building to another. */
export function changeFacts(sim: Sim, before: Change, after: Change): Fact[] {
  const a = look(sim, before);
  const b = look(sim, after);
  const facts: Fact[] = [];
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was) {
      facts.push({ text: `A new flat: ${lower(now.kind.name)}`, tone: 'up' });
      continue;
    }
    if (was.kind.type !== now.kind.type) facts.push({ text: `${now.name}: ${lower(was.kind.name)} → ${lower(now.kind.name)}`, tone: now.kind.bedrooms > was.kind.bedrooms ? 'up' : now.kind.bedrooms < was.kind.bedrooms ? 'down' : undefined });
    const boxes = (k: FlatKind) => k.rooms.filter((r) => r.name === 'Box room').length;
    if (boxes(now.kind) > boxes(was.kind)) facts.push({ text: `${now.name}: box room, too small for a bedroom`, tone: 'down' });
    if (was.kind.sitting && !now.kind.sitting) facts.push({ text: `${now.name}: nowhere to sit but the bed`, tone: 'down' });
    if (!was.kind.sitting && now.kind.sitting && now.kind.sleeps > 0) facts.push({ text: `${now.name}: somewhere to sit`, tone: 'up' });
  }
  for (const [id, was] of a) if (!b.has(id)) facts.push({ text: `${was.name} goes`, tone: 'down' });
  // A bedroom by the stairs or a telly, or a bathroom put between: louder or quieter.
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was || was.loud === 0 || now.loud === 0) continue;
    const change = now.loud - was.loud;
    if (Math.abs(change) < ACOUSTICS.previewChange * Math.max(was.loud, now.loud)) continue;
    facts.push({ text: `${now.name} bedroom: ${change > 0 ? 'louder' : 'quieter'}`, tone: change > 0 ? 'down' : 'up' });
  }
  const sum = (m: Map<string, Seen>) => [...m.values()].reduce((n, s) => n + s.rate, 0);
  const delta = sum(b) - sum(a);
  const rent: Fact[] = delta === 0 ? [] : [{ text: `Going rates ${delta > 0 ? '+' : '−'}£${Math.abs(delta) / POUND} a week`, tone: delta > 0 ? 'up' : 'down' }];
  // The money first if there's room, then what changed.
  return [...rent, ...facts, ...climateFacts(a, b)].slice(0, 3);
}
