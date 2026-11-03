import assert from 'node:assert/strict';
import test from 'node:test';
import { sceneLoadTarget, validateProjectScenes } from '../src/project-scenes.ts';

test('scene IDs survive renaming and scene.load rejects unknown or malformed targets', () => {
  const document = { format: 'ecs-scene', version: 1, sceneId: 'scene:level', entities: [] };
  const scene = { id: 'scene:level', name: 'Renamed level', document };
  const collection = validateProjectScenes({ scenes: [scene], activeSceneId: scene.id, startSceneId: scene.id }, undefined);
  assert.equal(sceneLoadTarget({ sceneId: scene.id }, collection.scenes), scene);
  for (const payload of [null, {}, { sceneId: 'Renamed level' }, { sceneId: 4 }, { sceneId: 'missing' }]) assert.throws(() => sceneLoadTarget(payload, collection.scenes), /valid sceneId/);
  assert.throws(() => validateProjectScenes({ ...collection, scenes: [{ ...scene, id: 'different' }] }, undefined), /document ID/);
});
