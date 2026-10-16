// Plain-data simulation state. Everything here is JSON-serialisable so it can be
// saved, compared in tests, and replayed from a seed.

import type { HairStyle, ItemKind, NeedValues, PawnKind, Priorities, Skills, TraitId, WorkType } from './defs';

export type FloorKind = 'K' | 'S' | 'B' | 'F' | 'C' | 'T' | 'P';

export interface Tile {
  floor: FloorKind;
  wall: boolean;
  door: boolean;
}

export interface ObjectInst {
  id: number;
  def: string;
  x: number;
  y: number;
}

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  apron: string | null;
}

/** A piece of work that changes the world when it finishes (and is re-validated every tick). */
export type Action =
  | { type: 'takeOrder'; guestId: number }
  | { type: 'makeItem'; orderId: number; index: number }
  | { type: 'placeItem'; orderId: number; index: number }
  | { type: 'pickDishes'; objectId: number }
  | { type: 'dropDishes' }
  | { type: 'wash'; count: number }
  | { type: 'argue'; guestId: number }
  | { type: 'repair' }
  | { type: 'mop'; x: number; y: number };

export type Step =
  | { kind: 'goto'; x: number; y: number; path: [number, number][] | null; node: number }
  | { kind: 'use'; objectId: number; offerId: string; ticksLeft: number; total: number }
  | { kind: 'act'; action: Action; work: WorkType; ticksLeft: number; total: number }
  | { kind: 'wait'; ticksLeft: number }
  | { kind: 'exit' };

export interface Job {
  label: string;
  /** What the job is for, shown while walking there ("use the loo"). */
  goal: string | null;
  steps: Step[];
  index: number;
  /** Reservation keys this job holds; released whenever the job ends. */
  reservations: string[];
  /** The tick the current step started, used to spot pawns that make no progress. */
  stepStartedAt: number;
  sitting: boolean;
  /** Filling time (wandering, or waiting at a post): dropped as soon as there's something to do. */
  idle?: boolean;
}

export interface Shift {
  /** Minutes after midnight. */
  start: number;
  end: number;
}

/** What a pawn has in its hands. `ref` points back at what it came from, so it can be returned if dropped. */
export type Carrying =
  | { kind: ItemKind; orderId: number; index: number }
  | { kind: 'dishes'; count: number; fromObject: number | null }
  | { kind: 'takeaway'; item: ItemKind };

/** A remembered event that affects mood (and, if it's about someone, opinion) until it expires. */
export interface Memory {
  def: string;
  /** Who it's about, for social memories. */
  other: number | null;
  /** Name snapshot, so the memory still reads right after that person has left. */
  otherName: string | null;
  expires: number;
}

export type BreakKind = 'sulk' | 'slowWalk' | 'snappy' | 'walkout' | 'cry' | 'argueGuest' | 'quit';
export type InspirationKind = 'latteArt' | 'charm';

export interface MentalBreak {
  kind: BreakKind;
  until: number;
  finalStraw: string;
}

export interface StaffInfo {
  priorities: Priorities;
  skills: Skills;
  tipsToday: number;
  tipsTotal: number;
  traits: TraitId[];
  memories: Memory[];
  /** Mood in points, 0-100. Drifts toward the sum of its reasons rather than jumping. */
  mood: number;
  /** Tick mood first dropped below each break band, or null while above it. */
  belowSince: { minor: number | null; major: number | null; severe: number | null };
  highSince: number | null;
  /** Tick of the last proper break (lunch or feet up), or of arriving for the shift. */
  lastBreak: number;
  mentalBreak: MentalBreak | null;
  inspiration: { kind: InspirationKind; until: number } | null;
  /** Set when someone quits for good: they leave and never come back. */
  quit: boolean;
  /** Day they've called in sick for, if any. */
  sickDay: number | null;
  /** Orders taken today, for the recap. */
  servedToday: number;
  /** The manager said "take a break now". */
  forcedBreak: boolean;
  /** Day the manager sent them home early, if any. */
  homeEarlyDay: number | null;
  /** Let go by the manager (as opposed to quitting). */
  fired: boolean;
  /** Things they'd like to happen (Sims-style wants); meeting one is a lasting mood boost. */
  wants: Want[];
  /** Kinds of work they love: they learn those much faster. */
  passions: WorkType[];
  /** Pay, pence per hour. Raises push it up. */
  wage: number;
  /** Slow-building strain, 0-100: long shifts, rushes and no days off. Burnout lies at the top. */
  stress: number;
  /** Weekdays (0-6, day 1 is 0) they're not in. */
  daysOff: number[];
  hiredDay: number;
  /** Shift lead: steadies the team around them, for a bit more pay. */
  lead: boolean;
  /** Where they go when there's a rush on, overriding their usual station. */
  rushStation: WorkType | null;
  /** Lines they come out with (for recreating real colleagues). */
  catchphrases: string[];
  /** Lives in the staff flat (if there is one) instead of going home. */
  livesIn: boolean;
  /** The kind of work they did last, so switching costs a little settling-in time. */
  lastWork: WorkType | null;
  /** Last day they asked for a raise (or were offered one by a rival). */
  lastAskDay: number;
  /** The manager's choice of station: they stick to this work and only help out when it's quiet. */
  station?: WorkType | null;
  /** What they've settled into (without a station), and when they last did any of it. */
  focus?: { work: WorkType; lastDone: number; since: number } | null;
}

export interface Want {
  def: string;
  /** Tick the want appeared; only things after this count. */
  since: number;
  /** Who or what it's about: a colleague's id, a work type. */
  param: string | null;
  /** A number to reach, such as a skill level. */
  target: number;
  label: string;
}

/** A guest who keeps coming back, remembers how they were treated and has a usual. */
export interface Regular {
  id: number;
  name: string;
  look: Look;
  usual: string;
  eatIn: boolean;
  visits: number;
  lastVisitDay: number;
  /** Regulars come in every few days, not every day. */
  nextVisitDay: number;
  /** How much they like each staff member, by staff id. */
  likes: Record<number, number>;
  /** Something a staff member did that they haven't forgotten. */
  grudge: { staffId: number; staffName: string; what: string } | null;
}

/** Someone who answered the job ad, waiting to be hired. */
export interface Applicant {
  name: string;
  look: Look;
  traits: TraitId[];
  skills: Skills;
  backstory: string;
  /** Kinds of work they love: they learn those much faster. */
  passions: WorkType[];
  /** What they'd want paying, pence per hour. */
  wage: number;
}

export interface MenuEntry {
  name: string;
  kind: ItemKind;
  basePrice: number;
  price: number;
  enabled: boolean;
}

export type VisitState = 'queuing' | 'ordering' | 'waiting' | 'collecting' | 'toSeat' | 'eating' | 'leaving';

export interface Visit {
  state: VisitState;
  /** 0-1; drains while queuing and waiting. At zero they walk out. */
  patience: number;
  orderId: number | null;
  eatIn: boolean;
  seatKey: string | null;
  seatObject: number | null;
  /** Ticks left eating or drinking at their seat. */
  eatTicks: number;
  /** Items they ordered, kept for the character sheet and for leaving dirty cups. */
  items: string[];
  mood: 'fine' | 'happy' | 'annoyed' | 'furious';
  /** A social media star: their verdict reaches a lot of people (big fame swings). */
  influencer?: boolean;
  /** A restaurant critic: their verdict moves reputation a lot and makes the recap. */
  critic: boolean;
  /** Set when this guest is one of the regulars. */
  regularId: number | null;
  /** Spilt their drink already this visit (once is plenty). */
  spilt: boolean;
}

export interface OrderItem {
  name: string;
  kind: ItemKind;
  price: number;
  status: 'todo' | 'carried' | 'ready';
  /** Skill of whoever made it, 0-10; feeds guest satisfaction. */
  quality: number;
}

export interface Order {
  id: number;
  guestId: number;
  takenBy: number;
  items: OrderItem[];
  placedAt: number;
}

export interface Relation {
  /** Romantic memories shared so far; enough of them, plus liking each other, makes a couple. */
  romance: number;
  together: boolean;
  /** Used to be together. Shifts with an ex are awkward. */
  exes?: boolean;
}

export interface LogEntry {
  tick: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  /** Who the entry is about, so tapping it can select them. */
  pawn: number | null;
  /** What kind of story this is, for the recap's novelty scoring. Null for minor chatter. */
  tale: string | null;
  /** How good a story it is before novelty; 0 means never worth retelling. */
  interest: number;
}

export type ConditionId = 'stationBroken' | 'noFood' | 'heatwave' | 'busker' | 'quietSpell';

export interface Condition {
  id: ConditionId;
  until: number;
}

export interface Review {
  name: string;
  stars: number;
  text: string;
  critic: boolean;
}

export interface Recap {
  day: number;
  headline: string;
  stats: DayStats;
  repStart: number;
  repEnd: number;
  stories: string[];
  review: Review | null;
  star: string | null;
}

export interface StoryState {
  /** Hidden comfort counter: rises through calm days, drops after disasters; scales pressure. */
  adaptation: number;
  phase: 'busy' | 'quiet';
  phaseUntilDay: number;
  nextEventAt: number;
  /** Guests still to arrive from a coach party. */
  pendingArrivals: number;
  /** A rush on its way: when it lands and how many. Announced ahead so you can prepare. */
  incoming: { at: number; n: number; what: string } | null;
  /** How many times each story kind has headlined a recap; stale kinds score lower. */
  taleUses: Record<string, number>;
  repAtOpen: number;
  breaksToday: number;
  quitsToday: number;
  recapDay: number;
}

export interface DayStats {
  reviews: Review[];
  served: number;
  walkouts: number;
  turnedAway: number;
  takings: number;
  wages: number;
  tips: number;
  /** Running costs, in pence. */
  ingredients: number;
  rent: number;
  repairs: number;
  other: number;
}

/** A week on the books, written up every seventh morning. */
export interface WeeklyReport {
  week: number;
  firstDay: number;
  takings: number;
  wages: number;
  ingredients: number;
  rent: number;
  repairs: number;
  other: number;
  served: number;
  walkouts: number;
  fameStart: number;
  fameEnd: number;
  starsStart: number;
  starsEnd: number;
  notes: string[];
}

/**
 * Something that needs the manager: a big event worth reading (a letter), or a decision
 * with choices (a raise request, a rival's offer). Stays until dealt with.
 */
export interface Letter {
  id: number;
  tick: number;
  title: string;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  pawn: number | null;
  /** A decision: what it's about and the choices. Without these it's just news. */
  kind?: string;
  choices?: { id: string; label: string }[];
  /** For decisions: when it lapses (the default choice is taken). */
  expires?: number;
  data?: Record<string, number | string>;
}

/** A target to aim for, with a reward. */
export interface Goal {
  id: string;
  title: string;
  detail: string;
  /** Day it must be met by, if any. */
  byDay: number | null;
  done: boolean;
  failed: boolean;
  reward: number;
}

export interface Pawn {
  id: number;
  name: string;
  kind: PawnKind;
  look: Look;
  x: number;
  y: number;
  onMap: boolean;
  moving: boolean;
  needs: NeedValues;
  job: Job | null;
  shift: Shift;
  /** Tick the pawn last left the map; drives the off-site recovery on return. */
  leftAt: number;
  /** Day number of the pawn's last arrival, so a shift starts once per day. */
  arrivedDay: number;
  carrying: Carrying | null;
  /** Staff only. */
  staff: StaffInfo | null;
  /** Guests only. */
  visit: Visit | null;
}

export const SAVE_VERSION = 3;

export interface SimState {
  version: typeof SAVE_VERSION;
  /** Which venue this is ('cafe', 'pub'). */
  venue: string;
  seed: number;
  rng: number;
  /** One tick is one in-game second. */
  tick: number;
  w: number;
  h: number;
  tiles: Tile[];
  objects: ObjectInst[];
  pawns: Pawn[];
  /** Reservation key -> pawn id. Keys look like "obj:12:0" (object 12, spot 0). */
  reservations: Record<string, number>;
  nextId: number;
  /** Café money in pence. Can go negative. */
  money: number;
  /** 0-100. Drives how many guests come. */
  reputation: number;
  /** Guest ids, front of the queue first. */
  queue: number[];
  orders: Order[];
  /** Dirty cups left on each guest seating object, by object id. */
  dirty: Record<number, number>;
  /** Dirty cups waiting at the sink. */
  sinkDirty: number;
  today: DayStats;
  yesterday: DayStats | null;
  /** Pair key "lowId:highId" -> relation. */
  relations: Record<string, Relation>;
  log: LogEntry[];
  conditions: Condition[];
  story: StoryState;
  recaps: Recap[];
  menu: MenuEntry[];
  applicants: Applicant[];
  regulars: Regular[];
  /** Spilt drinks on the floor, waiting for a mop. */
  spills: { x: number; y: number }[];
  /** The café's proudest and most infamous moments, kept for good. */
  hallOfFame: { day: number; text: string }[];
  /** Kinds of work currently in a rush (they start at a high backlog and end at a lower one). */
  rushes?: WorkType[];
  /** How well known the place is. Grows with happy customers, drives how many come. Slow to move. */
  fame: number;
  /** Wear on each machine, 0 (new) to 100 (about to give up), by object id. */
  wear: Record<number, number>;
  /** This week's numbers so far. */
  week: WeeklyReport;
  weeklyReports: WeeklyReport[];
  /** Consecutive mornings spent in the red. */
  debtDays: number;
  letters: Letter[];
  goals: Goal[];
  /** Manager calls in effect, and when each can next be used. */
  calls: { allHandsUntil: number; closedUntil: number; ready: Record<string, number> };
  /** Big days announced ahead: a festival, the inspection, an award judging. */
  diary: { day: number; kind: 'festival' | 'inspection' | 'award'; title: string }[];
  /** Menu items unlocked by reaching a star rating. */
  unlocked: string[];
}

export const TICKS_PER_MINUTE = 60;
export const TICKS_PER_HOUR = 60 * TICKS_PER_MINUTE;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
