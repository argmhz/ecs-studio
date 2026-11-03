import type { MultiplayerJson, RoomSnapshotMessage } from './protocol.ts';

export interface SnapshotFrame<T> {
  readonly tick: number;
  readonly state: T;
}

export interface SnapshotSample<T> {
  readonly state: T;
  readonly targetTick: number;
  readonly fromTick: number;
  readonly toTick: number;
  readonly alpha: number;
}

export interface SnapshotBufferOptions {
  /** Render this many simulation ticks behind the newest known server tick. */
  readonly interpolationDelayTicks?: number;
  /** Bound memory when the connection is slow or snapshots arrive faster than rendering. */
  readonly capacity?: number;
}

/** Bounded, monotonic snapshot history for delayed remote-state rendering. */
export class SnapshotBuffer<T> {
  readonly interpolationDelayTicks: number;
  readonly capacity: number;
  private readonly frames: SnapshotFrame<T>[] = [];

  constructor(options: SnapshotBufferOptions = {}) {
    this.interpolationDelayTicks = options.interpolationDelayTicks ?? 2;
    this.capacity = options.capacity ?? 32;
    if (!Number.isFinite(this.interpolationDelayTicks) || this.interpolationDelayTicks < 0) throw new RangeError('interpolationDelayTicks must be finite and non-negative.');
    if (!Number.isInteger(this.capacity) || this.capacity < 2) throw new RangeError('Snapshot capacity must be an integer of at least 2.');
  }

  get latestTick(): number | undefined { return this.frames.at(-1)?.tick; }
  get size(): number { return this.frames.length; }

  /** Ignore duplicate or late packets, as commonly happens after jitter or reordering. */
  push(frame: SnapshotFrame<T> | Pick<RoomSnapshotMessage, 'tick' | 'state'>): boolean {
    if (!Number.isSafeInteger(frame.tick) || frame.tick < 0) throw new RangeError('Snapshot tick must be a non-negative safe integer.');
    if (this.latestTick !== undefined && frame.tick <= this.latestTick) return false;
    this.frames.push({ tick: frame.tick, state: frame.state as T });
    if (this.frames.length > this.capacity) this.frames.splice(0, this.frames.length - this.capacity);
    return true;
  }

  /** Sample at serverTick - interpolationDelayTicks; numeric fields are interpolated by default. */
  sample(serverTick: number, interpolate: (from: T, to: T, alpha: number) => T = interpolateSnapshotValues): SnapshotSample<T> | undefined {
    if (!Number.isFinite(serverTick) || serverTick < 0) throw new RangeError('serverTick must be finite and non-negative.');
    if (!this.frames.length) return undefined;
    const targetTick = Math.max(0, serverTick - this.interpolationDelayTicks);
    if (targetTick <= this.frames[0]!.tick) {
      const first = this.frames[0]!;
      return { state: first.state, targetTick, fromTick: first.tick, toTick: first.tick, alpha: 0 };
    }
    for (let index = 1; index < this.frames.length; index++) {
      const to = this.frames[index]!;
      if (targetTick > to.tick) continue;
      const from = this.frames[index - 1]!;
      const alpha = (targetTick - from.tick) / (to.tick - from.tick);
      return { state: interpolate(from.state, to.state, alpha), targetTick, fromTick: from.tick, toTick: to.tick, alpha };
    }
    const last = this.frames.at(-1)!;
    return { state: last.state, targetTick, fromTick: last.tick, toTick: last.tick, alpha: 0 };
  }

  clear(): void { this.frames.length = 0; }
}

/**
 * Reconcile predicted local state with a server snapshot, then replay inputs the
 * server has not acknowledged yet. The caller supplies its game-specific step.
 */
export class InputReconciler<Input, State> {
  private readonly capacity: number;
  private readonly pending: { sequence: number; input: Input }[] = [];
  private latestSequence = -1;
  private acknowledgedSequence = -1;

  constructor(capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Input history capacity must be a positive integer.');
    this.capacity = capacity;
  }

  get pendingCount(): number { return this.pending.length; }
  get lastAcknowledgedSequence(): number { return this.acknowledgedSequence; }

  record(sequence: number, input: Input): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence <= this.latestSequence) throw new RangeError('Input sequence must be a new, increasing non-negative safe integer.');
    if (this.pending.length >= this.capacity) throw new RangeError('Unacknowledged input history is full.');
    this.latestSequence = sequence;
    this.pending.push({ sequence, input });
  }

  /** Returns undefined for stale acknowledgements so old snapshots cannot rewind prediction. */
  reconcile(authoritativeState: State, acknowledgedSequence: number, replay: (state: State, input: Input) => State): { readonly state: State; readonly replayedInputs: number; readonly discardedInputs: number } | undefined {
    if (!Number.isSafeInteger(acknowledgedSequence) || acknowledgedSequence < -1 || acknowledgedSequence > this.latestSequence) throw new RangeError('Acknowledged input sequence is invalid or was never sent.');
    if (acknowledgedSequence < this.acknowledgedSequence) return undefined;
    const discardedInputs = this.pending.findIndex(item => item.sequence > acknowledgedSequence);
    const firstPending = discardedInputs < 0 ? this.pending.length : discardedInputs;
    this.pending.splice(0, firstPending);
    this.acknowledgedSequence = acknowledgedSequence;
    let state = authoritativeState;
    for (const item of this.pending) state = replay(state, item.input);
    return { state, replayedInputs: this.pending.length, discardedInputs: firstPending };
  }

  clear(): void { this.pending.length = 0; this.latestSequence = -1; this.acknowledgedSequence = -1; }
}

/** Interpolate numeric JSON fields; non-numeric fields switch to the newer value at alpha 1. */
export function interpolateSnapshotValues<T>(from: T, to: T, alpha: number): T {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('Interpolation alpha must be in [0, 1].');
  return interpolateJson(from as MultiplayerJson, to as MultiplayerJson, alpha) as T;
}

function interpolateJson(from: MultiplayerJson, to: MultiplayerJson, alpha: number): MultiplayerJson {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * alpha;
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) return from.map((value, index) => interpolateJson(value, to[index]!, alpha));
  if (isJsonRecord(from) && isJsonRecord(to)) {
    const result: Record<string, MultiplayerJson> = {};
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const oldValue = from[key], newValue = to[key];
      if (oldValue !== undefined && newValue !== undefined) result[key] = interpolateJson(oldValue, newValue, alpha);
      else if (alpha < 1 && oldValue !== undefined) result[key] = oldValue;
      else if (alpha === 1 && newValue !== undefined) result[key] = newValue;
    }
    return result;
  }
  return alpha < 1 ? from : to;
}

function isJsonRecord(value: MultiplayerJson): value is { readonly [key: string]: MultiplayerJson } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
