// The character form: name, looks and traits with a live portrait.
// Used by the new-game team builder and by Edit on the Staff panel.

import { HAIR_COLOURS, HAIR_STYLES, SKIN_TONES, TRAITS, traitDef, type HairStyle, type TraitId } from '../sim/defs';
import type { StaffChanges } from '../sim/manage';
import type { Look, Pawn } from '../sim/state';
import { drawPawn } from '../render/pawnArt';
import { capitalise, h } from './dom';

export const MAX_TRAITS = 3;

export interface CharacterDraft {
  name: string;
  look: Look;
  traits: TraitId[];
  catchphrases: string[];
}

export function draftOf(p: Pawn): CharacterDraft {
  return { name: p.name, look: { ...p.look }, traits: [...(p.staff?.traits ?? [])], catchphrases: [...(p.staff?.catchphrases ?? [])] };
}

export function changesOf(d: CharacterDraft): StaffChanges {
  return { name: d.name, skin: d.look.skin, hair: d.look.hair, hairStyle: d.look.hairStyle, traits: [...d.traits], catchphrases: [...d.catchphrases] };
}

/** Draws a pawn filling a square canvas, sharp on high-density screens. */
export function paintPortrait(canvas: HTMLCanvasElement, look: Look): void {
  const css = canvas.clientWidth || Number(canvas.getAttribute('width')) || 64;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(css * dpr)) {
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);
  drawPawn(ctx, look, css / 2, css * 0.6, css * 0.95);
}

export function portrait(look: Look, size: number, label: string): HTMLCanvasElement {
  const canvas = h('canvas', { className: 'portrait', width: size, height: size, role: 'img', 'aria-label': label });
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  // Paint once it's in the page (so its CSS size is known), and right away as a fallback.
  paintPortrait(canvas, look);
  requestAnimationFrame(() => paintPortrait(canvas, look));
  return canvas;
}

/** Why a trait can't be added to this set, or null if it can. */
function traitBlock(traits: TraitId[], id: TraitId): string | null {
  if (traits.includes(id)) return null;
  const def = traitDef(id);
  const clash = traits.find((t) => def.excludes?.includes(t) || traitDef(t).excludes?.includes(id));
  if (clash) return `Clashes with ${traitDef(clash).label}`;
  if (traits.length >= MAX_TRAITS) return `${MAX_TRAITS} traits at most`;
  return null;
}

export class CharacterForm {
  readonly root: HTMLElement;
  private draft: CharacterDraft | null = null;
  private preview = h('canvas', { className: 'portrait large', width: 112, height: 112, role: 'img', 'aria-label': 'Preview' });
  private name = h('input', { type: 'text', maxlength: 16, autocomplete: 'off', spellcheck: 'false' });
  private skin = h('div', { className: 'swatches' });
  private hair = h('div', { className: 'swatches' });
  private style = h('div', { className: 'choices' });
  private traits = h('div', { className: 'choices' });
  private traitNotes = h('ul', { className: 'trait-notes' });
  private phrases = h('textarea', { rows: 3, maxlength: 190, placeholder: 'One per line, up to three. "Not my circus." "Who moved my mug?"' });

  constructor(private readonly onChange: () => void = () => {}) {
    this.name.addEventListener('input', () => {
      if (this.draft) this.draft.name = this.name.value;
      this.onChange();
    });
    this.root = h('div', { className: 'character-form' },
      h('div', { className: 'identity' },
        this.preview,
        h('label', { className: 'field' }, 'Name', this.name)),
      h('h3', {}, 'Skin'), this.skin,
      h('h3', {}, 'Hair colour'), this.hair,
      h('h3', {}, 'Hair style'), this.style,
      h('h3', {}, `Traits (up to ${MAX_TRAITS})`), this.traits, this.traitNotes,
      h('h3', {}, 'Catchphrases'),
      h('label', { className: 'field' }, 'Things they say (great for real colleagues)', this.phrases),
    );
    this.phrases.addEventListener('input', () => {
      if (this.draft) this.draft.catchphrases = this.phraseLines();
      this.onChange();
    });
  }

  set(draft: CharacterDraft): void {
    this.draft = { name: draft.name, look: { ...draft.look }, traits: [...draft.traits], catchphrases: [...draft.catchphrases] };
    this.name.value = draft.name;
    this.phrases.value = draft.catchphrases.join('\n');
    this.paint();
  }

  get value(): CharacterDraft {
    const d = this.draft!;
    return { name: this.name.value, look: { ...d.look }, traits: [...d.traits], catchphrases: this.phraseLines() };
  }

  private phraseLines(): string[] {
    return this.phrases.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  }

  focusName(): void {
    this.name.focus();
  }

  private update(fn: (d: CharacterDraft) => void): () => void {
    return () => {
      fn(this.draft!);
      this.paint();
      this.onChange();
    };
  }

  private paint(): void {
    const d = this.draft!;
    paintPortrait(this.preview, d.look);
    const swatches = (box: HTMLElement, colours: readonly string[], current: string, label: string, set: (c: string) => void) =>
      box.replaceChildren(...colours.map((c, i) => h('button', {
        type: 'button', style: `background:${c}`, 'aria-label': `${label} ${i + 1}`, 'aria-pressed': String(c === current),
        onclick: this.update(() => set(c)),
      })));
    swatches(this.skin, SKIN_TONES, d.look.skin, 'Skin tone', (c) => { d.look.skin = c; });
    swatches(this.hair, HAIR_COLOURS, d.look.hair, 'Hair colour', (c) => { d.look.hair = c; });
    this.style.replaceChildren(...HAIR_STYLES.map((st: HairStyle) => h('button', {
      type: 'button', 'aria-pressed': String(st === d.look.hairStyle), onclick: this.update((x) => { x.look.hairStyle = st; }),
    }, capitalise(st))));
    this.traits.replaceChildren(...TRAITS.map((t) => {
      const block = traitBlock(d.traits, t.id);
      return h('button', {
        type: 'button', title: block ?? t.description, disabled: block !== null, 'aria-pressed': String(d.traits.includes(t.id)),
        onclick: this.update((x) => {
          x.traits = x.traits.includes(t.id) ? x.traits.filter((id) => id !== t.id) : [...x.traits, t.id];
        }),
      }, t.label);
    }));
    this.traitNotes.replaceChildren(...(d.traits.length === 0
      ? [h('li', {}, 'No traits: a perfectly ordinary person.')]
      : d.traits.map((id) => h('li', {}, h('b', {}, traitDef(id).label), ` ${traitDef(id).description}`))));
  }
}
