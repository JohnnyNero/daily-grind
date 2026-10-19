import { Renderer } from './render/renderer';
import { deserialize, serialize } from './sim/save';
import { Sim } from './sim/sim';
import { planTicks, quietNight } from './sim/pace';
import { BuildUi } from './ui/buildUi';
import { el } from './ui/dom';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
import { attachInput } from './ui/input';
import { FurnitureCard } from './ui/furnitureCard';
import { furnitureAt } from './sim/build';
import { spaceAt } from './sim/shared';
import { HandoverUi } from './ui/handover';

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

  const panels = new Panels(sim, (text, bad) => hud.notify(text, bad));
  const hud = new Hud(sim, panels, (s) => {
    speed = s;
    hud.showSpeed(speed);
  });
  hud.showSpeed(speed);
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
    // Quiet nights (everyone asleep or out, nothing happening) run faster until something stirs.
    const quiet = quietNight(sim);
    const plan = planTicks(dt, speed, quiet, carry);
    carry = plan.carry;
    const ticks = plan.ticks;
    sim.run(ticks);
    hud.showNight(quiet && speed > 0);
    if (sim.state.repossessed !== undefined && el('endscreen').hidden) {
      el('endscreen').hidden = false;
      el('end-body').textContent = `Four missed mortgage payments, and on day ${sim.state.repossessed} Northfold Building Society took the building. The tenants have been told. Some of them are pleased.`;
      speed = 0;
      hud.showSpeed(speed);
    }
    const c = renderer.camera;
    const view = `${c.ox}|${c.oy}|${c.scale}|${renderer.selectedPawn}|${renderer.build.version}|${sim.version}|${renderer.overlay}`;
    if (ticks > 0 || view !== lastView) renderer.draw();
    lastView = view;
    hud.update(now);
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
