import assert from 'node:assert/strict';
import test from 'node:test';
import { createScriptApi } from '../src/api.ts';
import { evaluateVisualGraph, graphPorts, validateVisualGraph, type VisualGraph } from '../src/visual-graph.ts';

const graph: VisualGraph = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'literal', kind: 'value.number', x: 0, y: 120, data: { value: 7 } },
    { id: 'set', kind: 'variable.set', x: 250, y: 0, data: { name: 'score' } },
    { id: 'end', kind: 'flow.end', x: 500, y: 0, data: {} },
  ],
  links: [
    { id: 'flow-a', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'set', portId: 'exec' } },
    { id: 'data-a', from: { nodeId: 'literal', portId: 'value' }, to: { nodeId: 'set', portId: 'value' } },
    { id: 'flow-b', from: { nodeId: 'set', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  ],
};

test('visual graph validates typed exec/data links and runs variables in flow order', () => {
  assert.equal(graphPorts('variable.set').inputs.find(port => port.id === 'value')?.type, 'number');
  assert.deepEqual(evaluateVisualGraph(graph), {
    variables: { score: 7 }, visitedNodeIds: ['start', 'set', 'end'],
    output: { state: { score: 7 }, componentCommands: [], emittedEvents: [], subscriptions: [] },
  });
});

test('visual component nodes use the shared API and return schema-hosted commands', () => {
  const componentGraph: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'json', kind: 'value.json', x: 0, y: 100, data: { value: '{"x": 9}' } },
    { id: 'write', kind: 'component.write', x: 200, y: 0, data: { componentTypeId: 'engine.transform2d' } },
    { id: 'end', kind: 'flow.end', x: 400, y: 0, data: {} },
  ], links: [
    { id: 'flow-a', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'write', portId: 'exec' } },
    { id: 'data-a', from: { nodeId: 'json', portId: 'value' }, to: { nodeId: 'write', portId: 'value' } },
    { id: 'flow-b', from: { nodeId: 'write', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  ] };
  const api = createScriptApi({ entityId: 'entity:1', phase: 'update', deltaTime: 1 / 60, components: { 'engine.transform2d': { x: 0 } }, availableComponentTypeIds: ['engine.transform2d'] });
  const result = evaluateVisualGraph(componentGraph, { api });
  assert.deepEqual(result.output.componentCommands, [{ operation: 'set', entityId: 'entity:1', componentTypeId: 'engine.transform2d', data: { x: 9 } }]);
});

test('visual event nodes emit payloads and return subscriptions through the shared API', () => {
  const eventGraph: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'payload', kind: 'event.payload', x: 0, y: 100, data: { eventType: 'game.input' } },
    { id: 'emit', kind: 'event.emit', x: 200, y: 0, data: { eventType: 'game.ready' } },
    { id: 'subscribe', kind: 'event.subscribe', x: 400, y: 0, data: { eventType: 'ui.button.clicked' } },
    { id: 'end', kind: 'flow.end', x: 600, y: 0, data: {} },
  ], links: [
    { id: 'flow-a', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
    { id: 'payload-a', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
    { id: 'flow-b', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'subscribe', portId: 'exec' } },
    { id: 'flow-c', from: { nodeId: 'subscribe', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  ] };
  const api = createScriptApi({ entityId: 'entity:1', phase: 'update', deltaTime: 0, events: [{ type: 'game.input', payload: { ready: true } }], availableComponentTypeIds: [] });
  const result = evaluateVisualGraph(eventGraph, { api });
  assert.deepEqual(result.output.emittedEvents, [{ type: 'game.ready', payload: { ready: true } }]);
  assert.deepEqual(result.output.subscriptions, ['ui.button.clicked']);
});

test('lifecycle graph entrypoints subscribe at start and handle only the matching event payload', () => {
  const lifecycleGraph: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.onStart', x: 0, y: 0, data: {} },
    { id: 'subscribe', kind: 'event.subscribe', x: 180, y: 0, data: { eventType: 'pong.point' } },
    { id: 'start-end', kind: 'flow.end', x: 360, y: 0, data: {} },
    { id: 'point', kind: 'event.onEvent', x: 0, y: 150, data: { eventType: 'pong.point' } },
    { id: 'payload', kind: 'event.payload', x: 180, y: 300, data: { eventType: 'pong.point' } },
    { id: 'emit', kind: 'event.emit', x: 360, y: 150, data: { eventType: 'pong.scored' } },
    { id: 'event-end', kind: 'flow.end', x: 600, y: 150, data: {} },
  ], links: [
    { id: 'start-flow', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'subscribe', portId: 'exec' } },
    { id: 'start-done', from: { nodeId: 'subscribe', portId: 'then' }, to: { nodeId: 'start-end', portId: 'exec' } },
    { id: 'event-flow', from: { nodeId: 'point', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
    { id: 'event-data', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
    { id: 'event-done', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'event-end', portId: 'exec' } },
  ] };
  const startApi = createScriptApi({ entityId: 'game', phase: 'start', deltaTime: 0, availableComponentTypeIds: [] });
  const started = evaluateVisualGraph(lifecycleGraph, { api: startApi, entryNodeId: 'start' });
  assert.deepEqual(started.output.subscriptions, ['pong.point']);
  const api = createScriptApi({ entityId: 'game', phase: 'event', deltaTime: 0, subscriptions: started.output.subscriptions, events: [{ type: 'pong.point', payload: { scorer: 'left' } }], availableComponentTypeIds: [] });
  const handled = evaluateVisualGraph(lifecycleGraph, { api, entryNodeId: 'point' });
  assert.deepEqual(handled.output.emittedEvents, [{ type: 'pong.scored', payload: { scorer: 'left' } }]);
  assert.deepEqual(handled.visitedNodeIds, ['point', 'emit', 'event-end']);
  const unmatched = createScriptApi({ entityId: 'game', phase: 'event', deltaTime: 0, subscriptions: started.output.subscriptions, events: [{ type: 'pong.other', payload: null }], availableComponentTypeIds: [] });
  assert.deepEqual(evaluateVisualGraph(lifecycleGraph, { api: unmatched, entryNodeId: 'point' }).output.emittedEvents, []);
});

test('event received data node gates event-driven graph flow', () => {
  const eventGraph: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'subscribe', kind: 'event.subscribe', x: 180, y: 0, data: { eventType: 'pong.point' } },
    { id: 'received', kind: 'event.received', x: 180, y: 140, data: { eventType: 'pong.point' } },
    { id: 'branch', kind: 'flow.branch', x: 400, y: 0, data: {} },
    { id: 'payload', kind: 'event.payload', x: 400, y: 180, data: { eventType: 'pong.point' } },
    { id: 'emit', kind: 'event.emit', x: 650, y: 0, data: { eventType: 'pong.scored' } },
    { id: 'end', kind: 'flow.end', x: 870, y: 0, data: {} },
    { id: 'no-event-end', kind: 'flow.end', x: 650, y: 150, data: {} },
  ], links: [
    { id: 'start-subscribe', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'subscribe', portId: 'exec' } },
    { id: 'subscribe-branch', from: { nodeId: 'subscribe', portId: 'then' }, to: { nodeId: 'branch', portId: 'exec' } },
    { id: 'condition', from: { nodeId: 'received', portId: 'value' }, to: { nodeId: 'branch', portId: 'condition' } },
    { id: 'yes', from: { nodeId: 'branch', portId: 'true' }, to: { nodeId: 'emit', portId: 'exec' } },
    { id: 'no', from: { nodeId: 'branch', portId: 'false' }, to: { nodeId: 'no-event-end', portId: 'exec' } },
    { id: 'event-payload', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
    { id: 'emit-end', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  ] };
  const evaluate = (events: { type: string; payload: import('../src/api.ts').ScriptJson }[]) => evaluateVisualGraph(eventGraph, { api: createScriptApi({ entityId: 'game', phase: 'update', deltaTime: 0, events, availableComponentTypeIds: [] }) });
  assert.deepEqual(evaluate([]).output.emittedEvents, []);
  assert.deepEqual(evaluate([{ type: 'pong.point', payload: { scorer: 'left' } }]).output.emittedEvents, [{ type: 'pong.scored', payload: { scorer: 'left' } }]);
});

test('repeat loops return to their loop node and stop at the visit budget', () => {
  const loop: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'count', kind: 'value.number', x: 0, y: 100, data: { value: 3 } },
    { id: 'one', kind: 'value.number', x: 0, y: 200, data: { value: 1 } },
    { id: 'repeat', kind: 'flow.repeat', x: 200, y: 0, data: {} },
    { id: 'set', kind: 'variable.set', x: 420, y: 0, data: { name: 'score' } },
    { id: 'loopEnd', kind: 'flow.loop.end', x: 650, y: 0, data: {} },
    { id: 'end', kind: 'flow.end', x: 850, y: 0, data: {} },
  ], links: [
    { id: 'to-repeat', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'repeat', portId: 'exec' } },
    { id: 'count-input', from: { nodeId: 'count', portId: 'value' }, to: { nodeId: 'repeat', portId: 'count' } },
    { id: 'body', from: { nodeId: 'repeat', portId: 'body' }, to: { nodeId: 'set', portId: 'exec' } },
    { id: 'value', from: { nodeId: 'one', portId: 'value' }, to: { nodeId: 'set', portId: 'value' } },
    { id: 'to-loop-end', from: { nodeId: 'set', portId: 'then' }, to: { nodeId: 'loopEnd', portId: 'exec' } },
    { id: 'done', from: { nodeId: 'repeat', portId: 'done' }, to: { nodeId: 'end', portId: 'exec' } },
  ] };
  const result = evaluateVisualGraph(loop);
  assert.equal(result.variables.score, 1);
  assert.equal(result.visitedNodeIds.filter(id => id === 'set').length, 3);
  assert.throws(() => evaluateVisualGraph({ ...loop, nodes: loop.nodes.map(node => node.id === 'count' ? { ...node, data: { value: 1000 } } : node) }, { maxNodeVisits: 10 }), /visit budget/);
  assert.throws(() => evaluateVisualGraph({ ...loop, nodes: loop.nodes.map(node => node.id === 'count' ? { ...node, data: { value: 1001 } } : node) }), /between 0 and 1000/);
});

test('visual graph rejects incompatible or multiply connected inputs', () => {
  const wrongType: VisualGraph = { ...graph, links: [...graph.links, { id: 'bad', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'set', portId: 'value' } }] };
  assert.throws(() => validateVisualGraph(wrongType), /Cannot connect exec to number/);
  const duplicate: VisualGraph = { ...graph, links: [...graph.links, { id: 'duplicate', from: { nodeId: 'literal', portId: 'value' }, to: { nodeId: 'set', portId: 'value' } }] };
  assert.throws(() => validateVisualGraph(duplicate), /already has a connection/);
});

test('visual graph cancels and enforces a bounded flow traversal', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => evaluateVisualGraph(graph, { signal: controller.signal }), /cancelled/);
  assert.throws(() => evaluateVisualGraph(graph, { maxNodeVisits: 2 }), /exceeded its 2 node visit budget/);
});

test('input action node exposes the shared input snapshot to visual scripts', () => {
  const inputGraph: VisualGraph = { version: 1, nodes: [
    { id: 'start', kind: 'event.start', x: 0, y: 0, data: {} },
    { id: 'action', kind: 'input.action', x: 0, y: 100, data: { action: 'jump' } },
    { id: 'emit', kind: 'event.emit', x: 200, y: 0, data: { eventType: 'game.input' } },
    { id: 'end', kind: 'flow.end', x: 400, y: 0, data: {} },
  ], links: [
    { id: 'flow-a', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
    { id: 'data-a', from: { nodeId: 'action', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
    { id: 'flow-b', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  ] };
  const result = evaluateVisualGraph(inputGraph, { api: createScriptApi({
    entityId: 'entity:1', phase: 'update', deltaTime: 0, availableComponentTypeIds: [],
    input: { actions: { jump: { value: 1, pressed: true, justPressed: true, justReleased: false } }, pointer: { x: 0, y: 0, inside: false, primary: false, secondary: false }, connectedGamepads: [] },
  }) });
  assert.deepEqual(result.output.emittedEvents, [{ type: 'game.input', payload: { value: 1, pressed: true, justPressed: true, justReleased: false } }]);
});
