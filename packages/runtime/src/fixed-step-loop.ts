import { Scheduler } from './scheduler.ts';

export interface FixedStepLoopOptions {
  readonly fixedDeltaTime?: number;
  readonly maxStepsPerFrame?: number;
  /** Caps elapsed wall time accepted from a single frame, such as after tab sleep. */
  readonly maxFrameDeltaTime?: number;
}

export interface FrameAdvanceResult {
  readonly steps: number;
  /** Fraction of a fixed step available for render interpolation, always in [0, 1). */
  readonly alpha: number;
  /** Wall/simulation time discarded by frame and catch-up limits. */
  readonly droppedTime: number;
}

/** Fixed-step simulation driver. A browser adapter can feed it RAF elapsed time. */
export class FixedStepLoop {
  readonly fixedDeltaTime: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDeltaTime: number;

  private accumulator = 0;
  private paused = false;
  private readonly scheduler: Scheduler;

  constructor(scheduler: Scheduler, options: FixedStepLoopOptions = {}) {
    this.scheduler = scheduler;
    this.fixedDeltaTime = options.fixedDeltaTime ?? 1 / 60;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.maxFrameDeltaTime = options.maxFrameDeltaTime ?? 0.25;
    if (!Number.isFinite(this.fixedDeltaTime) || this.fixedDeltaTime <= 0) {
      throw new RangeError('fixedDeltaTime must be a finite number greater than zero.');
    }
    if (!Number.isInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame < 1) {
      throw new RangeError('maxStepsPerFrame must be a positive integer.');
    }
    if (!Number.isFinite(this.maxFrameDeltaTime) || this.maxFrameDeltaTime <= 0) {
      throw new RangeError('maxFrameDeltaTime must be a finite number greater than zero.');
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
    this.accumulator = 0;
  }

  resume(): void {
    this.paused = false;
  }

  /** Advance from elapsed wall time, running no more than maxStepsPerFrame ticks. */
  advance(frameDeltaTime: number): FrameAdvanceResult {
    if (!Number.isFinite(frameDeltaTime) || frameDeltaTime < 0) {
      throw new RangeError('frameDeltaTime must be a finite number greater than or equal to zero.');
    }
    if (this.paused) return { steps: 0, alpha: 0, droppedTime: 0 };

    const acceptedTime = Math.min(frameDeltaTime, this.maxFrameDeltaTime);
    let droppedTime = frameDeltaTime - acceptedTime;
    this.accumulator += acceptedTime;
    let steps = 0;

    try {
      while (this.accumulator >= this.fixedDeltaTime && steps < this.maxStepsPerFrame) {
        this.scheduler.step(this.fixedDeltaTime);
        this.accumulator = Math.max(0, this.accumulator - this.fixedDeltaTime);
        steps++;
      }
    } catch (error) {
      // A partially executed tick must not be retried on the next frame.
      this.pause();
      throw error;
    }

    if (this.accumulator >= this.fixedDeltaTime) {
      const retainedTime = this.accumulator % this.fixedDeltaTime;
      droppedTime += this.accumulator - retainedTime;
      this.accumulator = retainedTime;
    }
    return {
      steps,
      alpha: this.accumulator / this.fixedDeltaTime,
      droppedTime,
    };
  }

  /** Run exactly one fixed step while paused, as used by an editor's Step control. */
  stepOnce(): void {
    if (!this.paused) throw new Error('Pause the simulation before stepping once.');
    this.accumulator = 0;
    this.scheduler.step(this.fixedDeltaTime);
  }
}
