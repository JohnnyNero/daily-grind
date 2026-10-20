// The whole catalogue, gathered from its files (one per source, so parallel work doesn't
// collide). The drip and the rule test read it from here.
//
// Gathered lazily, on first use: the card files import the sim (for their fixtures), and the
// sim imports the drip, which imports this. If a card file is loaded first, this file runs
// before that card file's array exists, so nothing here may touch the arrays at load time.

import { BUILDING_CARDS } from './building';
import { FIRST_WEEK_CARDS } from './firstWeek';
import { STREET_CARDS } from './street';
import { TENANT_CARDS } from './tenant';
import type { CardDef } from './types';

export { FIRST_WEEK_SCRIPT } from './firstWeek';

let all: CardDef[] | null = null;
let byId: Map<string, CardDef> | null = null;

/** Every card, in file order. */
export function allCards(): readonly CardDef[] {
  return (all ??= [...TENANT_CARDS, ...BUILDING_CARDS, ...STREET_CARDS, ...FIRST_WEEK_CARDS]);
}

/** The catalogue as an array, gathered the first time anything reads it. */
export const ALL_CARDS: readonly CardDef[] = new Proxy([] as CardDef[], {
  get: (_t, k) => {
    const a = allCards();
    const v = Reflect.get(a, k);
    return typeof v === 'function' ? v.bind(a) : v;
  },
  has: (_t, k) => Reflect.has(allCards(), k),
  ownKeys: () => Reflect.ownKeys(allCards()),
  getOwnPropertyDescriptor: (_t, k) => Reflect.getOwnPropertyDescriptor(allCards(), k),
});

export function cardDef(id: string): CardDef | undefined {
  byId ??= new Map(allCards().map((c) => [c.id, c]));
  return byId.get(id);
}
