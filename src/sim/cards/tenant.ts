// Tenant cards (spec 1.4, source T): asks and moments that come from the people in the
// building, their traits, needs, liking, who likes whom. About 45% of cards. Includes the
// three old chat requests (pet, heating, paint), which move here from `requestsHour`.
//
// STUB from chunk 0: chunk 2a fills in the catalogue. Each card is a CardDef (types.ts);
// every one must pass the consequence rule (rule.ts, test/cards.rule.test.ts).

import type { CardDef } from './types';

export const TENANT_CARDS: CardDef[] = [];
