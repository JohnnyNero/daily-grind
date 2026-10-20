// The first week (spec 3): the scripted cards only the handover's week brings (Bill's
// shopping, the cleaner's card, the bins question, the window cleaner, a few people round),
// and the script that times them, 2 to 3 a day. Beats can also name cards from the other
// files (the applicant at the door, the parcel, the leak...). The drip (chunk 1) plays the
// script in days 1 to 7 instead of the daily budget, unless the handover was skipped.
//
// STUB from chunk 0: chunk 7 fills these in. Scripted cards obey the consequence rule too.

import type { CardDef, ScriptBeat } from './types';

/** Cards only the first week brings (all `followUp: true`, so the ordinary drip never draws them). */
export const FIRST_WEEK_CARDS: CardDef[] = [];

/** When each scripted card is due. A beat whose card's `when` is false when it's due is skipped. */
export const FIRST_WEEK_SCRIPT: ScriptBeat[] = [];
