import assert from 'node:assert/strict';
import test from 'node:test';
import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import { defineScriptDefinition } from '@ecs/scripting';
import { EDITOR_PLUGIN_API_VERSION, EditorPluginManager, type EditorPlugin, type EditorPluginHost } from '../src/plugin-api.ts';

function setup() {
  const registrations = new Set<string>();
  const host: EditorPluginHost = {
    registerComponent: (_plugin, schema) => add(`component:${schema.typeId}`),
    registerScript: (_plugin, definition) => add(`script:${definition.scriptId}`),
    registerImporter: (_plugin, importer) => add(`importer:${importer.id}`),
    registerEditorPanel: (_plugin, panel) => add(`panel:${panel.id}`),
  };
  function add(key: string) {
    if (registrations.has(key)) throw new Error(`duplicate ${key}`);
    registrations.add(key);
    return () => { registrations.delete(key); };
  }
  return { manager: new EditorPluginManager(host), registrations, host };
}
function sample(setupFn: EditorPlugin['setup'] = () => {}): EditorPlugin {
  return { manifest: { id: 'test.plugin', name: 'Test Plugin', version: '1.2.3', apiVersion: EDITOR_PLUGIN_API_VERSION }, setup: setupFn };
}

test('plugin API registers and removes each contribution as one lifecycle', () => {
  const { manager, registrations } = setup();
  manager.load(sample(api => {
    api.registerComponent(defineComponentSchema({ typeId: 'test.component', displayName: 'Test', version: 1, component: defineComponent<{ value: string }>('Test'), fields: { value: { type: 'string', label: 'Value', default: '' } } }));
    api.registerScript(defineScriptDefinition({ scriptId: 'test.script', version: 1, properties: {} }));
    api.registerImporter({ id: 'test.importer', label: 'Test', accepts: () => true, import: async () => {} });
    api.registerEditorPanel({ id: 'test.panel', label: 'Test', mount: () => {} });
  }));
  assert.equal(registrations.size, 4);
  assert.equal(manager.list().length, 1);
  manager.unload('test.plugin');
  assert.equal(registrations.size, 0);
  assert.equal(manager.list().length, 0);
});

test('plugin API rejects incompatible and duplicate plugins', () => {
  const { manager } = setup();
  const plugin = sample();
  manager.load(plugin);
  assert.throws(() => manager.load(plugin), /already loaded/);
  manager.unload(plugin.manifest.id);
  assert.throws(() => manager.load({ ...plugin, manifest: { ...plugin.manifest, apiVersion: '2.0.0' } }), /requires API/);
});

test('failed plugin setup rolls back registrations', () => {
  const { manager, registrations } = setup();
  assert.throws(() => manager.load(sample(api => {
    api.registerImporter({ id: 'test.importer', label: 'Test', accepts: () => true, import: async () => {} });
    throw new Error('setup failed');
  })), /setup failed/);
  assert.equal(registrations.size, 0);
  assert.equal(manager.list().length, 0);
});

test('plugin teardown attempts every cleanup even if one contribution throws', () => {
  const calls: string[] = [];
  const base = setup();
  const host: EditorPluginHost = {
    ...base.host,
    registerImporter: () => () => { calls.push('importer'); throw new Error('dispose failed'); },
    registerEditorPanel: () => () => { calls.push('panel'); },
  };
  const manager = new EditorPluginManager(host);
  manager.load(sample(api => {
    api.registerImporter({ id: 'test.importer', label: 'Test', accepts: () => true, import: async () => {} });
    api.registerEditorPanel({ id: 'test.panel', label: 'Test', mount: () => {} });
  }));
  assert.throws(() => manager.unload('test.plugin'), /cleanup errors/);
  assert.deepEqual(calls, ['panel', 'importer']);
  assert.equal(manager.list().length, 0);
});

test('plugin unload can be blocked while contributed components are in use', () => {
  let inUse = true;
  const { manager, host } = setup();
  const guardedHost: EditorPluginHost = { ...host, canUnload: () => inUse ? 'component still used' : undefined };
  const guarded = new EditorPluginManager(guardedHost); guarded.load(sample());
  assert.throws(() => guarded.unload('test.plugin'), /component still used/);
  assert.equal(guarded.list().length, 1);
  inUse = false; guarded.unload('test.plugin');
  assert.equal(guarded.list().length, 0);
});
