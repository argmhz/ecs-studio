import type { ComponentType } from './component.ts';
import type { Entity, EntityReference, PendingEntity } from './entity.ts';
import { isPendingFromBuffer, makePendingEntity } from './entity.ts';
import { EntityError, type World } from './world.ts';

type Command = () => void;

/** Defers structural world changes until flush(), preserving command order. */
export class CommandBuffer {
  private readonly identity = Symbol('ecs.command-buffer');
  private readonly pendingEntities = new Map<PendingEntity, Entity>();
  private commands: Command[] = [];
  private flushing = false;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  create(): PendingEntity {
    this.assertQueueable();
    const pending = makePendingEntity(this.identity);
    this.commands.push(() => {
      this.pendingEntities.set(pending, this.world.createEntity());
    });
    return pending;
  }

  addComponent<T>(entity: EntityReference, type: ComponentType<T>, value: T): this {
    this.assertReference(entity);
    this.commands.push(() => this.world.addComponent(this.resolve(entity), type, value));
    return this;
  }

  removeComponent<T>(entity: EntityReference, type: ComponentType<T>): this {
    this.assertReference(entity);
    this.commands.push(() => this.world.removeComponent(this.resolve(entity), type));
    return this;
  }

  destroyEntity(entity: EntityReference): this {
    this.assertReference(entity);
    this.commands.push(() => this.world.destroyEntity(this.resolve(entity)));
    return this;
  }

  /** Applies queued commands in order. On failure, the failed and later commands remain queued. */
  flush(): number {
    this.assertQueueable();
    this.flushing = true;
    let cursor = 0;
    try {
      for (; cursor < this.commands.length; cursor += 1) this.commands[cursor]();
      return cursor;
    } finally {
      // Keep the failing command and its successors queued if playback throws.
      this.commands.splice(0, cursor);
      this.flushing = false;
    }
  }

  /** Resolves a pending entity after its create command has been played. */
  resolve(entity: EntityReference): Entity {
    if (!this.isPending(entity)) {
      this.world.assertAlive(entity);
      return entity;
    }
    const resolved = this.pendingEntities.get(entity);
    if (!resolved) throw new EntityError('Deferred entity has not been created yet.');
    this.world.assertAlive(resolved);
    return resolved;
  }

  /** Discards pending commands and handles; already-applied world changes remain. */
  clear(): void {
    this.assertQueueable();
    this.commands = [];
    this.pendingEntities.clear();
  }

  get pendingCommandCount(): number {
    return this.commands.length;
  }

  private isPending(entity: EntityReference): entity is PendingEntity {
    return isPendingFromBuffer(entity as PendingEntity, this.identity);
  }

  private assertReference(entity: EntityReference): void {
    this.assertQueueable();
    if (this.isPending(entity)) return;
    if ('index' in entity) this.world.assertAlive(entity);
    else throw new EntityError('Deferred entity belongs to a different command buffer.');
  }

  private assertQueueable(): void {
    if (this.flushing) throw new Error('Cannot queue commands while the buffer is flushing.');
  }
}
