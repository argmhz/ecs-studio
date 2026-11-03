import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScriptInputSnapshot } from '@ecs/scripting';
import { initialPongState, runPongTick } from '../src/pong-script.ts';

const input: ScriptInputSnapshot = { actions: {}, pointer: { x: 0, y: 0, inside: false, primary: false, secondary: false }, connectedGamepads: [] };

test('a point flows through the node graph before code updates the score', () => {
  const first = runPongTick({ input, deltaTime: 1 / 60, state: { ...initialPongState(), ballX: 1.03, velocityX: 1 }, codeSubscriptions: [], graphState: null, graphSubscriptions: [], graphStarted: false, pendingEvents: [] });
  assert.equal(first.pendingEvents[0]?.type, 'pong.point');
  assert.equal(first.state.leftScore, 0);

  const second = runPongTick({ input, deltaTime: 1 / 60, state: first.state, codeSubscriptions: first.codeSubscriptions, graphState: first.graphState, graphSubscriptions: first.graphSubscriptions, graphStarted: first.graphStarted, pendingEvents: first.pendingEvents });
  assert.equal(second.pendingEvents[0]?.type, 'pong.scored');
  assert.equal(second.state.leftScore, 0);

  const third = runPongTick({ input, deltaTime: 1 / 60, state: second.state, codeSubscriptions: second.codeSubscriptions, graphState: second.graphState, graphSubscriptions: second.graphSubscriptions, graphStarted: second.graphStarted, pendingEvents: second.pendingEvents });
  assert.equal(third.state.leftScore, 1);
});
