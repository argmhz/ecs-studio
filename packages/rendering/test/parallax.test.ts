import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '@ecs/core';
import { SceneCodec, SceneHierarchy, SchemaRegistry, Transform2D, registerBuiltInSceneSchemas } from '@ecs/scene';
import { Parallax2D, parallax2DSchema, parallaxTransform, parallaxTransforms, collectSpriteRenderItems, SpriteRenderer2D, spriteRenderer2DSchema } from '../src/index.ts';

const data = { factorX: .25, factorY: .5, repeatX: false, repeatY: false, originX: 2, originY: 3 };
const transform = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 };
const view = { x: 0, y: 0, halfWidth: 5, halfHeight: 3 };

test('parallax factors and origins alter only rendered positions, independently by axis', () => {
  const original = { ...transform };
  assert.deepEqual(parallaxTransform(transform, data, { x: 6, y: 7 }), { ...transform, tx: 13, ty: 22 });
  assert.deepEqual(parallaxTransform(transform, { ...data, factorX: 1, factorY: 1 }, { x: 100, y: -100 }), transform);
  const fixed = { ...data, factorX: 0, factorY: 0 };
  const a = parallaxTransform(transform, fixed, { x: 6, y: 7 }), b = parallaxTransform(transform, fixed, { x: 16, y: -13 });
  assert.equal(a.tx - 6, b.tx - 16); assert.equal(a.ty - 7, b.ty + 13);
  assert.equal(parallaxTransform(transform, { ...data, factorX: 1.5 }, { x: 6, y: 7 }).tx, 8);
  assert.deepEqual(transform, original);
});

test('repetition covers the viewport at large positive/negative camera coordinates', () => {
  for (const x of [-10000, 0, 10000]) {
    const copies = parallaxTransforms({ ...transform, tx: 0, ty: 0 }, 2, 6, { ...data, factorX: .5, repeatX: true }, { ...view, x });
    const centers = copies.map(t => t.tx).sort((a, b) => a - b);
    assert.ok(centers[0]! - 1 <= x - 5); assert.ok(centers.at(-1)! + 1 >= x + 5);
    for (let i = 1; i < centers.length; i++) assert.equal(centers[i]! - centers[i - 1]!, 2);
    assert.ok(copies.length <= 7);
  }
});

test('repeat lattice follows rotated, scaled and reflected transforms without changing source', () => {
  const rotated = { a: 0, b: 2, c: -3, d: 0, tx: 0, ty: 0 };
  const settings = { ...data, factorX: 1, factorY: 1, repeatX: true };
  const copies = parallaxTransforms(rotated, 2, 2, settings, view);
  assert.deepEqual(copies.map(t => [t.tx, t.ty]), [[0, -4], [0, 0], [0, 4]]);
  const reflected = parallaxTransforms({ ...rotated, b: -2 }, 2, 2, settings, view);
  assert.deepEqual(reflected.map(t => [t.tx, t.ty]), [[0, 4], [0, 0], [0, -4]]);
  assert.equal(rotated.ty, 0);
  assert.equal(parallaxTransforms({ ...rotated, b: 0 }, 2, 2, settings, view).length, 1);
});

test('pathological tiny repeating sprites have a bounded number of render copies', () => {
  for (const repeatY of [false, true]) {
    const copies = parallaxTransforms(transform, 1e-5, 1e-5, { ...data, repeatX: true, repeatY }, view);
    assert.ok(copies.length <= 4096);
  }
});

test('repeat counters terminate beyond safe-integer world indices', () => {
  const copies = parallaxTransforms(transform, 2, 2, { ...data, repeatX: true, repeatY: true }, { ...view, x: 1e20, y: -1e20 });
  assert.ok(copies.length > 0 && copies.length <= 4096);
  assert.ok(copies.every(t => Number.isFinite(t.tx) && Number.isFinite(t.ty)));
});

test('Parallax schema roundtrips and collection preserves world/Transform data', () => {
  const schemas = new SchemaRegistry(); registerBuiltInSceneSchemas(schemas); schemas.register(spriteRenderer2DSchema); schemas.register(parallax2DSchema);
  assert.equal(parallax2DSchema.validate({ ...data, factorX: NaN }).length, 1);
  assert.equal(parallax2DSchema.validate({ ...data, repeatX: 'true' }).length, 1);
  const world = new World(), entity = world.createEntity(), entities = new Map([['background', entity]]);
  world.addComponent(entity, Transform2D, { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 });
  world.addComponent(entity, SpriteRenderer2D, { asset: { assetId: 'sheet' }, region: null, width: 2, height: 3, order: -10, tint: '#ffffff' });
  world.addComponent(entity, Parallax2D, data);
  const codec = new SceneCodec(schemas), document = codec.serialize(world, entities, 'scene:parallax');
  const loaded = codec.deserialize(document);
  assert.deepEqual(loaded.world.getComponent(loaded.entities.get('background')!, Parallax2D), data);
  const [item] = collectSpriteRenderItems(world, entities, new SceneHierarchy(world, entities));
  assert.deepEqual(item!.parallax, data);
  parallaxTransforms(item!.transform, item!.width, item!.height, item!.parallax, view);
  assert.equal(world.getComponent(entity, Transform2D)!.x, 10);
  world.removeComponent(entity, Parallax2D);
  assert.equal(collectSpriteRenderItems(world, entities, new SceneHierarchy(world, entities))[0]!.parallax, undefined);
});

test('editor navigation uses a fixed gameplay camera for parallax without moving the composition', () => {
  const reference = { x: 6, y: 7 };
  const expected = parallaxTransform(transform, data, reference);
  for (const [x, y, size] of [[0, 0, 5], [100, -20, 50], [-100, 100, 2]]) {
    assert.deepEqual(parallaxTransforms(transform, 2, 3, data, { x: x!, y: y!, halfWidth: size!, halfHeight: size!, parallaxCamera: reference }), [expected]);
  }
  assert.notDeepEqual(parallaxTransforms(transform, 2, 3, data, { ...view, x: 100 })[0], expected);
});
