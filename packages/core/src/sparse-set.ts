import type { ComponentType } from './component.ts';
import type { Entity } from './entity.ts';
import { entityEquals } from './entity.ts';

/** Packed component storage with O(1) lookup, insertion and swap-remove. */
export class SparseSet<T> {
  readonly component: ComponentType<T>;
  private sparse: number[] = [];
  private denseEntities: Entity[] = [];
  private denseValues: T[] = [];

  constructor(component: ComponentType<T>) {
    this.component = component;
  }

  get size(): number {
    return this.denseEntities.length;
  }

  has(entity: Entity): boolean {
    const packed = this.sparse[entity.index];
    return packed !== undefined && packed > 0 && entityEquals(this.denseEntities[packed - 1], entity);
  }

  get(entity: Entity): T | undefined {
    const packed = this.sparse[entity.index];
    if (packed === undefined || packed === 0) return undefined;
    const denseIndex = packed - 1;
    return entityEquals(this.denseEntities[denseIndex], entity)
      ? this.denseValues[denseIndex]
      : undefined;
  }

  set(entity: Entity, value: T): void {
    const packed = this.sparse[entity.index];
    if (packed !== undefined && packed > 0) {
      const denseIndex = packed - 1;
      const stored = this.denseEntities[denseIndex];
      if (entityEquals(stored, entity)) {
        this.denseValues[denseIndex] = value;
        return;
      }
      // A recycled entity index can replace its stale slot without leaving a duplicate.
      this.removeAt(denseIndex);
    }
    const denseIndex = this.denseEntities.length;
    this.denseEntities.push(entity);
    this.denseValues.push(value);
    this.sparse[entity.index] = denseIndex + 1;
  }

  delete(entity: Entity): boolean {
    const packed = this.sparse[entity.index];
    if (packed === undefined || packed === 0) return false;
    const denseIndex = packed - 1;
    if (!entityEquals(this.denseEntities[denseIndex], entity)) return false;
    this.removeAt(denseIndex);
    return true;
  }

  /** Snapshot for safe iteration while the world changes. */
  entities(): readonly Entity[] {
    return this.denseEntities.slice();
  }

  clear(): void {
    this.sparse = [];
    this.denseEntities = [];
    this.denseValues = [];
  }

  private removeAt(denseIndex: number): void {
    const lastIndex = this.denseEntities.length - 1;
    const removed = this.denseEntities[denseIndex];
    if (denseIndex !== lastIndex) {
      const movedEntity = this.denseEntities[lastIndex];
      this.denseEntities[denseIndex] = movedEntity;
      this.denseValues[denseIndex] = this.denseValues[lastIndex];
      this.sparse[movedEntity.index] = denseIndex + 1;
    }
    this.denseEntities.pop();
    this.denseValues.pop();
    this.sparse[removed.index] = 0;
  }
}
