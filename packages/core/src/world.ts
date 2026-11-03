import type { ComponentType } from './component.ts';
import type { Entity } from './entity.ts';
import { isFromWorld, makeEntity } from './entity.ts';
import { SparseSet } from './sparse-set.ts';
import { CommandBuffer } from './command-buffer.ts';

export interface ResourceType<T = unknown> {
  readonly id: symbol;
  readonly name: string;
  readonly __valueType?: T;
}

export function defineResource<T>(name: string): ResourceType<T> {
  if (!name.trim()) throw new TypeError('Resource name must not be empty.');
  return Object.freeze({ id: Symbol(name), name });
}

/** Identifies an entity operation that failed. */
export class EntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityError';
  }
}

export class World {
  private readonly identity = Symbol('ecs.world');
  private readonly generations: number[] = [];
  private readonly aliveIndices = new Set<number>();
  private readonly freeIndices: number[] = [];
  private readonly components = new Map<symbol, SparseSet<unknown>>();
  private readonly resources = new Map<symbol, unknown>();

  createEntity(): Entity {
    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.generations.length;
      this.generations.push(0);
    }
    this.aliveIndices.add(index);
    return makeEntity(index, this.generations[index], this.identity);
  }

  isAlive(entity: Entity): boolean {
    return isFromWorld(entity, this.identity)
      && this.aliveIndices.has(entity.index)
      && this.generations[entity.index] === entity.generation;
  }

  destroyEntity(entity: Entity): boolean {
    if (!this.isAlive(entity)) return false;
    if (this.generations[entity.index] === Number.MAX_SAFE_INTEGER) {
      throw new EntityError(`Generation exhausted for entity index ${entity.index}.`);
    }
    for (const storage of this.components.values()) storage.delete(entity);
    this.aliveIndices.delete(entity.index);
    this.generations[entity.index] += 1;
    this.freeIndices.push(entity.index);
    return true;
  }

  addComponent<T>(entity: Entity, type: ComponentType<T>, value: T): void {
    this.assertAlive(entity);
    this.storage(type, true)!.set(entity, value);
  }

  setComponent<T>(entity: Entity, type: ComponentType<T>, value: T): void {
    this.addComponent(entity, type, value);
  }

  getComponent<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    this.assertAlive(entity);
    return this.storage(type)?.get(entity) as T | undefined;
  }

  hasComponent<T>(entity: Entity, type: ComponentType<T>): boolean {
    return this.isAlive(entity) && (this.storage(type)?.has(entity) ?? false);
  }

  removeComponent<T>(entity: Entity, type: ComponentType<T>): boolean {
    this.assertAlive(entity);
    return this.storage(type)?.delete(entity) ?? false;
  }

  /** Returns a snapshot of entities having every requested component. */
  query(...types: readonly ComponentType<unknown>[]): readonly Entity[] {
    if (types.length === 0) {
      return Array.from(this.aliveIndices, index => makeEntity(index, this.generations[index], this.identity));
    }
    let smallest: SparseSet<unknown> | undefined;
    for (const type of types) {
      const candidate = this.storage(type);
      if (!candidate) return [];
      if (!smallest || candidate.size < smallest.size) smallest = candidate;
    }
    return smallest!.entities().filter(entity =>
      this.isAlive(entity) && types.every(type => this.storage(type)?.has(entity) ?? false),
    );
  }

  createCommandBuffer(): CommandBuffer {
    return new CommandBuffer(this);
  }

  setResource<T>(type: ResourceType<T>, value: T): void {
    this.resources.set(type.id, value);
  }

  getResource<T>(type: ResourceType<T>): T {
    if (!this.resources.has(type.id)) throw new Error(`Resource "${type.name}" is not set.`);
    return this.resources.get(type.id) as T;
  }

  hasResource<T>(type: ResourceType<T>): boolean {
    return this.resources.has(type.id);
  }

  removeResource<T>(type: ResourceType<T>): boolean {
    return this.resources.delete(type.id);
  }

  /** @internal Used by the command buffer to validate queued references. */
  assertAlive(entity: Entity): void {
    if (!isFromWorld(entity, this.identity)) {
      throw new EntityError('Entity belongs to a different world.');
    }
    if (!this.aliveIndices.has(entity.index) || this.generations[entity.index] !== entity.generation) {
      throw new EntityError(`Entity ${entity.index}:${entity.generation} is stale or has been destroyed.`);
    }
  }

  private storage<T>(type: ComponentType<T>, create = false): SparseSet<unknown> | undefined {
    let storage = this.components.get(type.id);
    if (!storage && create) {
      storage = new SparseSet(type);
      this.components.set(type.id, storage);
    }
    return storage;
  }
}
