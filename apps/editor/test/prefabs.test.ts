import assert from 'node:assert/strict';
import test from 'node:test';
import { componentOverrides, makePrefab, mergePrefabComponents, validatePrefabs } from '../src/prefabs.ts';

test('prefab documents have stable IDs, a named root and detached scene data', () => {
  const scene = { entities: [{ id: 'root' }] };
  const prefab = makePrefab('prefab:one', 'Crate', scene, 'root');
  scene.entities[0]!.id = 'changed';
  assert.equal(prefab.name, 'Crate');
  assert.equal((prefab.scene as typeof scene).entities[0]!.id, 'root');
  assert.throws(() => validatePrefabs([prefab, prefab]), /Duplicate prefab ID/);
  assert.throws(() => makePrefab('prefab:bad', 'Bad', { entities: [] }, 'missing'), /root entity/);
});

test('prefab updates replace inherited components and keep changed components as local overrides', () => {
  const oldBase = [{ typeId: 'transform', version: 1, data: { x: 0, y: 0 } }, { typeId: 'sprite', version: 1, data: { tint: 'white' } }];
  const newBase = [{ typeId: 'transform', version: 1, data: { x: 2, y: 0 } }, { typeId: 'sprite', version: 1, data: { tint: 'blue' } }];
  const current = [{ typeId: 'transform', version: 1, data: { x: 5, y: 0 } }, oldBase[1]!];
  const result = mergePrefabComponents(newBase, oldBase, current);
  assert.deepEqual(result.components, [newBase[1], current[0]]);
  assert.deepEqual(result.overrides, ['transform']);
});

test('added and removed local components remain explicit during source updates', () => {
  const baseline = [{ typeId: 'a', version: 1, data: 1 }, { typeId: 'b', version: 1, data: 2 }];
  const current = [{ typeId: 'a', version: 1, data: 1 }, { typeId: 'local', version: 1, data: 3 }];
  const merged = mergePrefabComponents([{ typeId: 'a', version: 1, data: 4 }, { typeId: 'b', version: 1, data: 5 }], baseline, current);
  assert.deepEqual(merged.components, [{ typeId: 'a', version: 1, data: 4 }, { typeId: 'local', version: 1, data: 3 }]);
  assert.deepEqual(componentOverrides(baseline, current), ['b', 'local']);
});
