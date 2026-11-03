import type { Entity, World } from '@ecs/core';
import type { SchemaRegistry } from '@ecs/scene';
import type { ScriptApiOutput, ScriptComponentCommand } from './api.ts';

/** Validate a whole script tick before applying any of its schema-addressed writes. */
export function applyScriptCommandBuffer(
  outputs: readonly Pick<ScriptApiOutput, 'componentCommands'>[],
  world: World,
  entities: ReadonlyMap<string, Entity>,
  schemas: SchemaRegistry,
  requiredComponentTypeIds: ReadonlySet<string>,
): void {
  const shadow = new Map([...entities].map(([id, entity]) => [id, new Set(schemas.all().filter(schema => world.hasComponent(entity, schema.component)).map(schema => schema.typeId))]));
  const validated: { command: ScriptComponentCommand; schema: NonNullable<ReturnType<SchemaRegistry['get']>> }[] = [];
  for (const output of outputs) for (const command of output.componentCommands) {
    const present = shadow.get(command.entityId);
    if (!entities.has(command.entityId) || !present) throw new Error(`Script command targeted unknown entity "${command.entityId}".`);
    const schema = schemas.get(command.componentTypeId); if (!schema) throw new Error(`Unknown component schema "${command.componentTypeId}".`);
    if (command.operation === 'remove') {
      if (requiredComponentTypeIds.has(schema.typeId)) throw new Error('Scene objects must keep their Name and Transform 2D components.');
      if (!present.has(schema.typeId)) continue;
      present.delete(schema.typeId); validated.push({ command, schema }); continue;
    }
    const issues = schema.validate(command.data); if (issues.length) throw new Error(`Invalid ${command.componentTypeId}: ${issues.map(issue => issue.message).join(' ')}`);
    if (command.operation === 'set') {
      if (!present.has(schema.typeId)) throw new Error(`Cannot set missing ${command.componentTypeId} on "${command.entityId}".`);
    } else {
      if (present.has(schema.typeId)) throw new Error(`${command.componentTypeId} already exists on "${command.entityId}".`);
      present.add(schema.typeId);
    }
    validated.push({ command, schema });
  }
  for (const { command, schema } of validated) {
    const entity = entities.get(command.entityId)!;
    if (command.operation === 'remove') world.removeComponent(entity, schema.component);
    else if (command.operation === 'set') world.setComponent(entity, schema.component, command.data);
    else world.addComponent(entity, schema.component, command.data);
  }
}
