// The simulation: owns the state and advances it one tick (one in-game second) at a time.
// No drawing code lives here, so it runs headless in tests.

import { pickCandidate, reservationKey, scoreCandidates } from './ai';
import {
  BUSINESS, FIRST_NAMES, HAIR_COLOURS, HAIR_STYLES, NEEDS, SKIN_TONES, WORK_TYPES, objectDef, type WorkType,
  type MenuItem, type NeedValues, type OfferDef, type Priorities, type Skills, type TraitId,
} from './defs';
import { breakJob, checkBreaks } from './breaks';
import { closeUp, guestTick, guestsEveryMinute, removeGuest, tryArrive } from './guests';
import { storytellerEveryMinute, storytellerNewDay } from './storyteller';
import { buildRecap } from './tales';
import { randomTraits, refreshApplicants } from './manage';
import { checkSlip } from './ambience';
import { checkWants, topUpWants } from './wants';
import { emptyShell, venueDef, type ServicePositions, type VenueDef } from './venues';
import { SERVICE_DEFS, computePositions, zonesFrom } from './service';
import { clamp01, moodFromNeeds, worstNeed } from './mood';
import { findPath } from './path';
import { pick, random, randInt, randRange } from './rng';
import { canoodle, socialEveryMinute } from './social';
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE,
  SAVE_VERSION, type Applicant, type ConditionId, type Job, type LogEntry, type Pawn, type Relation, type Shift, type SimState, type StaffInfo, type Step,
} from './state';
import { addMemory, driftMood, expireMemories, hasTrait, opinionFromMemories } from './thoughts';
import { abandonAction, findWork, performAction, standByJob, updateRushes, validateAction } from './work';
import { World, addPlotToSave, parseMap, withPlot } from './world';
import { askingWage, emptyDay } from './business';
import { morningBooks } from './books';
import { friendsMayFollow } from './careers';
import { checkGoals } from './goals';
import { lapseDecisions, letterFromLog } from './letters';
import { isDayOff, stressEveryMinute } from './stakes';
import { bedtime, homeJob, livesHere } from './flat';
import { fillStaff, normalize } from './normalize';

/** Walking speed in tiles per tick. At 1x (60 ticks per real second) that's about 4 tiles a second. */
const WALK_SPEED = 0.07;
/** How often each idle staff member looks again for work or a need, in ticks. */
const IDLE_RECHECK_TICKS = 10;
/** A step running longer than this is treated as stuck and abandoned. */
const STEP_TIMEOUT_TICKS = 2 * TICKS_PER_HOUR;
const START_TICK = 6 * TICKS_PER_HOUR;
/** Money to fit out an empty lot: about what the standard fit-out, walls and floors cost, and a bit over. */
export const EMPTY_LOT_MONEY = 800000;

/** How a new place starts: fitted out and ready to open, or an empty shell to build from scratch. */
export type StartLayout = 'fitted' | 'empty';
const IDLE_FLOORS = new Set(['K', 'S', 'B']);
/** Below this, a need beats work. */
const URGENT_NEED = 0.3;

export const IDLE_LABEL = 'Hanging about';
/** Story kinds memorable enough for the hall of fame. */
const FAME_TALES = new Set(['couple', 'quit', 'criticRave', 'criticWalkout', 'milestone', 'lostRegular', 'fired', 'birthday', 'breakup', 'poached', 'followedOut']);


/** Walking done for each kind of work today: ticks on foot and tasks finished. Not saved. */
export type WalkStats = Record<WorkType, { walk: number; tasks: number }>;

function emptyWalkStats(): WalkStats {
  return Object.fromEntries(WORK_TYPES.map((w) => [w.id, { walk: 0, tasks: 0 }])) as WalkStats;
}

export class Sim {
  readonly state: SimState;
  readonly world: World;
  /** Footsteps per tile, fading day to day: where people actually walk. Not saved. */
  footfall: Float32Array = new Float32Array(0);
  walkToday: WalkStats = emptyWalkStats();
  walkYesterday: WalkStats | null = null;
  private positionsCache: ServicePositions | null = null;
  private positionsAt = -1;

  /** A new venue from a seed, or a saved one restored as-is. */
  constructor(seed: number, saved?: SimState, venueId = 'cafe', layout: StartLayout = 'fitted') {
    if (saved) {
      this.state = saved;
      addPlotToSave(saved, venueDef(saved.venue).map);
      this.world = new World(this.state);
      normalize(this);
      return;
    }
    const venue = venueDef(venueId);
    const empty = layout === 'empty';
    const map = parseMap(withPlot(empty ? emptyShell(venue.map, venue.frontFloors[0]) : venue.map));
    this.state = {
      version: SAVE_VERSION,
      venue: venue.id,
      seed,
      rng: seed | 0,
      tick: START_TICK,
      w: map.w,
      h: map.h,
      tiles: map.tiles,
      objects: [],
      pawns: [],
      reservations: {},
      nextId: 1,
      money: empty ? EMPTY_LOT_MONEY : BUSINESS.startingMoney,
      reputation: BUSINESS.startingReputation,
      queue: [],
      orders: [],
      dirty: {},
      sinkDirty: 0,
      today: emptyDay(),
      yesterday: null,
      relations: {},
      log: [],
      conditions: [],
      story: {
        adaptation: 0, phase: 'busy', phaseUntilDay: 3, nextEventAt: 0, pendingArrivals: 0, incoming: null,
        taleUses: {}, repAtOpen: BUSINESS.startingReputation, breaksToday: 0, quitsToday: 0, recapDay: 0,
      },
      recaps: [],
      menu: venue.menu.map((m) => ({ name: m.name, kind: m.kind, basePrice: m.price, price: m.price, enabled: true })),
      applicants: [],
      regulars: [],
      spills: [],
      hallOfFame: [],
    } as Partial<SimState> as SimState;
    this.state.zones = empty ? { queue: [], pickup: [] } : zonesFrom(this.state, venue.zones);
    this.world = new World(this.state);
    refreshApplicants(this);
    if (!empty) for (const o of venue.objects) this.world.placeObject(o);
    normalize(this);
    // The opening team all work day one, and take their days off on different days after.
    venue.shifts.forEach((shift, i) => {
      this.addStarterStaff(shift).staff!.daysOff = [1 + (i % 6)];
    });
  }

  /** Someone for the opening team on one of the venue's shifts: a specialist if the shift has a station. */
  addStarterStaff(shift: { start: number; end: number; station?: WorkType }): Pawn {
    const p = this.addStaff({ start: shift.start, end: shift.end });
    if (shift.station) {
      const staff = p.staff!;
      staff.station = shift.station;
      staff.priorities[shift.station] = 1;
      staff.skills[shift.station] = Math.max(staff.skills[shift.station], 5);
      staff.wage = askingWage(staff.skills);
    }
    return p;
  }

  get venue(): VenueDef {
    return venueDef(this.state.venue);
  }

  /** Where service happens, worked out from the till, pickup, food counter and zones. */
  get positions(): ServicePositions {
    const v = this.world.version;
    if (this.positionsAt !== v || !this.positionsCache) {
      this.positionsCache = computePositions(this);
      this.positionsAt = v;
    }
    return this.positionsCache;
  }

  /** A till, a pickup counter and something to make drinks with: the least it takes to open. */
  get canTrade(): boolean {
    const need = [SERVICE_DEFS.till, SERVICE_DEFS.pickup, this.venue.drinkStation];
    return need.every((def) => this.state.objects.some((o) => o.def === def));
  }

  // ---------------------------------------------------------------- time

  get minuteOfDay(): number {
    return Math.floor(this.state.tick / TICKS_PER_MINUTE) % (24 * 60);
  }

  get day(): number {
    return Math.floor(this.state.tick / TICKS_PER_DAY) + 1;
  }

  clock(): string {
    const m = this.minuteOfDay;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  isOpen(): boolean {
    const m = this.minuteOfDay;
    return m >= this.venue.hours.open && m < this.venue.hours.close;
  }

  /** True when the café is shut and nobody is on site, so the game can fast-forward. */
  isQuiet(): boolean {
    // Live-ins at home in the flat don't stop the overnight skip.
    return !this.isOpen() && this.state.pawns.every((p) => !p.onMap || (!!p.staff && !this.onShift(p) && livesHere(this, p)));
  }

  // ---------------------------------------------------------------- people

  /** Adds a staff member: random, or from an applicant's details. */
  addStaff(shift: Shift, from?: Applicant): Pawn {
    const s = this.state;
    const priorities = {} as Priorities;
    const skills = {} as Skills;
    for (const w of WORK_TYPES) {
      priorities[w.id] = randInt(s, 2, 3);
      skills[w.id] = from ? from.skills[w.id] : Math.round(randRange(s, 1, 8) * 10) / 10;
    }
    // Everyone has one thing they're keen on.
    priorities[pick(s, WORK_TYPES).id] = 1;
    const traits: TraitId[] = from ? [...from.traits] : randomTraits(this);
    const p: Pawn = {
      id: s.nextId++,
      name: from?.name ?? this.uniqueName(),
      kind: 'staff',
      look: from ? { ...from.look } : {
        skin: pick(s, SKIN_TONES),
        hair: pick(s, HAIR_COLOURS),
        hairStyle: pick(s, HAIR_STYLES),
        shirt: this.venue.uniform.shirt,
        apron: this.venue.uniform.apron,
      },
      x: 0,
      y: 0,
      onMap: false,
      moving: false,
      needs: Object.fromEntries(NEEDS.map((n) => [n.id, randRange(s, 0.6, 0.9)])) as NeedValues,
      job: null,
      shift,
      leftAt: s.tick - 10 * TICKS_PER_HOUR,
      arrivedDay: 0,
      carrying: null,
      staff: {
        priorities, skills, tipsToday: 0, tipsTotal: 0, traits, memories: [], mood: 60,
        belowSince: { minor: null, major: null, severe: null }, highSince: null, lastBreak: s.tick,
        mentalBreak: null, inspiration: null, quit: false, sickDay: null, servedToday: 0,
        forcedBreak: false, homeEarlyDay: null, fired: false, wants: [], station: null, focus: null,
      } as Partial<StaffInfo> as StaffInfo,
      visit: null,
    };
    if (from) {
      p.staff!.passions = [...from.passions];
      p.staff!.wage = from.wage;
    }
    fillStaff(p.staff!, p.id, this.day);
    s.pawns.push(p);
    topUpWants(this, p);
    return p;
  }

  uniqueName(): string {
    const taken = new Set(this.state.pawns.map((p) => p.name));
    const free = FIRST_NAMES.filter((n) => !taken.has(n));
    return pick(this.state, free.length > 0 ? free : FIRST_NAMES);
  }

  /** A menu item at today's price. */
  menuItem(name: string): MenuItem {
    const item = this.state.menu.find((m) => m.name === name);
    if (!item) throw new Error(`Unknown menu item: ${name}`);
    return { name: item.name, kind: item.kind, price: item.price };
  }

  pawnById(id: number): Pawn | undefined {
    return this.state.pawns.find((p) => p.id === id);
  }

  /** 0-1. Staff use their mood ledger; anyone else falls back to how their needs are doing. */
  mood(p: Pawn): number {
    return p.staff ? p.staff.mood / 100 : moodFromNeeds(p.needs);
  }

  // ---------------------------------------------------------------- relationships

  private pairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /** Whether two people are a couple, without creating a relation record just by asking. */
  together(a: number, b: number): boolean {
    return this.state.relations[this.pairKey(a, b)]?.together === true;
  }

  relation(a: number, b: number): Relation {
    const key = this.pairKey(a, b);
    return (this.state.relations[key] ??= { romance: 0, together: false });
  }

  /** How well two people naturally click, -1 to 1. Fixed per pair for a given seed. */
  compatibility(a: number, b: number): number {
    let h = (this.state.seed ^ Math.imul(Math.min(a, b), 0x9e3779b1) ^ Math.imul(Math.max(a, b), 0x85ebca6b)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 13;
    return ((h >>> 0) % 2001) / 1000 - 1;
  }

  opinion(of: Pawn, about: Pawn): number {
    return Math.round(opinionFromMemories(of, about.id) + this.compatibility(of.id, about.id) * 15);
  }

  partnerOf(p: Pawn): Pawn | null {
    for (const other of this.state.pawns) {
      if (other.id !== p.id && other.staff && !other.staff.quit && this.relation(p.id, other.id).together) return other;
    }
    return null;
  }

  /** Adds to the event feed. A `tale` kind with interest makes it a candidate for the recap. */
  log(text: string, tone: LogEntry['tone'], pawn: number | null = null, tale: string | null = null, interest = 0): void {
    const log = this.state.log;
    log.push({ tick: this.state.tick, text, tone, pawn, tale, interest });
    if (log.length > 120) log.splice(0, log.length - 120);
    if (tale && FAME_TALES.has(tale)) this.remember(text);
    letterFromLog(this, text, tone, pawn, tale);
  }

  /** Keeps a moment in the hall of fame for good. */
  remember(text: string): void {
    const fame = this.state.hallOfFame;
    fame.push({ day: this.day, text });
    if (fame.length > 50) fame.shift();
  }

  hasCondition(id: ConditionId): boolean {
    return this.state.conditions.some((c) => c.id === id && c.until > this.state.tick);
  }

  /** A guest turns up (if there's room in the queue). */
  arriveGuest(): void {
    tryArrive(this);
  }

  activity(p: Pawn): string {
    if (!p.onMap) return 'Off shift';
    const job = p.job;
    if (!job) return p.visit ? guestIdleLabel(p) : IDLE_LABEL;
    if (job.goal && job.steps[job.index]?.kind === 'goto') return `Going to ${job.goal}`;
    return job.label;
  }

  /** On the clock right now: in their shift hours, and not off, sick or sent home today. */
  onShift(p: Pawn): boolean {
    const m = this.minuteOfDay;
    const staff = p.staff;
    if (staff && (staff.homeEarlyDay === this.day || staff.sickDay === this.day || isDayOff(this, p))) return false;
    // While the place is still being fitted out, nobody comes in (or gets paid).
    if (staff && !this.canTrade) return false;
    return m >= p.shift.start && m < p.shift.end;
  }

  // ---------------------------------------------------------------- ticking

  step(): void {
    const s = this.state;
    s.tick++;
    if (s.tick % TICKS_PER_MINUTE === 0) this.everyMinute();
    if (s.tick % 10 === 0) updateRushes(this);
    // Iterate a copy: guests leave the list mid-loop.
    for (const p of [...s.pawns]) {
      if (!p.onMap) continue;
      if (p.kind === 'guest') {
        if (!p.job) guestTick(this, p);
      } else {
        if ((s.tick + p.id * 7) % IDLE_RECHECK_TICKS === 0 && (p.job?.idle || p.job?.label === IDLE_LABEL)) this.interruptIdle(p);
        if (!p.job) this.decide(p);
      }
      if (p.job) this.runJob(p, p.job);
      // Staff who just finished something pick the next thing straight away, never standing jobless.
      if (!p.job && p.kind === 'staff' && p.onMap) this.decide(p);
    }
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  private everyMinute(): void {
    const s = this.state;
    const m = this.minuteOfDay;
    if (m === 0) this.newDay();
    if (m === this.venue.hours.close) closeUp(this);
    for (const p of s.pawns) {
      if (p.kind !== 'staff') continue;
      const staff = p.staff!;
      stressEveryMinute(this, p);
      if (!p.onMap && staff.mentalBreak && s.tick >= staff.mentalBreak.until) {
        if (staff.mentalBreak.kind === 'walkout') addMemory(this, p, 'walkedOut');
        staff.mentalBreak = null;
      }
      if (p.onMap) {
        this.decayNeeds(p);
        expireMemories(this, p);
        driftMood(this, p);
        const working = this.onShift(p);
        if (working) {
          checkBreaks(this, p);
          const wage = staff.wage / 60;
          s.money -= wage;
          s.today.wages += wage;
          // A live-in's shift starts where they are: the alarm goes and they come down.
          if (p.arrivedDay !== this.day) {
            p.arrivedDay = this.day;
            staff.lastBreak = s.tick;
            if (p.job?.home) this.endJob(p);
          }
        } else if (!this.isLeaving(p) && !p.job?.home) {
          this.offShift(p);
        }
      } else if (this.onShift(p) && p.arrivedDay !== this.day && !staff.quit && !staff.mentalBreak && staff.sickDay !== this.day && !isDayOff(this, p)) {
        this.arrive(p);
      }
    }
    socialEveryMinute(this);
    canoodle(this);
    guestsEveryMinute(this);
    storytellerEveryMinute(this);
    if (m % 10 === 0) checkWants(this);
    lapseDecisions(this);
    this.maybeRecap();
  }

  /** Once the café has shut and emptied, write up the day. */
  private maybeRecap(): void {
    const s = this.state;
    // Nothing to write up while it's still being fitted out.
    if (s.story.recapDay === this.day || !this.canTrade) return;
    const m = this.minuteOfDay;
    const emptied = m >= this.venue.hours.close && s.pawns.every((p) => !p.onMap);
    if (emptied || m === 24 * 60 - 1) {
      checkGoals(this);
      s.recaps.push(buildRecap(this));
      if (s.recaps.length > 60) s.recaps.shift();
      s.story.recapDay = this.day;
    }
  }

  private newDay(): void {
    const s = this.state;
    this.walkYesterday = this.walkToday;
    this.walkToday = emptyWalkStats();
    for (let i = 0; i < this.footfall.length; i++) this.footfall[i] *= 0.5;
    s.yesterday = s.today;
    s.today = emptyDay();
    morningBooks(this);
    for (const p of s.pawns) {
      if (!p.staff) continue;
      p.staff.tipsToday = 0;
      p.staff.servedToday = 0;
    }
    storytellerNewDay(this);
    refreshApplicants(this);
    for (const p of s.pawns) if (p.staff && !p.staff.quit) topUpWants(this, p);
  }

  /** Someone left for good (quit or fired): colleagues react and they're gone from the books. */
  removeStaff(p: Pawn): void {
    const s = this.state;
    const fired = p.staff?.fired === true;
    for (const other of s.pawns) {
      if (other.id === p.id || !other.staff || other.staff.quit) continue;
      const op = this.opinion(other, p);
      const memory = op >= 40 ? 'friendQuit' : op <= -30 ? 'goodRiddance' : fired ? 'colleagueFired' : 'colleagueQuit';
      addMemory(this, other, memory, p);
    }
    for (const key of Object.keys(s.relations)) {
      if (key.split(':').map(Number).includes(p.id)) delete s.relations[key];
    }
    if (!fired) friendsMayFollow(this, p);
    this.releaseAll(p);
    s.pawns = s.pawns.filter((x) => x.id !== p.id);
    if (!fired) {
      s.story.quitsToday++;
      this.log(`${p.name}'s shifts need covering. There are applicants waiting in Staff.`, 'neutral', null);
    }
  }

  private decayNeeds(p: Pawn): void {
    const sitting = p.job?.sitting === true;
    const hot = this.hasCondition('heatwave');
    // Asleep, the body ticks over slowly: nobody wakes up starving after a night's sleep.
    const asleep = p.job?.label === 'Asleep';
    for (const def of NEEDS) {
      if (def.id === 'comfort' && sitting) continue;
      let rate = def.id === 'comfort' && hot ? def.decayPerHour * 1.5 : def.decayPerHour;
      if (asleep && def.id !== 'energy') rate *= 0.2;
      p.needs[def.id] = clamp01(p.needs[def.id] - rate / 60);
    }
  }

  /**
   * Life off site, abstracted. Hours away are split into evening, sleep and commute;
   * needs carry over, so a close-then-open turnaround arrives tired.
   */
  private arrive(p: Pawn): void {
    const s = this.state;
    const hoursAway = (s.tick - p.leftAt) / TICKS_PER_HOUR;
    const sleep = Math.min(9, Math.max(0, hoursAway - 3));
    const awake = hoursAway - sleep;
    p.needs.energy = clamp01(p.needs.energy + sleep * 0.11 - awake * 0.04);
    p.needs.hunger = clamp01(randRange(s, 0.65, 0.95));
    p.needs.bladder = clamp01(randRange(s, 0.75, 1));
    p.needs.comfort = clamp01(p.needs.comfort + hoursAway * 0.08);
    this.placeAtEntry(p);
    p.onMap = true;
    p.arrivedDay = this.day;
    if (p.staff) p.staff.lastBreak = s.tick;
    p.job = null;
  }

  placeAtEntry(p: Pawn): void {
    const entry = this.venue.entry;
    const [ex, ey] = entry[randInt(this.state, 0, entry.length - 1)];
    p.x = ex;
    p.y = ey;
  }

  private isLeaving(p: Pawn): boolean {
    return p.job?.steps.some((st) => st.kind === 'exit') === true;
  }

  private sendHome(p: Pawn): void {
    this.endJob(p);
    p.job = this.leaveJob('Heading home');
  }

  /** End of the shift: home to the flat if they live in, otherwise out the door. */
  private offShift(p: Pawn): void {
    if (!livesHere(this, p)) {
      this.sendHome(p);
      return;
    }
    this.endJob(p);
    p.job = homeJob(this, p, (bed) => {
      const candidates = bed
        ? scoreCandidates(this.state, this.world, p, true).filter((c) => c.offer.id === 'sleep')
        : scoreCandidates(this.state, this.world, p);
      return this.startNeedJob(p, candidates);
    });
    if (!p.job) this.sendHome(p);
  }

  leaveJob(label: string): Job {
    const entry = this.venue.entry;
    const [ex, ey] = entry[randInt(this.state, 0, entry.length - 1)];
    return this.makeJob(label, [this.gotoStep(ex, ey), { kind: 'exit' }]);
  }

  /**
   * Staff decision order: urgent needs, then work by priority, then any need worth
   * meeting, then idling. Needs and work compete the way RimWorld's think tree sorts them.
   */
  private decide(p: Pawn): void {
    const broken = breakJob(this, p);
    if (broken) {
      p.job = broken;
      return;
    }
    if (!this.onShift(p)) {
      this.offShift(p);
      return;
    }
    if (p.staff?.forcedBreak) {
      p.staff.forcedBreak = false;
      // The manager said take a break: lunch if at all peckish, otherwise feet up.
      const breakOffers = scoreCandidates(this.state, this.world, p, true).filter((c) =>
        c.offer.id === 'rest' || (c.offer.id === 'lunch' && p.needs.hunger < 0.8));
      if (this.startNeedJob(p, breakOffers)) return;
    }
    const candidates = scoreCandidates(this.state, this.world, p);
    if (candidates.length > 0 && worstNeed(p.needs) < URGENT_NEED && this.startNeedJob(p, candidates)) return;
    const work = findWork(this, p);
    if (work) {
      p.job = work;
      return;
    }
    if (this.startNeedJob(p, candidates)) return;
    const standBy = standByJob(this, p);
    if (standBy) {
      p.job = standBy;
      return;
    }
    this.idle(p);
  }

  /**
   * An idle pawn looks up now and then. It only drops its wander if there's actually
   * something to do; otherwise it would twitch between random spots.
   */
  private interruptIdle(p: Pawn): void {
    if (p.staff?.mentalBreak) return;
    if (!this.onShift(p)) {
      // At home in the flat: only stop pottering about if there's something they need.
      if (p.job?.home && livesHere(this, p)) {
        if (bedtime(this, p) && p.job.label !== 'Asleep' && !p.job.steps.some((st) => st.kind === 'use')) {
          this.offShift(p);
          return;
        }
        const candidates = scoreCandidates(this.state, this.world, p);
        if (candidates.length === 0) return;
        const pottering = p.job;
        this.endJob(p);
        if (this.startNeedJob(p, candidates)) p.job!.home = true;
        else p.job = pottering;
        return;
      }
      this.offShift(p);
      return;
    }
    const work = findWork(this, p);
    if (work) {
      this.endJob(p);
      p.job = work;
      return;
    }
    const candidates = scoreCandidates(this.state, this.world, p);
    if (candidates.length > 0) {
      // Only drop the wander (or the wait at their post) if a need job actually starts.
      const waiting = p.job;
      this.endJob(p);
      if (!this.startNeedJob(p, candidates)) p.job = waiting;
    }
  }

  /** Tries offers in choice order until one is reachable. Returns false if none are. */
  private startNeedJob(p: Pawn, candidates: ReturnType<typeof scoreCandidates>): boolean {
    const list = [...candidates];
    while (list.length > 0) {
      const c = pickCandidate(this.state, p, list);
      if (!c) break;
      const go = this.gotoStep(c.spot[0], c.spot[1]);
      go.path = this.pathFrom(p, c.spot[0], c.spot[1]);
      if (!go.path) {
        list.splice(list.indexOf(c), 1);
        continue;
      }
      const goal = c.offer.label.charAt(0).toLowerCase() + c.offer.label.slice(1);
      const job = this.makeJob(c.offer.doing, [go, this.useStep(c.object.id, c.offer)], goal);
      this.reserve(job, p, reservationKey(c.object.id, c.spotIndex));
      p.job = job;
      return true;
    }
    return false;
  }

  private idle(p: Pawn): void {
    const s = this.state;
    for (let tries = 0; tries < 12; tries++) {
      const x = randInt(s, 0, s.w - 1);
      const y = randInt(s, 0, s.h - 1);
      if (!this.world.passable(x, y) || !IDLE_FLOORS.has(this.world.tile(x, y).floor)) continue;
      const g = this.gotoStep(x, y);
      g.path = this.pathFrom(p, x, y);
      if (!g.path) continue;
      p.job = { ...this.makeJob(IDLE_LABEL, [g, { kind: 'wait', ticksLeft: randInt(s, 2, 6) * TICKS_PER_MINUTE }]), idle: true };
      return;
    }
    p.job = { ...this.makeJob(IDLE_LABEL, [{ kind: 'wait', ticksLeft: 2 * TICKS_PER_MINUTE }]), idle: true };
  }

  // ---------------------------------------------------------------- jobs (shared with guests.ts and work.ts)

  makeJob(label: string, steps: Step[], goal: string | null = null): Job {
    return { label, goal, steps, index: 0, reservations: [], stepStartedAt: this.state.tick, sitting: false };
  }

  gotoStep(x: number, y: number): Extract<Step, { kind: 'goto' }> {
    return { kind: 'goto', x, y, path: null, node: 0 };
  }

  private useStep(objectId: number, offer: OfferDef): Step {
    const total = offer.minutes * TICKS_PER_MINUTE;
    return { kind: 'use', objectId, offerId: offer.id, ticksLeft: total, total };
  }

  pathFrom(p: Pawn, x: number, y: number): [number, number][] | null {
    const from = [Math.round(p.x), Math.round(p.y)] as const;
    const found = findPath(this.state.w, this.state.h, this.world.passable, from, [x, y]);
    if (!found) return null;
    const path: [number, number][] = found.map(([px, py]) => [px, py]);
    // Re-routed mid-step: if we're already heading past the start tile, don't hop back to its centre.
    if (path.length >= 2) {
      const [ax, ay] = path[0];
      const [bx, by] = path[1];
      if (Math.hypot(bx - p.x, by - p.y) <= Math.hypot(bx - ax, by - ay)) path.shift();
    }
    return path;
  }

  /** After the layout changes: anyone whose route now runs into something works out a new one. */
  reroute(): void {
    for (const p of this.state.pawns) {
      const st = p.job?.steps[p.job.index];
      if (st?.kind !== 'goto' || !st.path) continue;
      if (st.path.slice(st.node).some(([x, y]) => !this.world.passable(x, y))) {
        st.path = null;
        st.node = 0;
      }
    }
  }

  isReservedByOther(key: string, p: Pawn): boolean {
    const holder = this.state.reservations[key];
    return holder !== undefined && holder !== p.id;
  }

  reserve(job: Job, p: Pawn, key: string): void {
    this.state.reservations[key] = p.id;
    job.reservations.push(key);
  }

  releaseAll(p: Pawn): void {
    for (const [key, holder] of Object.entries(this.state.reservations)) {
      if (holder === p.id) delete this.state.reservations[key];
    }
  }

  /** Ends a job early (interrupted or failed): whatever was in hand is dealt with. */
  endJob(p: Pawn): void {
    const job = p.job;
    if (!job) return;
    const st = job.steps[job.index];
    if (st && st.kind === 'act') abandonAction(this, p, st.action);
    if (p.kind === 'staff') abandonAction(this, p, null);
    this.finishJob(p);
  }

  private finishJob(p: Pawn): void {
    const job = p.job!;
    for (const key of job.reservations) {
      if (this.state.reservations[key] === p.id) delete this.state.reservations[key];
    }
    p.job = null;
    p.moving = false;
  }

  private advance(p: Pawn, job: Job): void {
    job.index++;
    job.stepStartedAt = this.state.tick;
    job.sitting = false;
    if (job.index >= job.steps.length) this.finishJob(p);
  }

  private runJob(p: Pawn, job: Job): void {
    const st = job.steps[job.index];
    // Long uses (a night's sleep) get their full length before they count as stuck.
    const limit = st?.kind === 'use' ? Math.max(STEP_TIMEOUT_TICKS, st.total + 30 * TICKS_PER_MINUTE) : STEP_TIMEOUT_TICKS;
    if (this.state.tick - job.stepStartedAt > limit) {
      this.endJob(p);
      return;
    }
    switch (st.kind) {
      case 'goto': {
        if (!st.path) st.path = this.pathFrom(p, st.x, st.y);
        if (!st.path) {
          this.endJob(p);
          return;
        }
        if (this.walk(p, st)) this.advance(p, job);
        return;
      }
      case 'use': {
        const o = this.world.objectById(st.objectId);
        const offer = o && objectDef(o.def).offers.find((of) => of.id === st.offerId);
        if (!o || !offer) {
          this.endJob(p);
          return;
        }
        job.sitting = offer.sits === true;
        for (const def of NEEDS) {
          const d = offer.deltas[def.id];
          if (d !== undefined) p.needs[def.id] = clamp01(p.needs[def.id] + d / st.total);
        }
        if (--st.ticksLeft <= 0) {
          this.rememberOffer(p, offer);
          this.advance(p, job);
        }
        return;
      }
      case 'act': {
        if (!validateAction(this, p, st.action, st.ticksLeft === st.total)) {
          this.endJob(p);
          return;
        }
        if (--st.ticksLeft <= 0) {
          performAction(this, p, st.action);
          const staff = p.staff;
          if (staff) {
            // Practice makes better: much faster at something they love, slowly otherwise.
            // Each point is harder won than the last, so mastery takes weeks.
            const rate = staff.passions.includes(st.work) ? 0.006 : 0.0015;
            const now = staff.skills[st.work];
            staff.skills[st.work] = Math.min(10, now + rate * (1 - now / 12) ** 2);
            staff.lastWork = st.work;
            this.walkToday[st.work].tasks++;
          }
          this.advance(p, job);
        }
        return;
      }
      case 'wait': {
        if (--st.ticksLeft <= 0) this.advance(p, job);
        return;
      }
      case 'exit': {
        this.finishJob(p);
        p.onMap = false;
        p.leftAt = this.state.tick;
        if (p.kind === 'guest') removeGuest(this, p);
        else if (p.staff?.quit) this.removeStaff(p);
        return;
      }
    }
  }

  private rememberOffer(p: Pawn, offer: OfferDef): void {
    if (!p.staff) return;
    if (offer.id === 'lunch' || offer.id === 'rest') p.staff.lastBreak = this.state.tick;
    if (offer.id === 'lunch') addMemory(this, p, 'properLunch');
    else if (offer.id === 'rest') addMemory(this, p, 'feetUp');
    else if (offer.id === 'coffee') addMemory(this, p, hasTrait(p, 'coffeeSnob') ? 'snobCoffee' : 'sneakyCoffee');
    else if (offer.id === 'lemonade') addMemory(this, p, 'sneakyLemonade');
  }

  /** Small randomness helper for systems that don't hold the state directly. */
  chance(probability: number): boolean {
    return random(this.state) < probability;
  }

  /** Moves the pawn along its path. Returns true on arrival. */
  private walk(p: Pawn, st: Extract<Step, { kind: 'goto' }>): boolean {
    const path = st.path!;
    let budget = WALK_SPEED;
    while (budget > 0 && st.node < path.length) {
      const [nx, ny] = path[st.node];
      const dx = nx - p.x;
      const dy = ny - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        p.x = nx;
        p.y = ny;
        budget -= dist;
        st.node++;
        this.step_(nx, ny);
        if (this.state.spills.length > 0) checkSlip(this, p);
      } else {
        p.x += (dx / dist) * budget;
        p.y += (dy / dist) * budget;
        budget = 0;
      }
    }
    p.moving = st.node < path.length;
    const work = p.job?.work;
    if (work && p.moving) this.walkToday[work].walk++;
    return !p.moving;
  }

  /** Counts a footstep on a tile. */
  private step_(x: number, y: number): void {
    const s = this.state;
    if (this.footfall.length !== s.w * s.h) this.footfall = new Float32Array(s.w * s.h);
    this.footfall[y * s.w + x]++;
  }
}

function guestIdleLabel(p: Pawn): string {
  const v = p.visit!;
  switch (v.state) {
    case 'queuing': return 'Queuing';
    case 'ordering': return 'Ordering';
    case 'waiting': return `Waiting for ${v.items.join(' and ')}`;
    case 'collecting': return 'Collecting their order';
    case 'toSeat': return 'Finding a seat';
    case 'eating': return `Enjoying ${v.items.join(' and ')}`;
    case 'leaving': return 'Leaving';
  }
}
