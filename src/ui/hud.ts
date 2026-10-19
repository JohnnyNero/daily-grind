// The top bar, notices, and the info panel for a flat or a person.

import { furnitureDef } from '../sim/defs';
import { FACTOR_NAMES, flatScore, type FactorId, type FlatScore } from '../sim/impressiveness';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type NeedId, type Pawn } from '../sim/state';
import { NEED_NAMES } from '../sim/tenants';
import { BASELINE, likingTarget, thoughtsOf } from '../sim/thoughts';
import { el, h, hhmm } from './dom';

export class Hud {
  private dayEl = el('day');
  private timeEl = el('time');
  private statusEl = el('status');
  private toastEl = el<HTMLButtonElement>('toast');
  private info = el('info');
  private toastUntil = 0;
  /** What the info panel is showing, so it can refresh. */
  private showing: { kind: 'flat'; id: string } | { kind: 'pawn'; id: number } | null = null;
  onClose: () => void = () => {};

  constructor(private readonly sim: Sim, private readonly setSpeed: (s: number) => void) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('.speeds [data-speed]')) {
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    }
    this.toastEl.addEventListener('click', () => {
      this.toastEl.hidden = true;
    });
    el('info-close').addEventListener('click', () => this.closeInfo());
  }

  showSpeed(speed: number): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('.speeds [data-speed]')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    }
  }

  notify(text: string, bad = false): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('bad', bad);
    this.toastEl.hidden = false;
    this.toastUntil = performance.now() + 4000;
  }

  update(now: number, speed: number): void {
    this.dayEl.textContent = `Day ${this.sim.day}`;
    this.timeEl.textContent = hhmm(this.sim.minuteOfDay);
    const agent = this.sim.state.pawns.find((p) => p.kind === 'agent');
    this.statusEl.textContent = speed === 0 ? 'Paused' : agent ? agent.doing.replace(/^/, 'Denise: ') : '';
    if (!this.toastEl.hidden && now > this.toastUntil) this.toastEl.hidden = true;
    if (this.showing?.kind === 'pawn') this.renderPawn();
  }

  get infoOpen(): boolean {
    return !this.info.hidden;
  }

  showFlat(id: string): void {
    this.showing = { kind: 'flat', id };
    this.renderFlat();
    this.open();
  }

  showPawn(p: Pawn): void {
    this.showing = { kind: 'pawn', id: p.id };
    this.renderPawn();
    this.open();
  }

  closeInfo(): void {
    this.info.hidden = true;
    this.showing = null;
    document.body.classList.remove('panel-open');
    this.onClose();
  }

  private open(): void {
    this.info.hidden = false;
    document.body.classList.add('panel-open');
  }

  /** The flat might have changed (or gone) while the panel was open. */
  refresh(): void {
    if (this.showing?.kind === 'flat') this.renderFlat();
  }

  private renderFlat(): void {
    if (this.showing?.kind !== 'flat') return;
    const lay = this.sim.layout;
    const flat = lay.flat(this.showing.id);
    if (!flat) {
      this.closeInfo();
      return;
    }
    const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes);
    const inFlat = new Set(nodes);
    const furniture = this.sim.state.furniture.filter((f) => inFlat.has(lay.node(f.x, f.s)));
    const floors = flat.storeys.map((s) => (s === 0 ? 'Ground floor' : `Floor ${s}`)).join(' and ');
    const score = flatScore(this.sim, flat.id);
    const residents = this.sim.state.pawns.filter((p) => p.life?.flat === flat.id);
    el('info-title').textContent = flat.name;
    el('info-sub').textContent = `${floors} · ${flat.rooms.length === 1 ? 'one room' : `${flat.rooms.length} rooms`} · ${flat.area} tiles`;
    const body = el('info-body');
    const key = JSON.stringify([score, residents.map((p) => p.id), furniture.length]);
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    const factors = (Object.keys(FACTOR_NAMES) as FactorId[]).map((id) =>
      meter(FACTOR_NAMES[id], score.factors[id], id === score.weakest ? 'Holding it back' : undefined),
    );
    const counts = new Map<string, number>();
    for (const f of furniture) {
      const name = furnitureDef(f.def).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    body.replaceChildren(
      h('div', { className: 'score-head' }, h('b', { className: 'tier' }, score.tier), h('span', {}, `Impressiveness ${score.score}`)),
      h('div', { className: 'meters' }, ...factors),
      h('p', { className: 'hint-line' }, fixHint(score)),
      h(
        'p',
        { className: 'people-line' },
        residents.length === 0 ? 'Nobody lives here.' : 'Lives here: ',
        ...residents.flatMap((p, i) => [
          i > 0 ? ', ' : '',
          h('button', { type: 'button', className: 'link', onclick: () => this.showPawn(p) }, p.name),
        ]),
      ),
      h('div', { className: 'chips' }, ...[...counts].map(([name, n]) => h('span', { className: 'chip' }, n > 1 ? `${name} ×${n}` : name))),
    );
    if (furniture.length === 0) body.append(h('p', { className: 'note' }, 'Stripped back to the brick. Nothing in it yet.'));
    if (!flat.enclosed) body.append(h('p', { className: 'note' }, 'Open to the weather: it needs walls and a ceiling all round.'));
  }

  private pawnTab: 'thoughts' | 'needs' = 'thoughts';

  private renderPawn(): void {
    if (this.showing?.kind !== 'pawn') return;
    const id = this.showing.id;
    const p = this.sim.state.pawns.find((o) => o.id === id);
    if (!p) {
      this.closeInfo();
      return;
    }
    el('info-title').textContent = p.name;
    const body = el('info-body');
    const life = p.life;
    if (!life) {
      el('info-sub').textContent = p.kind === 'agent' ? 'Shows flats to people. Has keys to everything.' : 'Just walking past.';
      if (body.textContent !== p.doing) body.replaceChildren(h('p', {}, p.doing));
      return;
    }
    const flat = this.sim.layout.flat(life.flat);
    const job = life.job ? `${life.job.title}, ${hhmm(life.job.leave)} to ${hhmm(life.job.back)} weekdays` : 'Works from home';
    el('info-sub').textContent = `${flat?.name ?? 'No flat'} · ${job}`;
    const thoughts = thoughtsOf(this.sim, p);
    const target = likingTarget(thoughts);
    const doing = life.away ? `${life.away.why} (back about ${hhmm(minuteOf(life.away.until))})` : p.doing;
    const key = JSON.stringify([this.pawnTab, Math.round(life.liking), target, doing, thoughts, this.pawnTab === 'needs' ? Object.values(life.needs).map((v) => Math.round(v * 50)) : 0]);
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    const liking = Math.round(life.liking);
    const trend = target > liking + 1 ? '↑' : target < liking - 1 ? '↓' : '';
    const tab = (id: 'thoughts' | 'needs', label: string) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.pawnTab === id), onclick: () => { this.pawnTab = id; this.renderPawn(); } }, label);
    const page =
      this.pawnTab === 'thoughts'
        ? h(
            'div',
            { className: 'thoughts' },
            ...thoughts.map((t) => h('div', { className: 'thought' }, h('span', {}, t.label), h('b', { className: t.value > 0 ? 'good' : t.value < 0 ? 'bad' : '' }, signed(t.value)))),
            h('div', { className: 'thought total' }, h('span', {}, `Adds up to (from ${BASELINE})`), h('b', {}, String(Math.round(target)))),
          )
        : h('div', { className: 'meters' }, ...(Object.keys(NEED_NAMES) as NeedId[]).map((n) => meter(NEED_NAMES[n], life.needs[n] * 100)));
    body.replaceChildren(
      h('p', { className: 'doing' }, doing),
      h(
        'div',
        { className: 'liking' },
        h('div', { className: 'liking-num' }, h('b', {}, String(liking)), h('span', {}, `${likingWord(liking)} ${trend}`)),
        h('div', { className: 'track big' }, h('div', { className: `fill ${liking < 35 ? 'low' : ''}`, style: `width:${liking}%` }), h('div', { className: 'target', style: `left:${target}%` })),
        h('p', { className: 'small' }, 'How much they like living here'),
      ),
      h('div', { className: 'tabs', role: 'tablist' }, tab('thoughts', 'Thoughts'), tab('needs', 'Needs')),
      page,
    );
  }
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r > 0 ? `+${r}` : String(r);
}

function likingWord(v: number): string {
  if (v >= 80) return 'Loves it here';
  if (v >= 60) return 'Settled';
  if (v >= 40) return 'Getting by';
  if (v >= 20) return 'Fed up';
  return 'Wants out';
}

function minuteOf(tick: number): number {
  return Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_MINUTE);
}

function meter(label: string, value: number, note?: string): HTMLElement {
  const v = Math.round(value);
  return h(
    'div',
    { className: `meter ${note ? 'weakest' : ''}` },
    h('span', {}, label, note ? h('small', {}, ` ${note}`) : ''),
    h('div', { className: 'track' }, h('div', { className: `fill ${v < 30 ? 'low' : ''}`, style: `width:${v}%` })),
    h('b', {}, String(v)),
  );
}

function fixHint(score: FlatScore): string {
  switch (score.weakest) {
    case 'space':
      return 'To improve it: more room per person. Fewer people, or knock through.';
    case 'furnishing':
      return 'To improve it: more (or better) furniture.';
    case 'basics': {
      const missing = [!score.has.bed && 'a bed', !score.has.toilet && 'a toilet', !score.has.wash && 'a shower or bath', !score.has.kitchen && 'a cooker and fridge'].filter(Boolean);
      return `To improve it: it needs ${missing.join(', ')}.`;
    }
    case 'light':
      return 'To improve it: a window or a lamp.';
    case 'decor':
      return 'To improve it: pictures, plants, a mirror.';
  }
}
