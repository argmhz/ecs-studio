import { defineComponent, World } from '@ecs/core';
import type { Entity } from '@ecs/core';
import { defineComponentSchema } from './schema.ts';
import type { SchemaRegistry } from './registry.ts';

export interface Transform2DData {
  readonly x: number;
  readonly y: number;
  /** Rotation in radians. */
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface ParentData {
  readonly parentId: string | null;
}

/** Local 2D transform in scene space. */
export const Transform2D = defineComponent<Transform2DData>('Transform2D');
/** Stable scene-entity reference for a child relationship. */
export const Parent = defineComponent<ParentData>('Parent');

export const transform2DSchema = defineComponentSchema({
  typeId: 'engine.transform2d',
  displayName: 'Transform 2D',
  version: 1,
  component: Transform2D,
  fields: {
    x: { type: 'number', label: 'X', default: 0 },
    y: { type: 'number', label: 'Y', default: 0 },
    rotation: { type: 'number', label: 'Rotation (radians)', default: 0 },
    scaleX: { type: 'number', label: 'Scale X', default: 1 },
    scaleY: { type: 'number', label: 'Scale Y', default: 1 },
  },
});

export const parentSchema = defineComponentSchema({
  typeId: 'engine.parent',
  displayName: 'Parent',
  version: 1,
  component: Parent,
  fields: {
    parentId: { type: 'entity', label: 'Parent', default: null, relation: 'parent' },
  },
});

export function registerBuiltInSceneSchemas(registry: SchemaRegistry): void {
  registry.register(transform2DSchema);
  registry.register(parentSchema);
}

export interface AffineTransform2D {
  /** Matrix convention: x' = a*x + c*y + tx; y' = b*x + d*y + ty. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export class SceneHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneHierarchyError';
  }
}

/** Hierarchy and transform operations over one World and its stable scene IDs. */
export class SceneHierarchy {
  private readonly entities: ReadonlyMap<string, Entity>;
  private readonly idByEntityKey = new Map<string, string>();

  constructor(world: World, entities: ReadonlyMap<string, Entity>) {
    this.world = world;
    this.entities = entities;
    for (const [id, entity] of entities) {
      if (!id.trim()) throw new SceneHierarchyError('Stable entity IDs must not be empty.');
      if (!world.isAlive(entity)) throw new SceneHierarchyError(`Entity "${id}" is stale or belongs to another world.`);
      const key = entityKey(entity);
      if (this.idByEntityKey.has(key)) throw new SceneHierarchyError(`Runtime entity is mapped more than once ("${id}").`);
      this.idByEntityKey.set(key, id);
    }
    for (const entity of world.query()) {
      if (!this.idByEntityKey.has(entityKey(entity))) {
        throw new SceneHierarchyError(`Entity ${entity.index}:${entity.generation} has no stable scene ID.`);
      }
    }
    this.validateParentLinks();
  }

  private readonly world: World;

  getParent(childId: string): string | null {
    const child = this.requireEntity(childId);
    const parentId = this.world.getComponent(child, Parent)?.parentId ?? null;
    if (parentId !== null) this.requireEntity(parentId);
    return parentId;
  }

  getChildren(parentId: string): readonly string[] {
    this.requireEntity(parentId);
    const children: string[] = [];
    for (const id of this.entities.keys()) {
      if (this.getParent(id) === parentId) children.push(id);
    }
    return children;
  }

  /** Reparent while preserving the child's local transform. Null makes it a root. */
  setParent(childId: string, parentId: string | null): void {
    const child = this.requireEntity(childId);
    if (parentId === childId) throw new SceneHierarchyError('An entity cannot be its own parent.');
    if (parentId !== null) {
      this.requireEntity(parentId);
      let ancestor: string | null = parentId;
      while (ancestor !== null) {
        if (ancestor === childId) throw new SceneHierarchyError('Reparenting would create a hierarchy cycle.');
        ancestor = this.getParent(ancestor);
      }
    }

    if (parentId === null) {
      if (this.world.hasComponent(child, Parent)) this.world.removeComponent(child, Parent);
    } else {
      this.world.setComponent(child, Parent, { parentId });
    }
  }

  getLocalTransform(entityId: string): Transform2DData {
    const entity = this.requireEntity(entityId);
    const transform = this.world.getComponent(entity, Transform2D);
    return transform ? { ...transform } : identityLocalTransform();
  }

  setLocalTransform(entityId: string, transform: Transform2DData): void {
    const entity = this.requireEntity(entityId);
    const issues = transform2DSchema.validate(transform);
    if (issues.length > 0) {
      const issue = issues[0]!;
      throw new SceneHierarchyError(`${issue.path}: ${issue.message}`);
    }
    this.world.setComponent(entity, Transform2D, { ...transform });
  }

  /** Resolve local transforms through every ancestor into one exact affine matrix. */
  getGlobalTransform(entityId: string): AffineTransform2D {
    this.requireEntity(entityId);
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: string | null = entityId;
    while (current !== null) {
      if (visited.has(current)) throw new SceneHierarchyError('Hierarchy contains a cycle.');
      visited.add(current);
      chain.push(current);
      current = this.getParent(current);
    }

    let result = identityAffineTransform();
    for (let index = chain.length - 1; index >= 0; index--) {
      result = composeAffineTransforms(result, toAffineTransform(this.getLocalTransform(chain[index]!)));
    }
    return result;
  }

  private requireEntity(id: string): Entity {
    const entity = this.entities.get(id);
    if (!entity) throw new SceneHierarchyError(`Unknown scene entity "${id}".`);
    if (!this.world.isAlive(entity)) throw new SceneHierarchyError(`Entity "${id}" is stale or has been destroyed.`);
    return entity;
  }

  private validateParentLinks(): void {
    for (const id of this.entities.keys()) {
      let parentId = this.getParent(id);
      const visited = new Set([id]);
      while (parentId !== null) {
        if (visited.has(parentId)) throw new SceneHierarchyError(`Parent relationship for "${id}" contains a cycle.`);
        visited.add(parentId);
        parentId = this.getParent(parentId);
      }
    }
  }
}

export function identityLocalTransform(): Transform2DData {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
}

export function identityAffineTransform(): AffineTransform2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

export function toAffineTransform(transform: Transform2DData): AffineTransform2D {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    a: cosine * transform.scaleX,
    b: sine * transform.scaleX,
    c: -sine * transform.scaleY,
    d: cosine * transform.scaleY,
    tx: transform.x,
    ty: transform.y,
  };
}

export function composeAffineTransforms(parent: AffineTransform2D, local: AffineTransform2D): AffineTransform2D {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function entityKey(entity: Entity): string {
  return `${entity.index}:${entity.generation}`;
}
