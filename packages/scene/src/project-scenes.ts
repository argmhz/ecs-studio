/** Project scenes share assets and scripts; each document owns its entity namespace. */
export interface ProjectScene { readonly id: string; readonly name: string; readonly document: unknown; }
export interface ProjectScenes { readonly scenes: readonly ProjectScene[]; readonly activeSceneId: string; readonly startSceneId: string; }
export function validateProjectScenes(value: ProjectScenes | undefined, legacyScene: unknown): ProjectScenes {
  if (value === undefined) {
    const id = (legacyScene as { sceneId?: string } | null)?.sceneId ?? 'scene:main';
    return { scenes: [{ id, name: 'Main scene', document: legacyScene }], activeSceneId: id, startSceneId: id };
  }
  if (!value || !Array.isArray(value.scenes) || !value.scenes.length) throw new Error('Project must contain at least one scene.');
  const ids = new Set<string>();
  for (const scene of value.scenes) {
    if (!scene || typeof scene.id !== 'string' || !scene.id.trim() || typeof scene.name !== 'string' || !scene.name.trim() || !scene.document || typeof scene.document !== 'object') throw new Error('Invalid project scene.');
    if (ids.has(scene.id)) throw new Error(`Duplicate scene ID "${scene.id}".`);
    if ((scene.document as { sceneId?: string }).sceneId !== scene.id) throw new Error(`Scene document ID must match "${scene.id}".`);
    ids.add(scene.id);
  }
  if (!ids.has(value.activeSceneId) || !ids.has(value.startSceneId)) throw new Error('Active scene and start scene must belong to the project.');
  return { scenes: value.scenes, activeSceneId: value.activeSceneId, startSceneId: value.startSceneId };
}
/** Stable IDs are required; names can be changed without breaking scripts. */
export function sceneLoadTarget(payload: unknown, scenes: readonly ProjectScene[]): ProjectScene {
  const id = payload && typeof payload === 'object' ? (payload as { sceneId?: unknown }).sceneId : undefined;
  const target = scenes.find(scene => scene.id === id);
  if (!target) throw new Error(`scene.load requires a valid sceneId; received ${String(id)}.`);
  return target;
}
