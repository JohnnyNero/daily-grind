// The top bar, the selected-person sheet and the staff panel's jobs and log.
// Plain DOM over the canvas keeps text crisp.

import { showingsToday } from '../sim/cinema';
import { BREAK_LABELS } from '../sim/breaks';
import { NEEDS, WORK_COLOURS, WORK_TYPES, traitDef, type WorkType } from '../sim/defs';
import { homeWork } from '../sim/work';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type DayStats, type LogEntry, type Pawn, type Recap } from '../sim/state';
import { moodReasons } from '../sim/thoughts';
import { paintPortrait } from './characterForm';
import { el, hhmm, setupTabs } from './dom';
import { stars } from '../sim/business';
import { WEEKDAYS, weekday } from '../sim/stakes';

/** Every story stays up at least this long, so it can be read. */
const TOAST_MIN_MS = 4000;
/** Longer stories get a little longer (per character). */
const TOAST_PER_CHAR_MS = 45;
/** Stories waiting their turn; past this, everyday chatter is dropped. */
const TOAST_QUEUE = 4;

/** Mood reasons shown before "Show more". */
const TOP_REASONS = 4;

export function pounds(pence: number): string {
  const sign = pence < 0 ? '−' : '';
  return `${sign}£${Math.abs(Math.round(pence / 100)).toLocaleString('en-GB')}`;
}

function meterColour(v: number): string {
  if (v < 0.25) return 'var(--bad)';
  if (v < 0.5) return 'var(--warn)';
  return 'var(--good)';
}

const VERDICTS = {
  happy: 'Loved it.',
  fine: 'Perfectly fine.',
  annoyed: 'Not impressed.',
  furious: 'Furious. Wants a refund.',
} as const;

/** Cycle order when tapping a priority cell. */
const NEXT_PRIORITY: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 0, 0: 1 };

export class Hud {
  private day = el('day');
  private time = el('time');
  private money = el('money');
  private rep = el('rep');
  private status = el('status');
  private sheet = el('sheet');
  private name = el('sheet-name');
  private activity = el('sheet-activity');
  private moodLabel = el('mood-label');
  private moodRow = el('mood-label').parentElement!;
  private moodFill = el('mood-fill');
  private moodValue = el('mood-value');
  private needsBox = el('needs');
  private shift = el('sheet-shift');
  private staffPanel = el('staff-panel');
  private priorities = el<HTMLTableElement>('priorities');
  private daySummary = el('day-summary');
  private traits = el('sheet-traits');
  private reasons = el('reasons');
  private relations = el('relations');
  private wants = el('wants');
  private more = el('sheet-more');
  private moreToggle = el<HTMLButtonElement>('sheet-toggle');
  private portrait = el<HTMLCanvasElement>('sheet-portrait');
  /** Whether the sheet shows every reason, colleague and want. */
  private showAll = false;
  private sheetFor: number | null = null;
  private portraitKey = '';
  private summaryKey = '';
  private detailsKey = '';
  private toast = el<HTMLButtonElement>('toast');
  private events = el('events');
  private recapBox = el('recap');
  private recapsSeen = 0;
  private toastUntil = 0;
  private toastQueue: LogEntry[] = [];
  private lastEntry: LogEntry | null = null;
  private toastPawn: number | null = null;
  private needFills = new Map<string, { fill: HTMLElement; value: HTMLElement }>();
  private speedButtons: HTMLButtonElement[];

  constructor(
    private readonly sim: Sim,
    onSpeed: (speed: number) => void,
    private readonly onCloseSheet: () => void,
    private readonly onSelect: (pawnId: number) => void,
  ) {
    this.toast.addEventListener('click', () => {
      // Tapping a toast jumps to who it's about, and moves on to the next story.
      this.toastUntil = 0;
      if (this.toastPawn !== null) this.onSelect(this.toastPawn);
    });
    for (const def of NEEDS) {
      const row = document.createElement('div');
      row.className = 'meter';
      const label = document.createElement('span');
      label.textContent = def.label;
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill';
      track.append(fill);
      const value = document.createElement('b');
      row.append(label, track, value);
      this.needsBox.append(row);
      this.needFills.set(def.id, { fill, value });
    }
    this.speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')];
    for (const b of this.speedButtons) b.addEventListener('click', () => onSpeed(Number(b.dataset.speed)));
    el('sheet-close').addEventListener('click', onCloseSheet);
    this.moreToggle.addEventListener('click', () => {
      this.showAll = !this.showAll;
    });
    setupTabs(this.staffPanel);
    el('staff-open').addEventListener('click', () => this.openStaffPanel());
    el('staff-close').addEventListener('click', () => {
      this.staffPanel.hidden = true;
    });
    el('recap-close').addEventListener('click', () => {
      this.recapBox.hidden = true;
    });
    el('recap-open').addEventListener('click', () => {
      const recaps = this.sim.state.recaps;
      if (recaps.length > 0) this.showRecap(recaps[recaps.length - 1]);
    });
    // Recaps already written before this page loaded (a restored game) don't pop up.
    this.recapsSeen = sim.state.recaps.length;
  }

  setSpeed(speed: number): void {
    for (const b of this.speedButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
  }

  get staffPanelOpen(): boolean {
    return !this.staffPanel.hidden;
  }

  /** Set by main: whether a panel this class doesn't own is open. */
  otherPanelOpen: () => boolean = () => false;

  /** While the recap is up the game holds still. */
  get recapOpen(): boolean {
    return !this.recapBox.hidden;
  }

  showRecap(r: Recap): void {
    this.staffPanel.hidden = true;
    this.onCloseSheet();
    el('recap-day').textContent = `Day ${r.day} recap`;
    el('recap-headline').textContent = r.headline;
    const net = r.stats.takings - r.stats.wages;
    const repDelta = Math.round(r.repEnd - r.repStart);
    const stats: [string, string, number][] = [
      ['Served', String(r.stats.served), 0],
      ['Walked out', String(r.stats.walkouts), r.stats.walkouts > 15 ? -1 : 0],
      ['Rep', `${Math.round(r.repEnd)} (${repDelta >= 0 ? '+' : ''}${repDelta})`, Math.sign(repDelta)],
      ['Takings', pounds(r.stats.takings), 0],
      ['Wages', pounds(r.stats.wages), 0],
      ['Net', pounds(net), Math.sign(net)],
    ];
    el('recap-stats').replaceChildren(
      ...stats.map(([label, value, sign]) => {
        const box = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        if (sign < 0) dd.className = 'neg';
        else if (sign > 0) dd.className = 'pos';
        box.append(dt, dd);
        return box;
      }),
    );
    const stories = r.stories.length > 0 ? r.stories : ['Nothing much happened. Honestly, bliss.'];
    el('recap-stories').replaceChildren(
      ...stories.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
    const quote = el('recap-review');
    quote.hidden = !r.review;
    if (r.review) {
      const cite = document.createElement('cite');
      cite.textContent = `${'★'.repeat(r.review.stars)}${'☆'.repeat(5 - r.review.stars)} ${r.review.name}${r.review.critic ? ', restaurant critic' : ''}`;
      quote.replaceChildren(`“${r.review.text.replace(/^["“]+|["”]+$/g, '')}”`, cite);
    }
    el('recap-star').textContent = r.star ? `Star of the day: ${r.star}` : '';
    this.recapBox.hidden = false;
    el<HTMLButtonElement>('recap-close').focus();
  }

  /** Set by main: renders the Team and Applicants sections when the panel opens. */
  onStaffPanelOpen: (() => void) | null = null;
  /** Set by main: closes panels this class doesn't own (the café panel). */
  onClosePanels: (() => void) | null = null;

  private openStaffPanel(): void {
    this.closePanels();
    this.buildPriorities();
    this.renderEvents(this.sim.state.log);
    this.onStaffPanelOpen?.();
    this.staffPanel.hidden = false;
  }

  /** Rebuilds the staff panel after the team changes (a hire). */
  refreshStaffPanel(): void {
    if (!this.staffPanelOpen) return;
    this.buildPriorities();
    this.onStaffPanelOpen?.();
  }

  closePanels(): void {
    this.onCloseSheet();
    this.staffPanel.hidden = true;
    this.onClosePanels?.();
  }

  /** A one-off message (a build error, "Saved.") in the toast slot. */
  notify(text: string, tone: LogEntry['tone'] = 'neutral'): void {
    this.toast.textContent = text;
    this.toast.className = `toast ${tone}`;
    this.toastPawn = null;
    this.toast.hidden = false;
    this.toastUntil = performance.now() + 4000;
  }

  private buildPriorities(): void {
    const table = this.priorities;
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.textContent = 'Staff';
    head.append(corner);
    for (const w of WORK_TYPES) {
      const th = document.createElement('th');
      th.scope = 'col';
      const dot = document.createElement('i');
      dot.className = 'work-dot';
      dot.style.background = WORK_COLOURS[w.id];
      th.append(dot, this.sim.venue.workLabels[w.id] ?? w.label);
      th.title = w.description;
      head.append(th);
    }
    const body = table.createTBody();
    for (const p of this.sim.state.pawns) {
      if (!p.staff || p.staff.quit) continue;
      const row = body.insertRow();
      const name = document.createElement('th');
      name.scope = 'row';
      name.append(p.name);
      const small = document.createElement('small');
      small.textContent = `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}`;
      name.append(small);
      row.append(name);
      for (const w of WORK_TYPES) {
        const cell = row.insertCell();
        const button = document.createElement('button');
        button.type = 'button';
        this.paintPriority(button, p, w.id);
        button.addEventListener('click', () => {
          const staff = p.staff!;
          staff.priorities[w.id] = NEXT_PRIORITY[staff.priorities[w.id]] ?? 1;
          this.paintPriority(button, p, w.id);
        });
        cell.append(button);
      }
    }
  }

  private paintPriority(button: HTMLButtonElement, p: Pawn, work: WorkType): void {
    const value = p.staff!.priorities[work];
    const skill = Math.floor(p.staff!.skills[work]);
    button.dataset.p = String(value);
    button.classList.toggle('station', p.staff!.station === work);
    button.classList.toggle('passion', p.staff!.passions.includes(work));
    button.replaceChildren(value === 0 ? 'off' : String(value));
    const small = document.createElement('small');
    small.textContent = String(skill);
    button.append(small);
    const label = this.sim.venue.workLabels[work] ?? WORK_TYPES.find((w) => w.id === work)!.label;
    const station = (p.staff!.station === work ? ', their station' : '') + (p.staff!.passions.includes(work) ? ', loves it' : '');
    button.setAttribute('aria-label', `${p.name}, ${label}: ${value === 0 ? 'off' : `priority ${value}`}, skill ${skill}${station}`);
  }

  /**
   * Queues new log entries as toasts and shows them one at a time, each long enough to
   * read. When it's busy, everyday chatter makes way for proper stories.
   */
  private updateLog(now: number): void {
    const log = this.sim.state.log;
    // New entries since last frame. The log is capped, so if our place fell off the
    // front, take the last few; on the very first frame, start from now.
    let fresh: LogEntry[] = [];
    if (this.lastEntry === null) {
      this.lastEntry = log[log.length - 1] ?? null;
    } else if (log[log.length - 1] !== this.lastEntry) {
      const at = log.lastIndexOf(this.lastEntry);
      fresh = at >= 0 ? log.slice(at + 1) : log.slice(-3);
    }
    if (fresh.length > 0) {
      this.lastEntry = log[log.length - 1];
      for (const e of fresh) {
        const chatter = !e.tale && e.interest === 0 && e.tone === 'neutral';
        if (chatter && this.toastQueue.length >= 2) continue;
        this.toastQueue.push(e);
        if (e.interest >= 6) this.onBigEvent?.();
      }
      while (this.toastQueue.length > TOAST_QUEUE) {
        const i = this.toastQueue.findIndex((e) => !e.tale);
        this.toastQueue.splice(i >= 0 ? i : 0, 1);
      }
      if (this.staffPanelOpen) this.renderEvents(log);
    }
    if (now < this.toastUntil) return;
    const next = this.toastQueue.shift();
    if (!next) {
      this.toast.hidden = true;
      return;
    }
    this.toast.textContent = this.toastQueue.length > 0 ? `${next.text}  (+${this.toastQueue.length})` : next.text;
    this.toast.className = `toast ${next.tone}`;
    this.toastPawn = next.pawn !== null && this.sim.pawnById(next.pawn) ? next.pawn : null;
    this.toast.hidden = false;
    this.toastUntil = now + TOAST_MIN_MS + next.text.length * TOAST_PER_CHAR_MS;
  }

  /** Set by main: something big happened (worth slowing down for). */
  onBigEvent: (() => void) | null = null;

  private renderEvents(log: LogEntry[]): void {
    this.events.replaceChildren(
      ...log.slice(-12).reverse().map((e) => {
        const li = document.createElement('li');
        const when = document.createElement('span');
        const minute = Math.floor((e.tick % TICKS_PER_DAY) / TICKS_PER_MINUTE);
        when.textContent = `Day ${Math.floor(e.tick / TICKS_PER_DAY) + 1} ${hhmm(minute)}`;
        li.append(when, e.text);
        return li;
      }),
    );
  }

  update(selected: Pawn | null, fastForwarding: boolean, now = performance.now()): void {
    const s = this.sim.state;
    this.updateLog(now);
    if (s.recaps.length > this.recapsSeen) {
      this.recapsSeen = s.recaps.length;
      this.showRecap(s.recaps[s.recaps.length - 1]);
    }
    el('recap-open').hidden = s.recaps.length === 0;
    this.day.textContent = `${WEEKDAYS[weekday(this.sim.day)]} · Day ${this.sim.day}`;
    this.time.textContent = this.sim.clock();
    this.money.textContent = pounds(s.money);
    this.money.classList.toggle('negative', s.money < 0);
    this.rep.textContent = `${stars(this.sim)}★`;
    this.rep.title = `Reputation ${Math.round(s.reputation)}, fame ${Math.round(s.fame)}`;
    if (!this.sim.canTrade) this.status.textContent = 'Fitting out';
    else if (fastForwarding) this.status.textContent = 'Closed · skipping to morning';
    else if (!this.sim.isOpen()) this.status.textContent = 'Closed';
    else {
      const condition = s.conditions.find((c) => c.until > s.tick);
      if (condition) this.status.textContent = this.sim.venue.text.conditions[condition.id];
      else {
        const queuing = s.queue.length > 0 ? `${s.queue.length} queuing` : 'Open';
        // A cinema always has an eye on the next film.
        const next = this.sim.venue.cinema ? showingsToday(this.sim).find((sh) => sh.start >= this.sim.minuteOfDay) : undefined;
        this.status.textContent = next ? `${queuing} · next film ${String(Math.floor(next.start / 60)).padStart(2, '0')}:${String(next.start % 60).padStart(2, '0')}` : queuing;
      }
    }
    if (this.staffPanelOpen) {
      this.renderSummary(s.today);
      this.renderWalkStats();
    }

    this.sheet.hidden = !selected;
    if ((selected?.id ?? null) !== this.sheetFor) {
      this.sheetFor = selected?.id ?? null;
      this.showAll = false;
    }
    // Corner buttons would sit under an open panel; hide them until it closes.
    document.body.classList.toggle('panel-open', !!selected || this.staffPanelOpen || this.otherPanelOpen());
    if (!selected) return;
    this.name.textContent = selected.visit
      ? `${selected.name} (${selected.visit.critic ? 'critic' : selected.visit.regularId !== null ? 'regular' : 'guest'})`
      : selected.name;
    this.activity.textContent = this.sim.activity(selected);
    const key = `${selected.id}|${selected.look.skin}|${selected.look.hair}|${selected.look.hairStyle}|${selected.look.shirt}`;
    if (key !== this.portraitKey) {
      this.portraitKey = key;
      paintPortrait(this.portrait, selected.look);
    }
    if (selected.visit) {
      const v = selected.visit;
      const served = v.state === 'toSeat' || v.state === 'eating' || v.state === 'leaving';
      this.moodRow.hidden = served;
      this.traits.hidden = true;
      this.reasons.hidden = true;
      this.relations.hidden = true;
      this.wants.hidden = true;
      this.more.hidden = true;
      this.moreToggle.hidden = true;
      this.detailsKey = '';
      this.moodLabel.textContent = 'Patience';
      this.setMeter(this.moodFill, this.moodValue, v.patience);
      this.needsBox.hidden = true;
      el('stress-row').hidden = true;
      const order = `Ordered ${v.items.join(' and ')}${v.eatIn ? ' to have in' : ' to take away'}.`;
      const regular = this.sim.state.regulars.find((r) => r.id === v.regularId);
      let about = '';
      if (regular) {
        const fav = this.sim.state.pawns
          .filter((p) => p.staff && (regular.likes[p.id] ?? 0) >= 15)
          .sort((a, b) => (regular.likes[b.id] ?? 0) - (regular.likes[a.id] ?? 0))[0];
        about = ` A regular: visit ${regular.visits + (served ? 0 : 1)}, usual ${regular.usual}.`;
        if (fav) about += ` Soft spot for ${fav.name}.`;
        if (regular.grudge) about += ` Still sore about ${regular.grudge.what} by ${regular.grudge.staffName}.`;
      }
      this.shift.textContent = (served ? `${order} ${VERDICTS[v.mood]}` : order) + about;
      return;
    }
    this.moodRow.hidden = false;
    this.moodLabel.textContent = 'Mood';
    this.setMeter(this.moodFill, this.moodValue, this.sim.mood(selected));
    this.renderStaffDetails(selected);
    this.needsBox.hidden = false;
    const stress = selected.staff ? selected.staff.stress / 100 : 0;
    el('stress-row').hidden = !selected.staff;
    // Stress reads the other way round: full is bad.
    this.setMeter(el('stress-fill'), el('stress-value'), 1 - stress);
    el('stress-value').textContent = `${Math.round(stress * 100)}%`;
    el('stress-fill').style.width = `${Math.round(stress * 100)}%`;
    for (const def of NEEDS) {
      const row = this.needFills.get(def.id)!;
      this.setMeter(row.fill, row.value, selected.needs[def.id]);
    }
    const tips = selected.staff ? ` · Tips today ${pounds(selected.staff.tipsToday)}` : '';
    const station = selected.staff?.station;
    const off = selected.staff && selected.staff.daysOff.length > 0 ? ` · Off ${selected.staff.daysOff.map((d) => WEEKDAYS[d]).join(', ')}` : '';
    const stationText = station ? ` · Station: ${this.sim.venue.workLabels[station] ?? WORK_TYPES.find((w) => w.id === station)!.label}` : '';
    this.shift.textContent = `Shift ${hhmm(selected.shift.start)}–${hhmm(selected.shift.end)}${off}${stationText}${tips}`;
  }

  private renderStaffDetails(p: Pawn): void {
    const staff = p.staff!;
    // Rebuilding these lists every frame is costly on a phone: only redo them when something shown changed.
    const reasons = moodReasons(this.sim, p).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const others = this.sim.state.pawns
      .filter((o) => o.staff && o.id !== p.id && !o.staff.quit)
      .map((o) => ({ o, op: this.sim.opinion(p, o), together: this.sim.together(p.id, o.id) }))
      .sort((a, b) => Number(b.together) - Number(a.together) || Math.abs(b.op) - Math.abs(a.op));
    const key = JSON.stringify([
      p.id, this.showAll, staff.traits, staff.mentalBreak?.kind, staff.inspiration?.kind, p.job?.work, p.job?.idle, p.job?.label,
      reasons.map((r) => [r.label, r.value]), others.map((x) => [x.o.name, x.op, x.together]), staff.wants.map((w) => w.label),
    ]);
    if (key === this.detailsKey) return;
    this.detailsKey = key;
    this.traits.hidden = false;
    this.reasons.hidden = false;
    this.relations.hidden = false;
    const chips: HTMLElement[] = staff.traits.map((t) => {
      const span = document.createElement('span');
      span.textContent = traitDef(t).label;
      span.title = traitDef(t).description;
      return span;
    });
    if (staff.mentalBreak) {
      const span = document.createElement('span');
      span.className = 'break';
      span.textContent = BREAK_LABELS[staff.mentalBreak.kind];
      span.title = `Final straw: ${staff.mentalBreak.finalStraw}`;
      chips.unshift(span);
    }
    if (staff.inspiration) {
      const span = document.createElement('span');
      span.className = 'inspired';
      span.textContent = staff.inspiration.kind === 'latteArt' ? 'Inspired: latte art' : 'Inspired: charm';
      chips.unshift(span);
    }
    // What they're on right now, in that work's colour (matches the badge over their head).
    const work = p.job?.work;
    if (work && this.sim.onShift(p) && !staff.mentalBreak) {
      const home = homeWork(p, this.sim);
      const span = document.createElement('span');
      span.className = 'on-work';
      span.style.setProperty('--work', WORK_COLOURS[work]);
      const label = this.sim.venue.workLabels[work] ?? WORK_TYPES.find((w) => w.id === work)!.label;
      span.textContent = p.job!.idle ? `Waiting: ${label}` : home && home !== work ? `Helping: ${label}` : `On: ${label}`;
      if (home && home !== work && !p.job!.idle) span.classList.add('helping');
      chips.unshift(span);
    }
    this.traits.replaceChildren(...chips);

    this.reasons.replaceChildren(...(this.showAll ? reasons : reasons.slice(0, TOP_REASONS)).map((r) => row(r.label, r.value)));
    this.more.hidden = !this.showAll;
    this.moreToggle.hidden = false;
    this.moreToggle.setAttribute('aria-expanded', String(this.showAll));
    const hiddenReasons = Math.max(0, reasons.length - TOP_REASONS);
    this.moreToggle.textContent = this.showAll
      ? 'Show less'
      : `Show more${hiddenReasons > 0 ? ` (${hiddenReasons} more reason${hiddenReasons === 1 ? '' : 's'})` : ''}`;

    this.relations.replaceChildren(
      ...others.map(({ o, op, together }) => row(`${o.name}: ${together ? 'partner' : relationLabel(op)}`, op)),
    );
    this.wants.hidden = staff.wants.length === 0;
    this.wants.replaceChildren(
      ...staff.wants.map((w) => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `Wants: ${w.label}`;
        li.append(label);
        return li;
      }),
    );
  }

  /** Seconds on foot per task for each kind of work: long walks mean the layout is costing you. */
  private walkKey = '';
  private renderWalkStats(): void {
    const stats = this.sim.walkToday;
    const parts = WORK_TYPES.filter((w) => stats[w.id].tasks >= 3).map((w) => {
      const secs = Math.round(stats[w.id].walk / stats[w.id].tasks / (TICKS_PER_MINUTE / 60));
      return `${this.sim.venue.workLabels[w.id] ?? w.label} ${secs}s`;
    });
    const text = parts.length > 0
      ? `Walking per task today: ${parts.join(' · ')}. Long walks mean the layout is costing time; Footfall in build mode shows where.`
      : 'Walking time per task shows here once a few jobs are done.';
    if (text === this.walkKey) return;
    this.walkKey = text;
    el('walk-stats').textContent = text;
  }

  /** Today's numbers at the top of the Team tab. */
  private renderSummary(d: DayStats): void {
    const net = d.takings - d.wages;
    const stats: [string, string, number][] = [
      ['Served', String(d.served), 0],
      ['Walked out', String(d.walkouts), d.walkouts > 15 ? -1 : 0],
      ['Net today', pounds(net), Math.sign(net)],
    ];
    const key = stats.map((x) => x[1]).join('|');
    if (key === this.summaryKey) return;
    this.summaryKey = key;
    this.daySummary.replaceChildren(...stats.map(([label, value, sign]) => {
      const box = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (sign !== 0) dd.className = sign < 0 ? 'neg' : 'pos';
      box.append(dt, dd);
      return box;
    }));
  }

  private setMeter(fill: HTMLElement, value: HTMLElement, v: number): void {
    fill.style.width = `${Math.round(v * 100)}%`;
    fill.style.background = meterColour(v);
    value.textContent = `${Math.round(v * 100)}%`;
  }
}


function row(label: string, value: number): HTMLLIElement {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = label;
  const v = document.createElement('b');
  v.textContent = value > 0 ? `+${value}` : String(value);
  v.className = value > 0 ? 'pos' : value < 0 ? 'neg' : '';
  li.append(name, v);
  return li;
}

function relationLabel(opinion: number): string {
  if (opinion <= -30) return 'rival';
  if (opinion <= -10) return 'not keen';
  if (opinion < 15) return 'colleague';
  if (opinion < 40) return 'friend';
  return 'close friend';
}
