import assert from 'node:assert/strict';
import test from 'node:test';
import { EditHistory } from '../src/edit-history.ts';

test('undo and redo move one atomic edit between stacks', () => {
  const history = new EditHistory<number>();
  history.record('Move', 1, 2);
  assert.equal(history.undoLabel, 'Move');
  assert.equal(history.undo()?.before, 1);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo()?.after, 2);
  assert.equal(history.canRedo, false);
});

test('new edits clear redo and old edits are bounded', () => {
  const history = new EditHistory<number>(2);
  history.record('A', 0, 1);
  history.record('B', 1, 2);
  history.undo();
  history.record('C', 1, 3);
  assert.equal(history.canRedo, false);
  history.record('D', 3, 4);
  history.record('E', 4, 5);
  assert.equal(history.undoLabel, 'E');
  history.undo();
  assert.equal(history.undoLabel, 'D');
  history.undo();
  assert.equal(history.canUndo, false);
});
