import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '@ecs/core';
import {
  Parent,
  registerBuiltInSceneSchemas,
  SceneCodec,
  SceneHierarchy,
  SceneHierarchyError,
  SchemaRegistry,
  Transform2D,
} from '../src/index.ts';

function createHierarchy() {
  const world = new World();
  const root = world.createEntity();
  const child = world.createEntity();
  const leaf = world.createEntity();
  const entities = new Map([['root', root], ['child', child], ['leaf', leaf]]);
  return { world, entities, hierarchy: new SceneHierarchy(world, entities), root, child, leaf };
}

test('hierarchy supports parent, children, detach, and preserves local transforms on reparent', () => {
  const { hierarchy, world, root, child, entities } = createHierarchy();
  const local = { x: 3, y: 4, rotation: 0.25, scaleX: 2, scaleY: 1 };
  hierarchy.setLocalTransform('child', local);
  hierarchy.setParent('child', 'root');

  assert.equal(hierarchy.getParent('child'), 'root');
  assert.deepEqual(hierarchy.getChildren('root'), ['child']);
  hierarchy.setParent('child', null);
  assert.equal(hierarchy.getParent('child'), null);
  assert.deepEqual(hierarchy.getChildren('root'), []);
  assert.deepEqual(world.getComponent(child, Transform2D), local);
  assert.equal(world.hasComponent(child, Parent), false);
  assert.equal(entities.get('root'), root);
});

test('reparenting rejects self-parenting, unknown IDs, and cycles without changing the graph', () => {
  const { hierarchy } = createHierarchy();
  hierarchy.setParent('child', 'root');
  hierarchy.setParent('leaf', 'child');

  assert.throws(() => hierarchy.setParent('root', 'leaf'), /hierarchy cycle/);
  assert.throws(() => hierarchy.setParent('child', 'child'), /own parent/);
  assert.throws(() => hierarchy.setParent('child', 'missing'), /Unknown scene entity/);
  assert.equal(hierarchy.getParent('root'), null);
  assert.equal(hierarchy.getParent('child'), 'root');
  assert.equal(hierarchy.getParent('leaf'), 'child');
});

test('global transforms compose position, rotation, and non-uniform scale as affine matrices', () => {
  const { hierarchy } = createHierarchy();
  hierarchy.setLocalTransform('root', { x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 });
  hierarchy.setLocalTransform('child', { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 });
  hierarchy.setParent('child', 'root');

  const global = hierarchy.getGlobalTransform('child');
  assert.ok(Math.abs(global.a) < 1e-10);
  assert.ok(Math.abs(global.b - 2) < 1e-10);
  assert.ok(Math.abs(global.c + 3) < 1e-10);
  assert.ok(Math.abs(global.d) < 1e-10);
  assert.ok(Math.abs(global.tx - 4) < 1e-10);
  assert.ok(Math.abs(global.ty - 22) < 1e-10);
});

test('invalid local transforms are rejected without replacing the existing value', () => {
  const { hierarchy, world, child } = createHierarchy();
  const valid = { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 };
  hierarchy.setLocalTransform('child', valid);

  assert.throws(
    () => hierarchy.setLocalTransform('child', { ...valid, rotation: Number.NaN }),
    /finite number/,
  );
  assert.deepEqual(world.getComponent(child, Transform2D), valid);
});

test('built-in hierarchy schemas round-trip stable parent references', () => {
  const { hierarchy, world, entities } = createHierarchy();
  hierarchy.setLocalTransform('root', { x: 8, y: -2, rotation: 0.5, scaleX: 1, scaleY: 1 });
  hierarchy.setLocalTransform('child', { x: 2, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  hierarchy.setParent('child', 'root');
  const registry = new SchemaRegistry();
  registerBuiltInSceneSchemas(registry);
  const codec = new SceneCodec(registry);

  const loaded = codec.deserialize(codec.stringify(world, entities, 'scene:hierarchy'));
  const loadedHierarchy = new SceneHierarchy(loaded.world, loaded.entities);
  assert.equal(loadedHierarchy.getParent('child'), 'root');
  assert.deepEqual(loadedHierarchy.getChildren('root'), ['child']);
  assert.deepEqual(loadedHierarchy.getLocalTransform('child'), { x: 2, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
});

test('loading rejects dangling parent references and parent cycles', () => {
  const registry = new SchemaRegistry();
  registerBuiltInSceneSchemas(registry);
  const codec = new SceneCodec(registry);
  const document = (parentId: string) => ({
    format: 'ecs-scene', version: 1, sceneId: 'scene:hierarchy',
    entities: [
      { id: 'a', components: [{ typeId: 'engine.parent', version: 1, data: { parentId } }] },
      { id: 'b', components: [{ typeId: 'engine.parent', version: 1, data: { parentId: 'a' } }] },
    ],
  });

  assert.throws(() => codec.deserialize(document('missing')), /does not exist in this scene/);
  assert.throws(() => codec.deserialize(document('b')), /contains a cycle/);
});

test('hierarchy rejects dead or cross-world runtime entity mappings', () => {
  const world = new World();
  const foreignWorld = new World();
  const foreign = foreignWorld.createEntity();
  assert.throws(() => new SceneHierarchy(world, new Map([['foreign', foreign]])), SceneHierarchyError);
});
