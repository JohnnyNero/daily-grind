// The whole catalogue, gathered from its files (one per source, so parallel work doesn't
// collide). The drip and the rule test read it from here.

import { BUILDING_CARDS } from './building';
import { FIRST_WEEK_CARDS } from './firstWeek';
import { STREET_CARDS } from './street';
import { TENANT_CARDS } from './tenant';
import type { CardDef } from './types';

export { FIRST_WEEK_SCRIPT } from './firstWeek';

export const ALL_CARDS: readonly CardDef[] = [...TENANT_CARDS, ...BUILDING_CARDS, ...STREET_CARDS, ...FIRST_WEEK_CARDS];

const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function cardDef(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
