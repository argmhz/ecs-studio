import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineComponent,
  defineResource,
  EntityError,
  World,
} from '../src/index.ts';
import type { ComponentType } from '../src/index.ts';

interface Position { x: number; y: number }
interface Velocity { x: number; y: number }
const Position = defineComponent<Position>('Position');
const Velocity = defineComponent<Velocity>('Velocity');
const Enabled = defineComponent<true>('Enabled');

function makePosition(world: World, x: number, y = 0) {
  const entity = world.createEntity();
  world.addComponent(entity, Position, { x, y });
  return entity;
}

test('entity generation changes when an index is recycled', () => {
  const world = new World();
  const oldEntity = makePosition(world, 1);
  assert.equal(world.destroyEntity(oldEntity), true);
  const nextEntity = makePosition(world, 2);

  assert.equal(nextEntity.index, oldEntity.index);
  assert.notEqual(nextEntity.generation, oldEntity.generation);
  assert.equal(world.isAlive(oldEntity), false);
  assert.equal(world.hasComponent(oldEntity, Position), false);
  assert.equal(world.getComponent(nextEntity, Position)?.x, 2);
  assert.throws(() => world.addComponent(oldEntity, Position, { x: 3, y: 0 }), EntityError);
});

test('entity handles cannot cross worlds', () => {
  const first = new World();
  const second = new World();
  const entity = makePosition(first, 4);
  const other = makePosition(second, 9);

  assert.equal(entity.index, other.index);
  assert.equal(first.isAlive(other), false);
  assert.equal(second.hasComponent(entity, Position), false);
  assert.throws(() => second.getComponent(entity, Position), /different world/);
  assert.equal(second.destroyEntity(entity), false);
});

test('component replacement, query intersection and removal stay consistent', () => {
  const world = new World();
  const first = makePosition(world, 1);
  const second = makePosition(world, 2);
  world.addComponent(first, Velocity, { x: 3, y: 0 });
  world.addComponent(second, Velocity, { x: 4, y: 0 });
  world.setComponent(first, Position, { x: 10, y: 20 });

  assert.equal(world.getComponent(first, Position)?.x, 10);
  assert.deepEqual(world.query(Position, Velocity), [first, second]);
  assert.equal(world.query(Position, Enabled).length, 0);
  assert.equal(world.removeComponent(first, Velocity), true);
  assert.equal(world.removeComponent(first, Velocity), false);
  assert.deepEqual(world.query(Position, Velocity), [second]);
  assert.equal(world.query().length, 2);
});

test('query results are snapshots, and destroyed entities are not returned later', () => {
  const world = new World();
  const first = makePosition(world, 1);
  makePosition(world, 2);
  const snapshot = world.query(Position);

  world.destroyEntity(first);
  assert.equal(snapshot.length, 2);
  assert.equal(world.query(Position).length, 1);
  assert.equal(world.query(Position).some(entity =>
    entity.index === first.index && entity.generation === first.generation,
  ), false);
});

test('an unknown component query is empty and does not create storage', () => {
  const world = new World();
  makePosition(world, 1);
  assert.deepEqual(world.query(Enabled), []);
  assert.equal(world.query(Position).length, 1);
});

test('resources distinguish a stored undefined or falsey value from absence', () => {
  const world = new World();
  const Gravity = defineResource<number>('Gravity');
  assert.equal(world.hasResource(Gravity), false);
  world.setResource(Gravity, 0);
  assert.equal(world.hasResource(Gravity), true);
  assert.equal(world.getResource(Gravity), 0);
  assert.equal(world.removeResource(Gravity), true);
  assert.equal(world.removeResource(Gravity), false);
  assert.throws(() => world.getResource(Gravity), /is not set/);
});

test('component identity comes from its token, not its display name', () => {
  const world = new World();
  const One = defineComponent<{ value: number }>('SharedName');
  const Two = defineComponent<{ value: number }>('SharedName');
  const entity = world.createEntity();
  world.addComponent(entity, One, { value: 1 });
  world.addComponent(entity, Two, { value: 2 });

  assert.equal(world.getComponent(entity, One)?.value, 1);
  assert.equal(world.getComponent(entity, Two)?.value, 2);
});

test('command buffer defers creation and applies create/add/remove/destroy in order', () => {
  const world = new World();
  const commands = world.createCommandBuffer();
  const pending = commands.create();
  commands.addComponent(pending, Position, { x: 5, y: 8 });
  commands.addComponent(pending, Velocity, { x: 2, y: 0 });
  commands.removeComponent(pending, Velocity);

  assert.throws(() => commands.resolve(pending), /not been created/);
  assert.equal(commands.flush(), 4);
  const entity = commands.resolve(pending);
  assert.equal(world.getComponent(entity, Position)?.x, 5);
  assert.equal(world.hasComponent(entity, Velocity), false);
  assert.equal(world.query(Position).length, 1);

  commands.destroyEntity(entity);
  assert.equal(commands.flush(), 1);
  assert.equal(world.isAlive(entity), false);
  assert.throws(() => commands.resolve(pending), /stale/);
});

test('command buffers reject pending handles from another buffer', () => {
  const world = new World();
  const owner = world.createCommandBuffer();
  const other = world.createCommandBuffer();
  const pending = owner.create();
  assert.throws(() => other.addComponent(pending, Position, { x: 0, y: 0 }), /different command buffer/);
});

test('clear discards queued commands while preserving already committed world state', () => {
  const world = new World();
  const committed = world.createEntity();
  const commands = world.createCommandBuffer();
  const pending = commands.create();
  commands.destroyEntity(committed);
  commands.clear();

  assert.equal(commands.pendingCommandCount, 0);
  assert.equal(world.isAlive(committed), true);
  assert.throws(() => commands.resolve(pending), /not been created/);
});

test('failed playback keeps the failed and later commands for inspection or clearing', () => {
  const world = new World();
  const entity = makePosition(world, 1);
  const commands = world.createCommandBuffer();
  commands.addComponent(entity, Velocity, { x: 1, y: 0 });
  world.destroyEntity(entity);

  assert.throws(() => commands.flush(), /stale/);
  assert.equal(commands.pendingCommandCount, 1);
  commands.clear();
  assert.equal(commands.pendingCommandCount, 0);
});

test('sparse-set swap deletion keeps moved values addressable', () => {
  const world = new World();
  const first = makePosition(world, 1);
  const second = makePosition(world, 2);
  const third = makePosition(world, 3);

  world.removeComponent(first, Position);
  assert.equal(world.getComponent(second, Position)?.x, 2);
  assert.equal(world.getComponent(third, Position)?.x, 3);
  assert.deepEqual(world.query(Position), [third, second]);
});

test('component types remain usable through the public generic API', () => {
  function read<T>(world: World, entity: ReturnType<World['createEntity']>, type: ComponentType<T>): T | undefined {
    return world.getComponent(entity, type);
  }
  const world = new World();
  const entity = world.createEntity();
  world.addComponent(entity, Enabled, true);
  assert.equal(read(world, entity, Enabled), true);
});
