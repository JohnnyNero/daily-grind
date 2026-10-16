import { Renderer } from './render/renderer';
import { Sim } from './sim/sim';
import { TICKS_PER_MINUTE, type Recap } from './sim/state';
import { Hud } from './ui/hud';
import { attachInput } from './ui/input';
import { BuildUi } from './ui/buildUi';
import { CafeUi, TeamUi } from './ui/manageUi';
import { loadFromDevice, saveToDevice } from './ui/save';
import { showStartScreen } from './ui/startScreen';

/** Ticks per real second at 1x: one in-game minute per real second. */
const BASE_TICKS_PER_SECOND = TICKS_PER_MINUTE;
/** While nobody is on site the clock races ahead (about an in-game hour every 0.3s). */
const FAST_FORWARD = 200;
/** Never simulate more than this per frame, so a slow phone can't spiral. */
const MAX_TICKS_PER_FRAME = 20000;
const AUTOSAVE_MS = 60_000;

// ?seed=123 or ?venue=pub skip the start screen and open somewhere fresh;
// ?new opens the start screen at "What are you opening?".
async function chooseSim(): Promise<Sim> {
  const params = new URLSearchParams(location.search);
  const seedParam = Number(params.get('seed'));
  const venueParam = params.get('venue');
  if (seedParam > 0 || venueParam !== null) {
    const sim = new Sim(seedParam || Math.floor(Math.random() * 2 ** 31), undefined, venueParam ?? 'cafe');
    if (venueParam !== null) {
      // Drop the parameter so a reload carries on with this place instead of starting again.
      history.replaceState(null, '', location.pathname);
      saveToDevice(sim);
    }
    return sim;
  }
  const startAt = params.has('new') ? 'venue' : 'title';
  if (startAt === 'venue') history.replaceState(null, '', location.pathname);
  const sim = await showStartScreen({ saved: loadFromDevice(), startAt });
  saveToDevice(sim);
  return sim;
}

function play(sim: Sim): void {
  document.getElementById('cafe-open')!.textContent = sim.venue.text.noun.charAt(0).toUpperCase() + sim.venue.text.noun.slice(1);
  document.title = `Daily Grind · ${sim.venue.name}`;

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const topbar = document.getElementById('topbar')!;
  const renderer = new Renderer(canvas, sim);

  let speed = 1;
  let selectedId: number | null = null;

  const hud = new Hud(
    sim,
    (s) => {
      speed = s;
      hud.setSpeed(speed);
    },
    () => {
      selectedId = null;
    },
    (id) => {
      selectedId = id;
    },
  );
  hud.setSpeed(speed);

  const hooks = {
    notify: (text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral') => hud.notify(text, tone),
    closePanels: () => hud.closePanels(),
    showRecap: (r: Recap) => hud.showRecap(r),
  };
  const team = new TeamUi(sim, hooks, () => hud.refreshStaffPanel());
  const build = new BuildUi(sim, renderer, hooks);
  const cafe = new CafeUi(sim, hooks, () => build.start());
  hud.onStaffPanelOpen = () => team.render();
  hud.onClosePanels = () => cafe.close();
  hud.otherPanelOpen = () => cafe.isOpen;

  function fitView(): void {
    const top = topbar.getBoundingClientRect().bottom;
    renderer.fit(8, top + 8, window.innerWidth - 16, window.innerHeight - top - 16);
  }

  function onResize(): void {
    renderer.resize(window.innerWidth, window.innerHeight);
    fitView();
  }
  window.addEventListener('resize', onResize);
  onResize();
  document.getElementById('recentre')!.addEventListener('click', fitView);

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
      if (hud.staffPanelOpen || cafe.isOpen) return;
      selectedId = renderer.pawnAt(x, y)?.id ?? null;
    },
  });

  // Saving: every in-game day (when the recap is written), every minute, and when the page is hidden.
  function save(): void {
    if (!cafe.isResetting) saveToDevice(sim);
  }
  let recapsSaved = sim.state.recaps.length;
  setInterval(save, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  window.addEventListener('pagehide', save);

  let last = performance.now();
  let carry = 0;
  let lastView = '';
  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const held = hud.recapOpen ? 0 : speed;
    const fastForwarding = held > 0 && sim.isQuiet();
    const multiplier = fastForwarding ? FAST_FORWARD : held;
    carry += dt * BASE_TICKS_PER_SECOND * multiplier;
    const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(carry));
    carry -= ticks;
    if (carry > MAX_TICKS_PER_FRAME) carry = 0;
    sim.run(ticks);
    if (sim.state.recaps.length !== recapsSaved) {
      recapsSaved = sim.state.recaps.length;
      save();
    }

    const selected = sim.state.pawns.find((p) => p.id === selectedId && p.onMap) ?? null;
    if (!selected) selectedId = null;
    renderer.selectedId = selectedId;
    // Only redraw when something could have changed: time moved, the view moved, or a selection did.
    const c = renderer.camera;
    const view = `${c.ox}|${c.oy}|${c.scale}|${selectedId}|${renderer.buildSelection.version}|${renderer.buildSelection.active}|${renderer.staticVersion}`;
    if (ticks > 0 || view !== lastView) renderer.draw(now);
    lastView = view;
    hud.update(selected, fastForwarding, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for poking at the sim from the browser console.
  Object.assign(window, { sim, renderer });
}

void chooseSim().then(play);

// Offline play and "Add to Home Screen". Only in the built site, so dev reloads stay fresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the game works without it.
  });
}

