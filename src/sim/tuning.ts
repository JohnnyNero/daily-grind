// All the numbers to balance the game with, in one place, so balancing never means touching
// the systems. Grouped by system; each says what it means in plain words. Money is in pence.
//
// This file imports nothing (not even types from the other sim modules), so it's always safe
// to import from anywhere: a number worked out here at load time can't come out as NaN
// because some other module hadn't loaded yet.
//
// Content stays where it is: furniture in defs.ts, traits in traits.ts, words and templates
// next to the code that uses them. Where a table is really labels and numbers together (the
// memories), it lives here whole, as splitting it would make it harder to read.

// ================================================================== economy

export const POUND = 100;

export const START_MONEY = 1500 * POUND;
export const MORTGAGE = { balance: 30000 * POUND, payment: 250 * POUND, rate: 0.04 };
/** Payments missed in a row before the bank takes the building. */
export const MISSES_ALLOWED = 4;

/** Weekly going rate for a flat in each tier. */
export const TIER_RENT: Record<string, number> = {
  Grim: 60 * POUND,
  Shabby: 85 * POUND,
  Plain: 110 * POUND,
  Decent: 140 * POUND,
  Nice: 175 * POUND,
  Smart: 215 * POUND,
  Impressive: 260 * POUND,
};

/** Days below a tier before a flat's going rate drops to the one below. */
export const TIER_GRACE_DAYS = 3;

/** The building's own weekly bills. */
export const BILLS = { insurance: 25 * POUND, lighting: 8 * POUND, bins: 8 * POUND, emptyFlatTax: 20 * POUND };
/** Charged on a Monday that finds you overdrawn. */
export const OVERDRAFT_CHARGE = 10 * POUND;
/** The cleaner for the stairs and lobby, a week. */
export const CLEANER_WEEKLY = 30 * POUND;
/** Weekly gas for the central boiler, per radiator, per boiler setting. */
export const GAS_PER_RADIATOR = 3 * POUND;

/** Weeks of rent taken as a deposit, and how long a fixed lease runs. */
export const DEPOSIT_WEEKS = 4;
export const LEASE_WEEKS = 6;
/** Days' notice for a rent change, and before someone moves out. */
export const RENT_NOTICE_DAYS = 7;
export const MOVE_OUT_NOTICE_DAYS = 7;
/** Days' notice you give for arrears, and the weeks of rent they must owe first. */
export const EVICTION_NOTICE_DAYS = 14;
export const EVICTION_ARREARS_WEEKS = 2;

/** What each cell costs to put in. */
export const CELL_PRICES = {
  wall: 25 * POUND,
  window: 120 * POUND,
  door: 120 * POUND,
  flatDoor: 250 * POUND,
  entrance: 400 * POUND,
  stair: 200 * POUND,
};
export const DEMOLISH_PRICE = 10 * POUND;
export const INSULATE_PRICE = 40 * POUND;
/** Furniture costs this many pounds per point of its value, and never less than the least. */
export const FURNITURE_POUNDS_PER_VALUE = 8;
export const FURNITURE_LEAST_POUNDS = 30;
/** What you get back for furniture you take out. */
export const RESALE = 0.3;

/** Security: new locks on the street door and ground-floor windows, and an alarm (fitted, then monitored weekly). */
export const LOCKS_PRICE = 180 * POUND;
export const ALARM_PRICE = 350 * POUND;
export const ALARM_WEEKLY = 4 * POUND;
/** Fine for an improvement notice not done in time, per problem, and the most for one visit. */
export const COUNCIL_FINE = 150 * POUND;
export const COUNCIL_FINE_CAP = 450 * POUND;
export const PLANNING_FEE = 250 * POUND;
/** What Denise will advance against a deposit if you're short in the first week. */
export const HANDOVER_ADVANCE = 300 * POUND;

// ================================================================== letting flats

export const LETTING = {
  /** Most applicants waiting for one flat at a time, and days each waits for an answer. */
  maxWaiting: 3,
  applicantDays: 2,
  /** Average hours between applicants for a fairly priced flat; dearer ones go by the price ratio cubed. */
  meanHours: 14,
  fewestHours: 3,
  mostHours: 120,
  /** A flat without the basics draws people this many times more slowly. */
  unliveableSlower: 4,
  /** Nobody applies once the asking is this many times the going rate (less for each grade of expectations). */
  tooDear: 1.6,
  tooDearPerGrade: 0.05,
  /** Hours before the next applicant anywhere after someone moves in (word gets round). */
  afterMoveInHours: 18,
  /** Hours before the first applicant for a flat that's just come back on the market, or just been seen. */
  relistHours: 4,
  firstLookHours: 6,
  /** Reviews counted in your rating, and how it speeds applicants: pace = base - perStar × stars. */
  reviewsCounted: 8,
  ratingPaceBase: 1.45,
  ratingPacePerStar: 0.15,
  /** Households: chance of one person, else chance of two (else three). One person per five tiles, up to three. */
  single: 0.55,
  couple: 0.7,
  tilesPerPerson: 5,
  /** Chance someone works: anyone, the lead in a household, the rest of it. */
  working: 0.75,
  leadWorking: 0.8,
  othersWorking: 0.5,
  /** Chance a household member shares the lead's surname. */
  sameSurname: 0.6,
  /** A "pets considered" listing: chance the lead has a pet. */
  petsListing: 0.6,
  /** Chance an applicant for a grim or shabby flat is desperate. */
  desperate: 0.2,
  /** Hagglers offer this much of the asking. */
  hagglerOffer: 0.9,
};

/** How each way of listing a flat changes the time between applicants. */
export const LISTING_PACE = { plain: 1, agent: 0.6, honest: 1.6, professionals: 1.4, pets: 0.85 };

export const RENT = {
  /** Chance rent's late, by how much the household likes it here. */
  lateUnhappy: { under: 20, chance: 0.4 },
  lateFedUp: { under: 35, chance: 0.15 },
  lateUsual: 0.03,
  /** Tenants who pay early are this much less likely to be late (and only half as unlikely when very unhappy). */
  paysEarly: 0.1,
  paysEarlyUnhappy: { under: 15, factor: 0.5 },
  /** Liking needed to pay something off what's owed. */
  catchUpLiking: 30,
  /** Liking needed to renew, before touchiness moves it (by half). */
  renewLiking: 40,
  /** Hagglers ask for money off at renewal if the rent's above this much of the going rate, and ask for this much of it. */
  renewHaggleAbove: 0.95,
  renewHaggleAsk: 0.9,
  /** A rise of more than this counts as a big one. */
  bigRise: 0.1,
};

// ================================================================== impressiveness

/** Tiers by score, best first. */
export const TIERS: readonly { min: number; name: string }[] = [
  { min: 90, name: 'Impressive' },
  { min: 78, name: 'Smart' },
  { min: 65, name: 'Nice' },
  { min: 50, name: 'Decent' },
  { min: 35, name: 'Plain' },
  { min: 20, name: 'Shabby' },
  { min: 0, name: 'Grim' },
];

export const IMPRESSIVE = {
  /** The score is this share of the factors' average, and the rest the weakest one. */
  meanShare: 0.65,
  /** Space score from floor tiles per person. */
  space: [[3, 15], [6, 45], [10, 70], [16, 90], [24, 100]] as [number, number][],
  /** Furnishing: furniture value per tile, times this. */
  furnishing: 4.5,
  /** Light: a base, then each window and lamp. */
  light: { base: 15, window: 30, lamp: 20 },
  /** Decoration: each decorative thing. */
  decor: 20,
  /** Quiet: points lost for each unit of average noise. */
  quietPerNoise: 30,
  /** Space caps the score at this many times its own score; anything over counts a quarter. */
  spaceCeiling: 1.4,
  overCeiling: 0.25,
  /** Without the basics the score can't pass base + share × basics. */
  basicsCapBase: 19,
  basicsCapShare: 0.6,
};

// ================================================================== needs

/** How fast each need runs down while awake, per game hour. Warmth and quiet come from the building instead. */
export const DECAY = {
  sleep: 1 / 17,
  food: 1 / 7,
  hygiene: 1 / 30,
  bladder: 1 / 5,
  fun: 1 / 10,
  comfort: 1 / 8,
};

/** Below this, they go and do something about it. */
export const SEEK = { sleep: 0.15, food: 0.4, hygiene: 0.3, bladder: 0.35, fun: 0.4, comfort: 0.35 };

/** Needs when they move in. */
export const START_NEEDS = { sleep: 0.8, food: 0.7, hygiene: 0.8, bladder: 0.8, fun: 0.6, comfort: 0.6, warmth: 1, quiet: 1 };

export const NEEDS = {
  /** Party animals get bored this much faster. */
  partyAnimalFun: 1.4,
  /** At work: lunch and a loo are sorted; comfort is a desk chair. Anything else as usual. */
  atWork: { food: 0.35, bladder: 0, comfort: 0.5 } as Partial<Record<string, number>>,
  /** Asleep: needs run down this much as fast (and fun not at all). */
  asleep: { food: 0.3, bladder: 0.25 } as Partial<Record<string, number>>,
  asleepOther: 0.5,
  /** How fast shown liking eases towards what the thoughts add up to, each minute. */
  likingEase: 0.02,
  /** How fast the warmth need eases towards how warm the flat is, each minute. */
  warmthEase: 0.03,
  /** Quiet: felt noise of this much is no quiet at all. Noise gets in fast and goes slowly. */
  quietGone: 4,
  quietFalls: 0.15,
  quietRises: 0.03,
  /** Light sleepers feel noise this much more, and everyone feels it this much more at night. */
  lightSleeper: 2,
  night: 1.5,
  /** Asleep at night with this much noise felt, they're kept awake (once every few hours at most). */
  keptAwake: 1.5,
  keptAwakeHours: 3,
  /** A morning wash below this; tea between six and eight below this. */
  morningWash: 0.85,
  teatime: 0.7,
  /** Musicians practise when fun's below this, with this chance, for this much fun. */
  practiseUnder: 0.85,
  practiseChance: 0.3,
  practiseFun: 0.3,
  /** They tidy when the flat's dirtier than this (house-proud sooner), taking off this much. */
  tidyAt: 0.45,
  tidyAtHouseProud: 0.15,
  tidyAmount: 0.5,
  /** Eating standing up, with nowhere to sit. */
  eatStanding: 0.75,
  /** Chance of a grim commute home from work. */
  commute: 0.3,
};

/** What being out sorts out, by where they went. */
export const OUTINGS: Record<string, Record<string, number>> = {
  'Out for chips': { food: 1 },
  'Popped to the pub for the loo': { bladder: 1 },
  'Out at the pub': { fun: 0.6 },
  'Out for a walk': { fun: 0.5 },
};

// ================================================================== thoughts and memories

/** Liking with no thoughts at all. */
export const BASELINE = 50;
/** Hearing about something counts this much of living it. */
export const HEARD = 0.4;
/** Each extra copy of a memory counts this much of the one before. */
export const STACK_FACTOR = 0.75;
/** Easy-going people feel bad memories this much; keen cooks feel a cooked meal this much. */
export const EASY_GOING_BAD = 0.75;
export const KEEN_COOK_MEAL = 2;
/** House-proud tenants feel their flat's tier this much more, both ways. */
export const HOUSE_PROUD_TIER = 1.5;

export interface MemoryDef {
  label: string;
  value: number;
  hours: number;
  /** Most copies that count at once. */
  stack: number;
  /** Worth passing on: neighbours hear about it (at less than half the strength). */
  gossip?: boolean;
}

export const MEMORIES: Record<string, MemoryDef> = {
  sleptWell: { label: 'Slept well', value: 3, hours: 10, stack: 1 },
  sleptSofa: { label: 'Slept on the sofa', value: -4, hours: 12, stack: 2 },
  sleptFloor: { label: 'Slept on the floor', value: -8, hours: 14, stack: 2 },
  cookedMeal: { label: 'Cooked a proper meal', value: 3, hours: 8, stack: 2 },
  ateAtTable: { label: 'Ate at the table', value: 1, hours: 6, stack: 2 },
  ateStanding: { label: 'Ate standing up', value: -2, hours: 6, stack: 2 },
  fridgeDinner: { label: 'Had tea out of the fridge', value: -2, hours: 8, stack: 2 },
  longBath: { label: 'Had a long bath', value: 4, hours: 8, stack: 1 },
  commute: { label: 'Grim commute', value: -2, hours: 3, stack: 1 },
  newPlace: { label: 'New place', value: 5, hours: 5 * 24, stack: 1 },
  rentRiseSmall: { label: 'Rent went up', value: -5, hours: 10 * 24, stack: 2, gossip: true },
  rentRiseBig: { label: 'Rent went up a lot', value: -12, hours: 14 * 24, stack: 2, gossip: true },
  rentCut: { label: 'Rent came down', value: 6, hours: 10 * 24, stack: 1, gossip: true },
  refusedHaggle: { label: 'Landlord wouldn\'t budge on rent', value: -6, hours: 7 * 24, stack: 1, gossip: true },
  agreedHaggle: { label: 'Got money off the rent', value: 6, hours: 7 * 24, stack: 1, gossip: true },
  letOffSteam: { label: 'Let off steam', value: 8, hours: 2 * 24, stack: 1 },
  landlordListened: { label: 'Landlord listened', value: 4, hours: 5 * 24, stack: 2, gossip: true },
  landlordShrugged: { label: 'Landlord couldn\'t care less', value: -4, hours: 5 * 24, stack: 2, gossip: true },
  ignored: { label: 'Landlord ignored the chat', value: -5, hours: 5 * 24, stack: 2, gossip: true },
  wearAJumper: { label: 'Told to wear a jumper', value: -6, hours: 5 * 24, stack: 1, gossip: true },
  toldOff: { label: 'Landlord had a word about the noise', value: -5, hours: 5 * 24, stack: 1 },
  gotPet: { label: 'Got a pet', value: 8, hours: 10 * 24, stack: 1 },
  noPet: { label: 'Not allowed a pet', value: -6, hours: 7 * 24, stack: 1, gossip: true },
  sawRow: { label: 'Saw a row on the stairs', value: -3, hours: 24, stack: 2, gossip: true },
  keptAwake: { label: 'Kept awake by the neighbours', value: -6, hours: 14, stack: 3 },
  friendLeft: { label: 'A friend moved out', value: -6, hours: 7 * 24, stack: 2 },
  brokeUp: { label: 'Broke up', value: -12, hours: 7 * 24, stack: 1 },
  paysMore: { label: 'Pays more than next door', value: -6, hours: 7 * 24, stack: 1 },
  buildersIn: { label: 'Builders in the flat', value: -3, hours: 12, stack: 2 },
  doneUp: { label: 'Flat got done up', value: 6, hours: 5 * 24, stack: 1, gossip: true },
  threwParty: { label: 'Threw a party', value: 6, hours: 2 * 24, stack: 1 },
  goodParty: { label: 'Went to a good party', value: 5, hours: 24, stack: 1 },
  partyShutDown: { label: 'Party got shut down', value: -6, hours: 3 * 24, stack: 1 },
  sawFight: { label: 'Saw a fight on the stairs', value: -8, hours: 3 * 24, stack: 2, gossip: true },
  brokeItUp: { label: 'Got between a fight', value: -5, hours: 24, stack: 1 },
  cantStand: { label: 'Can\'t stand being in the same building as them', value: -4, hours: 48, stack: 1 },
  attemptedBreakIn: { label: 'Someone tried to break in', value: -3, hours: 3 * 24, stack: 1, gossip: true },
  burgled: { label: 'Got burgled', value: -15, hours: 10 * 24, stack: 1, gossip: true },
  cheatedOn: { label: 'Got cheated on', value: -15, hours: 10 * 24, stack: 1 },
  caughtOut: { label: 'Got found out', value: -6, hours: 4 * 24, stack: 1 },
  notAsAdvertised: { label: 'Not what the listing said', value: -8, hours: 7 * 24, stack: 1 },
  betterThanExpected: { label: 'Better than the listing said', value: 5, hours: 7 * 24, stack: 1 },
  gotBarbecue: { label: 'Went to the building barbecue', value: 5, hours: 2 * 24, stack: 1 },
  freshPaint: { label: 'Lobby smells of fresh paint', value: 3, hours: 3 * 24, stack: 1 },
  mendedForMe: { label: 'A neighbour mended my things', value: 5, hours: 4 * 24, stack: 1, gossip: true },
  stairsDone: { label: 'Someone did the stairs', value: 2, hours: 2 * 24, stack: 1 },
  sleptPosh: { label: 'Slept in a posh bed', value: 5, hours: 10, stack: 1 },
  lumpyMattress: { label: 'Lumpy mattress', value: -1, hours: 10, stack: 1 },
  // Shared spaces
  didWashing: { label: 'Did the washing', value: 3, hours: 24, stack: 1 },
  cycledToWork: { label: 'Cycled to work', value: 2, hours: 6, stack: 1 },
  satOut: { label: 'Sat out in the sun', value: 2, hours: 10, stack: 1 },
  firedUpBbq: { label: 'Fired up the barbecue', value: 4, hours: 36, stack: 1 },
  noWashUp: { label: 'Didn\'t have to wash up', value: 1.5, hours: 6, stack: 2 },
  goodRead: { label: 'Had a good read', value: 2, hours: 8, stack: 1 },
  darkBedroom: { label: 'Dark bedroom', value: 2, hours: 10, stack: 1 },
  // The drip's cards (1.4). Small for most; promises, lockouts, deposits and the pets precedent count for more.
  tookParcel: { label: 'Landlord took a parcel in for me', value: 3, hours: 5 * 24, stack: 2, gossip: true },
  missedParcel: { label: 'Missed a parcel', value: -2, hours: 3 * 24, stack: 1 },
  parcelNicked: { label: 'Parcel got nicked from the lobby', value: -4, hours: 5 * 24, stack: 1, gossip: true },
  leftToIt: { label: 'Left to sort it out myself', value: -4, hours: 5 * 24, stack: 2, gossip: true },
  keptWaiting: { label: 'Kept waiting for an answer', value: -2, hours: 3 * 24, stack: 3 },
  buildingCat: { label: 'There\'s a cat in the building', value: 3, hours: 7 * 24, stack: 1 },
  shooedCat: { label: 'Landlord shooed the cat out', value: -3, hours: 5 * 24, stack: 1, gossip: true },
  catHair: { label: 'Cat hair on the stairs', value: -2, hours: 3 * 24, stack: 1 },
  noPetButCat: { label: 'No pets, but the cat\'s allowed', value: -7, hours: 7 * 24, stack: 1, gossip: true },
  helpedLockout: { label: 'Landlord let me in when I was locked out', value: 7, hours: 7 * 24, stack: 1, gossip: true },
  nosyLandlord: { label: 'Landlord poked their nose in', value: -4, hours: 5 * 24, stack: 1, gossip: true },
  itchy: { label: 'Fleas', value: -4, hours: 4 * 24, stack: 1 },
  mumApproved: { label: 'Mum approved of the flat', value: 4, hours: 7 * 24, stack: 1 },
  mumWorried: { label: 'Mum worries about the flat', value: -4, hours: 7 * 24, stack: 1 },
  brokePromise: { label: 'Landlord broke a promise', value: -8, hours: 10 * 24, stack: 2, gossip: true },
  keptPromise: { label: 'Landlord kept their word', value: 4, hours: 7 * 24, stack: 2, gossip: true },
  itsYourJob: { label: 'Landlord did what they\'re meant to', value: 2, hours: 4 * 24, stack: 1 },
  scaffolding: { label: 'Scaffolding outside the window', value: -3, hours: 2 * 24, stack: 1 },
  landlordGossiped: { label: 'Landlord\'s been talking about me', value: -4, hours: 7 * 24, stack: 1, gossip: true },
  keptMyBusiness: { label: 'Landlord kept my business to themselves', value: 3, hours: 7 * 24, stack: 1 },
  brushedOff: { label: 'Landlord brushed me off', value: -2, hours: 3 * 24, stack: 1 },
  tapedWindow: { label: 'Window held together with tape', value: -3, hours: 2 * 24, stack: 1 },
  barsOnWindow: { label: 'Bars on the window', value: -2, hours: 3 * 24, stack: 1 },
  sadAboutKitten: { label: 'Couldn\'t keep a kitten', value: -3, hours: 5 * 24, stack: 1 },
  freePizza: { label: 'Got a free pizza', value: 2, hours: 2 * 24, stack: 1 },
  waitedForRepair: { label: 'Waiting for something to be fixed', value: -3, hours: 3 * 24, stack: 1 },
  notTrusted: { label: 'Landlord didn\'t trust me with it', value: -3, hours: 5 * 24, stack: 1 },
  askedToHelp: { label: 'Landlord asked me for a hand', value: 2, hours: 4 * 24, stack: 1 },
  keptAnEye: { label: 'Kept an eye on a stranger', value: 3, hours: 4 * 24, stack: 1 },
  wholeDeposit: { label: 'Got the whole deposit back', value: 4, hours: 7 * 24, stack: 1, gossip: true },
  keptDeposit: { label: 'Landlord kept some of the deposit', value: -7, hours: 10 * 24, stack: 1, gossip: true },
  accused: { label: 'Accused of something I didn\'t do', value: -4, hours: 7 * 24, stack: 1, gossip: true },
  openedPost: { label: 'Landlord opened someone else\'s post', value: -4, hours: 7 * 24, stack: 1, gossip: true },
  noKeyForFamily: { label: 'No key for the family', value: -4, hours: 7 * 24, stack: 1, gossip: true },
  gotToPaint: { label: 'Got to paint the flat', value: 4, hours: 10 * 24, stack: 1 },
  noPaint: { label: 'Not allowed to paint', value: -3, hours: 5 * 24, stack: 1 },
  grubbyWindows: { label: 'Grubby windows', value: -1, hours: 2 * 24, stack: 1 },
  // chunk 2b
  crackedWindow: { label: 'Hole in the window', value: -6, hours: 3 * 24, stack: 1 },
};

/** Need bands: below `under`, this thought. Lowest band first. */
export const NEED_THOUGHTS: Record<string, { under: number; label: string; value: number }[]> = {
  sleep: [
    { under: 0.12, label: 'Exhausted', value: -10 },
    { under: 0.3, label: 'Tired', value: -4 },
  ],
  food: [
    { under: 0.1, label: 'Starving', value: -12 },
    { under: 0.3, label: 'Hungry', value: -5 },
  ],
  hygiene: [{ under: 0.15, label: 'Feels grubby', value: -6 }],
  bladder: [{ under: 0.1, label: 'Bursting for the loo', value: -8 }],
  fun: [
    { under: 0.12, label: 'Bored stiff', value: -6 },
    { under: 0.3, label: 'Bored', value: -2 },
  ],
  comfort: [{ under: 0.2, label: 'Uncomfortable', value: -4 }],
  warmth: [
    { under: 0.25, label: 'Freezing in the flat', value: -10 },
    { under: 0.5, label: 'Cold flat', value: -5 },
  ],
  quiet: [
    { under: 0.3, label: 'Can\'t hear yourself think', value: -6 },
    { under: 0.55, label: 'Noisy neighbours', value: -3 },
  ],
};

/** What a flat's impressiveness tier does to how its tenants feel. Ordinary flats do nothing. */
export const TIER_THOUGHTS: Record<string, number> = { Grim: -10, Shabby: -5, Plain: 0, Decent: 3, Nice: 6, Smart: 9, Impressive: 12 };

/** Missing the basics, and too little room (fewer tiles each than `crampedUnder`). */
export const MISSING = { bed: -12, toilet: -15, wash: -8, kitchen: -6, cramped: -5, crampedUnder: 5 };

/**
 * The rent against the going rate. Under `bargain` is a bargain, under `fair` fair, up to
 * `ok` nothing, up to `steep` steep, and past that daylight robbery. Each grade of
 * expectations lowers the first three lines by its `perGrade`.
 */
export const RENT_THOUGHTS = {
  bargain: { under: 0.8, perGrade: 0.02, value: 6 },
  fair: { under: 0.95, perGrade: 0.02, value: 2 },
  ok: { upTo: 1.1, perGrade: 0.03 },
  steep: { upTo: 1.3, value: -6 },
  robbery: -14,
};

/** Thoughts about how things are right now: what each is worth, and when it starts. */
export const LIVE_THOUGHTS = {
  noFrontDoor: -20,
  openToWeather: -20,
  tooHot: { above: 26, value: -3 },
  /** Dirt in the flat (not for messy tenants; house-proud ones mind sooner). */
  tip: { above: 0.6, value: -4 },
  couldBeCleaner: { above: 0.3, value: -4 },
  grubbyStairs: { above: 0.5, value: -3, houseProud: -5 },
  binsOverflowing: -3,
  hasPet: 3,
  /** Each broken thing, up to `most` of them. */
  broken: { value: -3, most: 3 },
  inLove: 6,
  /** Friends (an opinion this high) count `each`, up to `most`; rivals (this low) count `value`, up to `most`. */
  friends: { opinion: 30, each: 1.5, most: 5 },
  rival: { opinion: -30, value: -3, most: 3 },
};

// ================================================================== social

export interface SocialDef {
  label: string;
  value: number;
  hours: number;
  stack: number;
}

/** What one tenant remembers about another, and what it does to their opinion. */
export const SOCIAL: Record<string, SocialDef> = {
  chat: { label: 'Chats', value: 3, hours: 240, stack: 8 },
  deepTalk: { label: 'Had a proper talk', value: 9, hours: 336, stack: 3 },
  slight: { label: 'Was a bit off with me', value: -5, hours: 96, stack: 3 },
  insult: { label: 'Said something nasty', value: -10, hours: 144, stack: 3 },
  row: { label: 'Had a row', value: -15, hours: 192, stack: 2 },
  flirt: { label: 'Flirted', value: 8, hours: 120, stack: 3 },
  rebuffed: { label: 'Turned me down', value: -6, hours: 120, stack: 1 },
  favour: { label: 'Did me a favour', value: 10, hours: 192, stack: 3 },
  noise: { label: 'Keeps me up at night', value: -4, hours: 168, stack: 5 },
  heardThings: { label: 'Heard things about them', value: -4, hours: 120, stack: 2 },
  brokeUp: { label: 'Broke up with me', value: -25, hours: 336, stack: 1 },
  fight: { label: 'Had a fight', value: -30, hours: 336, stack: 1 },
  cheatedOn: { label: 'Went behind my back', value: -35, hours: 600, stack: 1 },
  goodNight: { label: 'Threw a good night', value: 8, hours: 240, stack: 2 },
  // The drip's cards (1.4).
  leakedOnMe: { label: 'Their shower came through my ceiling', value: -6, hours: 168, stack: 2 },
};

export const OPINION = {
  /** Each extra copy of a social memory counts this much of the one before. */
  stack: 0.75,
  /** What being someone's partner, or their ex, is worth. */
  partner: 25,
  ex: -10,
  /** A social memory fades out over the part of its life after this. */
  fadeFrom: 2 / 3,
  /** Opinions this high count as friends (and are missed when they move out). */
  friend: 30,
};

export const TALK = {
  /** Minutes between someone's conversations, and the chance each minute that someone free starts one. */
  gapMinutes: 25,
  chance: 1 / 6,
  /** How far apart (in tiles) people can be to talk. */
  reach: 3,
  /** How often each kind of talk comes up, before what they think of each other. */
  weights: { chat: 1, deepTalk: 0.12, slight: 0.05, insult: 0.015, flirt: 0.12, gossip: 0.35, moan: 0.25, favour: 0.06 },
  /** Friendly people are this much more positive, and this much less negative. */
  friendlyPos: 1.5,
  friendlyNeg: 0.4,
  /** Busybodies gossip, and complainers moan, this many times more. Moaning starts below this liking. */
  busybodyGossip: 3,
  complainerMoan: 2,
  moanUnder: 40,
  /** Chance an insult turns into a row (more if they can't stand them, or are a complainer). */
  row: 0.25,
  /** Chance a moan ends up in the chat. */
  moanPost: 0.15,
  /** Chance a handy friend's favour gets mentioned. */
  favourNotice: 0.3,
};

export const ROMANCE = {
  /** Chance a flirt lands: base, plus chemistry times this, plus their opinion over this. */
  flirtBase: 0.5,
  flirtChemistry: 0.3,
  flirtOpinionPer: 200,
  /** Both thinking this well of each other, a flirt can make them a couple, with this chance. */
  coupleOpinion: 40,
  couple: 0.3,
  /** Chance an hour that a couple who've gone off each other split. */
  splitPerHour: 1 / 36,
};

export const GOSSIP = {
  /** Most tellings away from the first-hand news. */
  hops: 2,
  /** Chance a bit of gossip is about who pays what, and how much dearer counts as a grievance. */
  aboutRent: 0.35,
  paysMore: 1.15,
  /** Busybodies pass on things about anyone they think this little of. */
  busybodyRival: -20,
};

export const REQUESTS = {
  /** Chance an hour a tenant asks for something (after the first couple of days). */
  perHour: 1 / 24,
  settleDays: 2,
  /** Pet owners ask for a pet with this chance. */
  pet: 0.3,
  /** They ask about the heating when the warmth need is below this. */
  coldUnder: 0.45,
  /** House-proud or handy tenants ask to paint with this chance. */
  paint: 0.1,
};

// ================================================================== outcomes and breaks

/** The three lines, before traits move them. */
export const LINES = { minor: 35, major: 25, extreme: 15 };

export const OUTCOME_ODDS = {
  /** Hours below a line before anything can happen. */
  waitHours: 2,
  /** Average days between incidents while below each line. */
  meanDays: { minor: 3, major: 1.5, extreme: 1 },
  /** Days to calm down after kicking off; after going to the council. */
  calmDays: 2,
  calmDaysCouncil: 7,
  /** Rent held back for this many days. */
  withholdDays: 3,
  /** Hagglers ask for this much of the rent. */
  haggleAsk: 0.85,
  /** A hidden trait shows itself about once in this many days (not in the first few). */
  revealDays: 6,
  revealAfterDays: 3,
  /** Liking at or above this, and they do good turns: every `goodDaysBest` days at 100, up to `goodDaysBest` + `goodDaysSpread` at the line. */
  goodLiking: 65,
  goodDaysBest: 5,
  goodDaysSpread: 15,
};

// ================================================================== storyteller and events

/** Most happenings going at once. */
export const CAP = 2;
/** Nothing from the storyteller before this day. */
export const FIRST_DAY = 8;

/** Days before a tag can come round again ("party:" is per flat). Anything else, `other`. */
export const COOLDOWN: Record<string, number> = { party: 1, 'party:': 6, fight: 3, romance: 10, crime: 12, council: 14, money: 21, repair: 2 };
export const COOLDOWN_OTHER = 2;

export const STORY = {
  /** Hours of busy spells and quiet ones. */
  busyHours: [48, 72] as [number, number],
  quietHours: [48, 96] as [number, number],
  /** Chance an hour of something happening, busy and quiet. */
  busyChance: 0.08,
  quietChance: 0.02,
  /** Each point of threat over 1 adds this much to the chance. Struggling, it's this much of it. */
  threatChance: 0.3,
  strugglingChance: 0.7,
  /** Struggling: under this much money, or tenants' liking under this. */
  strugglingMoney: 300 * POUND,
  strugglingLiking: 35,
  /** Flush: over this much money. */
  flushMoney: 5000 * POUND,
  /** Good things are this much likelier when struggling; bad ones this much (and this much when flush). */
  goodWhenStruggling: 4,
  badWhenStruggling: 0.3,
  badWhenFlush: 1.5,
  /** How often each sort of thing gets picked. Burglaries go by the risk, times `crime`. */
  weights: { romance: 1, crime: 2, council: 0.35, repair: 0.8, grant: 0.2 },
  /** Days' notice of a surprise inspection. */
  inspectionDays: 3,
  /** A grant: this many £50s. */
  grantFifties: [2, 6] as [number, number],
};

/** The storyteller's points: what the building's worth to it. */
export const POINTS = {
  /** At the start: a tired building, two flats let. */
  base: 120,
  /** Pounds of furniture value per point, points per flat let, pounds of weekly rent per point, points per tenant. */
  perFurniture: 10,
  perLet: 10,
  perRent: 5,
  perTenant: 5,
};

export const PARTY = {
  /** Chance of a party on a Friday or Saturday evening: party animals (busy spell, quiet), a household, someone on their own. */
  animalBusy: 0.7,
  animalQuiet: 0.45,
  household: 0.04,
  alone: 0.01,
  /** Guests: a few, plus this many more for each point of threat over 1. */
  guests: [3, 6] as [number, number],
  guestsPerThreat: 5,
  /** Neighbours who think this well of the host (friendly ones a bit more) are asked, with this chance, up to `most`. */
  inviteOpinion: 8,
  inviteFriendly: 8,
  invite: 0.7,
  mostInvited: 2,
  /** Chance a minute that an invited neighbour comes over. */
  join: 0.12,
  /** The music's noise in each part of the evening, before the volume. */
  music: { arriving: 1, swing: 3, winding: 1.5, leaving: 0.5 },
  /** Chance an hour the music goes up, late on. */
  louder: 0.35,
  /** Chance a neighbour knocks rather than posting; chance the host turns it down (party animals less). */
  knock: 0.6,
  calm: 0.65,
  calmPartyAnimal: 0.35,
  /** Mess left in the flat and on the stairs. */
  mess: 0.35,
  stairsMess: 0.1,
  /** Chance something gets broken (more with someone clumsy). */
  damage: 0.3,
  damageClumsy: 0.5,
};

export const FIGHT = {
  /** A row turns into a fight after this many rows, or when they think this little of each other, with this chance. */
  rows: 2,
  hate: -40,
  chance: 0.35,
  /** Chance the police write. */
  police: 0.4,
  /** Chance a bystander steps in: more if they like either of them this much, and for friendly and handy people. */
  stepInFond: 0.45,
  stepIn: 0.08,
  fondOpinion: 10,
  stepInFriendly: 0.2,
  stepInHandy: 0.1,
  /** Chance a bystander films it (busybodies much more), or goes and hides. */
  film: 0.08,
  filmBusybody: 0.7,
  hide: 0.5,
  /** Chance a shove breaks something on the landing. */
  shove: 0.35,
};

export const AFFAIR = {
  /** Chemistry and opinions it takes. */
  chemistry: 0.25,
  opinion: 15,
  opinionBack: 10,
  /** How many days it runs. */
  days: [5, 12] as [number, number],
  /** Chance an evening hour that they meet on the landing. */
  meet: 0.3,
  /** Chance someone passing works it out: a busybody, anyone else. The partner always does. */
  spotBusybody: 0.3,
  spot: 0.08,
  /** Chance the two of them end up together. */
  together: 0.5,
};

// ================================================================== crime

export const BURGLARY = {
  /** Worth taking: each valuable, and a flat with people in. */
  perValuable: 1,
  occupied: 0.5,
  /** Ways in: the street door, each low window (windows count up to `mostWindows`). */
  door: 1,
  window: 0.5,
  mostWindows: 2,
  /** Risk = (base + perWorth × worth) × (easyBase + perEasy × ways in), capped at 1, then the locks and alarm. */
  base: 0.05,
  perWorth: 0.04,
  easyBase: 0.4,
  perEasy: 0.4,
  locks: 0.5,
  alarm: 0.5,
  /** What a household's own things are worth to a burglar. */
  household: 50 * POUND,
  /** Minutes at the door or window, with and without new locks; chance the locks put them off. */
  tryMinutes: 8,
  tryMinutesLocks: 20,
  lockPutsOff: 0.5,
  /** Minutes rummaging. */
  rummage: [8, 15] as [number, number],
  /** Chance a minute they're spotted outside: by a passer-by, by a tenant who's awake. */
  passerby: 0.04,
  spotted: 0.06,
  /** Chance a minute they're found inside: someone awake, someone asleep. */
  foundAwake: 0.5,
  foundAsleep: 0.02,
  /** Minutes the alarm rings, and how loud it is. */
  alarmMinutes: 15,
  alarmNoise: 8,
  /** Greed: a second thing over this much threat, a second flat over this (twice as fast). */
  twoThings: 1,
  secondFlat: 1.5,
};

/** Words for the risk: under each line. */
export const RISK_WORDS = { low: 0.15, some: 0.35, high: 0.6 };

// ================================================================== upkeep and the council

export const UPKEEP = {
  /** Wear from one go on something: about 250 goes from new to broken. */
  wearPerUse: 0.004,
  /** Clumsy people are this much harder on things; handy ones this much gentler. */
  clumsy: 2.5,
  handy: 0.7,
  /** Chance a clumsy breakage gives them away. */
  clumsyNoticed: 0.5,
  /** Worn enough for the storyteller to break it. */
  worn: 0.6,
  /** A repair costs this much of the price, to the nearest £5, and never less than the least. */
  repairShare: 0.2,
  repairLeast: 20 * POUND,
  /** Chance an hour a handy tenant fixes something, and the wear it's left at. */
  handyFix: 0.03,
  handyFixWear: 0.5,
  /** Chance an hour something broken gets reported. */
  report: 0.5,
};

export const COUNCIL = {
  /** Days to put things right before they come back. */
  revisitDays: 14,
  /** What counts: colder than this, fewer tiles each than this, broken for this many days, stairs dirtier than this. */
  tooCold: 10,
  overcrowded: 3,
  brokenDays: 7,
  filthy: 0.7,
};

// ================================================================== the building: warmth, noise, dirt

export const WARMTH = {
  /** Degrees from each radiator per boiler setting, for every 8 tiles of flat. */
  perRadiator: 3.5,
  radiatorTiles: 8,
  /** Degrees from the flat itself, and from each person in it. */
  base: 4,
  perPerson: 0.8,
  /** How fast it drifts: rate × exposure (plus `exposureBase`, up to `mostExposure`), less for insulation and size. */
  rate: 0.25,
  exposureBase: 0.3,
  mostExposure: 1.5,
  insulationKeeps: 0.6,
  sizeTiles: 15,
  /** A flat's temperature before it's been worked out. */
  start: 18,
  /** The warmth need is 0 at `cold` degrees and full at `cold` + `range`. */
  cold: 10,
  range: 9,
};

export const NOISE = {
  /** How much an insulated wall or floor lets through, against a bare one. */
  insulated: 0.15,
  /** Through one tile of wall, and of floor. Doors and windows let more through. */
  wall: 0.035,
  floor: 0.08,
  door: 1.5,
  window: 1.2,
  /** The rolling average of noise, for how impressive a flat is: how fast it moves each hour. */
  averageRate: 0.08,
  /** Night (counts for more), from and to, in hours. */
  nightFrom: 22,
  nightTo: 7,
  /** What people make doing things. */
  telly: 2,
  practising: 6,
  row: 8,
  fighting: 10,
  party: 2.5,
  dancing: 3.5,
  mingling: 1.5,
  windingDown: 1,
  chatting: 1,
  cooking: 0.5,
  slammingDoors: 6,
  tantrum: 7,
  spite: 7,
  kickingBins: 4,
  carryingBoxes: 1,
  barbecue: 2,
};

export const DIRT = {
  /** Dirt walked into the stairs each hour, per tenant; a doormat halves it. */
  shared: 0.0025,
  doormat: 0.5,
  /** Dirt in a flat each hour, per person (messy people count as three). */
  flat: 0.004,
  messyExtra: 2,
  /** One set of bins does this many people. */
  binPeople: 6,
  /** The cleaner comes at this hour. */
  cleanerHour: 10,
};

// ================================================================== expectations

export const EXPECT = {
  /** Where the level starts (out of 100). */
  start: 12,
  /** Most it moves in a morning, going up and coming down. */
  risePerDay: 1.5,
  fallPerDay: 3,
  /** The level is a grade each time it passes one of these. */
  gradeLines: [25, 50, 75],
  /** Reviews: points before any; else (stars - `reviewsFrom`) × `perStar`, up to `most`. */
  noReviews: 8,
  reviewsFrom: 2,
  perStar: 10,
  most: 30,
  /** Points for each tier of the average flat. */
  perTier: 4,
  /** Points for each good day, up to `most`. */
  perGoodDay: 0.75,
  /** A good day: average liking this high. A bad one: under this, and it takes off `badDays`. */
  goodLiking: 55,
  badLiking: 40,
  badDays: 3,
  /** Shown as rising or easing when the target's this far off. */
  trend: 2,
  /** A flat below what they expect: this much for each tier short, up to `mostTiers`. */
  perTierShort: -3,
  mostTiers: 3,
};

// ================================================================== pace

/** Real seconds per game minute at 1x (a day is 24 * 60 of these: about 7 minutes). Must match TICKS_PER_SECOND in state.ts. */
export const SECONDS_PER_GAME_MINUTE = 0.3;
/** A quiet night runs this many times faster than the speed you picked. */
export const NIGHT_BOOST = 4;
/** Night is from this hour to this one. */
export const QUIET_NIGHT_FROM = 23;
export const QUIET_NIGHT_TO = 6;
/** Never simulate more than this per frame, so a slow phone can't spiral (about 5ms here; the fastest real frame needs under 600). */
export const MAX_TICKS_PER_FRAME = 1500;

// ================================================================== tales

/** Most tales kept. */
export const MAX_TALES = 200;
/** Tales in a recap, how far back it looks, and the least interest worth repeating. */
export const RECAP_SIZE = 5;
export const RECAP_DAYS = 28;
export const RECAP_INTEREST = 2;
/** What a telling leaves of a tale's interest. */
export const RETOLD = 0.5;

/** How much people talk about each kind of thing, to start with. */
export const INTEREST = {
  affair: 10,
  repossessed: 10,
  fight: 8,
  burglary: 7,
  councilFine: 6,
  missedMortgage: 6,
  breakup: 5,
  partyShutDown: 5,
  burglaryFoiled: 4,
  couple: 4,
  gaveNotice: 4,
  councilNotice: 4,
  partyDamage: 3,
  party: 2.5,
  moveIn: 3,
  moveOut: 3,
  grant: 2,
  broken: 1,
  // From the drip's cards: low, except the cat, the kittens and the squatter, which people talk about for weeks.
  parcelNicked: 1.5,
  lockout: 1.5,
  cowboy: 2,
  leak: 1.5,
  cat: 4,
  kittens: 4,
  brokePromise: 2,
  pritchard: 2,
  fakeMeterMan: 2,
  deposit: 1.5,
  squatter: 4,
  badTurn: 2,
};

// ================================================================== furniture grades

/**
 * Pieces you use come cheap, standard or posh. Each grade's share of the standard price,
 * of its worth (how furnished a flat looks), and of how fast it wears out. Repairs and
 * resale go by the price, so they follow along.
 */
export const GRADES = {
  price: { cheap: 0.6, standard: 1, posh: 2.2 },
  value: { cheap: 0.6, standard: 1, posh: 1.8 },
  wear: { cheap: 1.6, standard: 1, posh: 0.6 },
  /** A valuable (a telly, a laptop) counts this much towards a burglar's interest. */
  burglar: { cheap: 0.5, standard: 1, posh: 2 },
};

/** Posh opens up at this rating, once any flat is this tier (or better), or on this day regardless. */
export const POSH_UNLOCK = { stars: 3.5, tier: 'Smart', day: 30 };

/** House-proud tenants like having posh things in the kitchen and the bathroom. */
export const POSH_PROUD = { kitchen: 2, bathroom: 2 };

// ================================================================== shared spaces

/** Laundry rooms, bike stores and gardens: when tenants use them, and what they're worth to the building. */
export const SHARED_USE = {
  /** Outdoors only in daylight (minutes of the day) and when it's decent out (degrees). */
  outdoorFrom: 8 * 60,
  outdoorTo: 19 * 60 + 30,
  mildest: 12,
  hottest: 30,
  /** The barbecue wants proper weather, and the afternoon or evening. */
  bbqTemp: 15,
  bbqFrom: 12 * 60,
  bbqTo: 19 * 60,
  /** Each time they're idle at home: the chance of going down to the garden; of firing up the grill; of joining a barbecue already going. */
  leisureChance: 0.12,
  bbqChance: 0.04,
  /** Sociable types fire it up this much sooner. */
  sociableBbq: 3,
  joinChance: 0.6,
  /** Only those with a need this low go out for the garden (it's for fun and comfort). */
  leisureUnder: 0.8,
  /** The washing is due every so many days, done between these times. */
  washEveryDays: 3,
  washFrom: 9 * 60,
  washTo: 21 * 60,
  /** Chance on a working day that a tenant with a bike rack to hand cycles (asked once a day). */
  cycleChance: 0.35,
};

/** What the building's amenities do to how tenants feel (thoughts) and to how impressive a flat is (points on its score). */
export const AMENITIES = {
  garden: 2,
  laundry: 2,
  /** Only for tenants with a job. */
  bikes: 2,
  /** No washing machine in the flat or the building. */
  noWashing: -1,
  /** Added to the score of every flat in a building that has one. */
  score: { garden: 1, laundry: 1, bikes: 1 },
};

// ================================================================== in-flat items

export const ITEMS = {
  /** A dishwasher: this much of the usual dirt in the flat, and it runs (noisily) after tea, between these minutes of the day. */
  dishwasherDirt: 0.6,
  dishwasherNoise: 1.5,
  dishwasherFrom: 20 * 60,
  dishwasherTo: 21 * 60 + 30,
  /** What playing on the console sounds like next door. */
  consoleNoise: 2.5,
  /** A big telly: fun comes this much faster, and it's this much louder. */
  bigTellyFun: 1.4,
  bigTellyNoise: 1.5,
  /** Reading: tenants who are keen (these traits) feel a good read this much more. */
  keenReaders: ['lightSleeper', 'easyGoing'] as string[],
  keenReadingFeel: 2,
  /** Each rug in a flat lets this much of its noise through to the flat below; only this many count. */
  rugBelow: 0.7,
  mostRugs: 2,
  /** With curtains, a night's sleep counts as well-slept at this level (else 0.8). */
  curtainsWell: 0.65,
  sleptWell: 0.8,
  /** Cameras (up to `mostCameras`) in the shared parts: burglary risk times this each, and burglars outside are this much likelier to be spotted. */
  cctvRisk: 0.8,
  cctvSpotted: 1.6,
  mostCameras: 2,
  /** An intercom: the street door counts for this much as a way in, and a burglar at it is this much likelier to be spotted. */
  intercomDoor: 0.6,
  intercomSpotted: 2,
  /** What tenants think of them. */
  intercomLikes: 1,
  cctvBusybody: 2,
  cctvKnowsRights: -2,
};

// ================================================================== the drip (chunk 1 tunes)

/** The little decisions: nought to two a day, each worth having (spec 1.2). Times in game minutes. */
export const DRIP = {
  /** Cards a day before anything takes one off, and the most open at once. */
  perDay: 2,
  maxOpen: 2,
  /** Waking hours, when the drip tries every `tryEvery` minutes with this chance (doubled after `lateFrom` if nothing's come). */
  wakeFrom: 7 * 60,
  wakeTo: 23 * 60,
  tryEvery: 30,
  tryChance: 0.08,
  lateFrom: 15 * 60,
  /** Least time between two cards on the same day. */
  minGap: 240,
  /** Night cards: the chance an hour, between `wakeTo` and `wakeFrom`. */
  nightChance: 0.04,
  /** Days before the same person is the subject of another card. */
  perPerson: 2,
  /** How long cards last: a moment at the door, any other moment, and a tenant's ask (three steps of `askStep`). */
  life: { door: 120, moment: 240, askStep: 480, askSteps: 3 },
  /** Never resolved before this many real seconds after it appears, whatever the speed (1.1). */
  floorSeconds: 10,
  /** Ignored in a row before a card comes off each day's budget. */
  ignoredRun: 3,
  /** Follow-ups (threads and promises) at once, and over the budget in a day. */
  maxThreads: 3,
  overBudget: 1,
  /** Flags kept at once. */
  maxFlags: 16,
  /** Cards resolved, kept for the recap and the tests. */
  logSize: 50,
  /** Money from cards in the first week, at most. */
  firstWeekIncome: 150 * POUND,
};

/** How worn Bill's shower is at the start, so the first leak (card 5) has something to go on. */
export const BILL_SHOWER_WEAR = 0.85;

// ================================================================== schedules and habits (chunk 3 tunes)

/** Who's home when (spec 2.1): each schedule's share of new tenants, and its weekday hours away (minutes of the day). */
export const SCHEDULES = {
  share: { office: 0.35, early: 0.15, late: 0.1, nights: 0.05, home: 0.15, student: 0.1, retired: 0.1 },
  away: {
    office: { leave: 8 * 60, back: 18 * 60 },
    early: { leave: 6 * 60, back: 15 * 60 },
    late: { leave: 13 * 60 + 30, back: 22 * 60 + 30 },
    nights: { leave: 20 * 60 + 30, back: 7 * 60 + 30 },
    student: { leave: 10 * 60, back: 13 * 60 },
  } as Record<string, { leave: number; back: number }>,
  /** Students are out on these weekdays only (0 is Monday). */
  studentDays: [1, 3],
};

/** Habits (spec 2.1): one or two each, at about the same time every day. */
export const HABITS = {
  /** Most habits a tenant has, and the chance of a second. */
  most: 2,
  second: 0.5,
  /** How far either side of its time a habit can start, in game minutes. */
  slack: 20,
};

// ================================================================== visitors (chunk 4 tunes)

/** People from outside (spec 2.2). Times in minutes of the day; counts a day. */
export const VISITORS = {
  /** Most on the map at once (not counting party guests and applicants with Denise), and passers-by. */
  most: 3,
  mostPassersBy: 3,
  /** Sandra the postie, every morning about now. */
  postie: 9 * 60 + 30,
  /** Couriers a day, and when they come. */
  couriers: [2, 4] as [number, number],
  courierFrom: 9 * 60,
  courierTo: 20 * 60,
  /** Lorraine does the stairs at this time, if you pay the cleaner. */
  cleaner: 8 * 60,
};

// ================================================================== ambient moments (chunk 5 tunes)

/** Little scenes that cost nothing to watch (spec 2.3). */
export const MOMENTS = {
  /** Most running at once. */
  most: 2,
  /** Game minutes between one starting and the next, in waking hours. */
  gap: [50, 100] as [number, number],
  /** How long one runs, in real seconds. */
  seconds: [5, 30] as [number, number],
};

// ================================================================== what's on screen (chunk 6 tunes)

/** Keeping the building readable on a phone (spec 2.5). */
export const BUDGET = {
  /** Most bubbles drawn at once, and the least real time one stays up (the sim's `until` is a minimum). */
  bubbles: 4,
  bubbleSeconds: 1.5,
  /** One thing in each hand. */
  propsPerPerson: 1,
};

// ================================================================== the next project (chunk 7 tunes)

/** Something to save for (spec 4). */
export const PROJECT = {
  /** Weeks of this week's rent less the bills the guess looks ahead. */
  horizonWeeks: 12,
};
