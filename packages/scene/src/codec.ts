import { World } from '@ecs/core';
import type { Entity } from '@ecs/core';
import type { ComponentMigration, ComponentSchema, ValidationIssue } from './schema.ts';
import { SchemaRegistry } from './registry.ts';

export const SCENE_FORMAT = 'ecs-scene';
export const SCENE_FORMAT_VERSION = 1;

export interface SerializedComponent {
  readonly typeId: string;
  readonly version: number;
  readonly data: unknown;
}

export interface SerializedSceneEntity {
  readonly id: string;
  readonly components: readonly SerializedComponent[];
}

export interface SceneDocument {
  readonly format: typeof SCENE_FORMAT;
  readonly version: number;
  readonly sceneId: string;
  readonly entities: readonly SerializedSceneEntity[];
}

export interface LoadedScene {
  readonly world: World;
  /** Stable scene entity ID to runtime handle. */
  readonly entities: ReadonlyMap<string, Entity>;
}

export type SceneMigration = (document: unknown) => unknown;

export class SceneValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'SceneValidationError';
    this.path = path;
  }
}

interface PreparedComponent {
  readonly schema: ComponentSchema;
  readonly data: unknown;
}

interface PreparedEntity {
  readonly id: string;
  readonly components: readonly PreparedComponent[];
}

/** Versioned JSON scene codec using stable IDs and registered component schemas. */
export class SceneCodec {
  private readonly sceneMigrations = new Map<number, SceneMigration>();
  private readonly schemas: SchemaRegistry;

  constructor(schemas: SchemaRegistry) {
    this.schemas = schemas;
  }

  /** Register a migration from one scene format version to the next. */
  registerSceneMigration(fromVersion: number, migration: SceneMigration): void {
    if (!Number.isSafeInteger(fromVersion) || fromVersion < 1 || fromVersion >= SCENE_FORMAT_VERSION) {
      throw new RangeError(`Invalid scene migration source version ${fromVersion}.`);
    }
    if (this.sceneMigrations.has(fromVersion)) {
      throw new Error(`Scene migration from version ${fromVersion} is already registered.`);
    }
    this.sceneMigrations.set(fromVersion, migration);
  }

  serialize(world: World, entities: ReadonlyMap<string, Entity>, sceneId: string): SceneDocument {
    assertStableId(sceneId, 'sceneId');
    const identityToId = new Map<string, string>();
    for (const [id, entity] of entities) {
      assertStableId(id, `entities["${id}"].id`);
      if (!world.isAlive(entity)) throw new SceneValidationError(`entities["${id}"]`, 'Runtime entity is stale or belongs to another world.');
      const key = entityKey(entity);
      const existingId = identityToId.get(key);
      if (existingId) throw new SceneValidationError(`entities["${id}"]`, `Runtime entity is already mapped to stable ID "${existingId}".`);
      identityToId.set(key, id);
    }

    for (const entity of world.query()) {
      if (!identityToId.has(entityKey(entity))) {
        throw new SceneValidationError('entities', `Runtime entity ${entity.index}:${entity.generation} has no stable scene ID.`);
      }
    }

    const serializedEntities: SerializedSceneEntity[] = [];
    for (const [id, entity] of entities) {
      const components: SerializedComponent[] = [];
      for (const schema of this.schemas.all()) {
        if (!world.hasComponent(entity, schema.component)) continue;
        const data = world.getComponent(entity, schema.component);
        const issues = schema.validate(data);
        if (issues.length) throw validationError(`entities["${id}"].components.${schema.typeId}`, issues);
        components.push({ typeId: schema.typeId, version: schema.version, data: cloneJson(data, `entities["${id}"].components.${schema.typeId}`) });
      }
      serializedEntities.push({ id, components });
    }
    validateRelationships(serializedEntities, this.schemas);

    return {
      format: SCENE_FORMAT,
      version: SCENE_FORMAT_VERSION,
      sceneId,
      entities: serializedEntities,
    };
  }

  stringify(world: World, entities: ReadonlyMap<string, Entity>, sceneId: string): string {
    return JSON.stringify(this.serialize(world, entities, sceneId), null, 2);
  }

  deserialize(input: string | unknown): LoadedScene {
    let raw: unknown;
    if (typeof input === 'string') {
      try {
        raw = JSON.parse(input) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Invalid JSON.';
        throw new SceneValidationError('$', `Could not parse scene JSON: ${reason}`);
      }
    } else {
      raw = input;
    }

    const migrated = this.migrateScene(raw);
    const prepared = this.validateAndPrepare(migrated);
    const world = new World();
    const entities = new Map<string, Entity>();
    for (const record of prepared) {
      const entity = world.createEntity();
      entities.set(record.id, entity);
      for (const component of record.components) {
        world.addComponent(entity, component.schema.component, component.data);
      }
    }
    return { world, entities };
  }

  private migrateScene(input: unknown): Record<string, unknown> {
    if (!isRecord(input)) throw new SceneValidationError('$', 'Expected a scene document object.');
    if (input.format !== SCENE_FORMAT) {
      throw new SceneValidationError('format', `Expected "${SCENE_FORMAT}", received ${describe(input.format)}.`);
    }
    let document: unknown = input;
    let version = input.version;
    if (!Number.isSafeInteger(version) || typeof version !== 'number' || version < 1) {
      throw new SceneValidationError('version', 'Expected a positive integer scene format version.');
    }
    if (version > SCENE_FORMAT_VERSION) {
      throw new SceneValidationError('version', `Scene format ${version} is newer than supported version ${SCENE_FORMAT_VERSION}.`);
    }
    while (version < SCENE_FORMAT_VERSION) {
      const migration = this.sceneMigrations.get(version);
      if (!migration) throw new SceneValidationError('version', `No migration is registered from scene format ${version} to ${version + 1}.`);
      try {
        document = migration(document);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Migration failed.';
        throw new SceneValidationError('version', `Migration from version ${version} failed: ${reason}`);
      }
      if (!isRecord(document) || document.format !== SCENE_FORMAT || document.version !== version + 1) {
        throw new SceneValidationError('version', `Migration from version ${version} must return an ${SCENE_FORMAT} document at version ${version + 1}.`);
      }
      version++;
    }
    return document as Record<string, unknown>;
  }

  private validateAndPrepare(document: Record<string, unknown>): PreparedEntity[] {
    assertKeys(document, ['format', 'version', 'sceneId', 'entities'], '$');
    assertStableId(document.sceneId, 'sceneId');
    if (!Array.isArray(document.entities)) throw new SceneValidationError('entities', 'Expected an array of scene entities.');
    const seenEntities = new Set<string>();
    const prepared: PreparedEntity[] = [];

    for (let entityIndex = 0; entityIndex < document.entities.length; entityIndex++) {
      const path = `entities[${entityIndex}]`;
      const entity = document.entities[entityIndex];
      if (!isRecord(entity)) throw new SceneValidationError(path, 'Expected an entity object.');
      assertKeys(entity, ['id', 'components'], path);
      assertStableId(entity.id, `${path}.id`);
      if (seenEntities.has(entity.id as string)) throw new SceneValidationError(`${path}.id`, `Duplicate stable entity ID "${entity.id as string}".`);
      seenEntities.add(entity.id as string);
      if (!Array.isArray(entity.components)) throw new SceneValidationError(`${path}.components`, 'Expected an array of components.');

      const seenComponents = new Set<string>();
      const components: PreparedComponent[] = [];
      for (let componentIndex = 0; componentIndex < entity.components.length; componentIndex++) {
        const componentPath = `${path}.components[${componentIndex}]`;
        const component = entity.components[componentIndex];
        if (!isRecord(component)) throw new SceneValidationError(componentPath, 'Expected a component object.');
        assertKeys(component, ['typeId', 'version', 'data'], componentPath);
        if (typeof component.typeId !== 'string' || !component.typeId.trim()) {
          throw new SceneValidationError(`${componentPath}.typeId`, 'Expected a non-empty stable component typeId.');
        }
        if (seenComponents.has(component.typeId)) {
          throw new SceneValidationError(`${componentPath}.typeId`, `Duplicate component "${component.typeId}" on one entity.`);
        }
        seenComponents.add(component.typeId);
        const schema = this.schemas.get(component.typeId);
        if (!schema) throw new SceneValidationError(`${componentPath}.typeId`, `Unknown component type "${component.typeId}".`);
        if (!Number.isSafeInteger(component.version) || typeof component.version !== 'number' || component.version < 1) {
          throw new SceneValidationError(`${componentPath}.version`, 'Expected a positive integer component schema version.');
        }
        const data = migrateComponent(schema, component.version, component.data, componentPath);
        const issues = schema.validate(data);
        if (issues.length) throw validationError(`${componentPath}.data`, issues);
        components.push({ schema, data: cloneJson(data, `${componentPath}.data`) });
      }
      prepared.push({ id: entity.id as string, components });
    }
    validateRelationships(prepared.map(entity => ({
      id: entity.id,
      components: entity.components.map(component => ({
        typeId: component.schema.typeId,
        version: component.schema.version,
        data: component.data,
      })),
    })), this.schemas);
    return prepared;
  }
}

function validateRelationships(entities: readonly SerializedSceneEntity[], schemas: SchemaRegistry): void {
  const ids = new Set(entities.map(entity => entity.id));
  const parents = new Map<string, string>();
  for (const entity of entities) {
    for (const component of entity.components) {
      const schema = schemas.get(component.typeId)!;
      const data = component.data as Record<string, unknown>;
      for (const [fieldName, field] of Object.entries(schema.fields)) {
        if (field.type !== 'entity') continue;
        const parentId = data[fieldName];
        if (parentId === null) continue;
        if (typeof parentId !== 'string' || !ids.has(parentId)) {
          throw new SceneValidationError(
            `entities["${entity.id}"].components.${component.typeId}.${fieldName}`,
            `Entity reference "${String(parentId)}" does not exist in this scene.`,
          );
        }
        if (field.relation === 'parent') {
          if (parents.has(entity.id)) {
            throw new SceneValidationError(`entities["${entity.id}"].components`, 'An entity can have only one parent relationship.');
          }
          parents.set(entity.id, parentId);
        }
      }
    }
  }

  for (const start of parents.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && parents.has(current)) {
      if (visited.has(current)) {
        throw new SceneValidationError(`entities["${start}"].components`, 'Parent relationship contains a cycle.');
      }
      visited.add(current);
      current = parents.get(current);
    }
  }
}

function migrateComponent(schema: ComponentSchema, sourceVersion: number, sourceData: unknown, path: string): unknown {
  if (sourceVersion > schema.version) {
    throw new SceneValidationError(`${path}.version`, `Component "${schema.typeId}" version ${sourceVersion} is newer than supported version ${schema.version}.`);
  }
  let version = sourceVersion;
  let data = sourceData;
  while (version < schema.version) {
    const migration: ComponentMigration | undefined = schema.migrations.get(version);
    if (!migration) throw new SceneValidationError(`${path}.version`, `No migration for "${schema.typeId}" from version ${version} to ${version + 1}.`);
    try {
      data = migration(data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Migration failed.';
      throw new SceneValidationError(`${path}.data`, `Migration for "${schema.typeId}" from version ${version} failed: ${reason}`);
    }
    version++;
  }
  return data;
}

function validationError(path: string, issues: readonly ValidationIssue[]): SceneValidationError {
  const first = issues[0]!;
  const suffix = issues.length > 1 ? ` (${issues.length - 1} more issue${issues.length === 2 ? '' : 's'})` : '';
  return new SceneValidationError(`${path}.${first.path}`, `${first.message}${suffix}`);
}

function assertStableId(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new SceneValidationError(path, 'Expected a non-empty stable ID string.');
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new SceneValidationError(`${path}.${key}`, 'Unknown field.');
  }
}

function entityKey(entity: Entity): string {
  return `${entity.index}:${entity.generation}`;
}

function cloneJson(value: unknown, path: string): unknown {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Value is not JSON serializable.');
    return JSON.parse(json) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Value is not JSON serializable.';
    throw new SceneValidationError(path, `Component data must be JSON serializable: ${reason}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}
