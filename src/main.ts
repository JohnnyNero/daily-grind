import { Renderer } from './render/renderer';
import { deserialize, serialize } from './sim/save';
import { Sim } from './sim/sim';
import { planTicks, quietNight, skipToMorning } from './sim/pace';
import { BuildUi } from './ui/buildUi';
import { el } from './ui/dom';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
import { attachInput } from './ui/input';
import { FurnitureCard } from './ui/furnitureCard';
import { furnitureAt } from './sim/build';
import { spaceAt } from './sim/shared';
import { HandoverUi } from './ui/handover';
import { CardTray } from './ui/cards';
import { openCards } from './sim/drip';
import { ProjectBar } from './ui/project';

const AUTOSAVE_MS = 30_000;
const SAVE_KEY = 'landlord:save';

function load(): Sim {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed'));
  if (seed > 0 || params.has('new')) {
    history.replaceState(null, '', location.pathname);
    return Sim.create(seed || Math.floor(Math.random() * 2 ** 31));
  }
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (json) return deserialize(json);
  } catch {
    // No storage, or a broken save: start fresh.
  }
  return Sim.create(Math.floor(Math.random() * 2 ** 31));
}

function save(sim: Sim): void {
  try {
    localStorage.setItem(SAVE_KEY, serialize(sim));
  } catch {
    // Storage full or blocked: the game carries on without saving.
  }
}

function play(sim: Sim): void {
  const canvas = el<HTMLCanvasElement>('view');
  const renderer = new Renderer(canvas, sim);
  let speed = 1;
  let resetting = false;
  /** Skip to morning is running (spec 0.2). The speed you picked is untouched and carries on after. */
  let skipping = false;

  const panels = new Panels(sim, (text, bad) => hud.notify(text, bad));
  const hud = new Hud(sim, panels, (s) => {
    speed = s;
    hud.showSpeed(speed);
  });
  hud.showSpeed(speed);
  hud.onSkip = () => {
    skipping = true;
  };
  panels.onClose = () => {
    renderer.selectedPawn = null;
  };
  const card = new FurnitureCard(sim);
  const build = new BuildUi(sim, renderer, card);
  card.onNotify = (text, bad) => hud.notify(text, bad);
  card.onMove = (id) => (build.active ? build.moveFromCard(id) : build.startMoving(id));
  card.onChange = () => {
    if (card.showing === null && !build.isMoving) renderer.build.selected = null;
    renderer.build.version++;
  };
  hud.onBuild = () => build.start();
  const handover = new HandoverUi(sim);
  hud.onOverlay = (mode) => {
    renderer.overlay = mode;
  };

  /** The part of the screen between the chips along the top and the dock along the bottom. */
  function viewBox(): { x: number; y: number; w: number; h: number } {
    const top = (build.active ? el('build-zoom') : el('overlays')).getBoundingClientRect().bottom;
    const bottom = el('dock').offsetHeight + (build.active ? el('buildbar').offsetHeight : 0);
    return { x: 8, y: top + 8, w: window.innerWidth - 16, h: window.innerHeight - top - bottom - 16 };
  }
  function fitView(): void {
    const b = viewBox();
    renderer.fit(b.x, b.y, b.w, b.h);
  }
  build.viewBox = viewBox;
  build.onNotify = (text, bad) => hud.notify(text, bad);
  function onResize(): void {
    renderer.resize(window.innerWidth, window.innerHeight);
    fitView();
  }
  window.addEventListener('resize', onResize);
  onResize();
  build.onFit = fitView;
  // The walk round: the camera goes to each flat as Denise gets there.
  handover.onFocus = (flatId) => {
    const lay = sim.layout;
    const f = flatId ? lay.flat(flatId) : undefined;
    if (!f) {
      fitView();
      return;
    }
    const cells = lay.flatCells(f).map((n) => lay.xs(n));
    const xs = cells.map(([x]) => x);
    const ss = cells.map(([, s]) => s);
    renderer.focus(Math.min(...xs), Math.max(...xs), Math.min(...ss), Math.max(...ss), viewBox());
  };
  // Her list: each line takes you to where you'd do it.
  handover.onOpen = (id) => {
    const h = sim.state.handover;
    if (id === 'meet') panels.show({ kind: 'people' });
    else if (id === 'let' && h.toLet) panels.show(sim.state.applicants.some((a) => a.flat === h.toLet) ? { kind: 'applicants', flat: h.toLet } : { kind: 'flat', id: h.toLet });
    else if (id === 'fit' && h.fit) {
      panels.close();
      build.guide(h.fit);
    }
    else if (id === 'pay') panels.show({ kind: 'money' });
  };
  handover.update();
  el('recentre').addEventListener('click', fitView);
  // The drip's tray (ui/cards.ts) and the next thing to save for (ui/project.ts).
  const tray = new CardTray(sim, el('tray'));
  tray.onNotify = (text) => hud.notify(text, true);
  // Opening a card pans the camera to what it's about, once the open card has taken its room.
  let focusCard: number | null = null;
  let pan: { from: { scale: number; ox: number; oy: number }; to: { scale: number; ox: number; oy: number }; start: number } | null = null;
  tray.onFocus = (id) => {
    focusCard = id;
  };
  tray.cardAt = (x, y) => renderer.cardAt(x, y);
  function startPan(id: number, now: number): void {
    const c = openCards(sim).find((x) => x.id === id);
    const spot = c ? renderer.spotOf(c) : null;
    if (!c || !spot) return;
    const cam = renderer.camera;
    const from = { ...cam };
    const box = viewBox();
    const p = c.pawn !== undefined ? sim.state.pawns.find((x) => x.id === c.pawn) : undefined;
    const flat = sim.layout.flat(c.flat ?? p?.life?.flat ?? '');
    if (cam.scale < 2 && flat) {
      // Zoomed right out: zoom to the flat.
      const cells = sim.layout.flatCells(flat).map((n) => sim.layout.xs(n));
      const xs = cells.map(([x]) => x);
      const ss = cells.map(([, s]) => s);
      renderer.focus(Math.min(...xs), Math.max(...xs), Math.min(...ss), Math.max(...ss), box);
    }
    const to = { scale: cam.scale, ox: box.x + box.w / 2 - ((spot.x0 + spot.x1) / 2) * cam.scale, oy: box.y + box.h / 2 - ((spot.y0 + spot.y1) / 2) * cam.scale };
    Object.assign(cam, from);
    pan = { from, to, start: now };
  }
  const project = new ProjectBar(sim, el('project-bar'));
  project.onOpen = (flat) => {
    panels.close();
    if (flat) build.guide(flat);
    else build.start();
  };

  attachInput(canvas, renderer.camera, {
    onDragStart: (x, y) => build.dragStart(x, y),
    onDragMove: (x, y) => build.dragMove(x, y),
    onDragEnd: () => build.dragEnd(),
    onDragCancel: () => build.dragCancel(),
    onTap(x, y) {
      if (handover.tap()) return;
      if (build.active) {
        build.tap(x, y);
        return;
      }
      // A card's `!` or edge chip opens it; with a card open, a tap on the building folds it.
      if (tray.tap(x, y)) return;
      const p = renderer.pawnAt(x, y);
      const was = card.showing;
      card.hide();
      if (p) {
        renderer.selectedPawn = p.id;
        panels.show({ kind: 'pawn', id: p.id });
        return;
      }
      const cell = renderer.cellAt(x, y);
      // Furniture brings up its card (tap it again, or anywhere else, to put the card away).
      const piece = cell ? furnitureAt(sim.state, cell.x, cell.s) : undefined;
      if (piece && was !== piece.id) {
        panels.close();
        renderer.build.selected = piece.id;
        card.show(piece.id);
        return;
      }
      const flat = cell ? sim.layout.flatAt(cell.x, cell.s) : undefined;
      if (flat) {
        renderer.selectedPawn = null;
        panels.show({ kind: 'flat', id: flat.id });
        return;
      }
      const space = cell ? spaceAt(sim, cell.x, cell.s) : undefined;
      if (space) {
        renderer.selectedPawn = null;
        panels.show({ kind: 'space', x: cell!.x, s: cell!.s });
      } else panels.close();
    },
  });

  // The menu.
  const menu = el('menu');
  el('menu-open').addEventListener('click', () => {
    menu.hidden = !menu.hidden;
  });
  el('menu-close').addEventListener('click', () => {
    menu.hidden = true;
  });
  el('menu-export').addEventListener('click', () => {
    const blob = new Blob([serialize(sim)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `landlord-day-${sim.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  el<HTMLInputElement>('menu-import').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const loaded = deserialize(await file.text());
      resetting = true;
      localStorage.setItem(SAVE_KEY, serialize(loaded));
      location.reload();
    } catch (err) {
      hud.notify(err instanceof Error ? err.message : "Couldn't load that file.", true);
    }
  });
  const startAgain = () => {
    resetting = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to clear.
    }
    location.reload();
  };
  // Starting again needs a second tap to confirm (the page can't show a confirm box everywhere).
  let armed = false;
  el('menu-new').addEventListener('click', () => {
    if (!armed) {
      armed = true;
      el('menu-new').textContent = 'Tap again to throw this building away';
      return;
    }
    startAgain();
  });
  el('end-new').addEventListener('click', startAgain);

  const doSave = () => {
    if (!resetting) save(sim);
  };
  setInterval(doSave, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') doSave();
  });
  window.addEventListener('pagehide', doSave);

  let last = performance.now();
  let carry = 0;
  let lastView = '';
  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    let ticks = 0;
    if (skipping) {
      // Skip to morning: the same ticks, as many as fit in a frame, until 07:00 or something stirs.
      const before = sim.state.tick;
      const start = performance.now();
      let result: 'morning' | 'woke' | 'more';
      do result = skipToMorning(sim, 2000);
      while (result === 'more' && performance.now() - start < 12);
      ticks = sim.state.tick - before;
      carry = 0;
      if (result !== 'more') {
        skipping = false;
        if (result === 'woke') hud.notify('Something stirred, so the night stopped skipping.');
      }
    } else {
      const plan = planTicks(dt, speed, carry);
      carry = plan.carry;
      ticks = plan.ticks;
      sim.run(ticks);
    }
    hud.showSkip(skipping ? 'skipping' : quietNight(sim) ? 'offer' : 'off');
    if (sim.state.repossessed !== undefined && el('endscreen').hidden) {
      el('endscreen').hidden = false;
      el('end-body').textContent = `Four missed mortgage payments, and on day ${sim.state.repossessed} Northfold Building Society took the building. The tenants have been told. Some of them are pleased.`;
      speed = 0;
      hud.showSpeed(speed);
    }
    if (pan) {
      const t = Math.min(1, (now - pan.start) / 400);
      const e = t * (2 - t);
      const cam = renderer.camera;
      cam.scale = pan.from.scale + (pan.to.scale - pan.from.scale) * e;
      cam.ox = pan.from.ox + (pan.to.ox - pan.from.ox) * e;
      cam.oy = pan.from.oy + (pan.to.oy - pan.from.oy) * e;
      if (t >= 1) pan = null;
    }
    const c = renderer.camera;
    const view = `${c.ox}|${c.oy}|${c.scale}|${renderer.selectedPawn}|${renderer.build.version}|${sim.version}|${renderer.overlay}`;
    if (ticks > 0 || view !== lastView || renderer.animating) renderer.draw();
    lastView = view;
    hud.update(now);
    tray.update(now);
    if (focusCard !== null) {
      startPan(focusCard, now);
      focusCard = null;
    }
    project.update();
    handover.update();
    build.updateNeeds();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  Object.assign(window, { sim, renderer });
}

play(load());

// Offline play and "Add to Home Screen". Only in the built site, so dev reloads stay fresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the game works without it.
  });
}
