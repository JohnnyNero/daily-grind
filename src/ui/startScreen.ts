// The start screen: carry on, or start a new place. A new game picks the venue,
// then builds the starting team in the character creator before the doors open.

import { MAX_STAFF, WORK_TYPES, traitDef } from '../sim/defs';
import { addStarter, deserialize, editStaff, removeStarter, rerollStarter } from '../sim/manage';
import { Sim } from '../sim/sim';
import type { Pawn } from '../sim/state';
import { VENUES, type VenueDef } from '../sim/venues';
import { changesOf, CharacterForm, draftOf, portrait } from './characterForm';
import { capitalise, el, h, hhmm } from './dom';
import { pounds } from './hud';

export interface StartOptions {
  /** The saved place, if there is one. */
  saved: Sim | null;
  /** Skip the title and go straight to choosing a venue. */
  startAt: 'title' | 'venue';
}

function staffOf(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff && !p.staff.quit);
}

function venueLabel(v: VenueDef): string {
  return capitalise(v.name);
}

/** Shows the start screen until the player carries on or opens somewhere new. */
export function showStartScreen(opts: StartOptions): Promise<Sim> {
  return new Promise((resolve) => new StartScreen(opts, resolve).begin());
}

class StartScreen {
  private root = el('start');
  private body = el('start-body');
  private draft: Sim | null = null;
  private heading: HTMLElement | null = null;
  // The creator's heading follows the name as it's typed.
  private form = new CharacterForm(() => {
    if (this.heading) this.heading.textContent = this.form.value.name.trim() || 'Someone new';
  });

  constructor(private readonly opts: StartOptions, private readonly done: (sim: Sim) => void) {}

  begin(): void {
    this.root.hidden = false;
    document.body.classList.add('starting');
    if (this.opts.startAt === 'venue') this.venues();
    else this.title();
  }

  private finish(sim: Sim): void {
    this.root.hidden = true;
    document.body.classList.remove('starting');
    this.body.replaceChildren();
    this.done(sim);
  }

  private show(...children: (Node | string)[]): void {
    this.body.replaceChildren(...children);
    this.root.scrollTop = 0;
    this.body.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- title

  private title(): void {
    const saved = this.opts.saved;
    const crowd = h('div', { className: 'crowd', 'aria-hidden': 'true' });
    // A few made-up faces for the title, each in a venue's uniform.
    const seed = Math.floor(Math.random() * 2 ** 31);
    const sample = new Sim(seed, undefined, Math.random() < 0.5 ? 'cafe' : 'pub');
    for (const p of staffOf(sample)) crowd.append(portrait(p.look, 64, p.name));

    const status = h('p', { className: 'hint error', role: 'status' });
    const importInput = h('input', { type: 'file', accept: 'application/json,.json' });
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      try {
        const loaded = deserialize(await file.text());
        const saved = this.opts.saved;
        if (saved && !confirm(`This replaces ${saved.venue.name.toLowerCase()} you're running (day ${saved.day}). Export it from the venue panel first if you want to keep it.\n\nLoad the save?`)) return;
        this.finish(loaded);
      } catch (err) {
        status.textContent = (err as Error).message;
      }
    });

    const buttons = h('div', { className: 'start-actions' });
    if (saved) {
      buttons.append(h('button', { type: 'button', className: 'primary', onclick: () => this.finish(saved) },
        'Continue', h('small', {}, `${venueLabel(saved.venue)} · Day ${saved.day} · ${pounds(saved.state.money)}`)));
    }
    buttons.append(
      h('button', { type: 'button', className: saved ? '' : 'primary', onclick: () => this.venues() }, 'New game'),
      h('label', { className: 'file-button' }, 'Import save', importInput),
    );

    this.show(
      h('div', { className: 'title-block' },
        h('p', { className: 'kicker' }, 'A café sim'),
        h('h1', { tabindex: '-1' }, 'Daily Grind'),
        h('p', { className: 'tagline' }, 'Staff it with people you made up or recognise from work, then watch it run.')),
      crowd,
      buttons,
      status,
    );
  }

  // ---------------------------------------------------------------- venue

  private venues(): void {
    this.draft = null;
    this.show(
      h('p', { className: 'kicker' }, 'New game · 1 of 2'),
      h('h2', { tabindex: '-1' }, 'What are you opening?'),
      h('div', { className: 'cards' }, ...Object.values(VENUES).map((v) => h('button', {
        type: 'button', className: 'card choice-card',
        onclick: () => {
          this.draft = new Sim(Math.floor(Math.random() * 2 ** 31), undefined, v.id);
          this.team();
        },
      }, h('strong', {}, venueLabel(v)), h('span', {}, v.tagline),
      h('span', { className: 'hint' }, `Open ${hhmm(v.hours.open)}–${hhmm(v.hours.close)} · ${v.shifts.length} staff to start`)))),
      h('div', { className: 'row' }, h('button', { type: 'button', onclick: () => this.title() }, 'Back')),
    );
  }

  // ---------------------------------------------------------------- team

  private team(error = ''): void {
    const sim = this.draft!;
    const staff = staffOf(sim);
    const cards = staff.map((p) => {
      const best = WORK_TYPES.slice().sort((a, b) => p.staff!.skills[b.id] - p.staff!.skills[a.id])[0];
      const traits = p.staff!.traits.map((t) => traitDef(t).label).join(', ') || 'No traits';
      return h('div', { className: 'card person' },
        h('button', { type: 'button', className: 'portrait-button', 'aria-label': `Edit ${p.name}`, onclick: () => this.edit(p) },
          portrait(p.look, 56, p.name)),
        h('div', { className: 'person-info' },
          h('div', { className: 'top' }, h('strong', {}, p.name), h('span', {}, `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}`)),
          h('p', { className: 'hint' }, `${traits} · best at ${best.label.toLowerCase()}`),
          h('div', { className: 'row' },
            h('button', { type: 'button', onclick: () => this.edit(p) }, 'Edit'),
            h('button', { type: 'button', onclick: () => { rerollStarter(sim, p); this.team(); } }, 'New face'),
            h('button', {
              type: 'button', className: 'danger', disabled: staff.length <= 1,
              onclick: () => this.team(removeStarter(sim, p) ?? ''),
            }, 'Remove'))));
    });

    this.show(
      h('p', { className: 'kicker' }, `New game · 2 of 2 · ${venueLabel(sim.venue)}`),
      h('h2', { tabindex: '-1' }, 'Meet your team'),
      h('p', { className: 'hint' }, 'Make them up, or make your coworkers. Tap someone to change their name, looks and traits. Shifts can be changed later from the Staff panel.'),
      h('div', { className: 'cards' }, ...cards),
      h('p', { className: 'hint error', role: 'status' }, error),
      h('div', { className: 'row wrap' },
        h('button', {
          type: 'button', disabled: staff.length >= MAX_STAFF,
          onclick: () => {
            const added = addStarter(sim);
            if (typeof added === 'string') this.team(added);
            else this.edit(added, true);
          },
        }, staff.length >= MAX_STAFF ? 'Team is full' : 'Add someone'),
        h('button', { type: 'button', onclick: () => { for (const p of staffOf(sim)) rerollStarter(sim, p); this.team(); } }, 'Shuffle everyone')),
      h('div', { className: 'row' },
        h('button', { type: 'button', onclick: () => this.venues() }, 'Back'),
        h('button', { type: 'button', className: 'primary', onclick: () => this.open() }, 'Open the doors')),
    );
  }

  private open(): void {
    const saved = this.opts.saved;
    if (saved && !confirm(`This replaces ${saved.venue.name.toLowerCase()} you're running (day ${saved.day}). Export it from the venue panel first if you want to keep it.\n\nOpen the new place?`)) return;
    this.finish(this.draft!);
  }

  // ---------------------------------------------------------------- creator

  /** `isNew`: they were just added, so Cancel takes them off the team again. */
  private edit(p: Pawn, isNew = false): void {
    const sim = this.draft!;
    // Surprise me changes the person straight away, so Cancel puts them back as they were.
    const before = { name: p.name, look: { ...p.look }, traits: [...p.staff!.traits], skills: { ...p.staff!.skills } };
    const cancel = () => {
      if (isNew && removeStarter(sim, p) === null) {
        this.team();
        return;
      }
      Object.assign(p, { name: before.name, look: before.look });
      Object.assign(p.staff!, { traits: before.traits, skills: before.skills });
      this.team();
    };
    const error = h('p', { className: 'hint error', role: 'status' });
    this.form.set(draftOf(p));
    const heading = h('h2', { tabindex: '-1' }, p.name);
    this.heading = heading;
    this.show(
      h('p', { className: 'kicker' }, 'Character creator'),
      heading,
      this.form.root,
      error,
      h('div', { className: 'row' },
        h('button', {
          type: 'button',
          onclick: () => {
            rerollStarter(sim, p);
            this.form.set(draftOf(p));
            heading.textContent = p.name;
          },
        }, 'Surprise me')),
      h('div', { className: 'row' },
        h('button', { type: 'button', onclick: cancel }, 'Cancel'),
        h('button', {
          type: 'button', className: 'primary',
          onclick: () => {
            const err = editStaff(p, changesOf(this.form.value));
            if (err) error.textContent = err;
            else this.team();
          },
        }, 'Done')),
    );
  }
}
