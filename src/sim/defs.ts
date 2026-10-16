// Content definitions. Systems read these; adding content means adding data here.

export type NeedId = 'energy' | 'hunger' | 'bladder' | 'comfort';

export interface NeedDef {
  id: NeedId;
  label: string;
  /** Fall per in-game hour while awake on site. */
  decayPerHour: number;
}

export const NEEDS: readonly NeedDef[] = [
  { id: 'energy', label: 'Energy', decayPerHour: 0.06 },
  { id: 'hunger', label: 'Hunger', decayPerHour: 0.11 },
  { id: 'bladder', label: 'Bladder', decayPerHour: 0.17 },
  { id: 'comfort', label: 'Comfort', decayPerHour: 0.12 },
];

export type NeedValues = Record<NeedId, number>;

export type PawnKind = 'staff' | 'guest';

/** Something an object offers to whoever uses it (the Sims-style advertisement). */
export interface OfferDef {
  id: string;
  label: string;
  /** Present-tense activity text shown on the character sheet. */
  doing: string;
  usableBy: readonly PawnKind[];
  /** Total need change promised over the whole use. */
  deltas: Partial<NeedValues>;
  minutes: number;
  /** Sitting stops comfort draining while in use. */
  sits?: boolean;
  /** Only considered once this need has fallen below the threshold (an autonomy threshold). */
  whenBelow: { need: NeedId; value: number };
  /** Only off the clock (a bed in the staff flat). */
  offShiftOnly?: boolean;
}

export interface ObjectDef {
  id: string;
  label: string;
  /** Price in pence if it can be bought in build mode; selling refunds half. */
  price?: number;
  /** Fixtures can't be moved or sold. */
  fixed?: boolean;
  /** Floors it may stand on (staff kit behind the scenes, guest furniture out front). */
  floors?: readonly string[];
  w: number;
  h: number;
  /** Blocking objects can't be walked through; non-blocking ones (sofas, toilets) are stood or sat on. */
  blocks: boolean;
  /** Tiles, relative to the object's top-left, where a user stands or sits. */
  spots: readonly (readonly [number, number])[];
  offers: readonly OfferDef[];
}

const STAFF = ['staff'] as const;
const EVERYONE = ['staff', 'guest'] as const;

const defs: ObjectDef[] = [
  {
    id: 'fridge', price: 40000, floors: ['K', 'B', 'S', 'R'], label: 'Fridge', w: 1, h: 1, blocks: true, spots: [[0, 1]],
    offers: [{ id: 'snack', label: 'Grab a snack', doing: 'Grabbing a snack', usableBy: STAFF, deltas: { hunger: 0.25 }, minutes: 4, whenBelow: { need: 'hunger', value: 0.5 } }],
  },
  { id: 'oven', price: 30000, floors: ['K'], label: 'Oven', w: 1, h: 1, blocks: true, spots: [[0, 1]], offers: [] },
  { id: 'prep', price: 20000, floors: ['K', 'B'], label: 'Prep counter', w: 2, h: 1, blocks: true, spots: [[0, 1], [1, 1]], offers: [] },
  { id: 'sink', price: 35000, floors: ['K', 'B'], label: 'Sink', w: 1, h: 1, blocks: true, spots: [[0, 1]], offers: [] },
  {
    id: 'espresso', price: 90000, floors: ['K', 'B'], label: 'Espresso machine', w: 2, h: 1, blocks: true, spots: [[0, 1], [1, 1]],
    offers: [{ id: 'coffee', label: 'Make yourself a coffee', doing: 'Sneaking a coffee', usableBy: STAFF, deltas: { energy: 0.2, bladder: -0.08 }, minutes: 4, whenBelow: { need: 'energy', value: 0.75 } }],
  },
  { id: 'counter', fixed: true, label: 'Counter', w: 9, h: 1, blocks: true, spots: [], offers: [] },
  { id: 'bar', fixed: true, label: 'Bar', w: 9, h: 1, blocks: true, spots: [], offers: [] },
  {
    id: 'taps', price: 90000, floors: ['K', 'B'], label: 'Beer taps', w: 2, h: 1, blocks: true, spots: [[0, 1], [1, 1]],
    offers: [{ id: 'lemonade', label: 'Pour yourself a lemonade', doing: 'Sneaking a lemonade', usableBy: STAFF, deltas: { energy: 0.12, bladder: -0.08 }, minutes: 3, whenBelow: { need: 'energy', value: 0.75 } }],
  },
  { id: 'kegs', price: 15000, floors: ['K'], label: 'Kegs', w: 2, h: 1, blocks: true, spots: [], offers: [] },
  { id: 'poolTable', price: 45000, floors: ['F', 'C'], label: 'Pool table', w: 3, h: 2, blocks: true, spots: [], offers: [] },
  { id: 'dartboard', price: 6000, floors: ['F', 'C'], label: 'Dartboard', w: 1, h: 1, blocks: true, spots: [], offers: [] },
  {
    id: 'staffSofa', price: 25000, floors: ['S', 'R'], label: 'Staff sofa', w: 2, h: 1, blocks: false, spots: [[0, 0], [1, 0]],
    offers: [{ id: 'rest', label: 'Put feet up', doing: 'Feet up on the sofa', usableBy: STAFF, deltas: { comfort: 0.7, energy: 0.08 }, minutes: 15, sits: true, whenBelow: { need: 'comfort', value: 0.55 } }],
  },
  {
    id: 'staffTable', price: 18000, floors: ['S', 'R'], label: 'Staff table', w: 2, h: 1, blocks: true, spots: [[0, 1], [1, 1]],
    offers: [{ id: 'lunch', label: 'Eat lunch', doing: 'Eating lunch', usableBy: STAFF, deltas: { hunger: 0.85, comfort: 0.25 }, minutes: 20, sits: true, whenBelow: { need: 'hunger', value: 0.4 } }],
  },
  { id: 'lockers', price: 12000, floors: ['S', 'R'], label: 'Lockers', w: 1, h: 1, blocks: true, spots: [], offers: [] },
  { id: 'table4', price: 22000, floors: ['F', 'C'], label: 'Four-top', w: 2, h: 2, blocks: true, spots: [[0, -1], [1, -1], [0, 2], [1, 2]], offers: [] },
  { id: 'table2', price: 12000, floors: ['F', 'C'], label: 'Two-top', w: 1, h: 1, blocks: true, spots: [[0, -1], [0, 1]], offers: [] },
  { id: 'armchair', price: 15000, floors: ['F', 'C'], label: 'Armchair', w: 1, h: 1, blocks: false, spots: [[0, 0]], offers: [] },
  { id: 'plant', price: 4000, floors: ['F', 'C', 'K', 'B', 'S', 'R'], label: 'Plant', w: 1, h: 1, blocks: true, spots: [], offers: [] },
  {
    id: 'toilet', price: 30000, floors: ['T'], label: 'Toilet', w: 1, h: 1, blocks: false, spots: [[0, 0]],
    offers: [{ id: 'loo', label: 'Use the loo', doing: 'In the loo', usableBy: EVERYONE, deltas: { bladder: 1 }, minutes: 3, sits: true, whenBelow: { need: 'bladder', value: 0.45 } }],
  },
  // The staff flat.
  {
    id: 'bed', price: 18000, floors: ['R'], label: 'Bed', w: 1, h: 2, blocks: false, spots: [[0, 0]],
    offers: [{ id: 'sleep', label: 'Sleep', doing: 'Asleep', usableBy: STAFF, deltas: { energy: 0.95, comfort: 0.5 }, minutes: 420, sits: true, whenBelow: { need: 'energy', value: 0.4 }, offShiftOnly: true }],
  },
  {
    id: 'tv', price: 22000, floors: ['R', 'S'], label: 'TV', w: 1, h: 1, blocks: true, spots: [[0, 1]],
    offers: [{ id: 'telly', label: 'Watch telly', doing: 'Watching telly', usableBy: STAFF, deltas: { comfort: 0.45 }, minutes: 40, whenBelow: { need: 'comfort', value: 0.7 }, offShiftOnly: true }],
  },
];

export const OBJECT_DEFS: Readonly<Record<string, ObjectDef>> = Object.fromEntries(defs.map((d) => [d.id, d]));

export function objectDef(id: string): ObjectDef {
  const def = OBJECT_DEFS[id];
  if (!def) throw new Error(`Unknown object def: ${id}`);
  return def;
}

// ------------------------------------------------------------------ traits

export type TraitId =
  | 'chatty' | 'introvert' | 'perfectionist' | 'lazy' | 'hardWorker' | 'hotHeaded'
  | 'calm' | 'flirt' | 'coffeeSnob' | 'clumsy' | 'peoplePerson' | 'earlyBird' | 'nightOwl';

export interface TraitDef {
  id: TraitId;
  label: string;
  description: string;
  /** Traits that can't appear together. */
  excludes?: TraitId[];
}

export const TRAITS: readonly TraitDef[] = [
  { id: 'chatty', label: 'Chatty', description: 'Talks constantly. Gets low without someone to talk to.', excludes: ['introvert'] },
  { id: 'introvert', label: 'Introvert', description: 'Talks less. A packed queue drains them.', excludes: ['chatty', 'peoplePerson'] },
  { id: 'perfectionist', label: 'Perfectionist', description: 'Better quality, a bit slower. Mess really gets to them.' },
  { id: 'lazy', label: 'Lazy', description: 'Works slower. Hates a rush.', excludes: ['hardWorker'] },
  { id: 'hardWorker', label: 'Hard worker', description: 'Works faster.', excludes: ['lazy'] },
  { id: 'hotHeaded', label: 'Hot-headed', description: 'Quick to insult, quick to row, quicker to snap.', excludes: ['calm'] },
  { id: 'calm', label: 'Calm under pressure', description: 'Shrugs off walkouts and rude customers.', excludes: ['hotHeaded'] },
  { id: 'flirt', label: 'Flirt', description: 'Tries their luck. Often.' },
  { id: 'coffeeSnob', label: 'Coffee snob', description: 'Makes better coffee. Lives for the staff coffee.' },
  { id: 'clumsy', label: 'Clumsy', description: 'Drops things.' },
  { id: 'peoplePerson', label: 'People person', description: 'Earns bigger tips and loves a happy customer.', excludes: ['introvert'] },
  { id: 'earlyBird', label: 'Early bird', description: 'Bright in the morning, flagging by mid-afternoon.', excludes: ['nightOwl'] },
  { id: 'nightOwl', label: 'Night owl', description: 'Not a morning person. At all.', excludes: ['earlyBird'] },
];

export function traitDef(id: TraitId): TraitDef {
  return TRAITS.find((t) => t.id === id)!;
}

// ------------------------------------------------------------------ work

export type WorkType = 'counter' | 'barista' | 'floor' | 'dishes' | 'cleaning';

export interface WorkTypeDef {
  id: WorkType;
  label: string;
  /** What the job looks like on the character sheet. */
  description: string;
}

export const WORK_TYPES: readonly WorkTypeDef[] = [
  { id: 'counter', label: 'Counter', description: 'Takes orders at the till and plates cake' },
  { id: 'barista', label: 'Barista', description: 'Makes the coffee' },
  { id: 'floor', label: 'Floor', description: 'Clears dirty cups from tables' },
  { id: 'dishes', label: 'Dishes', description: 'Washes up' },
  { id: 'cleaning', label: 'Cleaning', description: 'Mops up spills' },
];

export type Priorities = Record<WorkType, number>;
export type Skills = Record<WorkType, number>;

/** Base minutes for each task at skill 5; skill scales speed from 0.6x to 1.4x. */
export const TASK_MINUTES = {
  takeOrder: 1,
  plateCake: 0.5,
  placeItem: 0.15,
  pickDishes: 0.3,
  dropDishes: 0.2,
  washPerDish: 0.4,
  repair: 15,
  mop: 1.5,
} as const;

// ------------------------------------------------------------------ menu

export type ItemKind = 'drink' | 'food';

export interface MenuItem {
  name: string;
  kind: ItemKind;
  /** Price in pence. */
  price: number;
}

/** "a flat white", "an oat latte". */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

// ------------------------------------------------------------------ business

export const BUSINESS = {
  startingMoney: 50000,
  rentPerDay: 6000,
  wagePerHour: 1150,
  startingReputation: 50,
  maxGuestsOnSite: 14,
} as const;

export const BACKSTORIES = [
  'Former barista at a chain. Has opinions about chains.',
  'Drama student. Every order is a performance.',
  'Ex-banker who "wanted something real".',
  'Has worked in hospitality since they were fourteen.',
  'Between bands.',
  'Studying for exams on every break.',
  'Moved here last month. Knows nobody. Yet.',
  'Used to run a food truck. Misses the truck.',
  "Their mum's friend owns the place next door.",
  'Can tell you the origin of any bean, unprompted.',
] as const;

export const MAX_STAFF = 8;

export const GUEST_CLOTHES = ['#4f8a5b', '#6c5a8e', '#2e4878', '#8b2f3c', '#c9973a', '#3f7d8a', '#7a7a7a', '#b8452e', '#e3dccf'] as const;

export const FIRST_NAMES = [
  'Alex', 'Sam', 'Priya', 'Tom', 'Jess', 'Marco', 'Aisha', 'Ben', 'Chloe', 'Dev',
  'Ellie', 'Femi', 'Grace', 'Hugo', 'Isla', 'Jamal', 'Kat', 'Leo', 'Mia', 'Nico',
  'Olu', 'Rosa', 'Theo', 'Yas', 'Zoe',
] as const;

export const SKIN_TONES = ['#f1cfae', '#e9b88f', '#e0a77c', '#c98d63', '#a8714a', '#8d5a3b', '#6b4430'] as const;
export const HAIR_COLOURS = ['#2f2219', '#3a2618', '#5a3a22', '#8a5a2b', '#d8b45a', '#b8452e', '#a9a9a9', '#1d1d1f'] as const;
export const HAIR_STYLES = ['short', 'long', 'bun', 'bald', 'beanie'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

