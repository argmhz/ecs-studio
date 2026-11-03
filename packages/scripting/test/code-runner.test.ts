import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodeScriptSource } from '../src/code-runner.js';

const ScriptFunction = Function as unknown as new (...args: string[]) => (input: unknown) => Promise<unknown>;

test('code invocation exposes copied components and returns commands and events', async () => {
  const body = createCodeScriptSource(`function update(api) {
    const transform = api.getComponent('engine.transform2d');
    api.setComponent('engine.transform2d', { x: transform.x + api.properties.speed });
    api.emit('game.moved', { x: transform.x + api.properties.speed });
    api.state = { ticks: 1 };
  }`);
  const run = new ScriptFunction('input', body);
  const input = { entityId: 'e1', phase: 'update', deltaTime: 1 / 60, state: null, properties: { speed: 2 }, components: { 'engine.transform2d': { x: 3 } }, availableComponentTypeIds: ['engine.transform2d'] };
  assert.deepEqual(await run(input), {
    state: { ticks: 1 },
    componentCommands: [{ operation: 'set', entityId: 'e1', componentTypeId: 'engine.transform2d', data: { x: 5 } }],
    emittedEvents: [{ type: 'game.moved', payload: { x: 5 } }], subscriptions: [],
  });
  assert.equal((input.components['engine.transform2d'] as { x: number }).x, 3);
});

test('code invocation rejects missing update functions and unknown components', async () => {
  const runMissing = new ScriptFunction('input', createCodeScriptSource('const noop = 1;'));
  await assert.rejects(runMissing({ phase: 'update' }), /declare onUpdate.*or update/);
  const runUnknown = new ScriptFunction('input', createCodeScriptSource("async function update(api) { api.getComponent('missing'); }"));
  await assert.rejects(runUnknown({ phase: 'update', availableComponentTypeIds: [], components: {} }), /Unknown component/);
});

test('lifecycle wrapper supports onStart, onUpdate and event listeners while preserving legacy update', async () => {
  const start = new ScriptFunction('input', createCodeScriptSource(`function onStart(api) { api.on('game.ping', (event, current) => { current.state = { pong: event.payload }; current.emit('game.pong', event.payload); }); }`));
  const startResult = await start({ entityId: 'e1', phase: 'start', deltaTime: 0, availableComponentTypeIds: [] });
  assert.deepEqual(startResult, { state: null, componentCommands: [], emittedEvents: [], subscriptions: ['game.ping'] });
  const event = new ScriptFunction('input', createCodeScriptSource('function onUpdate(api) {}'));
  const eventResult = await event({ entityId: 'e1', phase: 'event', deltaTime: 0, events: [{ type: 'game.ping', payload: 7 }], availableComponentTypeIds: [] }) as { emittedEvents: unknown[] };
  assert.deepEqual(eventResult.emittedEvents, [{ type: 'game.pong', payload: 7 }]);
  const update = new ScriptFunction('input', createCodeScriptSource('function onUpdate(api) { api.emit("game.tick"); }'));
  assert.deepEqual(((await update({ entityId: 'e1', phase: 'update', deltaTime: 0, availableComponentTypeIds: [] })) as { emittedEvents: unknown[] }).emittedEvents, [{ type: 'game.tick', payload: null }]);
});

test('event-only scripts can omit onUpdate', async () => {
  const run = new ScriptFunction('input', createCodeScriptSource("function onStart(api) { api.on('game.ping', () => {}); }"));
  const output = await run({ entityId: 'e1', phase: 'update', availableComponentTypeIds: [] }) as { componentCommands: unknown[] };
  assert.deepEqual(output.componentCommands, []);
});

test('code scripts receive the current action and pointer snapshot', async () => {
  const run = new ScriptFunction('input', createCodeScriptSource(`function update(api) { api.emit('game.jump', { pressed: api.input.actions.jump.pressed, x: api.input.pointer.x }); }`));
  const result = await run({ entityId: 'e1', phase: 'update', deltaTime: 0, availableComponentTypeIds: [], input: { actions: { jump: { value: 1, pressed: true, justPressed: true, justReleased: false } }, pointer: { x: 0.75, y: 0, inside: true, primary: false, secondary: false }, connectedGamepads: [] } });
  assert.deepEqual(result, { state: null, componentCommands: [], emittedEvents: [{ type: 'game.jump', payload: { pressed: true, x: 0.75 } }], subscriptions: [] });
});

test('code lifecycle can issue validated host commands for another snapshot entity', async () => {
  const body = createCodeScriptSource(`function onUpdate(api) {
    const transform = api.getEntityComponent('crate', 'engine.transform2d');
    api.setEntityComponent('crate', 'engine.transform2d', { ...transform, x: transform.x + 2 });
  }`);
  const run = new ScriptFunction('input', body);
  assert.deepEqual(await run({
    entityId: 'player', phase: 'update', deltaTime: 0,
    components: {}, entityComponents: { crate: { 'engine.transform2d': { x: 1 } } },
    availableComponentTypeIds: ['engine.transform2d'],
  }), {
    state: null,
    componentCommands: [{ operation: 'set', entityId: 'crate', componentTypeId: 'engine.transform2d', data: { x: 3 } }],
    emittedEvents: [], subscriptions: [],
  });
});
