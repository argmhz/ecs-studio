import assert from 'node:assert/strict';
import test from 'node:test';
import { InputReconciler, SnapshotBuffer } from '../src/client.ts';

test('snapshot buffering interpolates across missing packets and ignores late arrivals', () => {
  const snapshots = new SnapshotBuffer<{ player: { x: number }; state: string }>({ interpolationDelayTicks: 2, capacity: 4 });
  assert.equal(snapshots.push({ tick: 0, state: { player: { x: 0 }, state: 'old' } }), true);
  assert.equal(snapshots.push({ tick: 3, state: { player: { x: 30 }, state: 'new' } }), true); // packets 1 and 2 were lost
  assert.equal(snapshots.push({ tick: 2, state: { player: { x: 20 }, state: 'late' } }), false);
  const sample = snapshots.sample(4); // render tick 2 between received ticks 0 and 3
  assert.deepEqual(sample?.state, { player: { x: 20 }, state: 'old' });
  assert.equal(sample?.alpha, 2 / 3);
  assert.equal(snapshots.latestTick, 3);
});

test('snapshot history stays bounded under delayed delivery', () => {
  const snapshots = new SnapshotBuffer<number>({ interpolationDelayTicks: 1, capacity: 3 });
  for (let tick = 0; tick < 10; tick++) snapshots.push({ tick, state: tick });
  assert.equal(snapshots.size, 3);
  assert.equal(snapshots.sample(9)?.state, 8);
});

test('input reconciliation discards acknowledged commands and replays the unacknowledged tail', () => {
  const history = new InputReconciler<number, number>(3);
  history.record(1, 5);
  history.record(2, 3);
  history.record(3, -2);
  const first = history.reconcile(10, 1, (state, input) => state + input);
  assert.deepEqual(first, { state: 11, replayedInputs: 2, discardedInputs: 1 });
  assert.equal(history.pendingCount, 2);
  assert.equal(history.reconcile(8, 0, (state, input) => state + input), undefined, 'stale snapshots cannot rewind the local state');
  const next = history.reconcile(12, 3, (state, input) => state + input);
  assert.deepEqual(next, { state: 12, replayedInputs: 0, discardedInputs: 2 });
  assert.equal(history.pendingCount, 0);
});

test('prediction history rejects sequence regressions and overflow', () => {
  const history = new InputReconciler<string, string>(1);
  history.record(7, 'move');
  assert.throws(() => history.record(7, 'duplicate'), /increasing/);
  assert.throws(() => history.record(8, 'overflow'), /full/);
});
