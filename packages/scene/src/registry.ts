import type { ComponentType } from '@ecs/core';
import type { ComponentSchema } from './schema.ts';

export class SchemaRegistry {
  private readonly byTypeId = new Map<string, ComponentSchema>();
  private readonly byComponentId = new Map<symbol, ComponentSchema>();

  register<T>(schema: ComponentSchema<T>): void {
    if (this.byTypeId.has(schema.typeId)) throw new Error(`Schema typeId "${schema.typeId}" is already registered.`);
    if (this.byComponentId.has(schema.component.id)) {
      throw new Error(`Component "${schema.component.name}" already has a registered schema.`);
    }
    this.byTypeId.set(schema.typeId, schema);
    this.byComponentId.set(schema.component.id, schema);
  }

  unregister(typeId: string): ComponentSchema | undefined {
    const schema = this.byTypeId.get(typeId);
    if (!schema) return undefined;
    this.byTypeId.delete(typeId);
    this.byComponentId.delete(schema.component.id);
    return schema;
  }

  get(typeId: string): ComponentSchema | undefined {
    return this.byTypeId.get(typeId);
  }

  getForComponent(component: ComponentType): ComponentSchema | undefined {
    return this.byComponentId.get(component.id);
  }

  all(): readonly ComponentSchema[] {
    return [...this.byTypeId.values()];
  }
}
