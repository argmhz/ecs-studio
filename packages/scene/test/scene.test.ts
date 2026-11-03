import assert from 'node:assert/strict';
import test from 'node:test';
import { defineComponent, World } from '@ecs/core';
import {
  defineComponentSchema,
  SceneCodec,
  SceneValidationError,
  SchemaRegistry,
} from '../src/index.ts';

interface SpriteData {
  image: { assetId: string } | null;
  layer: number;
  visible: boolean;
}

function setup() {
  const Sprite = defineComponent<SpriteData>('Sprite');
  const schema = defineComponentSchema({
    typeId: 'engine.sprite',
    displayName: 'Sprite Renderer',
    version: 1,
    component: Sprite,
    fields: {
      image: { type: 'asset', label: 'Image', default: null },
      layer: { type: 'number', label: 'Layer', default: 0, min: -10, max: 10 },
      visible: { type: 'boolean', label: 'Visible', default: true },
    },
  });
  const registry = new SchemaRegistry();
  registry.register(schema);
  return { Sprite, schema, registry, codec: new SceneCodec(registry) };
}

test('scene round-trip preserves stable IDs and schema-validated component data', () => {
  const { Sprite, codec } = setup();
  const world = new World();
  const player = world.createEntity();
  const light = world.createEntity();
  world.addComponent(player, Sprite, { image: { assetId: 'asset:hero' }, layer: 2, visible: true });
  world.addComponent(light, Sprite, { image: null, layer: -1, visible: false });
  const ids = new Map([['entity:player', player], ['entity:light', light]]);

  const text = codec.stringify(world, ids, 'scene:main');
  const loaded = codec.deserialize(text);

  assert.equal(loaded.entities.size, 2);
  assert.deepEqual(
    loaded.world.getComponent(loaded.entities.get('entity:player')!, Sprite),
    { image: { assetId: 'asset:hero' }, layer: 2, visible: true },
  );
  assert.deepEqual(
    loaded.world.getComponent(loaded.entities.get('entity:light')!, Sprite),
    { image: null, layer: -1, visible: false },
  );
  assert.equal(codec.serialize(loaded.world, loaded.entities, 'scene:main').sceneId, 'scene:main');
});

test('schema validation rejects invalid values with a field path', () => {
  const { schema } = setup();
  assert.deepEqual(schema.validate({ image: null, layer: 11, visible: 'yes' }), [
    { path: 'engine.sprite.layer', message: 'Must be at most 10.' },
    { path: 'engine.sprite.visible', message: 'Expected a boolean.' },
  ]);
});

test('color and enum fields validate their specialized values', () => {
  const component = defineComponent<{ tint: string; bodyType: string }>('TypedFields');
  const schema = defineComponentSchema({
    typeId: 'engine.typedFields', displayName: 'Typed Fields', version: 1, component,
    fields: {
      tint: { type: 'color', label: 'Tint', default: '#ffffff' },
      bodyType: { type: 'enum', label: 'Body Type', default: 'Dynamic', options: ['Dynamic', 'Fixed'] },
    },
  });
  assert.deepEqual(schema.validate({ tint: '#123456', bodyType: 'Fixed' }), []);
  assert.deepEqual(schema.validate({ tint: 'purple', bodyType: 'Kinematic' }), [
    { path: 'engine.typedFields.tint', message: 'Expected a #RRGGBB color.' },
    { path: 'engine.typedFields.bodyType', message: 'Expected one of: Dynamic, Fixed.' },
  ]);
  assert.equal(Object.isFrozen(schema.fields.bodyType?.type === 'enum' ? schema.fields.bodyType.options : undefined), true);
});

test('serialization rejects runtime entities without stable scene IDs', () => {
  const { codec } = setup();
  const world = new World();
  world.createEntity();

  assert.throws(
    () => codec.serialize(world, new Map(), 'scene:main'),
    (error: unknown) => error instanceof SceneValidationError && error.message.includes('no stable scene ID'),
  );
});

test('deserialization explains unknown components and invalid component data', () => {
  const { codec } = setup();
  const base = {
    format: 'ecs-scene', version: 1, sceneId: 'scene:main',
    entities: [{ id: 'entity:one', components: [] }],
  };
  assert.throws(
    () => codec.deserialize({ ...base, entities: [{ id: 'entity:one', components: [{ typeId: 'plugin.missing', version: 1, data: {} }] }] }),
    /Unknown component type "plugin.missing"/,
  );
  assert.throws(
    () => codec.deserialize({ ...base, entities: [{ id: 'entity:one', components: [{ typeId: 'engine.sprite', version: 1, data: { image: null, layer: 99, visible: true } }] }] }),
    /Must be at most 10/,
  );
});

test('component migrations upgrade data before validation', () => {
  interface VersionedData { x: number; speed: number }
  const Movement = defineComponent<VersionedData>('Movement');
  const schema = defineComponentSchema({
    typeId: 'game.movement', displayName: 'Movement', version: 2, component: Movement,
    fields: {
      x: { type: 'number', label: 'X', default: 0 },
      speed: { type: 'number', label: 'Speed', default: 1 },
    },
    migrations: { 1: data => ({ ...(data as { x: number }), speed: 3 }) },
  });
  const registry = new SchemaRegistry();
  registry.register(schema);
  const codec = new SceneCodec(registry);

  const loaded = codec.deserialize({
    format: 'ecs-scene', version: 1, sceneId: 'scene:migration',
    entities: [{ id: 'entity:mover', components: [{ typeId: 'game.movement', version: 1, data: { x: 4 } }] }],
  });

  assert.deepEqual(loaded.world.getComponent(loaded.entities.get('entity:mover')!, Movement), { x: 4, speed: 3 });
});

test('malformed JSON, duplicate IDs, and unsupported versions get actionable errors', () => {
  const { codec } = setup();
  assert.throws(() => codec.deserialize('{'), /Could not parse scene JSON/);
  assert.throws(() => codec.deserialize({
    format: 'ecs-scene', version: 1, sceneId: 'scene:bad',
    entities: [{ id: 'same', components: [] }, { id: 'same', components: [] }],
  }), /Duplicate stable entity ID/);
  assert.throws(() => codec.deserialize({ format: 'ecs-scene', version: 999, sceneId: 'scene:future', entities: [] }), /newer than supported/);
});
