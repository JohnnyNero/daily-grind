// The top bar, notices, and the info panel for a flat or a person.

import { furnitureDef } from '../sim/defs';
import type { Sim } from '../sim/sim';
import type { Pawn } from '../sim/state';
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
    el('info-title').textContent = flat.name;
    el('info-sub').textContent = `${floors} · ${flat.rooms.length === 1 ? 'one room' : `${flat.rooms.length} rooms`}`;
    const counts = new Map<string, number>();
    for (const f of furniture) {
      const name = furnitureDef(f.def).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const body = el('info-body');
    body.replaceChildren(
      h('dl', { className: 'facts' }, h('dt', {}, 'Floor space'), h('dd', {}, `${flat.area} tiles`), h('dt', {}, 'Front door'), h('dd', {}, flat.doors.length > 1 ? `${flat.doors.length} doors` : 'One')),
      h('div', { className: 'chips' }, ...[...counts].map(([name, n]) => h('span', { className: 'chip' }, n > 1 ? `${name} ×${n}` : name))),
    );
    if (furniture.length === 0) body.append(h('p', { className: 'note' }, 'Stripped back to the brick. Nothing in it yet.'));
    if (!flat.enclosed) body.append(h('p', { className: 'note' }, 'Open to the weather: it needs walls and a ceiling all round.'));
  }

  private renderPawn(): void {
    if (this.showing?.kind !== 'pawn') return;
    const id = this.showing.id;
    const p = this.sim.state.pawns.find((o) => o.id === id);
    if (!p) {
      this.closeInfo();
      return;
    }
    el('info-title').textContent = p.name;
    el('info-sub').textContent = p.kind === 'agent' ? 'Shows flats to people. Has keys to everything.' : 'Just walking past.';
    const body = el('info-body');
    const text = p.doing;
    if (body.textContent !== text) body.replaceChildren(h('p', {}, text));
  }
}
