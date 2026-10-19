import { Renderer } from './render/renderer';
import { deserialize, serialize } from './sim/save';
import { Sim } from './sim/sim';
import { TICKS_PER_MINUTE } from './sim/state';
import { BuildUi } from './ui/buildUi';
import { el } from './ui/dom';
import { Hud } from './ui/hud';
import { attachInput } from './ui/input';

/** At 1x an in-game minute takes 2.5 real seconds, so a day takes about an hour. */
const BASE_TICKS_PER_SECOND = TICKS_PER_MINUTE / 2.5;
/** Never simulate more than this per frame, so a slow phone can't spiral. */
const MAX_TICKS_PER_FRAME = 20000;
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
  const topbar = el('topbar');
  const renderer = new Renderer(canvas, sim);
  let speed = 1;
  let resetting = false;

  const hud = new Hud(sim, (s) => {
    speed = s;
    hud.showSpeed(speed);
  });
  hud.showSpeed(speed);
  hud.onClose = () => {
    renderer.selectedPawn = null;
  };
  const build = new BuildUi(sim, renderer);

  function fitView(): void {
    const top = topbar.getBoundingClientRect().bottom;
    const bottom = build.active ? el('buildbar').offsetHeight : 64;
    renderer.fit(8, top + 8, window.innerWidth - 16, window.innerHeight - top - bottom - 16);
  }
  function onResize(): void {
    renderer.resize(window.innerWidth, window.innerHeight);
    fitView();
  }
  window.addEventListener('resize', onResize);
  onResize();
  build.onToggle = fitView;
  el('recentre').addEventListener('click', fitView);

  el('build-open').addEventListener('click', () => {
    hud.closeInfo();
    build.start();
  });

  attachInput(canvas, renderer.camera, {
    onDragStart: (x, y) => build.dragStart(x, y),
    onDragMove: (x, y) => build.dragMove(x, y),
    onDragEnd: () => build.dragEnd(),
    onDragCancel: () => build.dragCancel(),
    onTap(x, y) {
      if (build.active) {
        build.tap(x, y);
        return;
      }
      const p = renderer.pawnAt(x, y);
      if (p) {
        renderer.selectedPawn = p.id;
        hud.showPawn(p);
        return;
      }
      const cell = renderer.cellAt(x, y);
      const flat = cell && cell.r < 3 ? sim.layout.flatAt(cell.x, cell.s) : undefined;
      if (flat) {
        renderer.selectedPawn = null;
        hud.showFlat(flat.id);
      } else hud.closeInfo();
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
  el('menu-new').addEventListener('click', () => {
    if (!confirm('Start again with a new building? This one will be gone.')) return;
    resetting = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to clear.
    }
    location.reload();
  });

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
  let lastVersion = sim.version;
  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    carry += dt * BASE_TICKS_PER_SECOND * speed;
    const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(carry));
    carry -= ticks;
    sim.run(ticks);
    if (sim.version !== lastVersion) {
      lastVersion = sim.version;
      hud.refresh();
    }
    const c = renderer.camera;
    const view = `${c.ox}|${c.oy}|${c.scale}|${renderer.selectedPawn}|${renderer.build.version}|${sim.version}`;
    if (ticks > 0 || view !== lastView) renderer.draw();
    lastView = view;
    hud.update(now, speed);
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
