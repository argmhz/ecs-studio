import { validateProjectScenes, type ProjectScenes } from '@ecs/scene';
import { validateGameView, type GameViewSettings } from '@ecs/rendering';
import type { AssetRecord, AssetStore } from '@ecs/assets';
import { validateSpriteAtlases } from '@ecs/assets';
import type { SpriteAtlas } from '@ecs/assets';
import { validateVisualGraph } from '@ecs/scripting';
import { DEFAULT_INPUT_ACTIONS, InputActionMap, type InputActionDefinition } from '@ecs/runtime';
import { validatePrefabs, type PrefabDocument } from './prefabs.ts';

export const PROJECT_FORMAT = 'ecs-project';
export const PROJECT_VERSION = 9;

export interface ProjectArchive {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  readonly projectName: string;
  readonly scene: unknown;
  readonly gameView: GameViewSettings;
  readonly sceneCollection: ProjectScenes;
  readonly scripts: Readonly<Record<string, string>>;
  readonly scriptProperties: Readonly<Record<string, unknown>>;
  readonly visualGraphs: Readonly<Record<string, unknown>>;
  readonly prefabs: readonly PrefabDocument[];
  readonly atlases: readonly SpriteAtlas[];
  readonly inputActions: readonly InputActionDefinition[];
  readonly assets: readonly (AssetRecord & { readonly data: string })[];
}

export interface SavedProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly scene: unknown;
  readonly gameView?: GameViewSettings;
  readonly sceneCollection?: ProjectScenes;
  readonly scripts: Readonly<Record<string, string>>;
  readonly scriptProperties: Readonly<Record<string, unknown>>;
  readonly visualGraphs: Readonly<Record<string, unknown>>;
  readonly prefabs?: readonly PrefabDocument[];
  readonly atlases?: readonly SpriteAtlas[];
  readonly inputActions?: readonly InputActionDefinition[];
  readonly savedAt: number;
}

const DATABASE_NAME = 'ecs-studio-projects';
const DATABASE_VERSION = 1;

/** IndexedDB adapter shared by scene persistence and the asset catalog. */
export class IndexedDbProjectStore implements AssetStore {
  private readonly database: IDBDatabase;
  readonly projectId: string;

  private constructor(database: IDBDatabase, projectId: string) {
    this.database = database;
    this.projectId = projectId;
  }

  static async open(projectId: string, name = DATABASE_NAME): Promise<IndexedDbProjectStore> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable in this browser.');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: ['projectId', 'assetId'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'));
      request.onblocked = () => reject(new Error('Project storage upgrade is blocked by another editor tab.'));
    });
    return new IndexedDbProjectStore(database, projectId);
  }

  async loadProject(): Promise<SavedProject | undefined> {
    const project = await this.request<(SavedProject & { scripts?: Readonly<Record<string, string>> }) | undefined>('projects', 'readonly', store => store.get(this.projectId));
    return project ? { ...project, scripts: project.scripts ?? {}, scriptProperties: project.scriptProperties ?? {}, visualGraphs: project.visualGraphs ?? {}, prefabs: project.prefabs ?? [], atlases: project.atlases ?? [], gameView: validateGameView(project.gameView), sceneCollection: validateProjectScenes(project.sceneCollection, project.scene), inputActions: new InputActionMap(project.inputActions ?? DEFAULT_INPUT_ACTIONS).toJSON() } : undefined;
  }

  async saveProject(projectName: string, scene: unknown, scripts: Readonly<Record<string, string>> = {}, scriptProperties: Readonly<Record<string, unknown>> = {}, visualGraphs: Readonly<Record<string, unknown>> = {}, prefabs: readonly PrefabDocument[] = [], atlases: readonly SpriteAtlas[] = [], inputActions: readonly InputActionDefinition[] = DEFAULT_INPUT_ACTIONS, gameView?: GameViewSettings, sceneCollection?: ProjectScenes): Promise<void> {
    const validatedActions = new InputActionMap(inputActions).toJSON();
    await this.request('projects', 'readwrite', store => store.put({ projectId: this.projectId, projectName, scene, gameView: validateGameView(gameView), sceneCollection: validateProjectScenes(sceneCollection, scene), scripts, scriptProperties, visualGraphs, prefabs, atlases, inputActions: validatedActions, savedAt: Date.now() }));
  }

  async readManifest(): Promise<string | undefined> {
    const entry = await this.request<{ projectId: string; contents: string } | undefined>('manifests', 'readonly', store => store.get(this.projectId));
    return entry?.contents;
  }

  async writeManifest(contents: string): Promise<void> {
    await this.request('manifests', 'readwrite', store => store.put({ projectId: this.projectId, contents }));
  }

  async readAsset(assetId: string): Promise<Uint8Array | undefined> {
    const entry = await this.request<{ projectId: string; assetId: string; data: ArrayBuffer } | undefined>('assets', 'readonly', store => store.get([this.projectId, assetId]));
    return entry ? new Uint8Array(entry.data) : undefined;
  }

  async writeAsset(assetId: string, data: Uint8Array): Promise<void> {
    await this.request('assets', 'readwrite', store => store.put({ projectId: this.projectId, assetId, data: data.slice().buffer }));
  }

  async deleteAsset(assetId: string): Promise<void> {
    await this.request('assets', 'readwrite', store => store.delete([this.projectId, assetId]));
  }

  async readAllAssets(records: readonly AssetRecord[]): Promise<readonly (AssetRecord & { readonly data: Uint8Array })[]> {
    return Promise.all(records.map(async record => {
      const data = await this.readAsset(record.assetId);
      if (!data) throw new Error(`Project asset "${record.path}" is missing from local storage.`);
      return { ...record, data };
    }));
  }

  close(): void { this.database.close(); }

  private request<T = IDBValidKey>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = this.database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      let result: unknown;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Project storage request failed.'));
      transaction.oncomplete = () => resolve(result as T);
      transaction.onerror = () => reject(transaction.error ?? new Error('Project storage transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project storage transaction was aborted.'));
    });
  }
}

export function encodeProjectArchive(projectName: string, scene: unknown, assets: readonly (AssetRecord & { readonly data: Uint8Array })[], scripts: Readonly<Record<string, string>> = {}, scriptProperties: Readonly<Record<string, unknown>> = {}, visualGraphs: Readonly<Record<string, unknown>> = {}, prefabs: readonly PrefabDocument[] = [], atlases: readonly SpriteAtlas[] = [], inputActions: readonly InputActionDefinition[] = DEFAULT_INPUT_ACTIONS, gameView?: GameViewSettings, sceneCollection?: ProjectScenes): string {
  const archive: ProjectArchive = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    projectName: projectName.trim() || 'Untitled Project',
    scene,
    gameView: validateGameView(gameView), sceneCollection: validateProjectScenes(sceneCollection, scene),
    scripts,
    scriptProperties,
    visualGraphs,
    prefabs,
    atlases: validateSpriteAtlases(atlases),
    inputActions: new InputActionMap(inputActions).toJSON(),
    assets: assets.map(({ data, ...record }) => ({ ...record, data: bytesToBase64(data) })),
  };
  return JSON.stringify(archive, null, 2);
}

export function decodeProjectArchive(text: string): ProjectArchive {
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { throw new Error('Project file is not valid JSON.'); }
  if (!input || typeof input !== 'object') throw new Error('Project file must contain an object.');
  const archive = input as Partial<ProjectArchive>;
  if (archive.format !== PROJECT_FORMAT) throw new Error('This file is not an ECS Studio project.');
  if (archive.version !== 1 && archive.version !== 2 && archive.version !== 3 && archive.version !== 4 && archive.version !== 5 && archive.version !== 6 && archive.version !== 7 && archive.version !== 8 && archive.version !== PROJECT_VERSION) throw new Error(`Unsupported project format version: ${String(archive.version)}.`);
  if (typeof archive.projectName !== 'string' || !archive.projectName.trim()) throw new Error('Project name is missing.');
  if (!Array.isArray(archive.assets) || archive.scene === undefined) throw new Error('Project file is missing its scene or asset list.');
  const ids = new Set<string>(); const paths = new Set<string>();
  for (const item of archive.assets) {
    if (!item || typeof item !== 'object' || typeof item.assetId !== 'string' || !item.assetId || typeof item.path !== 'string' || !item.path || typeof item.data !== 'string') throw new Error('Project contains an invalid asset entry.');
    if (ids.has(item.assetId) || paths.has(item.path)) throw new Error('Project contains duplicate asset IDs or paths.');
    ids.add(item.assetId); paths.add(item.path);
    let data: Uint8Array;
    try { data = base64ToBytes(item.data); } catch { throw new Error(`Asset "${item.path}" contains invalid data.`); }
    if (data.byteLength !== item.size) throw new Error(`Asset "${item.path}" has an invalid size.`);
  }
  const scripts = archive.version === 1 ? {} : (archive as ProjectArchive).scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts) || Object.entries(scripts).some(([path, source]) => !path.endsWith('.ts') && !path.endsWith('.js') || typeof source !== 'string')) throw new Error('Project contains invalid script files.');
  const scriptProperties = archive.version < 3 ? {} : (archive as ProjectArchive).scriptProperties;
  if (!scriptProperties || typeof scriptProperties !== 'object' || Array.isArray(scriptProperties)) throw new Error('Project contains invalid script properties.');
  const visualGraphs = archive.version < 4 ? {} : (archive as ProjectArchive).visualGraphs;
  if (!visualGraphs || typeof visualGraphs !== 'object' || Array.isArray(visualGraphs)) throw new Error('Project contains invalid visual graphs.');
  for (const [path, graph] of Object.entries(visualGraphs)) {
    if (!path.endsWith('.graph.json')) throw new Error(`Visual graph path "${path}" must end with .graph.json.`);
    try { validateVisualGraph(graph as Parameters<typeof validateVisualGraph>[0]); } catch (error) { throw new Error(`Visual graph "${path}" is invalid: ${String(error)}`); }
  }
  const prefabs = archive.version < 5 ? [] : validatePrefabs((archive as ProjectArchive).prefabs);
  const atlases = archive.version < 6 ? [] : validateSpriteAtlases((archive as ProjectArchive).atlases);
  let inputActions: readonly InputActionDefinition[];
  try { inputActions = new InputActionMap(archive.version < 7 ? DEFAULT_INPUT_ACTIONS : (archive as ProjectArchive).inputActions).toJSON(); }
  catch (error) { throw new Error(`Project contains invalid input actions: ${String(error)}`); }
  const sceneCollection = validateProjectScenes(archive.sceneCollection, archive.scene);
  const imageAssetIds = new Set(archive.assets.filter(item => item.kind === 'image').map(item => item.assetId));
  for (const atlas of atlases) if (!imageAssetIds.has(atlas.assetId)) throw new Error(`Sprite atlas "${atlas.name}" must reference an image asset in the project.`);
  const assetIds = new Set(ids);
  for (const missing of collectMissingAssetIds([sceneCollection.scenes.map(scene => scene.document), prefabs.map(prefab => prefab.scene)], assetIds)) throw new Error(`Project references missing asset ID "${missing}". Add the asset to the project before exporting it.`);
  return { ...(archive as ProjectArchive), version: PROJECT_VERSION, scene: sceneCollection.scenes.find(scene => scene.id === sceneCollection.activeSceneId)!.document, sceneCollection, gameView: validateGameView(archive.gameView), scripts, scriptProperties, visualGraphs, prefabs, atlases, inputActions };
}

function collectMissingAssetIds(value: unknown, knownIds: ReadonlySet<string>): Set<string> {
  const missing = new Set<string>();
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) { for (const item of entry) visit(item); return; }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) {
      if (key === 'assetId' && typeof item === 'string' && !knownIds.has(item)) missing.add(item);
      else visit(item);
    }
  };
  visit(value);
  return missing;
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  return btoa(binary);
}
