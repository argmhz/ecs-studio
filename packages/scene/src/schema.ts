import type { ComponentType } from '@ecs/core';

export interface AssetReference {
  readonly assetId: string;
}

interface FieldBase {
  readonly label: string;
}

export type FieldDefinition =
  | (FieldBase & { readonly type: 'number'; readonly default: number; readonly min?: number; readonly max?: number })
  | (FieldBase & { readonly type: 'string'; readonly default: string })
  | (FieldBase & { readonly type: 'color'; readonly default: string })
  | (FieldBase & { readonly type: 'enum'; readonly default: string; readonly options: readonly string[] })
  | (FieldBase & { readonly type: 'boolean'; readonly default: boolean })
  | (FieldBase & { readonly type: 'asset'; readonly default: AssetReference | null; readonly kind?: 'image' | 'audio' })
  | (FieldBase & { readonly type: 'sprite-region'; readonly default: { readonly atlasId: string; readonly regionId: string } | null })
  | (FieldBase & { readonly type: 'entity'; readonly default: string | null; readonly relation?: 'parent' });

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ComponentMigration = (data: unknown) => unknown;

export interface ComponentSchema<T = unknown> {
  readonly typeId: string;
  readonly displayName: string;
  readonly version: number;
  readonly component: ComponentType<T>;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly migrations: ReadonlyMap<number, ComponentMigration>;
  validate(value: unknown): readonly ValidationIssue[];
}

export interface DefineComponentSchemaOptions<T> {
  readonly typeId: string;
  readonly displayName: string;
  readonly version: number;
  readonly component: ComponentType<T>;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  /** Each key is the source version; its migration returns the next version's data. */
  readonly migrations?: Readonly<Record<number, ComponentMigration>>;
  readonly validate?: (value: T) => readonly ValidationIssue[];
}

export function defineComponentSchema<T>(options: DefineComponentSchemaOptions<T>): ComponentSchema<T> {
  if (!options.typeId.trim()) throw new TypeError('Component schema typeId must not be empty.');
  if (!options.displayName.trim()) throw new TypeError(`Component schema "${options.typeId}" needs a displayName.`);
  if (!Number.isSafeInteger(options.version) || options.version < 1) {
    throw new RangeError(`Component schema "${options.typeId}" version must be a positive integer.`);
  }
  for (const [name, field] of Object.entries(options.fields)) {
    if (!name.trim() || !field.label.trim()) throw new TypeError(`Component schema "${options.typeId}" has an unnamed field.`);
    if (field.type === 'color' && !isHexColor(field.default)) throw new TypeError(`Default for color field "${options.typeId}.${name}" must be a #RRGGBB color.`);
    if (field.type === 'enum' && (!Array.isArray(field.options) || !field.options.length || field.options.some(option => typeof option !== 'string' || !option.trim()) || new Set(field.options).size !== field.options.length || !field.options.includes(field.default))) {
      throw new TypeError(`Enum field "${options.typeId}.${name}" needs unique non-empty options that include its default.`);
    }
    if (field.type === 'number') {
      if (!Number.isFinite(field.default)) throw new TypeError(`Default for "${options.typeId}.${name}" must be finite.`);
      if (field.min !== undefined && !Number.isFinite(field.min)) throw new TypeError(`Minimum for "${options.typeId}.${name}" must be finite.`);
      if (field.max !== undefined && !Number.isFinite(field.max)) throw new TypeError(`Maximum for "${options.typeId}.${name}" must be finite.`);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        throw new RangeError(`Minimum exceeds maximum for "${options.typeId}.${name}".`);
      }
    }
  }

  const fields = Object.freeze(Object.fromEntries(Object.entries(options.fields).map(([name, field]) => [
    name,
    Object.freeze(field.type === 'enum' ? { ...field, options: Object.freeze([...field.options]) } : { ...field }),
  ]))) as Readonly<Record<string, FieldDefinition>>;

  const migrations = new Map<number, ComponentMigration>();
  for (const [sourceVersion, migrate] of Object.entries(options.migrations ?? {})) {
    const version = Number(sourceVersion);
    if (!Number.isSafeInteger(version) || version < 1 || version >= options.version) {
      throw new RangeError(`Invalid migration source version "${sourceVersion}" for "${options.typeId}".`);
    }
    migrations.set(version, migrate);
  }

  const validate = (value: unknown): readonly ValidationIssue[] => {
    const issues = validateFields(options.typeId, fields, value);
    if (issues.length > 0 || !options.validate) return issues;
    return options.validate(value as T);
  };

  return Object.freeze({
    typeId: options.typeId,
    displayName: options.displayName,
    version: options.version,
    component: options.component,
    fields,
    migrations,
    validate,
  });
}

function validateFields(
  typeId: string,
  fields: Readonly<Record<string, FieldDefinition>>,
  value: unknown,
): ValidationIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path: typeId, message: 'Expected an object containing component fields.' }];
  }
  const data = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(data)) {
    if (!(key in fields)) issues.push({ path: `${typeId}.${key}`, message: 'Unknown field.' });
  }
  for (const [key, field] of Object.entries(fields)) {
    const fieldPath = `${typeId}.${key}`;
    if (!(key in data)) {
      issues.push({ path: fieldPath, message: 'Required field is missing.' });
      continue;
    }
    const fieldValue = data[key];
    switch (field.type) {
      case 'number':
        if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
          issues.push({ path: fieldPath, message: 'Expected a finite number.' });
        } else if (field.min !== undefined && fieldValue < field.min) {
          issues.push({ path: fieldPath, message: `Must be at least ${field.min}.` });
        } else if (field.max !== undefined && fieldValue > field.max) {
          issues.push({ path: fieldPath, message: `Must be at most ${field.max}.` });
        }
        break;
      case 'string':
        if (typeof fieldValue !== 'string') issues.push({ path: fieldPath, message: 'Expected a string.' });
        break;
      case 'color':
        if (typeof fieldValue !== 'string' || !isHexColor(fieldValue)) issues.push({ path: fieldPath, message: 'Expected a #RRGGBB color.' });
        break;
      case 'enum':
        if (typeof fieldValue !== 'string' || !field.options.includes(fieldValue)) issues.push({ path: fieldPath, message: `Expected one of: ${field.options.join(', ')}.` });
        break;
      case 'boolean':
        if (typeof fieldValue !== 'boolean') issues.push({ path: fieldPath, message: 'Expected a boolean.' });
        break;
      case 'asset':
        if (fieldValue !== null && (
          typeof fieldValue !== 'object'
          || Array.isArray(fieldValue)
          || typeof (fieldValue as { assetId?: unknown }).assetId !== 'string'
          || !(fieldValue as { assetId: string }).assetId.trim()
          || Object.keys(fieldValue).some(property => property !== 'assetId')
        )) {
          issues.push({ path: fieldPath, message: 'Expected null or an asset reference with a non-empty assetId.' });
        }
        break;
      case 'sprite-region':
        if (fieldValue !== null && (typeof fieldValue !== 'object' || Array.isArray(fieldValue) || typeof (fieldValue as { atlasId?: unknown }).atlasId !== 'string' || !(fieldValue as { atlasId: string }).atlasId || typeof (fieldValue as { regionId?: unknown }).regionId !== 'string' || !(fieldValue as { regionId: string }).regionId || Object.keys(fieldValue).some(property => property !== 'atlasId' && property !== 'regionId'))) issues.push({ path: fieldPath, message: 'Expected null or a sprite atlas region reference.' });
        break;
      case 'entity':
        if (fieldValue !== null && (typeof fieldValue !== 'string' || !fieldValue.trim())) {
          issues.push({ path: fieldPath, message: 'Expected null or a non-empty stable entity ID.' });
        }
        break;
    }
  }
  return issues;
}

function isHexColor(value: string): boolean { return /^#[\da-f]{6}$/i.test(value); }
