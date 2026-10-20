// Building cards (spec 1.4, source B): wear and broken things, dirt, the bins, warmth, noise,
// empty flats. About 30% of cards.
//
// STUB from chunk 0: chunk 2b fills in the catalogue. Each card is a CardDef (types.ts);
// every one must pass the consequence rule (rule.ts, test/cards.rule.test.ts).

import type { CardDef } from './types';

export const BUILDING_CARDS: CardDef[] = [];
