import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptApi, defineScriptDefinition, ScriptApiError, validateScriptProperties } from '../src/api.ts';

const definition = defineScriptDefinition({
  scriptId: 'game.mover', version: 1,
  properties: { speed: { type: 'number', label: 'Speed', default: 4, min: 0 }, enabled: { type: 'boolean', label: 'Enabled', default: true } },
});

test('shared script properties validate schema values and apply defaults', () => {
  assert.deepEqual(validateScriptProperties(definition, { speed: 8 }), { values: { speed: 8, enabled: true }, issues: [] });
  assert.equal(validateScriptProperties(definition, { speed: -1, extra: true }).issues.length, 2);
  assert.throws(() => defineScriptDefinition({ ...definition, properties: { speed: { type: 'number', label: 'Speed', default: -1, min: 0 } } }), /Default/);
});

test('code and node invocations use the same component, state and event contract', () => {
  const original = { x: 1 };
  const invoke = (source: 'code' | 'nodes') => {
    const api = createScriptApi({ entityId: 'entity-1', phase: 'update', deltaTime: 1 / 60, state: { ticks: 0 }, properties: { speed: 8 }, components: { 'game.position': original }, availableComponentTypeIds: ['game.position', 'game.velocity'], subscriptions: ['game.hit'] });
    assert.equal(api.getComponent('game.position') && (api.getComponent('game.position') as { x: number }).x, 1);
    api.state = { ticks: source === 'code' ? 1 : 2 };
    api.setComponent('game.position', { x: 3 });
    api.addComponent('game.velocity', { x: 8 });
    api.subscribe('game.damage');
    api.unsubscribe('game.hit');
    api.emit('game.moved', { x: 3 });
    return api.finish();
  };
  const code = invoke('code');
  const nodes = invoke('nodes');
  assert.equal(original.x, 1);
  assert.deepEqual(code.componentCommands.map(({ operation }) => operation), ['set', 'add']);
  assert.deepEqual(nodes.subscriptions, ['game.damage']);
  assert.deepEqual(code.emittedEvents, [{ type: 'game.moved', payload: { x: 3 } }]);
});

test('API rejects unknown components, invalid events and use after cleanup', () => {
  const api = createScriptApi({ entityId: 'e1', phase: 'destroy', deltaTime: 0, availableComponentTypeIds: ['game.position'], subscriptions: ['game.ready'] });
  assert.throws(() => api.addComponent('missing', {}), ScriptApiError);
  assert.throws(() => api.emit('bad event'), ScriptApiError);
  assert.deepEqual(api.finish().subscriptions, []);
  assert.throws(() => api.getComponent('game.position'), /finished/);
});

test('input snapshots are shared with scripts as immutable action and pointer data', () => {
  const input = { actions: { jump: { value: 1, pressed: true, justPressed: true, justReleased: false } }, pointer: { x: 0.5, y: -0.25, inside: true, primary: true, secondary: false }, connectedGamepads: [0] };
  const api = createScriptApi({ entityId: 'e1', phase: 'update', deltaTime: 0, availableComponentTypeIds: [], input });
  assert.deepEqual(api.input, input);
  assert.throws(() => { (api.input.actions.jump as { value: number }).value = 0; }, TypeError);
});

test('explicit entity component access uses stable IDs and emits owner-addressed commands', () => {
  const api = createScriptApi({
    entityId: 'game:controller', phase: 'update', deltaTime: 0,
    components: { 'game.state': { score: 0 } },
    entityComponents: { 'game:paddle': { 'game.position': { x: 1, y: 0 } } },
    availableComponentTypeIds: ['game.state', 'game.position'],
  });
  assert.deepEqual(api.getEntityComponent('game:paddle', 'game.position'), { x: 1, y: 0 });
  api.setEntityComponent('game:paddle', 'game.position', { x: 2, y: 0 });
  assert.deepEqual(api.finish().componentCommands, [{ operation: 'set', entityId: 'game:paddle', componentTypeId: 'game.position', data: { x: 2, y: 0 } }]);
  assert.throws(() => createScriptApi({ entityId: 'e1', phase: 'update', deltaTime: 0, entityComponents: {}, availableComponentTypeIds: ['game.position'] }).getEntityComponent('missing', 'game.position'), /not available/);
});
