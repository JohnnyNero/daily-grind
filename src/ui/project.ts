// The project bar (spec 4): "Next: furnish Flat 3. £340 of £610." Tap it for what it needs,
// which opens Build there.
//
// main.ts makes one on the #project-bar mount point and calls `update` every frame, so this
// only works out the project again when the building, the day or the pin has changed, and
// redraws the words when the money has.

import { nextProject, projectLine, type Project } from '../sim/project';
import type { Sim } from '../sim/sim';

export class ProjectBar {
  /** Opens Build on a flat (or Build as it is, with no flat). Set by main.ts. */
  onOpen?: (flat?: string) => void;

  private project: Project | null = null;
  private key = '';
  private text = '';

  constructor(
    private readonly sim: Sim,
    private readonly root: HTMLElement,
  ) {
    this.root.hidden = true;
    this.root.addEventListener('click', () => {
      const p = this.project;
      if (!p) return;
      this.sim.notify(p.needs);
      this.onOpen?.(p.flat);
    });
  }

  /** Every frame. */
  update(): void {
    const sim = this.sim;
    const key = `${sim.version}:${sim.day}:${sim.state.project.pinned ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      this.project = nextProject(sim);
    }
    // Not while Denise is still showing you round.
    const p = this.project;
    const show = !!p && sim.state.handover.stop < 0;
    this.root.hidden = !show;
    if (!show || !p) return;
    const text = projectLine(sim, p);
    if (text !== this.text) {
      this.text = text;
      this.root.textContent = text;
    }
  }
}
