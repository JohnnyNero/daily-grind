// What a change would do, said while you're making it: up to three short facts about the
// flats it touches ("Flat 3: one-bed → two-bed", "Going rates +£45 a week", "Flat 3: box
// room, too small for a bedroom"). Facts, never advice; how people will take it shows once
// they live there. Worked out on a throwaway copy of the building, nothing saved.

import { POUND, rateFor } from './economy';
import { rentScore } from './impressiveness';
import { flatKind, type FlatKind } from './rooms';
import { Sim } from './sim';
import type { CellKind, Furniture } from './state';
import { pipeCost } from './risers';

export interface Fact {
  text: string;
  /** Up (more rent, a room gained), down (a room lost), or neither. */
  tone?: 'up' | 'down';
}

/** The building as it would be: other cells, other furniture, or both. */
export interface Change {
  cells?: Record<string, CellKind>;
  furniture?: Furniture[];
}

interface Seen {
  name: string;
  kind: FlatKind;
  rate: number;
}

function look(sim: Sim, change: Change): Map<string, Seen> {
  const copy = new Sim({ ...sim.state, cells: change.cells ?? sim.state.cells, furniture: change.furniture ?? sim.state.furniture });
  const out = new Map<string, Seen>();
  for (const f of copy.layout.flats) {
    const kind = flatKind(copy, f.id);
    // The going rate as the flat stands (not waiting out the days a tier takes to drop).
    const rate = rateFor(kind.type, rentScore(copy, f.id).tier);
    out.set(f.id, { name: f.name, kind, rate });
  }
  return out;
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
  const sum = (m: Map<string, Seen>) => [...m.values()].reduce((n, s) => n + s.rate, 0);
  const delta = sum(b) - sum(a);
  const rent: Fact[] = delta === 0 ? [] : [{ text: `Going rates ${delta > 0 ? '+' : '−'}£${Math.abs(delta) / POUND} a week`, tone: delta > 0 ? 'up' : 'down' }];
  // Something that needs the water going in (or moving) far from a riser (risers.ts).
  const was = new Map((before.furniture ?? sim.state.furniture).map((f) => [f.id, f]));
  const far = (after.furniture ?? []).some((f) => {
    const old = was.get(f.id);
    return (!old || old.x !== f.x || old.s !== f.s) && pipeCost(sim.state, f.def, f.x) > 0;
  });
  const pipes: Fact[] = far ? [{ text: 'Far from the pipes: dearer to fit', tone: 'down' }] : [];
  // The money first if there's room, then what changed.
  return [...rent, ...pipes, ...facts].slice(0, 3);
}
