// Personality traits. Every tenant has two or three. Traits do nothing on their own: other
// systems ask about them (how fast needs drop, which thoughts count double, what someone
// does when they're fed up). Most cut both ways, so nobody is the perfect tenant.
//
// Some traits only come into play with later systems (noise, mess, neighbours, damage);
// they're generated now so tenants have them from the start.

import { pick, random, type RngHolder } from './rng';

export interface TraitDef {
  id: string;
  name: string;
  /** What it means, for the info panel. */
  says: string;
  /** What a reference says, hinting at it without naming it. */
  hint: string;
  /** How much it raises the lines where they kick off (positive) or lowers them. */
  touchy: number;
  conflicts?: string[];
  /** How common it is. */
  weight: number;
}

export const TRAITS: readonly TraitDef[] = [
  { id: 'handy', name: 'Handy', says: 'Fixes small things, sometimes other people\'s. Also puts up shelves you never agreed to.', hint: 'Re-tiled our bathroom. We hadn\'t asked.', touchy: 0, weight: 3 },
  { id: 'houseProud', name: 'House-proud', says: 'Looks after the flat, and notices everything about it, good and bad.', hint: 'Left it cleaner than we let it.', touchy: 3, conflicts: ['messy'], weight: 3 },
  { id: 'messy', name: 'Messy', says: 'Lives in a tip. Doesn\'t mind a tip.', hint: 'We kept the deposit. You\'ll see why.', touchy: -2, conflicts: ['houseProud'], weight: 3 },
  { id: 'clumsy', name: 'Clumsy', says: 'Breaks things. Always sorry.', hint: 'Lovely tenant. Bought us a new kettle. Twice.', touchy: 0, weight: 2 },
  { id: 'friendly', name: 'Friendly', says: 'Talks to everyone on the stairs. Makes friends fast.', hint: 'Knew the whole street within a week.', touchy: -2, weight: 4 },
  { id: 'busybody', name: 'Busybody', says: 'Knows everyone\'s business, and shares it.', hint: 'Very aware of the other tenants.', touchy: 2, weight: 3 },
  { id: 'complainer', name: 'Complainer', says: 'Puts every grievance in writing.', hint: 'They\'ll tell you exactly what they think. In writing.', touchy: 8, conflicts: ['easyGoing'], weight: 3 },
  { id: 'partyAnimal', name: 'Party animal', says: 'Likes a good time, and throws parties.', hint: 'Popular. Very popular. On Fridays especially.', touchy: 0, conflicts: ['lightSleeper'], weight: 3 },
  { id: 'nightOwl', name: 'Night owl', says: 'Up late, up late. Quiet in the mornings.', hint: 'Never saw them before noon.', touchy: 0, weight: 3 },
  { id: 'lightSleeper', name: 'Light sleeper', says: 'Wakes at the slightest noise.', hint: 'Asked us about double glazing at the viewing.', touchy: 4, conflicts: ['partyAnimal'], weight: 3 },
  { id: 'musician', name: 'Musician', says: 'Practises. At home. Most evenings.', hint: 'Very talented. You could hear it from the car park.', touchy: 0, weight: 2 },
  { id: 'petOwner', name: 'Pet owner', says: 'Comes with a pet. The pet comes with opinions.', hint: 'Asked if the lease mentions cats. Specifically cats.', touchy: 0, weight: 2 },
  { id: 'keenCook', name: 'Keen cook', says: 'A proper meal means a lot. The smells travel.', hint: 'The kitchen was the first thing they looked at.', touchy: 0, weight: 3 },
  { id: 'paysEarly', name: 'Always pays early', says: 'Rent arrives before it\'s due. Almost never late.', hint: 'Paid three months up front. Unprompted.', touchy: -2, conflicts: ['haggler'], weight: 3 },
  { id: 'haggler', name: 'Haggler', says: 'Pushes back on every rent rise, and asks for money off.', hint: 'Asked whether the rent was a starting point.', touchy: 3, conflicts: ['paysEarly'], weight: 3 },
  { id: 'knowsRights', name: 'Knows their rights', says: 'Knows the tenancy law better than you, and isn\'t shy about it.', hint: 'Knew the tenancy agreement better than I did.', touchy: 2, weight: 2 },
  { id: 'easyGoing', name: 'Easy-going', says: 'Forgives a lot. Takes a lot to rile.', hint: 'Never complained once. Not even about the boiler.', touchy: -10, conflicts: ['complainer'], weight: 3 },
];

const byId = new Map(TRAITS.map((t) => [t.id, t]));

export function traitDef(id: string): TraitDef {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown trait ${id}`);
  return t;
}

export function has(life: { traits: string[] }, id: string): boolean {
  return life.traits.includes(id);
}

/** Most a tenant's traits can add to how touchy they are, so nobody is miserable by design. */
const MAX_TOUCHY = 10;

/** Two or three traits that don't clash and don't add up to someone who's never happy. */
export function rollTraits(rng: RngHolder): string[] {
  const count = random(rng) < 0.5 ? 2 : 3;
  const out: string[] = [];
  for (let tries = 0; out.length < count && tries < 50; tries++) {
    const total = TRAITS.reduce((n, t) => n + t.weight, 0);
    let r = random(rng) * total;
    const t = TRAITS.find((d) => (r -= d.weight) < 0) ?? TRAITS[0];
    if (out.includes(t.id)) continue;
    if (out.some((o) => t.conflicts?.includes(o) || traitDef(o).conflicts?.includes(t.id))) continue;
    if (out.reduce((n, o) => n + traitDef(o).touchy, t.touchy) > MAX_TOUCHY) continue;
    out.push(t.id);
  }
  return out;
}

/** How much higher than usual their unhappiness lines sit. */
export function touchiness(life: { traits: string[] }): number {
  return life.traits.reduce((n, t) => n + (byId.get(t)?.touchy ?? 0), 0);
}

/** Reveals a trait, if it isn't known already. Returns true if it was news. */
export function reveal(life: { traits: string[]; revealed: string[] }, id: string): boolean {
  if (!life.traits.includes(id) || life.revealed.includes(id)) return false;
  life.revealed.push(id);
  return true;
}

export function pickTrait(rng: RngHolder, ids: readonly string[]): string {
  return pick(rng, ids);
}
