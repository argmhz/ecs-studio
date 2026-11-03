import { validateProjectScenes, sceneLoadTarget, type ProjectScenes, type ProjectScene } from '@ecs/scene';
import * as THREE from 'three';
import { createScene, type PlaySceneSource, type UiOverlayItem } from './index.ts';
import type { AssetRecord, SpriteAtlas, SpriteRegionReference } from '@ecs/assets';
import { defineComponent } from '@ecs/core';
import { defineComponentSchema, registerBuiltInSceneSchemas, SceneCodec, SceneHierarchy, SchemaRegistry, Transform2D } from '@ecs/scene';
import { camera2DSchema, resolveCamera2D, validateGameView, type GameViewSettings, applySpriteUvRegion, Parallax2D, parallax2DSchema, type Parallax2DData, collectTileRenderItems, parseTilemap, SpriteAnimation2D, spriteAnimation2DSchema, SpriteRenderer2D, spriteRenderer2DSchema, Tilemap2D, tilemap2DSchema, updateSpriteAnimations } from '@ecs/rendering';
import { AudioSource2D, audioSource2DSchema, WebAudioMixer } from '@ecs/audio';
import { applyScriptCommandBuffer, createCodeScriptSource, createSandboxedSession, createScriptApi, defineScriptDefinition, evaluateVisualGraph, ScriptBinding, scriptBindingSchema, validateScriptProperties } from '@ecs/scripting';
import type { ScriptApiOutput, ScriptJson } from '@ecs/scripting';
import type { ScriptBindingData } from '@ecs/scripting';
import { UiButton, UiCanvas, UiImage, UiText, layoutAnchoredRect, uiSchemas } from '@ecs/ui';
import { DEFAULT_INPUT_ACTIONS, type InputActionDefinition } from '@ecs/runtime';

interface ExportAsset extends AssetRecord { readonly url: string; }
interface ExportProject {
  readonly format: 'ecs-web-game';
  readonly version: 1;
  readonly projectName: string;
  readonly scene: unknown;
  readonly gameView?: GameViewSettings;
  readonly sceneCollection?: ProjectScenes;
  readonly scripts: Readonly<Record<string, string>>;
  readonly visualGraphs: Readonly<Record<string, unknown>>;
  readonly atlases: readonly SpriteAtlas[];
  readonly inputActions?: readonly InputActionDefinition[];
  readonly assets: readonly ExportAsset[];
}
interface PhysicsData { bodyType: 'Dynamic' | 'Fixed'; gravityScale: number; }
interface ColliderData { shape: 'Box' | 'Circle'; friction: number; restitution: number; sensor: boolean; groups: number; mask: number; }
interface SceneObject { parallax?: Parallax2DData; id: string; name: string; x: number; y: number; width: number; height: number; color: string; rotation: number; order: number; dynamic: boolean; hasSprite: boolean; assetId: string | null; region?: SpriteRegionReference | null; physics?: PhysicsData; collider?: ColliderData; }
interface QueuedEvent { type: string; payload: ScriptJson; }
interface ScriptState { state: ScriptJson; subscriptions: string[]; session?: ReturnType<typeof createSandboxedSession>; started: boolean; lastInput?: Record<string, unknown>; }

async function startStandaloneGame() {
const gameData = document.querySelector<HTMLScriptElement>('#game-data');
if (!gameData?.textContent) throw new Error('This export is missing its embedded game data.');
const project = JSON.parse(gameData.textContent) as ExportProject;
if (project.format !== 'ecs-web-game' || project.version !== 1) throw new Error('This embedded game data format is not supported.');
const name = defineComponent<{ value: string }>('Name');
const physics = defineComponent<PhysicsData>('Physics2D');
const collider = defineComponent<ColliderData>('Collider2D');
const nameSchema = defineComponentSchema({ typeId: 'engine.name', displayName: 'Name', version: 1, component: name, fields: { value: { type: 'string', label: 'Name', default: 'Object' } } });
const physicsSchema = defineComponentSchema({ typeId: 'engine.physics2d', displayName: 'Physics 2D', version: 1, component: physics, fields: { bodyType: { type: 'enum', label: 'Body Type', default: 'Dynamic', options: ['Dynamic', 'Fixed'] }, gravityScale: { type: 'number', label: 'Gravity Scale', default: 1 } } });
const colliderSchema = defineComponentSchema({ typeId: 'engine.collider2d', displayName: 'Collider 2D', version: 1, component: collider, fields: { shape: { type: 'enum', label: 'Shape', default: 'Box', options: ['Box', 'Circle'] }, friction: { type: 'number', label: 'Friction', default: 0.7, min: 0, max: 1 }, restitution: { type: 'number', label: 'Restitution', default: 0.25, min: 0, max: 1 }, sensor: { type: 'boolean', label: 'Is Trigger', default: false }, groups: { type: 'number', label: 'Collision Group', default: 1, min: 1, max: 65535 }, mask: { type: 'number', label: 'Collision Mask', default: 65535, min: 1, max: 65535 } } });
const schemas = new SchemaRegistry(); registerBuiltInSceneSchemas(schemas);
for (const schema of [nameSchema, spriteRenderer2DSchema, camera2DSchema, parallax2DSchema, physicsSchema, colliderSchema, tilemap2DSchema, spriteAnimation2DSchema, scriptBindingSchema, audioSource2DSchema, ...uiSchemas]) schemas.register(schema);
const codec = new SceneCodec(schemas);
const collection = validateProjectScenes(project.sceneCollection, project.scene);
function loadSceneDocument(document: unknown) {
  const sceneDocument = structuredClone(document) as { entities: { components: { typeId: string }[] }[] };
  for (const entity of sceneDocument.entities) entity.components = entity.components.filter(component => component.typeId !== 'engine.prefab-instance');
  return codec.deserialize(sceneDocument);
}
for (const entry of collection.scenes) loadSceneDocument(entry.document);
const startDocument = collection.scenes.find(entry => entry.id === collection.startSceneId)!.document;
let { world, entities } = loadSceneDocument(startDocument);
let hierarchy = new SceneHierarchy(world, entities);
const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]));
const blobUrls = new Map<string, string>();
const imageUrls = new Map<string, Promise<string | undefined>>();
function resolveUiImage(assetId: string): Promise<string | undefined> {
  let pending = imageUrls.get(assetId);
  if (!pending) { pending = (async () => { const record = assetsById.get(assetId); if (!record || record.kind !== 'image') return undefined; const response = await fetch(record.url); if (!response.ok) return undefined; const url = URL.createObjectURL(await response.blob()); blobUrls.set(`ui:${assetId}`, url); return url; })(); imageUrls.set(assetId, pending); }
  return pending;
}
const textureSource = new Map<string, Promise<THREE.Texture | null>>();
async function loadTexture(assetId: string, region?: SpriteRegionReference | null): Promise<THREE.Texture | null> {
  let pending = textureSource.get(assetId);
  if (!pending) { pending = (async () => { const record = assetsById.get(assetId); if (!record || record.kind !== 'image') return null; const response = await fetch(record.url); if (!response.ok) return null; const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none' }); const texture = new THREE.Texture(bitmap); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; texture.addEventListener('dispose', () => bitmap.close()); return texture; })(); textureSource.set(assetId, pending); }
  const texture = await pending; if (!texture || !region) return texture;
  const atlas = project.atlases.find(item => item.id === region.atlasId && item.assetId === assetId); const rect = atlas?.regions.find(item => item.id === region.regionId); if (!atlas || !rect) return texture;
  const cropped = texture.clone(); applySpriteUvRegion(cropped, { x: rect.x / atlas.width, y: 1 - (rect.y + rect.height) / atlas.height, width: rect.width / atlas.width, height: rect.height / atlas.height }); return cropped;
}
function uiItems() {
  const items: UiOverlayItem[] = [];
  for (const [id, entity] of entities) {
    if (world.hasComponent(entity, UiText)) { const data = world.getComponent(entity, UiText)!; const { text, color, fontSize, align, ...layout } = data; items.push({ id: `${id}:text`, entityId: id, kind: 'text', text, color, fontSize, align, layout }); }
    if (world.hasComponent(entity, UiImage)) { const data = world.getComponent(entity, UiImage)!; const { asset, fit, ...layout } = data; items.push({ id: `${id}:image`, entityId: id, kind: 'image', assetId: asset?.assetId ?? null, fit, layout }); }
    if (world.hasComponent(entity, UiButton)) { const data = world.getComponent(entity, UiButton)!; const { text, color, background, fontSize, disabled, ...layout } = data; items.push({ id: `${id}:button`, entityId: id, kind: 'button', text, color, background, fontSize, disabled, layout }); }
  }
  return items;
}
function canvasSettings() {
  for (const entity of entities.values()) if (world.hasComponent(entity, UiCanvas)) { const data = world.getComponent(entity, UiCanvas)!; return { referenceWidth: data.referenceWidth, referenceHeight: data.referenceHeight, scaleMode: data.scaleMode }; }
  return { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' as const };
}
function sceneObjects(): SceneObject[] {
  const output: SceneObject[] = [];
  for (const [id, entity] of entities) {
    const transform = hierarchy.getGlobalTransform(id); const sprite = world.getComponent(entity, SpriteRenderer2D); const body = world.getComponent(entity, physics); const shape = world.getComponent(entity, collider);
    const scaleX = Math.hypot(transform.a, transform.b), scaleY = Math.hypot(transform.c, transform.d);
    output.push({ ...(world.hasComponent(entity, Parallax2D) ? { parallax: world.getComponent(entity, Parallax2D)! } : {}), id, name: world.getComponent(entity, name)?.value ?? id, x: transform.tx, y: transform.ty, rotation: Math.atan2(transform.b, transform.a), width: (sprite?.width ?? 1) * scaleX, height: (sprite?.height ?? 1) * scaleY, color: sprite?.tint ?? '#ffffff', order: sprite?.order ?? 0, dynamic: body?.bodyType === 'Dynamic', hasSprite: Boolean(sprite), assetId: sprite?.asset?.assetId ?? null, region: sprite?.region, ...(body ? { physics: body } : {}), ...(shape ? { collider: shape } : {}) });
  }
  for (const item of collectTileRenderItems(world, entities, hierarchy, project.atlases)) {
    const scaleX = Math.hypot(item.transform.a, item.transform.b), scaleY = Math.hypot(item.transform.c, item.transform.d);
    output.push({ id: item.entityId, name: item.entityId, x: item.transform.tx, y: item.transform.ty, rotation: Math.atan2(item.transform.b, item.transform.a), width: item.width * scaleX, height: item.height * scaleY, color: item.tint, order: item.order, dynamic: false, hasSprite: true, assetId: item.assetId, region: item.region });
  }
  for (const [id, entity] of entities) if (world.hasComponent(entity, Tilemap2D)) {
    const map = world.getComponent(entity, Tilemap2D)!; const { layers } = parseTilemap(map); const transform = hierarchy.getGlobalTransform(id);
    for (const layer of layers) if (layer.collidable) layer.cells.forEach((tile, index) => { if (!tile) return; const x = (index % map.width - (map.width - 1) / 2) * map.tileSize, y = ((map.height - 1) / 2 - Math.floor(index / map.width)) * map.tileSize;
      output.push({ id: `${id}:collider:${layer.id}:${index}`, name: `${layer.name} tile`, x: transform.tx + transform.a * x + transform.c * y, y: transform.ty + transform.b * x + transform.d * y, rotation: Math.atan2(transform.b, transform.a), width: map.tileSize, height: map.tileSize, color: '#ffffff', order: 0, dynamic: false, hasSprite: false, assetId: null, physics: { bodyType: 'Fixed', gravityScale: 1 }, collider: { shape: 'Box', friction: 0.7, restitution: 0, sensor: false, groups: 1, mask: 65535 } });
    });
  }
  return output;
}
const host = document.querySelector<HTMLElement>('#game')!;
const errorPanel = document.querySelector<HTMLElement>('#error')!;
const mixer = new WebAudioMixer();
const audioBytes = new Map<string, Promise<Uint8Array>>();
async function playAudio(entityId: string) {
  const entity = entities.get(entityId); const source = entity && world.getComponent(entity, AudioSource2D);
  if (!source?.asset) return;
  const record = assetsById.get(source.asset.assetId); if (!record || record.kind !== 'audio') throw new Error(`Audio asset ${source.asset.assetId} was not exported.`);
  let bytes = audioBytes.get(record.assetId); if (!bytes) { bytes = fetch(record.url).then(async response => { if (!response.ok) throw new Error(`Could not load ${record.path}.`); return new Uint8Array(await response.arrayBuffer()); }); audioBytes.set(record.assetId, bytes); }
  await mixer.play(record.assetId, await bytes, { ownerId: entityId, group: source.group, volume: source.volume, loop: source.loop });
}
const scriptDefinition = defineScriptDefinition({ scriptId: 'game.player', version: 1, properties: { speed: { type: 'number', label: 'Speed', default: 5, min: 0, max: 100 } } });
const scriptInstances = new Map<string, { code: ScriptState; graph: ScriptState }>();
const animationStates = new Map<string, { clipId: string; time: number }>();
let pendingEvents: QueuedEvent[] = [];
let queuedUiEvents: QueuedEvent[] = [];
let abort: AbortController | undefined;
let scene: Awaited<ReturnType<typeof createScene>> | undefined;
let pendingScriptFrame: Promise<void> | undefined;
let stopScriptsTask: Promise<void> | undefined;
const stateFor = (entityId: string, kind: 'code' | 'graph'): ScriptState => {
  const found = scriptInstances.get(entityId) ?? { code: { state: null, subscriptions: [], started: false }, graph: { state: null, subscriptions: [], started: false } };
  scriptInstances.set(entityId, found); return found[kind];
};
function snapshotComponents() {
  const result = new Map<string, Record<string, ScriptJson>>();
  for (const [id, entity] of entities) { const values: Record<string, ScriptJson> = {}; for (const schema of schemas.all()) if (world.hasComponent(entity, schema.component)) values[schema.typeId] = world.getComponent(entity, schema.component) as ScriptJson; result.set(id, values); }
  return result;
}
function applyCommands(outputs: readonly Pick<ScriptApiOutput, 'componentCommands'>[]) {
  const shadow = new Map([...entities].map(([id, entity]) => [id, new Set(schemas.all().filter(schema => world.hasComponent(entity, schema.component)).map(schema => schema.typeId))]));
  const commands: { command: ScriptApiOutput['componentCommands'][number]; schema: NonNullable<ReturnType<typeof schemas.get>> }[] = [];
  for (const output of outputs) for (const command of output.componentCommands) {
    const present = shadow.get(command.entityId); const schema = schemas.get(command.componentTypeId); if (!present || !schema) throw new Error(`Script command targeted unknown entity or component: ${command.entityId} / ${command.componentTypeId}.`);
    if (command.operation === 'remove') { if (command.componentTypeId === 'engine.name' || command.componentTypeId === 'engine.transform2d') throw new Error('Objects must keep Name and Transform 2D.'); if (present.has(command.componentTypeId)) { present.delete(command.componentTypeId); commands.push({ command, schema }); } continue; }
    const issues = schema.validate(command.data); if (issues.length) throw new Error(`Invalid ${command.componentTypeId}: ${issues.map(issue => issue.message).join(' ')}`);
    if (command.operation === 'set' && !present.has(command.componentTypeId)) throw new Error(`Cannot set missing ${command.componentTypeId}.`);
    if (command.operation === 'add' && present.has(command.componentTypeId)) throw new Error(`${command.componentTypeId} already exists.`);
    if (command.operation === 'add') present.add(command.componentTypeId); commands.push({ command, schema });
  }
  for (const { command, schema } of commands) { const entity = entities.get(command.entityId)!; if (command.operation === 'remove') world.removeComponent(entity, schema.component); else if (command.operation === 'set') world.setComponent(entity, schema.component, command.data); else world.addComponent(entity, schema.component, command.data); }
}
async function stepScripts(deltaTime: number, input: Parameters<NonNullable<PlaySceneSource['onFrame']>>[1]): Promise<void> {
  const delivered = [...pendingEvents, ...queuedUiEvents]; queuedUiEvents = []; pendingEvents = [];
  for (const [id, entity] of entities) if (world.hasComponent(entity, AudioSource2D) && world.getComponent(entity, AudioSource2D)!.playOnStart && !autoplay.has(id)) { autoplay.add(id); await playAudio(id); }
  for (const event of delivered) {
    if (event.type === 'audio.play' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && typeof event.payload.entityId === 'string') await playAudio(event.payload.entityId);
    if (event.type === 'audio.stop' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && typeof event.payload.entityId === 'string') mixer.stop(event.payload.entityId);
  }
  const snapshots = snapshotComponents(); const outputs: ScriptApiOutput[] = []; const produced: QueuedEvent[] = [];
  const bindings = [...entities].flatMap(([entityId, entity]) => { if (!world.hasComponent(entity, ScriptBinding)) return []; const binding = world.getComponent(entity, ScriptBinding)!; return binding.enabled && (binding.codePath.trim() || binding.graphPath.trim()) ? [{ entityId, binding }] : []; }).sort((a, b) => a.entityId.localeCompare(b.entityId));
  for (const { entityId, binding } of bindings) {
    const own = snapshots.get(entityId); if (!own) continue;
    const common = { entityId, phase: 'update' as const, deltaTime, input, components: own, entityComponents: Object.fromEntries([...snapshots].filter(([id]) => id !== entityId)), availableComponentTypeIds: schemas.all().map(schema => schema.typeId) };
    const properties = validateScriptProperties(scriptDefinition, { speed: binding.speed }); if (properties.issues.length) throw new Error(`Invalid properties on ${entityId}.`);
    if (binding.codePath.trim()) {
      const source = project.scripts[binding.codePath]; if (source === undefined) throw new Error(`Script file "${binding.codePath}" is missing from the export.`);
      const state = stateFor(entityId, 'code'); state.session ??= createSandboxedSession(createCodeScriptSource(source), { timeoutMs: 500, signal: abort?.signal });
      const invoke = (phase: 'start' | 'event' | 'update' | 'destroy', events: readonly QueuedEvent[] = []) => { const inputValue = { ...common, phase, state: state.state, properties: properties.values, subscriptions: state.subscriptions, events }; state.lastInput = inputValue; return state.session!.invoke(inputValue) as Promise<ScriptApiOutput>; };
      if (!state.started) { const result = await invoke('start'); state.started = true; state.state = result.state ?? null; state.subscriptions = [...result.subscriptions]; outputs.push(result); produced.push(...result.emittedEvents); }
      const matching = delivered.filter(event => state.subscriptions.includes(event.type));
      if (matching.length) { const result = await invoke('event', matching); state.state = result.state ?? null; state.subscriptions = [...result.subscriptions]; outputs.push(result); produced.push(...result.emittedEvents); }
      const result = await invoke('update', matching); state.state = result.state ?? null; state.subscriptions = [...result.subscriptions]; outputs.push(result); produced.push(...result.emittedEvents);
    }
    if (binding.graphPath.trim()) {
      const graph = project.visualGraphs[binding.graphPath] as Parameters<typeof evaluateVisualGraph>[0] | undefined; if (!graph) throw new Error(`Node graph "${binding.graphPath}" is missing from the export.`);
      const state = stateFor(entityId, 'graph');
      const invoke = (entry: typeof graph.nodes[number], phase: 'start' | 'update' | 'event', events: readonly QueuedEvent[] = []) => {
        const api = createScriptApi({ ...common, phase, state: state.state, properties: properties.values, subscriptions: state.subscriptions, events });
        const result = evaluateVisualGraph(graph, { signal: abort?.signal, api, entryNodeId: entry.id }).output;
        state.state = result.state; state.subscriptions = [...result.subscriptions]; outputs.push(result); produced.push(...result.emittedEvents);
      };
      if (!state.started) { for (const entry of graph.nodes.filter(node => node.kind === 'event.onStart')) invoke(entry, 'start'); state.started = true; }
      const updates = graph.nodes.filter(node => node.kind === 'event.onUpdate');
      for (const entry of updates.length ? updates : graph.nodes.filter(node => node.kind === 'event.start')) invoke(entry, 'update', delivered.filter(event => state.subscriptions.includes(event.type)));
      for (const event of delivered.filter(event => state.subscriptions.includes(event.type))) for (const entry of graph.nodes.filter(node => node.kind === 'event.onEvent' && String(node.data.eventType ?? '') === event.type)) invoke(entry, 'event', [event]);
    }
  }
  applyCommands(outputs); updateSpriteAnimations(world, entities, schemas.all(), deltaTime, animationStates);
  pendingEvents = produced;
  const request = produced.find(event => event.type === 'scene.load');
  if (request) { const target = sceneLoadTarget(request.payload, collection.scenes); const revision = sceneRevision; window.setTimeout(() => { if (running && revision === sceneRevision) void transition(target); }, 0); }
  if (pendingEvents.length > 512) throw new Error('Scripts emitted too many events in one tick.');
}
const autoplay = new Set<string>();
function makeSource(): PlaySceneSource { return {
  objects: sceneObjects(), world, camera: () => resolveCamera2D(world, entities, hierarchy),
  inputActions: project.inputActions ?? DEFAULT_INPUT_ACTIONS,
  uiElements: uiItems, uiCanvas: canvasSettings, resolveUiImage,
  onUiButtonClick(entityId) { if (queuedUiEvents.length < 512) queuedUiEvents.push({ type: 'ui.button.clicked', payload: { entityId } }); },
  syncTransform(id, x, y, rotation) { const entity = entities.get(id); const current = entity && world.getComponent(entity, Transform2D); if (entity && current) world.setComponent(entity, Transform2D, { ...current, x, y, rotation }); },
  syncObjects: sceneObjects,
  async onFrame(deltaTime, input) { const current = stepScripts(deltaTime, input); pendingScriptFrame = current; try { await current; } finally { if (pendingScriptFrame === current) pendingScriptFrame = undefined; } },
  onPhysicsEvents(events) { pendingEvents.push(...events); if (pendingEvents.length > 512) throw new Error('Too many pending physics events.'); },
}; }
function stopScripts(): Promise<void> {
  if (stopScriptsTask) return stopScriptsTask;
  stopScriptsTask = (async () => {
    await pendingScriptFrame?.catch(() => {});
    for (const state of scriptInstances.values()) { const code = state.code; if (code.session && code.started && code.lastInput) { try { await code.session.invoke({ ...code.lastInput, phase: 'destroy', state: code.state, events: [] }); } catch (error) { console.error('Script onStop failed:', error); } } }
    abort?.abort(); abort = undefined;
    for (const state of scriptInstances.values()) state.code.session?.close();
    scriptInstances.clear(); animationStates.clear(); autoplay.clear(); pendingEvents = []; queuedUiEvents = [];
  })().finally(() => { stopScriptsTask = undefined; });
  return stopScriptsTask;
}
let running = false;
let sceneRevision = 0;
async function start(document: unknown = startDocument) {
  if (running) return;
  const revision = ++sceneRevision; running = true;
  try {
    await mixer.unlock(); await stopScripts();
    if (revision !== sceneRevision) return;
    ({ world, entities } = loadSceneDocument(document)); hierarchy = new SceneHierarchy(world, entities);
    abort = new AbortController(); scene?.dispose(); scene = undefined;
    const source = makeSource();
    const next = await createScene(host, [...source.objects], () => undefined, loadTexture, { x: 0, y: 2, worldUnitsPerPixel: 1 / 45 });
    if (revision !== sceneRevision) { next.dispose(); return; }
    scene = next; scene.setGameView(validateGameView(project.gameView)); scene.play(source); errorPanel.hidden = true;
  } catch (error) { if (revision !== sceneRevision) return; running = false; errorPanel.textContent = String(error); errorPanel.hidden = false; }
}
async function transition(target: ProjectScene) {
  const revision = ++sceneRevision; scene?.stop(); await stopScripts(); mixer.stopAll();
  if (revision !== sceneRevision) return;
  running = false; await start(target.document);
}
document.querySelector<HTMLButtonElement>('#play')!.addEventListener('click', () => { void start(); });
document.querySelector<HTMLButtonElement>('#pause')!.addEventListener('click', () => scene?.setPaused(true));
document.querySelector<HTMLButtonElement>('#resume')!.addEventListener('click', () => { void mixer.unlock(); scene?.setPaused(false); });
document.querySelector<HTMLButtonElement>('#stop')!.addEventListener('click', () => { ++sceneRevision; running = false; scene?.stop(); void stopScripts().then(() => mixer.stopAll()); });
host.addEventListener('playsimulationerror', event => { errorPanel.textContent = String((event as CustomEvent<unknown>).detail); errorPanel.hidden = false; ++sceneRevision; running = false; void stopScripts(); mixer.stopAll(); });
window.addEventListener('pagehide', () => { void stopScripts(); scene?.dispose(); mixer.dispose(); for (const url of blobUrls.values()) URL.revokeObjectURL(url); }, { once: true });
}

void startStandaloneGame().catch(error => {
  const panel = document.querySelector<HTMLElement>('#error');
  if (panel) { panel.textContent = String(error); panel.hidden = false; }
  else console.error('Could not start exported game:', error);
});
