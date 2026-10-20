// What's always on screen: the top bar (time, money, speed), the row of tenant portraits,
// alerts down the right edge, the tabs along the bottom and short notices.

import { billsDue, flatInfo, pounds } from '../sim/economy';
import { linesFor } from '../sim/outcomes';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE } from '../sim/state';
import { el, h, hhmm } from './dom';
import { cardsWaiting } from './cards';
import { dayName, face, likingColour, type Panels, type Showing } from './panels';

interface Alert {
  key: string;
  title: string;
  sub: string;
  colour: string;
  urgent?: boolean;
  open: Showing;
}

export class Hud {
  private dayEl = el('day');
  private timeEl = el('time');
  /** The Skip to morning button (spec 0.2): off, offered on a quiet night, or skipping. */
  private skip: 'off' | 'offer' | 'skipping' = 'off';
  private skipEl = el<HTMLButtonElement>('skip-morning');
  private moneyEl = el('money');
  private changeEl = el('money-change');
  private moneyPop = el('money-pop');
  private toastEl = el<HTMLButtonElement>('toast');
  private toastUntil = 0;
  private toastQueue: { text: string; bad: boolean }[] = [];
  private noticesSeen: number;
  private lastBar = '';
  private lastAlerts = '';
  private lastSlow = 0;
  onBuild: () => void = () => {};
  /** Skip to morning was tapped. */
  onSkip: () => void = () => {};

  constructor(private readonly sim: Sim, private readonly panels: Panels, private readonly setSpeed: (s: number) => void) {
    // The dock's height changes (tenants come and go, it shrinks while a tab is open), and
    // the sheets and bars sit on top of it.
    const dock = el('dock');
    const measure = () => document.body.style.setProperty('--tab-h', `${dock.offsetHeight}px`);
    new ResizeObserver(measure).observe(dock);
    measure();
    for (const b of document.querySelectorAll<HTMLButtonElement>('.speeds [data-speed]')) {
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    }
    this.skipEl.addEventListener('click', () => {
      if (this.skip === 'offer') this.onSkip();
    });
    this.toastEl.addEventListener('click', () => {
      this.toastEl.hidden = true;
      this.toastUntil = 0;
    });
    el('money-button').addEventListener('click', () => {
      this.moneyPop.hidden = !this.moneyPop.hidden;
      el('money-button').setAttribute('aria-expanded', String(!this.moneyPop.hidden));
      this.renderMoneyPop();
    });
    this.moneyPop.addEventListener('click', () => {
      this.moneyPop.hidden = true;
      panels.show({ kind: 'money' });
    });
    for (const b of document.querySelectorAll<HTMLButtonElement>('#tabbar [data-tab]')) {
      b.addEventListener('click', () => this.tab(b.dataset.tab!));
    }
    for (const span of document.querySelectorAll<HTMLElement>('[data-icon]')) span.innerHTML = ICONS[span.dataset.icon!] ?? '';
    const n = sim.state.notices;
    this.noticesSeen = n.length ? n[n.length - 1].tick : -1;
    panels.onChange = () => this.markTab();
    for (const b of document.querySelectorAll<HTMLButtonElement>('#overlays [data-overlay]')) {
      b.addEventListener('click', () => {
        this.onOverlay(b.dataset.overlay as 'none');
        for (const o of document.querySelectorAll<HTMLButtonElement>('#overlays [data-overlay]')) o.setAttribute('aria-pressed', String(o === b));
      });
    }
  }

  onOverlay: (mode: 'none' | 'noise' | 'warmth' | 'liking') => void = () => {};

  private tab(name: string): void {
    if (name === 'build') {
      this.panels.close();
      this.onBuild();
      return;
    }
    if (name === 'building') this.panels.close();
    else this.panels.show({ kind: name as 'people' | 'money' | 'post' | 'chat' });
  }

  /** Lights up the tab for whatever's open. */
  private markTab(): void {
    const s = this.panels.showing;
    const current = !s ? 'building' : s.kind === 'people' || s.kind === 'pawn' ? 'people' : s.kind === 'money' || s.kind === 'post' || s.kind === 'chat' ? s.kind : 'building';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#tabbar [data-tab]')) {
      if (b.dataset.tab === current) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  showSpeed(speed: number): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('.speeds [data-speed]')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    }
  }

  /** Offers Skip to morning on a quiet night, and says so while it's skipping. */
  showSkip(state: 'off' | 'offer' | 'skipping'): void {
    if (state === this.skip) return;
    this.skip = state;
    this.skipEl.hidden = state === 'off';
    this.skipEl.disabled = state === 'skipping';
    this.skipEl.textContent = state === 'skipping' ? 'Skipping to morning…' : 'Skip to morning';
  }

  notify(text: string, bad = false): void {
    this.toastQueue.push({ text, bad });
  }

  update(now: number): void {
    const sim = this.sim;
    const st = sim.state;
    this.dayEl.textContent = `Day ${sim.day} · ${dayName(sim.day)}`;
    this.timeEl.textContent = hhmm(sim.minuteOfDay);
    // A card waiting while Build or a panel hides the tray: a red dot on Done and Close (style.css).
    document.body.classList.toggle('cards-waiting', cardsWaiting(sim));
    this.moneyEl.textContent = pounds(st.money);
    this.moneyEl.classList.toggle('negative', st.money < 0);
    // News from the sim becomes notices.
    for (const n of st.notices) {
      if (n.tick > this.noticesSeen) {
        this.toastQueue.push({ text: n.text, bad: false });
        this.noticesSeen = n.tick;
      }
    }
    if (now > this.toastUntil && this.toastQueue.length > 0) {
      const t = this.toastQueue.shift()!;
      this.toastEl.textContent = t.text;
      this.toastEl.classList.toggle('bad', t.bad);
      this.toastEl.hidden = false;
      // Days go by faster now, so notices stay up for less, and less still when they're stacking up.
      this.toastUntil = now + (this.toastQueue.length > 2 ? 2200 : 3500);
    } else if (now > this.toastUntil) this.toastEl.hidden = true;
    // The slower parts, twice a second.
    if (now - this.lastSlow > 500) {
      this.lastSlow = now;
      const todayStart = (sim.day - 1) * TICKS_PER_DAY;
      const today = st.ledger.filter((e) => e.tick >= todayStart).reduce((n, e) => n + e.amount, 0);
      this.changeEl.textContent = today ? `${pounds(today, true)} today` : 'Nothing yet today';
      const unread = st.post.filter((l) => !l.read || (l.choices && l.chosen === undefined)).length;
      const badge = el('post-badge');
      badge.hidden = unread === 0;
      badge.textContent = String(unread);
      const asks = st.chat.filter((m) => m.choices && m.chosen === undefined).length;
      const newChat = st.chat.filter((m) => m.id > this.panels.chatSeen).length;
      const chatBadge = el('chat-badge');
      chatBadge.hidden = asks + newChat === 0;
      chatBadge.textContent = asks > 0 ? '!' : String(newChat);
      this.renderTenantBar();
      this.renderAlerts();
      if (!this.moneyPop.hidden) this.renderMoneyPop();
    }
    this.panels.render();
  }

  private renderTenantBar(): void {
    const sim = this.sim;
    const bar = el('tenantbar');
    const tenants = sim.state.pawns.filter((p) => p.life && !p.life.leaving);
    const order = sim.layout.flats.map((f) => f.id);
    tenants.sort((a, b) => order.indexOf(a.life!.flat) - order.indexOf(b.life!.flat));
    const empty = sim.layout.flats.filter((f) => !flatInfo(sim, f.id).lease);
    const key = JSON.stringify([tenants.map((p) => [p.id, Math.round(p.life!.liking)]), empty.map((f) => f.name)]);
    if (key === this.lastBar) return;
    this.lastBar = key;
    bar.replaceChildren(
      ...tenants.map((p) => {
        const lk = Math.round(p.life!.liking);
        const b = h('button', { type: 'button', className: 'who', style: `--c:${likingColour(lk)}`, 'aria-label': `${p.name}, liking ${lk}` }, h('span', { className: 'face' }, face(p).firstChild!), h('small', {}, String(lk)));
        b.addEventListener('click', () => this.panels.show({ kind: 'pawn', id: p.id }));
        return b;
      }),
      ...empty.map((f) => {
        const b = h('button', { type: 'button', className: 'who empty', 'aria-label': `${f.name} is empty` }, h('span', { className: 'face' }, f.name.replace('Flat ', '')), h('small', {}, 'empty'));
        b.addEventListener('click', () => this.panels.show({ kind: 'flat', id: f.id }));
        return b;
      }),
    );
  }

  private alerts(): Alert[] {
    const sim = this.sim;
    const st = sim.state;
    const out: Alert[] = [];
    const m = st.mortgage;
    if (m.missed > 0) out.push({ key: 'missed', title: `${m.missed} of 4 payments missed`, sub: `${pounds(m.arrears)} in arrears`, colour: 'var(--bad)', urgent: true, open: { kind: 'money' } });
    const daysToMonday = (7 - ((sim.day - 1) % 7)) % 7 || 7;
    const due = (m.paidOffDay === undefined ? Math.min(m.balance, m.payment + m.arrears) : 0) + billsDue(sim);
    if (daysToMonday <= 2 && st.money < due) out.push({ key: 'short', title: 'Short for Monday', sub: `Need ${pounds(due - st.money)} more`, colour: 'var(--bad)', urgent: true, open: { kind: 'money' } });
    for (const p of st.pawns) {
      if (!p.life || p.life.leaving) continue;
      const lines = linesFor(p);
      if (p.life.liking < lines.extreme) out.push({ key: `risk${p.id}`, title: `${p.name.split(' ')[0]} has had enough`, sub: `Liking ${Math.round(p.life.liking)}`, colour: 'var(--bad)', urgent: true, open: { kind: 'pawn', id: p.id } });
      else if (p.life.liking < lines.major) out.push({ key: `fed${p.id}`, title: `${p.name.split(' ')[0]} is fed up`, sub: `Liking ${Math.round(p.life.liking)}`, colour: 'var(--low)', open: { kind: 'pawn', id: p.id } });
    }
    for (const f of sim.layout.flats) {
      const info = flatInfo(sim, f.id);
      if (info.lease?.owed) out.push({ key: `owed${f.id}`, title: 'Rent owed', sub: `${f.name} · ${pounds(info.lease.owed)}`, colour: 'var(--low)', open: { kind: 'flat', id: f.id } });
      if (info.lease?.notice) out.push({ key: `notice${f.id}`, title: `${f.name} leaving`, sub: `Out on day ${info.lease.notice.day}`, colour: 'var(--low)', open: { kind: 'flat', id: f.id } });
      const n = st.applicants.filter((a) => a.flat === f.id).length;
      if (!info.lease && n > 0) out.push({ key: `apps${f.id}`, title: `${f.name} empty`, sub: `${n} applicant${n > 1 ? 's' : ''}`, colour: '#8d9097', open: { kind: 'applicants', flat: f.id } });
    }
    for (const c of st.chat.filter((x) => x.choices && x.chosen === undefined)) {
      out.push({ key: `chat${c.id}`, title: 'Asked in the chat', sub: c.who, colour: 'var(--ok)', open: { kind: 'chat' } });
    }
    for (const l of st.post.filter((x) => x.choices && x.chosen === undefined)) {
      out.push({ key: `letter${l.id}`, title: 'Needs an answer', sub: l.title, colour: 'var(--ok)', open: { kind: 'post', letter: l.id } });
    }
    return out.slice(0, 7);
  }

  private renderAlerts(): void {
    const list = this.alerts();
    const key = JSON.stringify(list.map((a) => [a.key, a.title, a.sub]));
    if (key === this.lastAlerts) return;
    this.lastAlerts = key;
    el('alerts').replaceChildren(
      ...list.map((a) => {
        const b = h('button', { type: 'button', className: `alert ${a.urgent ? 'urgent' : ''}`, style: `--c:${a.colour}` }, h('b', {}, a.title), h('span', {}, a.sub));
        b.addEventListener('click', () => this.panels.show(a.open));
        return b;
      }),
    );
  }

  private renderMoneyPop(): void {
    const st = this.sim.state;
    const todayStart = (this.sim.day - 1) * TICKS_PER_DAY;
    const today = st.ledger.filter((e) => e.tick >= todayStart);
    this.moneyPop.replaceChildren(
      ...today.slice(-6).map((e) => h('div', { className: 'row' }, h('span', {}, `${hhmm(Math.floor((e.tick % TICKS_PER_DAY) / TICKS_PER_MINUTE))} ${e.label}`), h('b', { className: e.amount >= 0 ? 'pos' : 'neg' }, pounds(e.amount, true)))),
      today.length === 0 ? h('div', { className: 'row' }, h('span', {}, 'Nothing in or out yet today.')) : '',
      h('div', { className: 'row total' }, h('span', {}, 'Now'), h('b', {}, pounds(st.money))),
      h('p', { className: 'small muted', style: 'margin:6px 0 0' }, 'Tap for the full money page.'),
    );
  }
}

// Little pixel icons for the tabs, drawn from 8x8 grids.
const GRIDS: Record<string, string[]> = {
  building: ['..####..', '.#....#.', '########', '#.##.#.#', '########', '#.#..#.#', '#.#..#.#', '########'],
  people: ['.##..##.', '.##..##.', '........', '####.###', '####.###', '####.###', '........', '........'],
  money: ['..####..', '.#....#.', '#..###.#', '#..#...#', '#.####.#', '#..#...#', '.#####..', '..####..'],
  post: ['........', '########', '##....##', '#.#..#.#', '#..##..#', '#......#', '########', '........'],
  chat: ['########', '#......#', '#.#.#.##', '#......#', '########', '.##.....', '.#......', '........'],
  build: ['####....', '#####...', '####.#..', '...#.#..', '....#.#.', '.....#.#', '......##', '........'],
};
const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(GRIDS).map(([name, rows]) => {
    let r = '';
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '#') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }));
    return [name, `<svg viewBox="0 0 8 8" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`];
  }),
);
