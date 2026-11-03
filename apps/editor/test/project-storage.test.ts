import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { AssetRecord, SpriteAtlas } from '@ecs/assets';
import { PROJECT_VERSION, decodeProjectArchive, encodeProjectArchive } from '../src/project-storage.ts';
import { makePrefab } from '../src/prefabs.ts';

const record: AssetRecord = { assetId: 'asset:sprite', path: 'Textures/sprite.png', name: 'sprite.png', kind: 'image', mimeType: 'image/png', size: 3, revision: 1 };

test('project archive round-trips scene, scripts and asset bytes with stable IDs', () => {
  const scene = { format: 'ecs-scene', version: 1, sceneId: 'scene:main', entities: [] };
  const bytes = Uint8Array.from([0, 127, 255]);
  const scripts = { 'scripts/player.ts': 'export function update() {}' };
  const properties = { speed: 7.5 };
  const graphs = { 'scripts/player.graph.json': { version: 1, nodes: [], links: [] } };
  const prefabs = [makePrefab('prefab:crate', 'Crate', { entities: [{ id: 'entity:root' }] }, 'entity:root')];
  const atlases: SpriteAtlas[] = [{ id: 'atlas:actors', name: 'Actors', assetId: record.assetId, width: 32, height: 16, regions: [{ id: 'region:hero', name: 'Hero', x: 0, y: 0, width: 16, height: 16, pivotX: .5, pivotY: .5 }] }];
  const inputActions = [{ name: 'dash', bindings: [{ type: 'key' as const, code: 'ShiftLeft', value: 1 }, { type: 'gamepadButton' as const, button: 2, value: 1 }] }];
  const archive = decodeProjectArchive(encodeProjectArchive('Demo', scene, [{ ...record, data: bytes }], scripts, properties, graphs, prefabs, atlases, inputActions));
  assert.equal(archive.projectName, 'Demo');
  assert.deepEqual(archive.scene, scene);
  assert.deepEqual(archive.scripts, scripts);
  assert.deepEqual(archive.scriptProperties, properties);
  assert.deepEqual(archive.visualGraphs, graphs);
  assert.deepEqual(archive.prefabs, prefabs);
  assert.deepEqual(archive.atlases, atlases);
  assert.deepEqual(archive.inputActions, inputActions);
  assert.equal(archive.assets[0]?.assetId, record.assetId);
  assert.deepEqual(Uint8Array.from(atob(archive.assets[0]!.data), character => character.charCodeAt(0)), bytes);
});

test('project archive rejects unsupported versions, duplicate IDs and incorrect asset sizes', () => {
  const base = { format: 'ecs-project', version: 1, projectName: 'Demo', scene: {}, assets: [{ ...record, data: 'AQID' }] };
  assert.throws(() => decodeProjectArchive(JSON.stringify({ ...base, version: 99 })), /Unsupported project format version/);
  assert.throws(() => decodeProjectArchive(JSON.stringify({ ...base, assets: [...base.assets, { ...base.assets[0], path: 'Textures/other.png' }] })), /duplicate/);
  assert.throws(() => decodeProjectArchive(JSON.stringify({ ...base, assets: [{ ...base.assets[0], size: 4 }] })), /invalid size/);
});

test('version 1 project archives migrate without script files', () => {
  const legacy = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 1, projectName: 'Legacy', scene: {}, assets: [] }));
  assert.equal(legacy.version, PROJECT_VERSION);
  assert.deepEqual(legacy.scripts, {});
  assert.deepEqual(legacy.scriptProperties, {});
  assert.deepEqual(legacy.visualGraphs, {});
});

test('version 2 project archives migrate while retaining code files', () => {
  const archive = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 2, projectName: 'Code', scene: {}, assets: [], scripts: { 'scripts/player.ts': 'function update() {}' } }));
  assert.equal(archive.version, PROJECT_VERSION);
  assert.equal(archive.scripts['scripts/player.ts'], 'function update() {}');
  assert.deepEqual(archive.scriptProperties, {});
  assert.deepEqual(archive.visualGraphs, {});
});

test('version 3 projects migrate with an empty visual graph collection', () => {
  const archive = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 3, projectName: 'Code', scene: {}, assets: [], scripts: {}, scriptProperties: { speed: 5 } }));
  assert.equal(archive.version, PROJECT_VERSION);
  assert.deepEqual(archive.visualGraphs, {});
});

test('version 4 projects migrate with an empty prefab library', () => {
  const archive = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 4, projectName: 'Prefabs', scene: {}, assets: [], scripts: {}, scriptProperties: {}, visualGraphs: {} }));
  assert.equal(archive.version, PROJECT_VERSION);
  assert.deepEqual(archive.prefabs, []);
});

test('version 5 project archives migrate with an empty atlas collection', () => {
  const archive = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 5, projectName: 'Legacy', scene: {}, assets: [], scripts: {}, scriptProperties: {}, visualGraphs: {}, prefabs: [] }));
  assert.equal(archive.version, PROJECT_VERSION);
  assert.deepEqual(archive.atlases, []);
});

test('version 6 archives migrate with default input actions', () => {
  const archive = decodeProjectArchive(JSON.stringify({ format: 'ecs-project', version: 6, projectName: 'Legacy', scene: {}, assets: [], scripts: {}, scriptProperties: {}, visualGraphs: {}, prefabs: [], atlases: [] }));
  assert.equal(archive.version, PROJECT_VERSION);
  assert.ok(archive.inputActions.some(action => action.name === 'moveX'));
});

test('archive rejects malformed input bindings', () => {
  const invalid = { format: 'ecs-project', version: 7, projectName: 'Bad', scene: {}, assets: [], scripts: {}, scriptProperties: {}, visualGraphs: {}, prefabs: [], atlases: [], inputActions: [{ name: 'jump', bindings: [] }] };
  assert.throws(() => decodeProjectArchive(JSON.stringify(invalid)), /invalid input actions/);
});

test('project archive import rejects missing referenced assets with their stable ID', () => {
  const scene = { format: 'ecs-scene', version: 1, sceneId: 'scene:main', entities: [{ id: 'player', components: [{ typeId: 'engine.spriteRenderer2d', version: 2, data: { asset: { assetId: 'asset:deleted' } } }] }] };
  const archive = { format: 'ecs-project', version: 6, projectName: 'Broken reference', scene, scripts: {}, scriptProperties: {}, visualGraphs: {}, prefabs: [], atlases: [], assets: [] };
  assert.throws(() => decodeProjectArchive(JSON.stringify(archive)), /missing asset ID "asset:deleted"/);
});

test('generated Showcase archive contains the complete editor example set', async () => {
  const text = await readFile(new URL('../public/showcase.ecsproj', import.meta.url), 'utf8');
  const archive = decodeProjectArchive(text);
  assert.deepEqual(Object.keys(archive.scripts).sort(), ['scripts/crate.ts', 'scripts/player.ts']);
  assert.deepEqual(Object.keys(archive.visualGraphs).sort(), ['scripts/gem.graph.json', 'scripts/player.graph.json']);
  assert.equal(archive.prefabs[0]?.name, 'Bouncy Crate');
  assert.equal((archive.prefabs[0]?.scene as { format?: string }).format, 'ecs-scene');
  assert.equal(archive.atlases[0]?.regions.length, 4);
  assert.deepEqual(archive.assets.map(asset => asset.path).sort(), ['Audio/Chime.wav', 'Textures/Parallax-Hills.png', 'Textures/Parallax-Mountains.png', 'Textures/Parallax-Sky.png', 'Textures/Showcase-Spritesheet.png']);
  const sceneJson = JSON.stringify(archive.scene);
  assert.match(sceneJson, /engine\.tilemap2d/);
  assert.match(sceneJson, /engine\.spriteAnimation2d/);
  assert.match(archive.scripts['scripts/player.ts']!, /function onStart/);
  assert.match(archive.scripts['scripts/crate.ts']!, /function onUpdate/);
  assert.match(JSON.stringify(archive.visualGraphs['scripts/gem.graph.json']), /compare\.greater/);
});

test('Game View persists and older projects migrate to Free aspect', () => {
  const scene = { format: 'ecs-scene', version: 1, sceneId: 'scene:main', entities: [] };
  const gameView = { mode: 'Fit' as const, width: 1920, height: 1080 };
  const archive = decodeProjectArchive(encodeProjectArchive('Viewport', scene, [], {}, {}, {}, [], [], [], gameView));
  assert.deepEqual(archive.gameView, gameView);
  const legacy = decodeProjectArchive(JSON.stringify({ ...archive, version: 7, gameView: undefined }));
  assert.equal(legacy.gameView.mode, 'Free');
  assert.throws(() => decodeProjectArchive(JSON.stringify({ ...archive, gameView: { ...gameView, width: 0 } })), /Game View/);
});

test('multiple scenes roundtrip, migrate legacy scenes and validate references in inactive scenes', () => {
  const a = { format: 'ecs-scene', version: 1, sceneId: 'scene:a', entities: [] };
  const b = { ...a, sceneId: 'scene:b' };
  const sceneCollection = { scenes: [{ id: a.sceneId, name: 'Menu', document: a }, { id: b.sceneId, name: 'Level', document: b }], activeSceneId: b.sceneId, startSceneId: a.sceneId };
  const archive = decodeProjectArchive(encodeProjectArchive('Scenes', b, [], {}, {}, {}, [], [], [], undefined, sceneCollection));
  assert.deepEqual(archive.sceneCollection, sceneCollection); assert.deepEqual(archive.scene, b);
  const legacy = decodeProjectArchive(JSON.stringify({ ...archive, version: 8, sceneCollection: undefined }));
  assert.equal(legacy.sceneCollection.startSceneId, b.sceneId); assert.equal(legacy.sceneCollection.scenes.length, 1);
  for (const invalid of [ { ...sceneCollection, startSceneId: 'missing' }, { ...sceneCollection, scenes: [] }, { ...sceneCollection, scenes: [sceneCollection.scenes[0], sceneCollection.scenes[0]] } ]) {
    assert.throws(() => decodeProjectArchive(JSON.stringify({ ...archive, sceneCollection: invalid })));
  }
  const missing = structuredClone(archive);
  (missing.sceneCollection.scenes[0]!.document as { entities: unknown[] }).entities.push({ id: 'hidden', components: [{ typeId: 'engine.spriteRenderer2d', data: { asset: { assetId: 'missing' } } }] });
  assert.throws(() => decodeProjectArchive(JSON.stringify(missing)), /missing asset ID/);
});
