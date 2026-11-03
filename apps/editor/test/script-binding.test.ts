import assert from 'node:assert/strict';
import test from 'node:test';
import { World, defineComponent } from '@ecs/core';
import { SchemaRegistry, SceneCodec, defineComponentSchema } from '@ecs/scene';
import { ScriptBinding, scriptBindingSchema } from '../src/script-binding.ts';
import { applyScriptCommandBuffer } from '../src/script-command-buffer.ts';

const Position = defineComponent<{ x: number }>('Position');
const positionSchema = defineComponentSchema({ typeId: 'game.position', displayName: 'Position', version: 1, component: Position, fields: { x: { type: 'number', label: 'X', default: 0 } } });

test('script bindings survive a versioned scene round-trip', () => {
  const schemas = new SchemaRegistry(); schemas.register(scriptBindingSchema);
  const world = new World(); const entity = world.createEntity();
  const entities = new Map([['game:player', entity]]);
  world.addComponent(entity, ScriptBinding, { enabled: true, codePath: 'scripts/player.ts', graphPath: 'scripts/player.graph.json', speed: 8 });
  const codec = new SceneCodec(schemas); const loaded = codec.deserialize(codec.stringify(world, entities, 'scene:main'));
  const restored = loaded.entities.get('game:player')!;
  assert.deepEqual(loaded.world.getComponent(restored, ScriptBinding), { enabled: true, codePath: 'scripts/player.ts', graphPath: 'scripts/player.graph.json', speed: 8 });
});

test('legacy script bindings migrate away from entryFunction', () => {
  const schemas = new SchemaRegistry(); schemas.register(scriptBindingSchema);
  const codec = new SceneCodec(schemas);
  const loaded = codec.deserialize({
    format: 'ecs-scene', version: 1, sceneId: 'scene:legacy-script',
    entities: [{ id: 'game:player', components: [{ typeId: 'engine.scriptBinding', version: 1, data: { enabled: true, codePath: 'scripts/player.ts', entryFunction: 'update', graphPath: 'scripts/player.graph.json', speed: 8 } }] }],
  });
  const entity = loaded.entities.get('game:player')!;
  assert.deepEqual(loaded.world.getComponent(entity, ScriptBinding), { enabled: true, codePath: 'scripts/player.ts', graphPath: 'scripts/player.graph.json', speed: 8 });
});

test('cross-entity command buffers validate the whole tick before applying writes', () => {
  const schemas = new SchemaRegistry(); schemas.register(positionSchema);
  const world = new World(); const controller = world.createEntity(); const paddle = world.createEntity();
  const entities = new Map([['game:controller', controller], ['game:paddle', paddle]]);
  world.addComponent(controller, Position, { x: 0 }); world.addComponent(paddle, Position, { x: 1 });
  const outputs = [{ componentCommands: [
    { operation: 'set' as const, entityId: 'game:paddle', componentTypeId: 'game.position', data: { x: 4 } },
    { operation: 'set' as const, entityId: 'game:controller', componentTypeId: 'game.position', data: { x: 'invalid' } },
  ] }];
  assert.throws(() => applyScriptCommandBuffer(outputs, world, entities, schemas, new Set()), /Invalid game.position/);
  assert.equal(world.getComponent(paddle, Position)?.x, 1);
  applyScriptCommandBuffer([{ componentCommands: [outputs[0]!.componentCommands[0]!] }], world, entities, schemas, new Set());
  assert.equal(world.getComponent(paddle, Position)?.x, 4);
});
