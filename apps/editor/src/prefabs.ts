export const PREFAB_FORMAT = 'ecs-prefab';
export const PREFAB_VERSION = 1;

export interface PrefabDocument {
  readonly format: typeof PREFAB_FORMAT;
  readonly version: typeof PREFAB_VERSION;
  readonly prefabId: string;
  readonly name: string;
  readonly scene: unknown;
  readonly rootEntityId: string;
}

export interface PrefabInstanceLink {
  readonly prefabId: string;
  readonly sourceEntityId: string;
  readonly baselineJson: string;
  readonly overriddenComponentIds: readonly string[];
  readonly broken: boolean;
}

export function makePrefab(prefabId: string, name: string, scene: { entities: readonly { id: string }[] }, rootEntityId: string): PrefabDocument {
  if (!prefabId || !name.trim() || !scene.entities.some(entity => entity.id === rootEntityId)) throw new Error('A prefab needs a name and a root entity in its scene.');
  return { format: PREFAB_FORMAT, version: PREFAB_VERSION, prefabId, name: name.trim(), scene: structuredClone(scene), rootEntityId };
}

export function validatePrefabs(value: unknown): readonly PrefabDocument[] {
  if (!Array.isArray(value)) throw new Error('Project contains an invalid prefab list.');
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Prefab ${index + 1} is invalid.`);
    const prefab = item as Partial<PrefabDocument>;
    if (prefab.format !== PREFAB_FORMAT || prefab.version !== PREFAB_VERSION || typeof prefab.prefabId !== 'string' || !prefab.prefabId || typeof prefab.name !== 'string' || !prefab.name.trim() || typeof prefab.rootEntityId !== 'string' || !prefab.scene || typeof prefab.scene !== 'object') throw new Error(`Prefab ${index + 1} has invalid metadata.`);
    if (ids.has(prefab.prefabId)) throw new Error(`Duplicate prefab ID "${prefab.prefabId}".`);
    ids.add(prefab.prefabId);
    const scene = prefab.scene as { entities?: unknown };
    if (!Array.isArray(scene.entities) || !(scene.entities as { id?: unknown }[]).some(entity => entity?.id === prefab.rootEntityId)) throw new Error(`Prefab "${prefab.name}" has a missing root reference.`);
    return structuredClone(prefab as PrefabDocument);
  });
}

export function componentOverrides(baseline: readonly { typeId: string; data: unknown }[], current: readonly { typeId: string; data: unknown }[]): string[] {
  const before = new Map(baseline.map(component => [component.typeId, stableJson(component.data)]));
  const after = new Map(current.map(component => [component.typeId, stableJson(component.data)]));
  return [...new Set([...before.keys(), ...after.keys()])].filter(id => before.get(id) !== after.get(id)).sort();
}

export function mergePrefabComponents(source: readonly { typeId: string; version: number; data: unknown }[], baseline: readonly { typeId: string; version: number; data: unknown }[], current: readonly { typeId: string; version: number; data: unknown }[]): { components: { typeId: string; version: number; data: unknown }[]; overrides: string[] } {
  const before = new Map(baseline.map(component => [component.typeId, component]));
  const local = new Map(current.map(component => [component.typeId, component]));
  const overrides = componentOverrides(baseline, current);
  const components = source.filter(component => !overrides.includes(component.typeId)).map(component => structuredClone(component));
  for (const component of current) {
    if (overrides.includes(component.typeId) && local.has(component.typeId)) components.push(structuredClone(component));
  }
  return { components, overrides };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
