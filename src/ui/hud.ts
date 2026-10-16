// The top bar, the selected-person sheet and the work-priorities panel.
// Plain DOM over the canvas keeps text crisp.

import { BREAK_LABELS } from '../sim/breaks';
import { NEEDS, WORK_TYPES, traitDef, type WorkType } from '../sim/defs';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type DayStats, type LogEntry, type Pawn, type Recap } from '../sim/state';
import { moodReasons } from '../sim/thoughts';

const TOAST_MS = 7000;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

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
  private toast = el<HTMLButtonElement>('toast');
  private events = el('events');
  private recapBox = el('recap');
  private recapsSeen = 0;
  private lastLogCount = 0;
  private lastLogTick = -1;
  private toastUntil = 0;
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
      this.toast.hidden = true;
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
      quote.replaceChildren(`“${r.review.text}”`, cite);
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
      th.textContent = this.sim.venue.workLabels[w.id] ?? w.label;
      th.title = w.description;
      head.append(th);
    }
    const body = table.createTBody();
    for (const p of this.sim.state.pawns) {
      if (!p.staff) continue;
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
    button.replaceChildren(value === 0 ? 'off' : String(value));
    const small = document.createElement('small');
    small.textContent = String(skill);
    button.append(small);
    const label = this.sim.venue.workLabels[work] ?? WORK_TYPES.find((w) => w.id === work)!.label;
    button.setAttribute('aria-label', `${p.name}, ${label}: ${value === 0 ? 'off' : `priority ${value}`}, skill ${skill}`);
  }

  /** Shows the newest log entry as a toast, and keeps the Recent list current. */
  private updateLog(now: number): void {
    const log = this.sim.state.log;
    const newest = log[log.length - 1];
    if (newest && (newest.tick !== this.lastLogTick || log.length !== this.lastLogCount)) {
      this.lastLogTick = newest.tick;
      this.lastLogCount = log.length;
      this.toast.textContent = newest.text;
      this.toast.className = `toast ${newest.tone}`;
      this.toastPawn = newest.pawn !== null && this.sim.pawnById(newest.pawn) ? newest.pawn : null;
      this.toast.hidden = false;
      this.toastUntil = now + TOAST_MS;
      if (this.staffPanelOpen) this.renderEvents(log);
    }
    if (!this.toast.hidden && now > this.toastUntil) this.toast.hidden = true;
  }

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
    this.day.textContent = `Day ${this.sim.day}`;
    this.time.textContent = this.sim.clock();
    this.money.textContent = pounds(s.money);
    this.money.classList.toggle('negative', s.money < 0);
    this.rep.textContent = `Rep ${Math.round(s.reputation)}`;
    if (fastForwarding) this.status.textContent = 'Closed · skipping to morning';
    else if (!this.sim.isOpen()) this.status.textContent = 'Closed';
    else {
      const condition = s.conditions.find((c) => c.until > s.tick);
      if (condition) this.status.textContent = this.sim.venue.text.conditions[condition.id];
      else this.status.textContent = s.queue.length > 0 ? `${s.queue.length} queuing` : 'Open';
    }
    if (this.staffPanelOpen) this.daySummary.textContent = summary(s.today, 'Today') + (s.yesterday ? `  ${summary(s.yesterday, 'Yesterday')}` : '');

    this.sheet.hidden = !selected;
    // Corner buttons would sit under an open panel; hide them until it closes.
    document.body.classList.toggle('panel-open', !!selected || this.staffPanelOpen || this.otherPanelOpen());
    if (!selected) return;
    this.name.textContent = selected.visit
      ? `${selected.name} (${selected.visit.critic ? 'critic' : selected.visit.regularId !== null ? 'regular' : 'guest'})`
      : selected.name;
    this.activity.textContent = this.sim.activity(selected);
    if (selected.visit) {
      const v = selected.visit;
      const served = v.state === 'toSeat' || v.state === 'eating' || v.state === 'leaving';
      this.moodRow.hidden = served;
      this.traits.hidden = true;
      this.reasons.hidden = true;
      this.relations.hidden = true;
      this.wants.hidden = true;
      this.moodLabel.textContent = 'Patience';
      this.setMeter(this.moodFill, this.moodValue, v.patience);
      this.needsBox.hidden = true;
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
    for (const def of NEEDS) {
      const row = this.needFills.get(def.id)!;
      this.setMeter(row.fill, row.value, selected.needs[def.id]);
    }
    const tips = selected.staff ? ` · Tips today ${pounds(selected.staff.tipsToday)}` : '';
    this.shift.textContent = `Shift ${hhmm(selected.shift.start)}–${hhmm(selected.shift.end)}${tips}`;
  }

  private renderStaffDetails(p: Pawn): void {
    const staff = p.staff!;
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
    this.traits.replaceChildren(...chips);

    this.reasons.replaceChildren(...moodReasons(this.sim, p).map((r) => row(r.label, r.value)));

    const others = this.sim.state.pawns
      .filter((o) => o.staff && o.id !== p.id && !o.staff.quit)
      .map((o) => ({ o, op: this.sim.opinion(p, o), together: this.sim.relation(p.id, o.id).together }))
      .sort((a, b) => Number(b.together) - Number(a.together) || Math.abs(b.op) - Math.abs(a.op));
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

  private setMeter(fill: HTMLElement, value: HTMLElement, v: number): void {
    fill.style.width = `${Math.round(v * 100)}%`;
    fill.style.background = meterColour(v);
    value.textContent = `${Math.round(v * 100)}%`;
  }
}

function summary(d: DayStats, label: string): string {
  const net = d.takings - d.wages;
  return `${label}: ${d.served} served, ${d.walkouts} walked out, takings ${pounds(d.takings)}, wages ${pounds(d.wages)} (${pounds(net)}).`;
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
