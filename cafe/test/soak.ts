// Long soak + chaos run, for manual use (too slow for CI):
//   npx vite-node test/soak.ts [seeds] [days] [chaosPerHour]
// Prints every invariant violation, stuck pawn and exception, plus timing.

import { deserialize, serialize } from '../src/sim/manage';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE } from '../src/sim/state';
import { chaosAction, FuzzRng } from './fuzz';
import { checkInvariants, StuckWatch } from './invariants';

declare const process: { argv: string[] };

const seeds = Number(process.argv[2] ?? 6);
const days = Number(process.argv[3] ?? 14);
const chaosPerHour = Number(process.argv[4] ?? 2);

let failures = 0;
const report = (msg: string) => {
  failures++;
  if (failures <= 80) console.log('  !', msg);
};

for (const venue of ['cafe', 'pub', 'cinema']) {
  for (let seed = 1; seed <= seeds; seed++) {
    let sim = new Sim(seed * 7919, undefined, venue);
    const rng = new FuzzRng(seed);
    const watch = new StuckWatch();
    const lastActions: string[] = [];
    const t0 = performance.now();
    let maxSave = 0;
    try {
      for (let t = 0; t < days * TICKS_PER_DAY; t++) {
        sim.step();
        if (t % TICKS_PER_MINUTE !== 0) continue;
        if (chaosPerHour > 0 && rng.next() < chaosPerHour / 60) {
          lastActions.push(chaosAction(sim, rng));
          if (lastActions.length > 6) lastActions.shift();
        }
        if (t % (10 * TICKS_PER_MINUTE) === 0) {
          for (const p of checkInvariants(sim)) report(`${venue} seed ${seed}: ${p} | recent: ${lastActions.join(' ; ')}`);
          for (const p of watch.check(sim)) report(`${venue} seed ${seed}: ${p}`);
        }
        // Save and reload every few hours; the reloaded sim must carry on.
        if (t % (6 * 60 * TICKS_PER_MINUTE) === 0) {
          const json = serialize(sim);
          maxSave = Math.max(maxSave, json.length);
          sim = deserialize(json);
        }
      }
    } catch (e) {
      report(`${venue} seed ${seed}: EXCEPTION ${(e as Error).stack?.split('\n').slice(0, 4).join(' / ')} | recent: ${lastActions.join(' ; ')}`);
    }
    const ms = performance.now() - t0;
    const y = sim.state.yesterday;
    console.log(`${venue} seed ${seed}: ${days} days in ${(ms / 1000).toFixed(1)}s (${(ms / days).toFixed(0)} ms/day), staff ${sim.state.pawns.filter((p) => p.staff).length}, money £${Math.round(sim.state.money / 100)}, rep ${sim.state.reputation.toFixed(0)}, last day ${y?.served}/${y?.walkouts}, save ${(maxSave / 1024).toFixed(0)} KB`);
  }
}
console.log(failures === 0 ? 'NO FAILURES' : `${failures} FAILURES`);
