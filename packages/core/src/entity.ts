/** Runtime entity handle. It is scoped to the World that created it. */
const entityWorld: unique symbol = Symbol('ecs.entity-world');

export interface Entity {
  readonly index: number;
  readonly generation: number;
  readonly [entityWorld]: symbol;
}

/** A deferred handle returned by CommandBuffer.create(). */
const pendingBuffer: unique symbol = Symbol('ecs.pending-buffer');
export interface PendingEntity {
  readonly [pendingBuffer]: symbol;
}

export type EntityReference = Entity | PendingEntity;

export function makeEntity(index: number, generation: number, world: symbol): Entity {
  return Object.freeze({ index, generation, [entityWorld]: world });
}

export function isFromWorld(entity: Entity, world: symbol): boolean {
  return entity[entityWorld] === world;
}

export function makePendingEntity(buffer: symbol): PendingEntity {
  return Object.freeze({ [pendingBuffer]: buffer });
}

export function isPendingFromBuffer(entity: PendingEntity, buffer: symbol): boolean {
  return entity[pendingBuffer] === buffer;
}

export function entityEquals(left: Entity, right: Entity): boolean {
  return left.index === right.index
    && left.generation === right.generation
    && left[entityWorld] === right[entityWorld];
}
