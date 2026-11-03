import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '@ecs/core';
import { SceneHierarchy, Transform2D } from '@ecs/scene';
import { Camera2D, camera2DSchema, resolveCamera2D, validateGameView, DEFAULT_GAME_VIEW, fitGameViewport } from '../src/index.ts';

const camera = { enabled: true, priority: 0, visibleHeight: 16, followTarget: null, offsetX: 0, offsetY: 0 };
test('Camera priority, follow targets and offsets resolve without changing scene transforms', () => {
  const world = new World(), a = world.createEntity(), b = world.createEntity(), player = world.createEntity();
  const entities = new Map([['camera:a', a], ['camera:b', b], ['player', player]]);
  for (const entity of [a, b, player]) world.addComponent(entity, Transform2D, { x: 2, y: 3, rotation: 0, scaleX: 1, scaleY: 1 });
  world.addComponent(a, Camera2D, camera); world.addComponent(b, Camera2D, { ...camera, priority: 1, followTarget: 'player', offsetX: 4, offsetY: -1 });
  const hierarchy = new SceneHierarchy(world, entities);
  assert.deepEqual(resolveCamera2D(world, entities, hierarchy), { entityId: 'camera:b', x: 6, y: 2, visibleHeight: 16 });
  world.setComponent(player, Transform2D, { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 });
  assert.equal(resolveCamera2D(world, entities, hierarchy)!.x, 24);
  assert.equal(world.getComponent(b, Transform2D)!.x, 2);
  world.setComponent(b, Camera2D, { ...camera, enabled: false });
  assert.equal(resolveCamera2D(world, entities, hierarchy)!.entityId, 'camera:a');
  world.removeComponent(a, Camera2D); assert.equal(resolveCamera2D(world, entities, hierarchy), undefined);
  assert.ok(camera2DSchema.validate({ ...camera, visibleHeight: 0 }).length);
});
test('fixed Game View fits narrow/wide displays while legacy Free uses the entire panel', () => {
  assert.deepEqual(validateGameView(), DEFAULT_GAME_VIEW);
  const settings = { mode: 'Fit' as const, width: 1280, height: 720 };
  assert.deepEqual(fitGameViewport(320, 240, settings), { left: 0, top: 30, width: 320, height: 180 });
  const wide = fitGameViewport(1000, 200, settings); assert.equal(wide.height, 200); assert.ok(wide.left > 0); assert.ok(wide.width <= 1000);
  assert.deepEqual(fitGameViewport(320, 240, DEFAULT_GAME_VIEW), { left: 0, top: 0, width: 320, height: 240 });
  for (const invalid of [{ ...settings, width: 0 }, { ...settings, height: .5 }, { ...settings, width: 8193 }, { ...settings, mode: 'Stretch' }]) assert.throws(() => validateGameView(invalid));
});
