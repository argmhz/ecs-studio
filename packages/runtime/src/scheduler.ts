import type { World } from '@ecs/core';

/** Data shared by every system during one completed simulation step. */
export interface SystemContext {
  readonly world: World;
  readonly deltaTime: number;
  /** One-based count of the step currently being run. */
  readonly tick: number;
  /** Simulation time at the end of this step. */
  readonly elapsedTime: number;
}

export type System = (context: SystemContext) => void;

export interface SystemOptions {
  /** Systems run in ascending order; equal orders preserve registration order. */
  readonly order?: number;
  readonly name?: string;
}

interface RegisteredSystem {
  readonly run: System;
  readonly order: number;
  readonly sequence: number;
  readonly name: string;
  lastDurationMs: number;
  totalDurationMs: number;
  runs: number;
}

export interface SystemTiming {
  readonly name: string;
  readonly order: number;
  readonly lastDurationMs: number;
  readonly averageDurationMs: number;
  readonly runs: number;
}

/** Runs registered systems in a stable, explicit order, without browser dependencies. */
export class Scheduler {
  private systems: RegisteredSystem[] = [];
  private nextSequence = 0;
  private isRunning = false;
  private completedTicks = 0;
  private totalElapsedTime = 0;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  get tick(): number {
    return this.completedTicks;
  }

  get elapsedTime(): number {
    return this.totalElapsedTime;
  }

  /** Register a system. The returned function removes it, taking effect next step. */
  addSystem(system: System, options: SystemOptions = {}): () => boolean {
    const order = options.order ?? 0;
    if (!Number.isFinite(order)) throw new RangeError('System order must be finite.');

    const entry: RegisteredSystem = {
      run: system,
      order,
      sequence: this.nextSequence++,
      name: options.name ?? system.name ?? `System ${this.nextSequence}`,
      lastDurationMs: 0,
      totalDurationMs: 0,
      runs: 0,
    };
    this.systems.push(entry);
    this.systems.sort((a, b) => a.order - b.order || a.sequence - b.sequence);

    return () => {
      const index = this.systems.indexOf(entry);
      if (index < 0) return false;
      this.systems.splice(index, 1);
      return true;
    };
  }

  /** Timing snapshots for registered systems; measurements use a monotonic clock when available. */
  getSystemTimings(): readonly SystemTiming[] {
    return this.systems.map(({ name, order, lastDurationMs, totalDurationMs, runs }) => ({
      name, order, lastDurationMs, averageDurationMs: runs ? totalDurationMs / runs : 0, runs,
    }));
  }

  /** Run one simulation step. A failed system leaves the tick counter unchanged. */
  step(deltaTime: number): SystemContext {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new RangeError('deltaTime must be a finite number greater than zero.');
    }
    if (this.isRunning) throw new Error('Scheduler steps cannot be re-entered.');

    const context: SystemContext = Object.freeze({
      world: this.world,
      deltaTime,
      tick: this.completedTicks + 1,
      elapsedTime: this.totalElapsedTime + deltaTime,
    });
    const systemsForStep = this.systems.slice();
    this.isRunning = true;
    try {
      for (const system of systemsForStep) {
        const start = globalThis.performance?.now?.() ?? Date.now();
        try { system.run(context); }
        finally {
          const duration = Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - start);
          system.lastDurationMs = duration;
          system.totalDurationMs += duration;
          system.runs++;
        }
      }
      this.completedTicks = context.tick;
      this.totalElapsedTime = context.elapsedTime;
    } finally {
      this.isRunning = false;
    }
    return context;
  }
}
