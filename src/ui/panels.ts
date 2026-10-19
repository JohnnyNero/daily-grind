// The bottom sheet: whatever you've opened, from a flat or a tenant to the money and the
// post. One sheet, the same layout every time: a header, sometimes tabs, then the detail.
// Every number says where it comes from.

import { meet } from '../sim/handover';
import { brokenIn, mend, repairCost } from '../sim/upkeep';
import { LISTINGS, landlordRating } from '../sim/leases';
import { burglaryRisk, fitAlarm, fitLocks, riskWord } from '../sim/crime';
import type { ListingStyle } from '../sim/state';
import { portrait } from '../render/art';
import { furnitureDef } from '../sim/defs';
import { AMENITIES } from '../sim/tuning';
import { spaceAt, type Space } from '../sim/shared';
import { POUND, billsDue, flatInfo, goingRate, overpay, pounds, MISSES_ALLOWED, MORTGAGE, LOCKS_PRICE, ALARM_PRICE, ALARM_WEEKLY } from '../sim/economy';
import { CLEANER_WEEKLY, flatClimate, gasBill, outdoorTemp, seasonName } from '../sim/environment';
import { answer } from '../sim/chat';
import { opinionParts, relationships } from '../sim/social';
import { FACTOR_NAMES, flatScore, scoreFor, type FactorId, type FlatScore } from '../sim/impressiveness';
import { accept, changeRent, giveNotice, household, householdLiking, likelyLiking, noticeProblem, turnAway } from '../sim/leases';
import { linesFor } from '../sim/outcomes';
import { choose } from '../sim/post';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type Letter, type NeedId, type Pawn } from '../sim/state';
import { NEED_NAMES } from '../sim/tenants';
import { expectGrade, expectName, expectNote } from '../sim/expectations';
import { BASELINE, likingTarget, rentThought, thoughtsOf } from '../sim/thoughts';
import { traitDef } from '../sim/traits';
import { talesOf } from '../sim/tales';
import { el, h, hhmm } from './dom';

export type Showing =
  | { kind: 'flat'; id: string }
  | { kind: 'pawn'; id: number }
  | { kind: 'people' }
  | { kind: 'money' }
  | { kind: 'post'; letter?: number }
  | { kind: 'applicants'; flat: string }
  | { kind: 'space'; x: number; s: number }
  | { kind: 'chat' };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BOILER = ['Off', 'Low', 'Medium', 'High'];

export function dayName(day: number): string {
  return DAYS[(day - 1) % 7];
}

/** Colour for a liking score. */
export function likingColour(v: number): string {
  return v >= 60 ? 'var(--good)' : v >= 40 ? 'var(--ok)' : v >= 25 ? 'var(--low)' : 'var(--bad)';
}

export function likingWord(v: number): string {
  if (v >= 80) return 'Loves it here';
  if (v >= 60) return 'Settled';
  if (v >= 40) return 'Getting by';
  if (v >= 25) return 'Fed up';
  return 'Wants out';
}

export function face(p: Pick<Pawn, 'look' | 'kind'>, colour?: string): HTMLElement {
  return h('span', { className: 'portrait', style: colour ? `--c:${colour}` : undefined }, portrait(p));
}

export class Panels {
  showing: Showing | null = null;
  private sheet = el('info');
  private body = el('info-body');
  private pawnTab: 'liking' | 'needs' | 'social' | 'about' = 'liking';
  /** The newest chat message you've seen (for the badge). */
  chatSeen = 0;
  /** Rent being set in the flat panel before it's applied. */
  private draftRent: { flat: string; rent: number } | null = null;
  onClose: () => void = () => {};
  onChange: () => void = () => {};

  constructor(private readonly sim: Sim, private readonly notify: (text: string, bad?: boolean) => void) {
    el('info-close').addEventListener('click', () => this.close());
  }

  get open(): boolean {
    return !this.sheet.hidden;
  }

  show(s: Showing): void {
    if (s.kind === 'pawn') meet(this.sim, s.id);
    this.showing = s;
    this.body.dataset.key = '';
    this.draftRent = null;
    this.sheet.hidden = false;
    document.body.classList.add('panel-open');
    this.render();
    this.sheet.scrollTop = 0;
    this.onChange();
  }

  close(): void {
    this.sheet.hidden = true;
    this.showing = null;
    document.body.classList.remove('panel-open');
    this.onClose();
    this.onChange();
  }

  /** Redraws if anything shown has changed (called every frame; cheap when nothing has). */
  render(): void {
    const s = this.showing;
    if (!s) return;
    switch (s.kind) {
      case 'flat':
        return this.renderFlat(s.id);
      case 'pawn':
        return this.renderPawn(s.id);
      case 'people':
        return this.renderPeople();
      case 'money':
        return this.renderMoney();
      case 'post':
        return this.renderPost(s.letter);
      case 'applicants':
        return this.renderApplicants(s.flat);
      case 'space':
        return this.renderSpace(s.x, s.s);
      case 'chat':
        return this.renderChat();
    }
  }

  private head(title: string, sub: string, who?: HTMLElement): void {
    el('info-title').textContent = title;
    el('info-sub').textContent = sub;
    el('info-portrait').replaceChildren(...(who ? [who] : []));
  }

  /** Rebuilds the body only when `key` changes. */
  private fill(key: unknown, build: () => (Node | string)[]): void {
    const k = JSON.stringify(key);
    if (this.body.dataset.key === k) return;
    this.body.dataset.key = k;
    this.body.replaceChildren(...build());
  }

  private rerender(): void {
    this.body.dataset.key = '';
    this.render();
  }

  // ------------------------------------------------------------------ a flat

  private renderFlat(id: string): void {
    const sim = this.sim;
    const lay = sim.layout;
    const flat = lay.flat(id);
    if (!flat) {
      this.close();
      return;
    }
    const nodes = new Set(lay.flatCells(flat));
    const furniture = sim.state.furniture.filter((f) => nodes.has(lay.node(f.x, f.s)));
    const score = flatScore(sim, id);
    const info = flatInfo(sim, id);
    const lease = info.lease;
    const people = household(sim, id);
    const going = goingRate(sim, id);
    const applicants = sim.state.applicants.filter((a) => a.flat === id);
    this.head(flat.name, `${flat.rooms.length === 1 ? 'one room' : `${flat.rooms.length} rooms`} · ${flat.area} tiles`);
    const draft = this.draftRent?.flat === id ? this.draftRent.rent : null;
    this.fill([id, score, info, people.map((p) => p.id), applicants.length, furniture.length, draft, sim.day], () => {
      const out: (Node | string)[] = [];
      out.push(
        h('div', { className: 'score-head' }, h('div', { className: 'tier-box' }, String(score.score)), h('div', {}, h('b', {}, score.tier), h('p', {}, 'Impressiveness: mostly the average of these, dragged down by the weakest'))),
        h('div', { className: 'meters sec' }, ...(Object.keys(FACTOR_NAMES) as FactorId[]).map((f) => meter(FACTOR_NAMES[f], score.factors[f], f === score.weakest ? 'weakest' : undefined))),
        h('div', { className: 'tip' }, h('b', {}, 'What to fix: '), fixHint(score)),
      );
      // Warmth, noise and dirt.
      const cl = flatClimate(sim, id);
      out.push(
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'The place', h('em', {}, `${Math.round(outdoorTemp(sim))}° outside`)),
          h(
            'div',
            { className: 'lines' },
            h('div', { className: 'line' }, h('span', {}, 'Temperature', h('small', {}, `${cl.radiators} radiator${cl.radiators === 1 ? '' : 's'}, boiler on ${BOILER[sim.state.boiler].toLowerCase()}`)), h('b', {}, `${Math.round(cl.temp)}°`)),
            h('div', { className: 'line' }, h('span', {}, 'Noise from next door', h('small', {}, 'Lately, on average')), h('b', {}, cl.noise < 0.3 ? 'Quiet' : cl.noise < 1 ? 'Some' : cl.noise < 2 ? 'Noisy' : 'Very noisy')),
            h('div', { className: 'line' }, h('span', {}, 'Insulated', h('small', {}, 'Outside walls, roof and floor')), h('b', {}, `${cl.insulated} of ${cl.outside}`)),
            h('div', { className: 'line' }, h('span', {}, 'Dirt'), h('b', {}, cl.dirt < 0.2 ? 'Clean' : cl.dirt < 0.5 ? 'A bit grubby' : 'A tip')),
          ),
          ...brokenIn(sim, id).map((f) =>
            h('div', { className: 'line warnline' }, h('span', {}, `Broken ${furnitureDef(f.def).name.toLowerCase()}`, h('small', {}, `Since day ${f.broken}`)), h('button', { type: 'button', className: 'btn', onclick: () => { const p = mend(sim, f.id); this.notify(p ?? `Mended the ${furnitureDef(f.def).name.toLowerCase()}.`, p !== null); this.rerender(); } }, `Mend ${pounds(repairCost(f))}`)),
          ),
        ),
      );
      // Rent.
      const rent = h('div', { className: 'rentbox' });
      const gr = h('div', { className: 'row' }, h('span', {}, `Going rate for "${info.tier}"`), h('b', {}, `${pounds(going)} a week`));
      rent.append(gr);
      if (info.belowSince !== undefined) rent.append(h('p', { className: 'small note' }, `It's slipped to ${score.tier}: the going rate drops in a few days unless that's fixed.`));
      const current = lease ? (lease.rise?.rent ?? lease.rent) : info.asking;
      const shown = draft ?? current;
      const step = (d: number) => {
        this.draftRent = { flat: id, rent: Math.max(5 * POUND, shown + d) };
        if (!lease) {
          changeRent(sim, id, this.draftRent.rent);
          this.draftRent = null;
        }
        this.rerender();
      };
      const ratio = shown / Math.max(1, going);
      const feel = rentThought(shown, going, expectGrade(sim));
      rent.append(
        h('div', { className: 'row' }, h('span', {}, lease ? 'Their rent' : 'Asking rent'), h('span', { className: 'small' }, `${Math.round(ratio * 100)}% of the going rate`)),
        h(
          'div',
          { className: 'stepper' },
          h('button', { type: 'button', className: 'btn', 'aria-label': 'Five pounds less', onclick: () => step(-5 * POUND) }, '−'),
          h('b', {}, pounds(shown)),
          h('button', { type: 'button', className: 'btn', 'aria-label': 'Five pounds more', onclick: () => step(5 * POUND) }, '+'),
          h('span', { className: 'small' }, feel ? `${feel.label} (${signed(feel.value)})` : 'Fair (no feeling either way)'),
        ),
      );
      if (lease && draft !== null && draft !== current) {
        const rise = draft > lease.rent;
        rent.append(
          h('p', { className: 'small' }, rise ? `A rise needs a week's notice, and they won't like it (${(draft - lease.rent) / lease.rent > 0.1 ? '−12' : '−5'} for a while).` : 'A cut: they\'ll like that (+6 for a while).'),
          h('div', { className: 'btns' }, h('button', { type: 'button', className: 'btn primary', onclick: () => { changeRent(sim, id, draft); this.draftRent = null; this.notify(`New rent for ${flat.name}: ${pounds(draft)} from ${dayName(sim.day + 7)} (day ${sim.day + 7}).`); this.rerender(); } }, rise ? 'Give notice of the rise' : 'Cut the rent'), h('button', { type: 'button', className: 'btn ghost', onclick: () => { this.draftRent = null; this.rerender(); } }, 'Cancel')),
        );
      }
      if (lease?.rise) rent.append(h('p', { className: 'small' }, `Going to ${pounds(lease.rise.rent)} on day ${lease.rise.from}.`));
      out.push(h('div', { className: 'sec' }, h('h3', {}, 'Rent', h('em', {}, 'per week')), rent));
      if (lease) {
        const rows: [string, string][] = [
          ['Tenancy', lease.sitting ? 'Old rolling tenancy (sitting tenants)' : `Day ${lease.startDay} to day ${lease.endDay}`],
          ['Deposit held', pounds(lease.deposit)],
          ['Paid on time', days(lease.paid)],
          ['Late or held back', days(lease.late)],
          ['Owed', lease.owed > 0 ? pounds(lease.owed) : 'Nothing'],
        ];
        if (lease.notice) rows.push(['Notice', `${lease.notice.by === 'tenant' ? 'They\'re leaving' : 'You\'ve given notice'} on day ${lease.notice.day} (${lease.notice.why.toLowerCase()})`]);
        out.push(h('div', { className: 'sec' }, h('h3', {}, 'Tenancy'), h('div', { className: 'lines' }, ...rows.map(([a, b]) => h('div', { className: 'line' }, h('span', {}, a), h('b', {}, b))))));
        const problem = noticeProblem(sim, id);
        if (!lease.notice && !lease.sitting) {
          out.push(h('div', { className: 'btns sec' }, h('button', { type: 'button', className: 'btn', disabled: problem !== null, title: problem ?? '', onclick: () => { const p = giveNotice(sim, id); this.notify(p ?? `You've given ${flat.name} notice. They go in 14 days.`, p !== null); this.rerender(); } }, 'Give notice'), h('span', { className: 'small muted' }, problem ?? 'They owe two weeks or more: you can give them notice.')));
        }
        out.push(
          h(
            'div',
            { className: 'sec' },
            h('h3', {}, 'Living here', h('em', {}, `liking ${Math.round(householdLiking(sim, id))}`)),
            ...people.map((p) => h('button', { type: 'button', className: 'line link', style: 'text-decoration:none;width:100%', onclick: () => this.show({ kind: 'pawn', id: p.id }) }, h('span', { style: 'display:flex;gap:8px;align-items:center' }, face(p, likingColour(p.life!.liking)), p.name), h('span', { className: 'chip', style: `color:${likingColour(p.life!.liking)}` }, String(Math.round(p.life!.liking))))),
          ),
        );
      } else {
        const s = scoreFor(sim, id, 1).has;
        const liveable = s.bed && s.toilet && s.wash && s.kitchen;
        out.push(
          h(
            'div',
            { className: 'sec' },
            h('h3', {}, 'Letting'),
            h('label', { className: 'line' }, h('span', {}, 'Listed: people can apply'), h('input', { type: 'checkbox', id: `listed-${id}`, checked: info.listed, onchange: (e: Event) => { info.listed = (e.target as HTMLInputElement).checked; this.rerender(); } })),
            liveable ? '' : h('p', { className: 'note small' }, 'Without a bed, a loo, a shower or bath and a cooker or fridge, only desperate people will apply.'),
            h('h3', {}, 'The listing'),
            h('div', { className: 'seg-row wrap' }, ...(Object.keys(LISTINGS) as ListingStyle[]).map((k) => h('button', { type: 'button', 'aria-pressed': String((info.style ?? 'plain') === k), onclick: () => { info.style = k; this.rerender(); } }, LISTINGS[k].name))),
            h('p', { className: 'listing' }, `“${LISTINGS[info.style ?? 'plain'].blurb}”`),
            h('p', { className: 'small muted' }, LISTINGS[info.style ?? 'plain'].does),
            h('button', { type: 'button', className: 'btn primary', disabled: applicants.length === 0, onclick: () => this.show({ kind: 'applicants', flat: id }) }, applicants.length === 0 ? 'No applicants yet' : `See ${applicants.length} applicant${applicants.length > 1 ? 's' : ''}`),
          ),
        );
      }
      const counts = new Map<string, number>();
      for (const f of furniture) counts.set(furnitureDef(f.def).name, (counts.get(furnitureDef(f.def).name) ?? 0) + 1);
      out.push(h('div', { className: 'chips sec' }, ...[...counts].map(([n, c]) => h('span', { className: 'chip' }, c > 1 ? `${n} ×${c}` : n))));
      if (furniture.length === 0) out.push(h('p', { className: 'note' }, 'Stripped back to the brick. Nothing in it yet.'));
      if (!flat.enclosed) out.push(h('p', { className: 'note' }, 'Open to the weather: it needs walls and a ceiling all round.'));
      return out;
    });
  }

  // ------------------------------------------------------------------ a tenant

  private renderPawn(id: number): void {
    const sim = this.sim;
    const p = sim.state.pawns.find((o) => o.id === id);
    if (!p) {
      this.close();
      return;
    }
    const life = p.life;
    if (!life) {
      const party = p.kind === 'guest' ? sim.layout.flat(p.flat)?.name : undefined;
      this.head(p.name, p.kind === 'agent' ? 'Shows flats to people. Has keys to everything.' : p.kind === 'guest' ? `Here for the party in ${party ?? 'a flat'}.` : p.kind === 'burglar' ? 'Up to no good.' : 'Just walking past.');
      this.fill([id, p.doing], () => [h('p', { className: 'doing' }, p.doing)]);
      return;
    }
    const flat = sim.layout.flat(life.flat);
    const liking = Math.round(life.liking);
    this.head(p.name, `${flat?.name ?? 'No flat'} · ${p.note ?? ''}`, face(p, likingColour(liking)));
    const thoughts = thoughtsOf(sim, p);
    const target = Math.round(likingTarget(thoughts));
    const doing = life.away ? `${life.away.why} (back about ${hhmm(Math.floor((life.away.until % TICKS_PER_DAY) / TICKS_PER_MINUTE))})` : p.doing;
    const needsKey = this.pawnTab === 'needs' ? Object.values(life.needs).map((v) => Math.round(v * 50)) : 0;
    const socialKey = this.pawnTab === 'social' ? relationships(sim, p).map((r) => [r.other.id, r.opinion]) : 0;
    const history = this.pawnTab === 'about' ? talesOf(sim, id) : [];
    this.fill([id, this.pawnTab, liking, target, doing, thoughts, needsKey, life.revealed, life.traits.length, socialKey, history.length], () => {
      const tab = (t: 'liking' | 'needs' | 'social' | 'about', label: string) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.pawnTab === t), onclick: () => { this.pawnTab = t; this.rerender(); } }, label);
      const out: (Node | string)[] = [h('p', { className: 'doing' }, doing), h('div', { className: 'tabs', role: 'tablist' }, tab('liking', 'Liking'), tab('needs', 'Needs'), tab('social', 'Social'), tab('about', 'About'))];
      if (this.pawnTab === 'liking') {
        const lines = linesFor(p);
        out.push(
          h(
            'div',
            { className: 'gauge', style: `--l1:${lines.minor}%;--l2:${lines.major}%;--l3:${lines.extreme}%` },
            h('span', { className: 'now', style: `left:${liking}%` }, String(liking)),
            h('div', { className: 'bar' }),
            h('span', { className: 'target', style: `left:${target}%` }, `▲ heading for ${target}`),
          ),
          h('p', { className: 'small' }, h('span', { className: 'liking-word' }, likingWord(liking)), ` · below ${lines.minor} they grumble, below ${lines.major} they act up, below ${lines.extreme} they leave or report you.`),
          h(
            'div',
            { className: 'thoughts sec', style: 'margin-top:8px' },
            h('div', { className: 'thought base' }, h('span', {}, 'Starting point'), h('b', {}, String(BASELINE))),
            ...thoughts.map((t) => h('div', { className: 'thought' }, h('span', {}, t.label), h('b', { className: t.value > 0 ? 'pos' : t.value < 0 ? 'neg' : '' }, signed(t.value)))),
            h('div', { className: 'thought total' }, h('span', {}, 'Heading for'), h('b', {}, String(target))),
          ),
        );
        if (liking < lines.major) out.push(h('div', { className: 'warn' }, h('b', {}, 'Close to the edge. '), `Worst right now: ${thoughts.filter((t) => t.value < 0).sort((a, b) => a.value - b.value)[0]?.label.toLowerCase() ?? 'nothing in particular'}.`));
      } else if (this.pawnTab === 'needs') {
        out.push(h('div', { className: 'meters' }, ...(Object.keys(NEED_NAMES) as NeedId[]).map((n) => meter(NEED_NAMES[n], life.needs[n] * 100))));
        out.push(h('p', { className: 'small muted', style: 'margin-top:8px' }, 'Warmth and quiet come from the flat: the heating, the insulation and the neighbours.'));
      } else if (this.pawnTab === 'social') {
        const rels = relationships(sim, p);
        if (rels.length === 0) out.push(h('p', {}, 'Doesn\'t really know anyone here yet.'));
        for (const r of rels.slice(0, 10)) {
          const v = r.opinion;
          const why = opinionParts(sim, p, r.other).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 2).map((x) => x.label).join(', ');
          const c = v >= 0 ? 'var(--good)' : 'var(--bad)';
          const bar = v >= 0 ? `left:50%;width:${Math.min(50, v / 2)}%` : `left:${50 + Math.max(-50, v / 2)}%;width:${Math.min(50, -v / 2)}%`;
          const flat = sim.layout.flat(r.other.life!.flat)?.name ?? '';
          const row = h('button', { type: 'button', className: 'rel link', style: 'text-decoration:none;width:100%;text-align:left;color:inherit', onclick: () => this.show({ kind: 'pawn', id: r.other.id }) },
            face(r.other, likingColour(r.other.life!.liking)),
            h('div', {}, h('b', {}, `${r.other.name} · ${flat}${life.partner === r.other.id ? ' · partner' : ''}`), h('small', {}, why || 'Hardly know each other'), h('div', { className: 'opbar' }, h('i', { style: `--c:${c};${bar}` }))),
            h('span', { className: `v ${v >= 0 ? 'pos' : 'neg'}` }, signed(v)));
          out.push(row);
        }
      } else {
        const hidden = life.traits.filter((t) => !life.revealed.includes(t));
        out.push(
          h(
            'div',
            { className: 'sec' },
            h('h3', {}, 'Traits', h('em', {}, `${life.revealed.length} known · ${hidden.length} not yet`)),
            ...life.revealed.map((t) => h('div', { className: 'trait' }, h('span', { className: 't-ic' }, traitDef(t).name[0]), h('div', {}, h('b', {}, traitDef(t).name), h('p', { className: 'muted' }, traitDef(t).says)))),
            ...hidden.map(() => h('div', { className: 'trait hidden' }, h('span', { className: 't-ic' }, '?'), h('div', {}, h('b', {}, 'Not known yet'), h('p', { className: 'muted' }, 'Shows itself when it matters, or as you get to know them.')))),
          ),
        );
        const lease = flatInfo(sim, life.flat).lease;
        const rows: [string, string][] = [
          ['Job', life.job ? `${life.job.title}, ${hhmm(life.job.leave)} to ${hhmm(life.job.back)} weekdays` : (p.note ?? 'At home')],
          ['Lived here', life.since < 0 ? 'Years' : `Since day ${life.since}`],
        ];
        if (lease) rows.push(['Rent record (flat)', `${days(lease.paid)} paid, ${lease.late} late`], ['Owed', lease.owed > 0 ? pounds(lease.owed) : 'Nothing']);
        out.push(h('div', { className: 'sec' }, h('h3', {}, 'Record'), h('div', { className: 'lines' }, ...rows.map(([a, b]) => h('div', { className: 'line' }, h('span', {}, a), h('b', {}, b))))));
        out.push(
          h(
            'div',
            { className: 'sec' },
            h('h3', {}, 'History', h('em', {}, history.length === 0 ? 'nothing yet' : `${history.length} thing${history.length === 1 ? '' : 's'}`)),
            history.length === 0
              ? h('p', { className: 'small muted' }, 'Nothing worth telling yet. Give it time.')
              : h('div', { className: 'lines' }, ...history.slice(0, 12).map((t) => h('div', { className: 'line' }, h('span', {}, t.text), h('b', {}, `Day ${Math.floor(t.tick / TICKS_PER_DAY) + 1}`)))),
          ),
        );
        if (flat) out.push(h('button', { type: 'button', className: 'btn', onclick: () => this.show({ kind: 'flat', id: flat.id }) }, `Open ${flat.name}`));
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ everyone

  private renderPeople(): void {
    const sim = this.sim;
    const tenants = sim.state.pawns.filter((p) => p.life && !p.life.leaving);
    const flats = sim.layout.flats;
    const empty = flats.filter((f) => !flatInfo(sim, f.id).lease);
    this.head('People', `${tenants.length} tenant${tenants.length === 1 ? '' : 's'} · ${flats.length} flats · ${empty.length} empty`);
    const key = [sim.day, Math.floor(sim.minuteOfDay / 10), tenants.map((p) => [p.id, Math.round(p.life!.liking)]), empty.map((f) => f.id), sim.state.applicants.length, sim.state.reviews.length, Math.round(sim.state.expect.level)];
    this.fill(key, () => {
      const avg = tenants.length ? Math.round(tenants.reduce((n, p) => n + p.life!.liking, 0) / tenants.length) : 0;
      const atRisk = tenants.filter((p) => p.life!.liking < linesFor(p).major);
      const owed = Object.values(sim.state.flats).reduce((n, f) => n + (f.lease?.owed ?? 0), 0);
      const rating = landlordRating(sim);
      const rows = [...tenants].sort((a, b) => sim.layout.flats.findIndex((f) => f.id === a.life!.flat) - sim.layout.flats.findIndex((f) => f.id === b.life!.flat));
      return [
        h(
          'div',
          { className: 'summary' },
          h('div', { className: 'stat' }, h('small', {}, 'Average liking'), h('b', { style: `color:${likingColour(avg)}` }, String(avg))),
          h('div', { className: 'stat' }, h('small', {}, 'At risk'), h('b', {}, String(atRisk.length)), h('span', { className: 'small muted' }, atRisk.map((p) => p.name.split(' ')[0]).join(', ') || 'Nobody')),
          h('div', { className: 'stat' }, h('small', {}, 'Rent owed'), h('b', {}, pounds(owed))),
          h('div', { className: 'stat' }, h('small', {}, 'Your rating'), h('b', {}, rating === null ? '–' : `${rating.toFixed(1)}★`), h('span', { className: 'small muted' }, rating === null ? 'No reviews yet' : `${Math.min(8, sim.state.reviews.length)} latest reviews`)),
        ),
        h('div', { className: 'row' }, h('span', {}, 'Tenants expect'), h('b', {}, expectName(sim))),
        h('p', { className: 'small muted' }, expectNote(sim)),
        h(
          'div',
          { className: 'table-wrap' },
          h(
            'table',
            { className: 'people' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Tenant'), h('th', {}, 'Flat'), h('th', {}, 'Liking'), h('th', {}, 'Rent'))),
            h(
              'tbody',
              {},
              ...rows.map((p) => {
                const life = p.life!;
                const lk = Math.round(life.liking);
                const target = Math.round(likingTarget(thoughtsOf(sim, p)));
                const lease = flatInfo(sim, life.flat).lease;
                const trend = target > lk + 5 ? '⇈' : target > lk + 1 ? '↑' : target < lk - 5 ? '⇊' : target < lk - 1 ? '↓' : '';
                const status = !lease ? h('span', { className: 'chip' }, '–') : lease.notice ? h('span', { className: 'chip bad' }, `Leaving day ${lease.notice.day}`) : lease.owed > 0 ? h('span', { className: 'chip low' }, `Owes ${pounds(lease.owed)}`) : h('span', { className: 'chip good' }, pounds(lease.rent));
                const row = h(
                  'tr',
                  { className: 'person' },
                  h('td', {}, h('div', { className: 'nm' }, face(p, likingColour(lk)), h('div', {}, h('b', {}, p.name.split(' ')[0]), h('div', { className: 'small muted' }, p.note ?? '')))),
                  h('td', {}, sim.layout.flat(life.flat)?.name.replace('Flat ', '') ?? '?'),
                  h('td', {}, h('div', { className: 'lk' }, h('b', { style: `color:${likingColour(lk)}` }, `${lk} ${trend}`), h('div', { className: 'track' }, h('div', { className: 'fill', style: `width:${lk}%;--c:${likingColour(lk)}` })))),
                  h('td', {}, status),
                );
                row.addEventListener('click', () => this.show({ kind: 'pawn', id: p.id }));
                return row;
              }),
              ...empty.map((f) => {
                const n = sim.state.applicants.filter((a) => a.flat === f.id).length;
                const row = h('tr', { className: 'vacant person' }, h('td', { colspan: '2' }, `${f.name} · empty`), h('td', { colspan: '2' }, n ? `${n} applicant${n > 1 ? 's' : ''} waiting` : flatInfo(sim, f.id).listed ? 'Listed, nobody yet' : 'Not listed'));
                row.addEventListener('click', () => this.show(n ? { kind: 'applicants', flat: f.id } : { kind: 'flat', id: f.id }));
                return row;
              }),
            ),
          ),
        ),
        sim.state.reviews.length > 0
          ? h(
              'div',
              { className: 'sec' },
              h('h3', {}, 'Reviews', h('em', {}, 'what people said when they left; good ones bring applicants quicker')),
              h('div', { className: 'reviews' }, ...[...sim.state.reviews].reverse().slice(0, 10).map((r) => h('div', { className: 'review' }, h('b', {}, `${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}`), h('span', {}, `“${r.text}”`), h('small', {}, `${r.who}, ${r.flat} · day ${r.day}`)))),
            )
          : '',
      ];
    });
  }

  // ------------------------------------------------------------------ money

  private renderMoney(): void {
    const sim = this.sim;
    const st = sim.state;
    const m = st.mortgage;
    this.head('Money', `Day ${sim.day} · ${dayName(sim.day)}`);
    this.fill([st.money, m, st.ledger.length, sim.day, st.boiler, st.cleaner, st.security], () => {
      const weekStart = (Math.floor((sim.day - 1) / 7) * 7) * TICKS_PER_DAY;
      const week = st.ledger.filter((e) => e.tick >= weekStart).reduce((n, e) => n + e.amount, 0);
      const todayStart = (sim.day - 1) * TICKS_PER_DAY;
      const today = st.ledger.filter((e) => e.tick >= todayStart).reduce((n, e) => n + e.amount, 0);
      const empty = sim.layout.flats.filter((f) => !flatInfo(sim, f.id).lease).length;
      const bills = billsDue(sim);
      const due = m.paidOffDay !== undefined ? 0 : Math.min(m.balance, m.payment + m.arrears);
      const daysToMonday = (7 - ((sim.day - 1) % 7)) % 7 || 7;
      const paid = MORTGAGE.balance - m.balance;
      const out: (Node | string)[] = [
        h(
          'div',
          { className: 'summary' },
          h('div', { className: 'stat' }, h('small', {}, 'Balance'), h('b', { className: st.money < 0 ? 'neg' : '' }, pounds(st.money))),
          h('div', { className: 'stat' }, h('small', {}, 'Today'), h('b', { className: today >= 0 ? 'pos' : 'neg' }, pounds(today, true))),
          h('div', { className: 'stat' }, h('small', {}, 'This week'), h('b', { className: week >= 0 ? 'pos' : 'neg' }, pounds(week, true))),
        ),
      ];
      out.push(
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Mortgage', h('em', {}, 'Northfold Building Society')),
          h('div', { className: 'mortbar' }, h('i', { style: `width:${Math.max(0, Math.min(100, (paid / MORTGAGE.balance) * 100))}%` })),
          h('div', { className: 'row' }, h('span', {}, m.paidOffDay !== undefined ? `Paid off on day ${m.paidOffDay}. It's yours.` : `${pounds(m.balance)} still owed`), h('span', { className: 'chip' }, `${Math.round((paid / MORTGAGE.balance) * 100)}% paid`)),
          m.missed > 0 ? h('div', { className: 'warn' }, h('b', {}, `${m.missed} of ${MISSES_ALLOWED} payments missed. `), `${pounds(m.arrears)} in arrears. Miss ${MISSES_ALLOWED - m.missed} more in a row and the bank takes the building.`) : '',
          m.paidOffDay === undefined
            ? h(
                'div',
                { className: 'btns' },
                ...[500, 1000, 5000].map((v) =>
                  h('button', { type: 'button', className: 'btn', disabled: st.money < v * POUND, onclick: () => { if (overpay(sim, v * POUND)) this.notify(`Paid ${pounds(v * POUND)} off the mortgage.`); this.rerender(); } }, `Pay off ${pounds(v * POUND)}`),
                ),
              )
            : '',
        ),
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Coming up', h('em', {}, `Monday, in ${daysToMonday} day${daysToMonday > 1 ? 's' : ''}`)),
          h('div', { className: 'lines' }, h('div', { className: 'line' }, h('span', {}, 'Mortgage', h('small', {}, m.arrears ? 'Includes arrears' : `4% a year on what's owed`)), h('b', { className: 'neg' }, pounds(-due))), h('div', { className: 'line' }, h('span', {}, 'Bills', h('small', {}, `Insurance, stairwell lights, bins${empty ? `, council tax on ${empty} empty` : ''}, gas ${pounds(gasBill(sim))}${st.cleaner ? ', the cleaner' : ''}`)), h('b', { className: 'neg' }, pounds(-bills)))),
          st.money < due + bills ? h('p', { className: 'note small' }, `You're ${pounds(due + bills - st.money)} short for Monday.`) : '',
        ),
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Central boiler', h('em', {}, `${Math.round(outdoorTemp(sim))}° outside · ${seasonName(sim)}`)),
          h(
            'div',
            { className: 'seg-row' },
            ...BOILER.map((label, i) =>
              h('button', { type: 'button', 'aria-pressed': String(st.boiler === i), onclick: () => { st.boiler = i; this.rerender(); } }, label),
            ),
          ),
          h('p', { className: 'small muted' }, `Gas: ${pounds(gasBill(sim))} a week at this setting, for ${sim.state.furniture.filter((f) => f.def === 'radiator').length} radiators.`),
        ),
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Cleaner', h('em', {}, `${pounds(CLEANER_WEEKLY)} a week`)),
          h('label', { className: 'line' }, h('span', {}, 'Does the stairs and lobby every morning'), h('input', { type: 'checkbox', id: 'cleaner', checked: st.cleaner, onchange: (e: Event) => { st.cleaner = (e.target as HTMLInputElement).checked; this.rerender(); } })),
        ),
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Security', h('em', {}, `Risk of a break-in: ${riskWord(burglaryRisk(sim)).toLowerCase()}`)),
          h('p', { className: 'small muted' }, 'Burglars come in the small hours, by the street door or a ground-floor window, for tellies and laptops.'),
          h(
            'div',
            { className: 'lines' },
            h('div', { className: 'line' }, h('span', {}, 'Better locks', h('small', {}, 'Street door and ground-floor windows. Slows them down; often puts them off.')), st.security.locks ? h('b', {}, 'Fitted') : h('button', { type: 'button', className: 'btn', disabled: st.money < LOCKS_PRICE, onclick: () => { if (fitLocks(sim)) this.notify('New locks fitted.'); this.rerender(); } }, `Fit ${pounds(LOCKS_PRICE)}`)),
            h('div', { className: 'line' }, h('span', {}, 'Burglar alarm', h('small', {}, `Sends them running. ${pounds(ALARM_WEEKLY)} a week to monitor.`)), st.security.alarm ? h('b', {}, 'Fitted') : h('button', { type: 'button', className: 'btn', disabled: st.money < ALARM_PRICE, onclick: () => { if (fitAlarm(sim)) this.notify('Alarm fitted.'); this.rerender(); } }, `Fit ${pounds(ALARM_PRICE)}`)),
          ),
        ),
        h(
          'div',
          { className: 'sec' },
          h('h3', {}, 'Ledger', h('em', {}, 'newest first')),
          h('div', { className: 'ledger' }, ...[...st.ledger].reverse().slice(0, 30).map((e) => h('div', { className: 'row' }, h('span', {}, `D${Math.floor(e.tick / TICKS_PER_DAY) + 1} ${hhmm(Math.floor((e.tick % TICKS_PER_DAY) / TICKS_PER_MINUTE))}`), h('span', {}, e.label), h('b', { className: e.amount >= 0 ? 'pos' : 'neg' }, pounds(e.amount, true))))),
        ),
      );
      return out;
    });
  }

  // ------------------------------------------------------------------ post

  private renderPost(letterId?: number): void {
    const sim = this.sim;
    const post = [...sim.state.post].reverse();
    const open = letterId !== undefined ? sim.state.post.find((l) => l.id === letterId) : undefined;
    if (open) open.read = true;
    const unread = post.filter((l) => !l.read).length;
    const waiting = post.filter((l) => l.choices && l.chosen === undefined).length;
    this.head('Post', `${unread} unread · ${waiting} need${waiting === 1 ? 's' : ''} an answer`);
    this.fill([letterId, post.length, post.map((l) => [l.read, l.chosen])], () => {
      const out: (Node | string)[] = [];
      if (open) out.push(this.paper(open));
      out.push(
        h(
          'div',
          { className: 'letters' },
          ...post.slice(0, 40).map((l) =>
            h(
              'button',
              { type: 'button', className: `letter ${l.read ? '' : 'unread'}`, onclick: () => this.show({ kind: 'post', letter: l.id }) },
              h('span', {}, h('b', {}, l.title), h('small', {}, `${l.from} · day ${l.day}`)),
              l.choices && l.chosen === undefined ? h('span', { className: 'chip bad' }, `Answer by day ${l.dueDay}`) : l.read ? '' : h('span', { className: 'badge' }, '•'),
            ),
          ),
        ),
      );
      return out;
    });
  }

  private paper(l: Letter): HTMLElement {
    const sim = this.sim;
    const box = h('article', { className: 'paper' }, h('header', {}, h('b', {}, l.from), h('small', {}, `Day ${l.day}`)), h('p', {}, h('b', {}, l.title)), h('p', {}, l.body));
    if (l.choices) {
      if (l.chosen === undefined && l.dueDay !== undefined) box.append(h('div', { className: 'deadline' }, h('b', {}, `Answer by day ${l.dueDay}.`), h('span', {}, `If you don't: "${l.choices[l.fallback ?? 0].label}".`)));
      l.choices.forEach((c, i) =>
        box.append(
          h('button', { type: 'button', className: `opt ${l.chosen === i ? 'chosen' : ''}`, disabled: l.chosen !== undefined, onclick: () => { choose(sim, l.id, i); this.rerender(); } }, h('span', {}, `${l.chosen === i ? '✓ ' : ''}${c.label}`), h('small', {}, c.note)),
        ),
      );
    }
    if (l.flat && sim.layout.flat(l.flat)) box.append(h('button', { type: 'button', className: 'link', onclick: () => this.show({ kind: 'flat', id: l.flat! }) }, `Open ${sim.layout.flat(l.flat)!.name}`));
    return box;
  }

  // ------------------------------------------------------------------ the group chat

  private renderChat(): void {
    const sim = this.sim;
    const st = sim.state;
    const msgs = st.chat.slice(-40);
    this.chatSeen = Math.max(this.chatSeen, ...msgs.map((m) => m.id), 0);
    const members = st.pawns.filter((p) => p.life && !p.life.leaving).length;
    this.head(`${sim.state.chat.length ? 'Albert Terrace (residents)' : 'Albert Terrace'}`, `${members} tenants and you · everyone reads everything`);
    this.fill([msgs.map((m) => [m.id, m.chosen])], () => {
      if (msgs.length === 0) return [h('p', {}, 'Nothing yet. It\'ll come.')];
      const box = h('div', { className: 'chat' });
      let day = -1;
      for (const m of msgs) {
        const d = Math.floor(m.tick / TICKS_PER_DAY) + 1;
        if (d !== day) {
          box.append(h('span', { className: 'sys' }, `Day ${d} · ${dayName(d)}`));
          day = d;
        }
        const time = hhmm(Math.floor((m.tick % TICKS_PER_DAY) / TICKS_PER_MINUTE));
        if (m.from === 0) {
          box.append(h('div', { className: 'msg me' }, h('div', { className: 'bubble' }, h('b', {}, 'You'), m.text, h('time', {}, time))));
          continue;
        }
        const p = st.pawns.find((x) => x.id === m.from);
        box.append(h('div', { className: 'msg' }, p ? face(p, p.life ? likingColour(p.life.liking) : undefined) : h('span', {}), h('div', { className: 'bubble' }, h('b', {}, m.who), m.text, h('time', {}, time))));
        if (m.choices && m.ignored) box.append(h('span', { className: 'sys' }, `No reply from you, so: "${m.choices[m.chosen ?? 0].label}". They noticed.`));
        if (m.choices && m.chosen === undefined) {
          box.append(
            h(
              'div',
              { className: 'choice' },
              h('b', {}, 'Reply as the landlord'),
              ...m.choices.map((c, i) => h('button', { type: 'button', className: 'opt', onclick: () => { answer(sim, m.id, i); this.rerender(); } }, h('span', {}, `"${c.label}"`), h('small', {}, c.note))),
              h('small', { className: 'muted' }, 'Left two days, it counts as a no, and they notice.'),
            ),
          );
        }
      }
      // Newest at the bottom; start scrolled there.
      requestAnimationFrame(() => {
        this.sheet.scrollTop = this.sheet.scrollHeight;
      });
      return [box];
    });
  }

  // ------------------------------------------------------------------ a shared space

  private renderSpace(x: number, s: number): void {
    const sim = this.sim;
    const space = spaceAt(sim, x, s);
    if (!space) {
      this.close();
      return;
    }
    const pieces = sim.state.furniture.filter((f) => space.furniture.includes(f.id));
    const users = pieces.flatMap((f) => sim.state.pawns.filter((p) => p.life?.using?.furniture === f.id && p.life.using.until > 0));
    this.head(space.name, `Shared · ${pieces.length} thing${pieces.length === 1 ? '' : 's'} in it`);
    this.fill([space.name, pieces.map((f) => [f.id, f.broken]), users.map((p) => p.id), space.working], () => [
      h('p', {}, spaceBlurb(space)),
      h(
        'div',
        { className: 'lines sec' },
        ...pieces.map((f) => {
          const user = users.find((p) => p.life!.using!.furniture === f.id);
          return h('div', { className: `line${f.broken !== undefined ? ' warnline' : ''}` }, h('span', {}, furnitureDef(f.def).name, h('small', {}, f.broken !== undefined ? `Broken since day ${f.broken}` : user ? `${user.name.split(' ')[0]}: ${user.doing.toLowerCase()}` : 'Free')));
        }),
      ),
    ]);
  }

  // ------------------------------------------------------------------ applicants

  private renderApplicants(flatId: string): void {
    const sim = this.sim;
    const flat = sim.layout.flat(flatId);
    if (!flat) {
      this.close();
      return;
    }
    const info = flatInfo(sim, flatId);
    const list = sim.state.applicants.filter((a) => a.flat === flatId);
    this.head(`${flat.name} · ${list.length} applicant${list.length === 1 ? '' : 's'}`, `Going rate ${pounds(goingRate(sim, flatId))} · listed at ${pounds(info.asking)}`);
    this.fill([flatId, list.map((a) => a.id), sim.day], () => {
      if (info.lease) return [h('p', {}, 'Let. Nobody else needed.')];
      if (list.length === 0) return [h('p', {}, 'Nobody yet. Fairly priced, impressive flats get more applicants.'), h('button', { type: 'button', className: 'btn', onclick: () => this.show({ kind: 'flat', id: flatId }) }, `Back to ${flat.name}`)];
      return [
        h(
          'div',
          { className: 'cards' },
          ...list.map((a) => {
            const lead = a.people[0];
            const others = a.people.slice(1);
            const liking = likelyLiking(sim, a);
            return h(
              'article',
              { className: 'card' },
              h('div', { className: 'top-line' }, face({ look: lead.look, kind: 'tenant' }), h('div', {}, h('h4', {}, a.people.map((p) => p.name.split(' ')[0]).join(' & ') + ' ' + lead.name.split(' ').slice(1).join(' ')), h('p', { className: 'muted' }, [lead.note, ...others.map((o) => o.note)].join(', ') + (a.people.length > 1 ? ` · ${a.people.length} people` : ' · lives alone')))),
              h('dl', { className: 'kv' }, h('dt', {}, 'Offers'), h('dd', {}, `${pounds(a.offer)} a week`), h('dt', {}, 'Deposit'), h('dd', {}, pounds(a.offer * 4)), h('dt', {}, 'Known trait'), h('dd', {}, h('span', { className: 'chip' }, traitDef(a.shown).name))),
              h('p', { className: 'small muted' }, traitDef(a.shown).says),
              ...a.hints.map((t) => h('div', { className: 'hintline' }, '? ', t)),
              h('p', { className: 'small' }, h('b', {}, `Likely liking: about ${liking}. `), h('span', { className: 'muted' }, 'From what you know: the flat, the rent, the basics.')),
              h('p', { className: 'small muted' }, `Waiting until day ${Math.floor(a.until / TICKS_PER_DAY) + 1}.`),
              h(
                'div',
                { className: 'btns' },
                h('button', { type: 'button', className: 'btn ghost', onclick: () => { turnAway(sim, a.id); this.rerender(); } }, 'Turn away'),
                h('button', { type: 'button', className: 'btn primary', onclick: () => { const p = accept(sim, a.id); if (p) this.notify(p, true); else { this.notify(`${lead.name.split(' ')[0]} is moving into ${flat.name}.`); this.show({ kind: 'flat', id: flatId }); } } }, 'Offer the flat'),
              ),
            );
          }),
        ),
      ];
    });
  }
}

// ------------------------------------------------------------------ bits

function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

export function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : '0';
}

function meter(label: string, value: number, note?: string): HTMLElement {
  const v = Math.round(value);
  const c = v >= 60 ? 'var(--good)' : v >= 40 ? 'var(--ok)' : v >= 25 ? 'var(--low)' : 'var(--bad)';
  return h('div', { className: `meter ${note ? 'weakest' : ''}` }, h('span', {}, label, note ? h('small', {}, ` ${note}`) : ''), h('div', { className: 'track' }, h('div', { className: 'fill', style: `width:${v}%;--c:${c}` })), h('b', {}, String(v)));
}

/** What a shared space does for the building. */
function spaceBlurb(space: Space): string {
  if (!space.working) return `Not much use yet: ${space.kind === 'garden' ? 'it needs a bench or a table to sit at, and a way up there.' : 'nothing in it works, or nobody can get to it from the street.'}`;
  switch (space.kind) {
    case 'laundry':
      return `Tenants without a machine of their own do the washing here, and think better of the building (+${AMENITIES.laundry}). Every flat scores a little higher.`;
    case 'bikes':
      return `Tenants with jobs sometimes cycle, and like having somewhere to keep the bike (+${AMENITIES.bikes}). Every flat scores a little higher.`;
    case 'garden':
      return `Tenants sit out here on fine days, daylight only, and think better of the building (+${AMENITIES.garden}). A barbecue brings the neighbours together.`;
  }
}

function fixHint(score: FlatScore): string {
  switch (score.weakest) {
    case 'space':
      return 'more room per person. Fewer people, or knock through.';
    case 'furnishing':
      return 'more (or better) furniture.';
    case 'basics': {
      const missing = [!score.has.bed && 'a bed', !score.has.toilet && 'a toilet', !score.has.wash && 'a shower or bath', !score.has.kitchen && 'a cooker or fridge'].filter(Boolean);
      return `it needs ${missing.join(', ')}.`;
    }
    case 'light':
      return 'a window or a lamp.';
    case 'decor':
      return 'pictures, plants, a mirror.';
    case 'clean':
      return 'it\'s dirty. Tenants who aren\'t messy tidy up after themselves; messy ones don\'t.';
    case 'warmth':
      return 'turn the boiler up, add radiators, or insulate the outside walls, roof and floor.';
    case 'quiet':
      return 'noise is getting in from next door. Insulate the walls and floors it shares.';
  }
}
