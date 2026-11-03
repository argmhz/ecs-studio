import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphExecutionBudgetError, runNodeGraph } from '../src/node-graph.js';

test('node graph visits declarative flow in order and stops at an exit', () => {
  const result = runNodeGraph('start', [
    { id: 'start', next: 'move' },
    { id: 'move', next: 'finish' },
    { id: 'finish' },
  ]);
  assert.deepEqual(result, { visits: 3, visitedNodeIds: ['start', 'move', 'finish'] });
});

test('cyclic node graph stops at its per-run visit budget', () => {
  assert.throws(
    () => runNodeGraph('a', [{ id: 'a', next: 'b' }, { id: 'b', next: 'a' }], { maxNodeVisits: 7 }),
    error => error instanceof GraphExecutionBudgetError && error.maxNodeVisits === 7,
  );
});

test('node graph rejects missing links, duplicate IDs, invalid budgets and cancellation', () => {
  assert.throws(() => runNodeGraph('a', [{ id: 'a', next: 'missing' }]), /missing next node/);
  assert.throws(() => runNodeGraph('a', [{ id: 'a' }, { id: 'a' }]), /Duplicate graph node ID/);
  assert.throws(() => runNodeGraph('a', [{ id: 'a' }], { maxNodeVisits: 0 }), /between 1 and/);
  assert.throws(() => runNodeGraph('a', [{ id: 'a' }], { maxNodeVisits: Number.MAX_SAFE_INTEGER }), /between 1 and/);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => runNodeGraph('a', [{ id: 'a' }], { signal: controller.signal }), /cancelled/);
});
