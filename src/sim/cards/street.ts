// Street cards (spec 1.4, source S): visitors at the door, vans, the cat, next door, kids.
// At most 25% of cards, and every one still needs a reason to be here.
//
// STUB from chunk 0: chunk 2c fills in the catalogue. Each card is a CardDef (types.ts);
// every one must pass the consequence rule (rule.ts, test/cards.rule.test.ts).

import type { CardDef } from './types';

export const STREET_CARDS: CardDef[] = [];
