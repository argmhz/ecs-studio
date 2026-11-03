import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutAnchoredRect } from '../src/layout.ts';
import { uiCanvasSchema, uiButtonSchema } from '../src/components.ts';
import { SceneCodec, SceneHierarchy, SchemaRegistry, Transform2D, registerBuiltInSceneSchemas } from '@ecs/scene';
import { World } from '@ecs/core';

test('anchored layout scales fixed and stretched elements into a fit viewport', () => {
  const fixed = layoutAnchoredRect({ anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 32, offsetMinY: 24, offsetMaxX: 192, offsetMaxY: 72 }, { width: 400, height: 300, referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' });
  assert.deepEqual(fixed, { left: 16, top: 12, width: 80, height: 24 });
  const stretched = layoutAnchoredRect({ anchorMinX: 0, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 1, offsetMinX: 16, offsetMinY: 20, offsetMaxX: -16, offsetMaxY: -20 }, { width: 1000, height: 600, referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' });
  assert.deepEqual(stretched, { left: 116, top: 20, width: 768, height: 560 });
});

test('UI canvas and button schemas validate and round-trip through scenes', () => {
  const registry = new SchemaRegistry(); registerBuiltInSceneSchemas(registry); registry.register(uiCanvasSchema); registry.register(uiButtonSchema);
  const world = new World(); const entity = world.createEntity(); world.addComponent(entity, Transform2D, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  world.addComponent(entity, uiCanvasSchema.component, { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' });
  world.addComponent(entity, uiButtonSchema.component, { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 32, offsetMinY: 32, offsetMaxX: 192, offsetMaxY: 80, text: 'Start', color: '#ffffff', background: '#51458a', fontSize: 18, disabled: false });
  const codec = new SceneCodec(registry); const encoded = codec.serialize(world, new Map([['ui', entity]]), 'scene:ui');
  const restored = codec.deserialize(encoded); const restoredEntity = restored.entities.get('ui')!;
  assert.deepEqual(restored.world.getComponent(restoredEntity, uiButtonSchema.component), world.getComponent(entity, uiButtonSchema.component));
});
