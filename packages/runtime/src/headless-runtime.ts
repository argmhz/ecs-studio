import { World } from '@ecs/core';
import { FixedStepLoop, type FixedStepLoopOptions, type FrameAdvanceResult } from './fixed-step-loop.ts';
import { Scheduler, type System, type SystemOptions } from './scheduler.ts';

/** A manually driven simulation host for Node and other non-browser environments. */
export class HeadlessRuntime {
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly loop: FixedStepLoop;
  private readonly removeSystems = new Set<() => boolean>();
  private disposed = false;

  constructor(world = new World(), options: FixedStepLoopOptions = {}) {
    this.world = world;
    this.scheduler = new Scheduler(world);
    this.loop = new FixedStepLoop(this.scheduler, options);
  }

  addSystem(system: System, options?: SystemOptions): () => boolean {
    this.assertActive();
    const remove = this.scheduler.addSystem(system, options);
    let removed = false;
    const removeOnce = () => {
      if (removed) return false;
      removed = true;
      this.removeSystems.delete(removeOnce);
      return remove();
    };
    this.removeSystems.add(removeOnce);
    return removeOnce;
  }

  /** Feed elapsed host time into the shared fixed-step simulation. */
  advance(elapsedSeconds: number): FrameAdvanceResult {
    this.assertActive();
    return this.loop.advance(elapsedSeconds);
  }

  pause(): void { this.assertActive(); this.loop.pause(); }
  resume(): void { this.assertActive(); this.loop.resume(); }
  stepOnce(): void { this.assertActive(); this.loop.stepOnce(); }

  /** Stop future ticks and detach registered systems; the caller retains the World. */
  dispose(): void {
    if (this.disposed) return;
    this.loop.pause();
    for (const remove of [...this.removeSystems]) remove();
    this.disposed = true;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('HeadlessRuntime has been disposed.');
  }
}
