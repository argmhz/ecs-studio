import * as THREE from 'three';
import { DEFAULT_GAME_VIEW, validateGameView, fitGameViewport, type GameViewSettings, type CameraView2D, parallaxTransforms, type Parallax2DData } from '@ecs/rendering';
import RAPIER, { type Collider, type RigidBody, type World } from '@dimforge/rapier2d-compat';
import { World as EcsWorld } from '@ecs/core';
import { FixedStepLoop, Scheduler } from '@ecs/runtime';
import { DEFAULT_INPUT_ACTIONS, InputActionMap } from '@ecs/runtime';
import type { InputActionDefinition } from '@ecs/runtime';
import type { InputSnapshot } from '@ecs/runtime';
import type { SpriteRegionReference } from '@ecs/assets';
import { BrowserInputAdapter } from './browser-input.ts';
import { createUiOverlay, type UiCanvasSettings, type UiOverlayItem } from './ui-overlay.ts';
export { type UiCanvasSettings, type UiOverlayItem } from './ui-overlay.ts';
export { createUiOverlay } from './ui-overlay.ts';

export interface SceneObject {
  parallax?: Parallax2DData;
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  dynamic: boolean;
  rotation?: number;
  order?: number;
  hasSprite?: boolean;
  assetId?: string | null;
  region?: SpriteRegionReference | null;
  physics?: { bodyType: 'Dynamic' | 'Fixed'; gravityScale: number };
  collider?: { shape: 'Box' | 'Circle'; friction: number; restitution: number; sensor: boolean; groups: number; mask: number };
}

export interface PlaySceneSource {
  readonly objects: readonly SceneObject[];
  readonly camera?: () => CameraView2D | undefined;
  readonly world: EcsWorld;
  readonly inputActions?: readonly InputActionDefinition[];
  readonly syncTransform?: (id: string, x: number, y: number, rotation: number) => void;
  readonly onFrame?: (deltaTime: number, input: InputSnapshot) => Promise<void>;
  readonly syncObjects?: () => readonly SceneObject[];
  readonly onPhysicsEvents?: (events: readonly { type: string; payload: { entityId: string; otherEntityId: string } }[]) => void;
  readonly uiElements?: () => readonly UiOverlayItem[];
  readonly uiCanvas?: () => UiCanvasSettings;
  readonly resolveUiImage?: (assetId: string) => Promise<string | undefined>;
  readonly onUiButtonClick?: (entityId: string) => void;
  readonly onEntitySelected?: (entityId: string) => void;
}

export interface PreviewCameraSettings {
  readonly x: number;
  readonly y: number;
  readonly worldUnitsPerPixel: number;
}

/** Temporary Game-view adapter; the simulation uses the shared runtime scheduler. */
export async function createScene(host: HTMLElement, objects: SceneObject[], select: (id: string) => void, loadTexture?: (assetId: string, region?: SpriteRegionReference | null) => Promise<THREE.Texture | null>, cameraSettings: PreviewCameraSettings = { x: 0, y: 2, worldUnitsPerPixel: 0.2 }) {
  await RAPIER.init();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor('#20232c');
  const surface = document.createElement('div'); surface.className = 'game-surface'; surface.style.cssText = 'position:absolute;overflow:hidden'; host.append(surface); surface.append(renderer.domElement);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  let gameView = DEFAULT_GAME_VIEW;
  let cameraProvider: (() => CameraView2D | undefined) | undefined;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  renderer.domElement.setAttribute('aria-label', '2D scene viewport');
  renderer.domElement.style.touchAction = 'none';
  const inputAdapter = new BrowserInputAdapter(renderer.domElement, new InputActionMap());
  let uiProvider: (() => readonly UiOverlayItem[]) | undefined;
  let uiCanvas: (() => UiCanvasSettings) | undefined;
  let uiImageResolver: ((assetId: string) => Promise<string | undefined>) | undefined;
  let uiButtonHandler: ((entityId: string) => void) | undefined;
  const defaultUiCanvas: UiCanvasSettings = { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' };
  const uiOverlay = createUiOverlay(surface, assetId => uiImageResolver?.(assetId) ?? Promise.resolve(undefined), entityId => uiButtonHandler?.(entityId));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 7, -3, 0.1, 100);
  camera.position.set(0, 2, 10);
  camera.lookAt(0, 2, 0);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  const visualObjects = new Map<string, SceneObject>();
  const repeatedMeshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  const textureLoads = new Map<string, Promise<THREE.Texture | null>>();
  let disposed = false;
  function setMeshAsset(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, assetId: string | null | undefined, region?: SpriteRegionReference | null) {
    const key = assetId ? `${assetId}|${region ? `${region.atlasId}:${region.regionId}` : 'full'}` : '';
    if (mesh.userData.assetId === key) return;
    mesh.userData.assetId = key;
    if (!key || !loadTexture) { mesh.material.map = null; mesh.material.needsUpdate = true; return; }
    let loading = textureLoads.get(key);
    if (!loading) { loading = loadTexture(assetId!, region); textureLoads.set(key, loading); }
    void loading.then(texture => { if (!disposed && texture && mesh.userData.assetId === key) { mesh.material.map = texture; mesh.material.needsUpdate = true; } }).catch(() => { /* Failed assets remain visible as tinted placeholder quads. */ });
  }
  const bodies = new Map<string, RigidBody>();
  const colliders = new Map<string, Collider>();
  const colliderSignatures = new Map<string, string>();
  const colliderEntities = new Map<number, string>();
  const sensorHandles = new Set<number>();
  let world: World | undefined;
  let eventQueue: RAPIER.EventQueue | undefined;
  let running = false;
  let scheduler: Scheduler | undefined;
  let simulation: FixedStepLoop | undefined;
  let activeSource: PlaySceneSource | undefined;
  let pendingScriptFrame: Promise<void> | undefined;
  let selected = objects[0]?.id ?? "";
  let frame = 0;
  let previous = 0;
  const timestep = 1 / 60;
  function addMesh(object: SceneObject) {
    visualObjects.set(object.id, { ...object });
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: object.color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.scale.set(object.width, object.height, 1);
    mesh.rotation.z = object.rotation ?? 0;
    mesh.userData.id = object.id;
    mesh.renderOrder = object.order ?? 0;
    scene.add(mesh);
    meshes.set(object.id, mesh);
    setMeshAsset(mesh, object.assetId, object.region);
  }
  for (const object of objects) {
    if (object.hasSprite === false) continue;
    addMesh(object);
  }
  function syncEdit() { syncRuntimeObjects(objects); }
  function stop() {
    running = false;
    inputAdapter.setActive(false);
    activeSource = undefined;
    uiProvider = undefined; uiCanvas = undefined; uiImageResolver = undefined; uiButtonHandler = undefined;
    uiOverlay.setButtonHandler(() => undefined);
    world?.free();
    world = undefined;
    eventQueue?.free(); eventQueue = undefined;
    bodies.clear();
    colliders.clear(); colliderSignatures.clear(); colliderEntities.clear(); sensorHandles.clear();
    simulation = undefined;
    scheduler = undefined;
    host.dataset.simulationTick = '0';
    syncEdit();
  }
  function stepPhysics(source?: PlaySceneSource) {
    if (!world) return;
    world.step(eventQueue);
    for (const [id, body] of bodies) {
      const position = body.translation();
      const mesh = meshes.get(id);
      const rotation = body.rotation();
      const visual = visualObjects.get(id); if (visual) visualObjects.set(id, { ...visual, x: position.x, y: position.y, rotation });
      if (mesh) { mesh.position.set(position.x, position.y, 0); mesh.rotation.z = rotation; }
      source?.syncTransform?.(id, position.x, position.y, rotation);
    }
    const events: { type: string; payload: { entityId: string; otherEntityId: string } }[] = [];
    eventQueue?.drainCollisionEvents((handle1, handle2, started) => {
      const entityId = colliderEntities.get(handle1); const otherEntityId = colliderEntities.get(handle2);
      if (!entityId || !otherEntityId) return;
      const trigger = sensorHandles.has(handle1) || sensorHandles.has(handle2);
      events.push({ type: `physics.${trigger ? 'trigger' : 'collision'}.${started ? 'enter' : 'exit'}`, payload: { entityId, otherEntityId } });
    });
    if (events.length) source?.onPhysicsEvents?.(events);
  }
  function syncRuntimeObjects(updates: readonly SceneObject[]) {
    const byId = new Map(updates.map(object => [object.id, object]));
    const ids = new Set(byId.keys());
    for (const [id, mesh] of meshes) if (!ids.has(id) || byId.get(id)?.hasSprite === false) {
      scene.remove(mesh); mesh.material.dispose(); meshes.delete(id); visualObjects.delete(id);
    }
    for (const [id, body] of bodies) if (!ids.has(id) || !byId.get(id)?.physics) {
      const collider = colliders.get(id); if (collider) { colliderEntities.delete(collider.handle); sensorHandles.delete(collider.handle); }
      colliders.delete(id); colliderSignatures.delete(id); world?.removeRigidBody(body); bodies.delete(id);
    }
    for (const object of updates) {
      visualObjects.set(object.id, { ...object });
      let mesh = meshes.get(object.id);
      if (object.hasSprite !== false && !mesh) { addMesh(object); mesh = meshes.get(object.id); }
      if (mesh) {
        mesh.scale.set(object.width, object.height, 1); mesh.material.color.set(object.color); mesh.renderOrder = object.order ?? 0;
        mesh.position.set(object.x, object.y, 0); mesh.rotation.z = object.rotation ?? 0;
        setMeshAsset(mesh, object.assetId, object.region);
      }
      const physics = object.physics;
      if (!physics || !world) continue;
      let body = bodies.get(object.id);
      if (!body) {
        const desc = physics.bodyType === 'Dynamic' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
        body = world.createRigidBody(desc.setTranslation(object.x, object.y).setRotation(object.rotation ?? 0).setGravityScale(physics.gravityScale));
        bodies.set(object.id, body);
      } else {
        body.setBodyType(physics.bodyType === 'Dynamic' ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed, true);
        body.setGravityScale(physics.gravityScale, true);
      }
      const collider = object.collider;
      if (!collider) {
        const previous = colliders.get(object.id); if (previous) { colliderEntities.delete(previous.handle); sensorHandles.delete(previous.handle); world.removeCollider(previous, true); }
        colliders.delete(object.id); colliderSignatures.delete(object.id); continue;
      }
      const signature = JSON.stringify([collider, object.width, object.height]);
      if (signature === colliderSignatures.get(object.id)) continue;
      const previous = colliders.get(object.id); if (previous) { colliderEntities.delete(previous.handle); sensorHandles.delete(previous.handle); world.removeCollider(previous, true); }
      const desc = collider.shape === 'Circle'
        ? RAPIER.ColliderDesc.ball(Math.max(object.width, object.height) / 2)
        : RAPIER.ColliderDesc.cuboid(object.width / 2, object.height / 2);
      const packedGroups = ((collider.groups & 0xffff) << 16) | (collider.mask & 0xffff);
      const created = world.createCollider(desc.setFriction(collider.friction).setRestitution(collider.restitution).setSensor(collider.sensor).setCollisionGroups(packedGroups).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      colliders.set(object.id, created); colliderSignatures.set(object.id, signature);
      colliderEntities.set(created.handle, object.id); if (collider.sensor) sensorHandles.add(created.handle);
    }
  }
  async function stepSimulation() {
    if (!simulation) return;
    if (activeSource?.onFrame) {
      try {
        await activeSource.onFrame(timestep, inputAdapter.sample());
        syncScriptObjects();
      } catch (error) {
        stop();
        host.dispatchEvent(new CustomEvent('playsimulationerror', { detail: error }));
        return;
      }
    }
    try { simulation.stepOnce(); }
    catch (error) { stop(); host.dispatchEvent(new CustomEvent('playsimulationerror', { detail: error })); }
  }
  function play(source?: PlaySceneSource) {
    stop();
    activeSource = source;
    inputAdapter.setActions(source?.inputActions ?? DEFAULT_INPUT_ACTIONS);
    uiProvider = source?.uiElements; uiCanvas = source?.uiCanvas; uiImageResolver = source?.resolveUiImage; uiButtonHandler = source?.onUiButtonClick;
    uiOverlay.setButtonHandler(entityId => uiButtonHandler?.(entityId));
    inputAdapter.setActive(Boolean(source?.onFrame));
    if (source?.onFrame) renderer.domElement.focus({ preventScroll: true });
    world = new RAPIER.World({ x: 0, y: -9.81 });
    world.timestep = timestep;
    eventQueue = new RAPIER.EventQueue(true);
    syncRuntimeObjects(structuredClone(source?.objects ?? objects));
    scheduler = new Scheduler(source?.world ?? new EcsWorld());
    scheduler.addSystem(context => { stepPhysics(source); host.dataset.simulationTick = String(context.tick); }, { order: 100, name: '2D Physics' });
    simulation = new FixedStepLoop(scheduler, { fixedDeltaTime: timestep, maxStepsPerFrame: 6, maxFrameDeltaTime: 0.1 });
    running = true;
    previous = performance.now();
    host.dataset.simulationTick = '0';
  }
  function syncScriptObjects() {
    const updates = activeSource?.syncObjects?.();
    if (!updates) return;
    syncRuntimeObjects(updates);
  }
  function updateCamera() {
    const active = activeSource?.camera?.() ?? cameraProvider?.();
    const width = surface.clientWidth, height = surface.clientHeight;
    if (!width || !height) return;
    const halfHeight = active ? active.visibleHeight / 2 : height * cameraSettings.worldUnitsPerPixel / 2;
    const halfWidth = halfHeight * (gameView.mode === 'Fit' ? gameView.width / gameView.height : width / height);
    camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.position.set(active?.x ?? cameraSettings.x, active?.y ?? cameraSettings.y, 10);
    camera.lookAt(camera.position.x, camera.position.y, 0); camera.updateProjectionMatrix();
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const rect = fitGameViewport(width, height, gameView);
    Object.assign(surface.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    renderer.setPixelRatio(gameView.mode === 'Fit' ? 1 : Math.min(devicePixelRatio, 2));
    renderer.setSize(gameView.mode === 'Fit' ? gameView.width : rect.width, gameView.mode === 'Fit' ? gameView.height : rect.height, false);
    updateCamera();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const raycaster = new THREE.Raycaster();
  function pick(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    ), camera);
    const hit = raycaster.intersectObjects([...meshes.values(), ...repeatedMeshes.values()].filter(mesh => mesh.visible)).sort((a, b) => b.object.renderOrder - a.object.renderOrder)[0];
    if (hit) {
      const id = hit.object.userData.id as string;
      select(id);
      activeSource?.onEntitySelected?.(id);
    }
  }
  renderer.domElement.addEventListener('pointerdown', pick);
  function updateParallax() {
    const wanted = new Set<string>();
    const ordered = [...meshes].sort(([a], [b]) => (visualObjects.get(a)?.order ?? 0) - (visualObjects.get(b)?.order ?? 0));
    ordered.forEach(([id, mesh], order) => {
      const object = visualObjects.get(id); if (!object) return;
      const rotation = object.rotation ?? 0, a = Math.cos(rotation), b = Math.sin(rotation);
      const transforms = parallaxTransforms({ a, b, c: -b, d: a, tx: object.x, ty: object.y }, object.width, object.height, object.parallax, { x: camera.position.x, y: camera.position.y, halfWidth: camera.right, halfHeight: camera.top });
      mesh.visible = transforms.length > 0; mesh.renderOrder = order;
      transforms.forEach((transform, index) => {
        let draw = mesh;
        if (index > 0) {
          const key = `${id}:${index}`; wanted.add(key);
          let repeat = repeatedMeshes.get(key);
          if (!repeat) { repeat = new THREE.Mesh(geometry, mesh.material); repeatedMeshes.set(key, repeat); scene.add(repeat); }
          repeat.material = mesh.material; repeat.scale.copy(mesh.scale); repeat.rotation.copy(mesh.rotation); repeat.renderOrder = order; repeat.userData.id = id;
          draw = repeat;
        }
        draw.position.set(transform.tx, transform.ty, 0);
      });
    });
    for (const [key, mesh] of repeatedMeshes) if (!wanted.has(key)) { scene.remove(mesh); repeatedMeshes.delete(key); }
  }
  function animate(now: number) {
    const elapsed = Math.max(0, (now - previous) / 1000);
    previous = now;
    if (running && simulation && !simulation.isPaused) {
      if (activeSource?.onFrame) {
        if (!pendingScriptFrame) {
          const stepDelta = Math.min(elapsed, 0.1);
          pendingScriptFrame = activeSource.onFrame(stepDelta, inputAdapter.sample()).then(() => {
            if (!running) return;
            syncScriptObjects();
            simulation?.advance(stepDelta);
          }).catch(error => {
            if (!running) return;
            stop();
            host.dispatchEvent(new CustomEvent('playsimulationerror', { detail: error }));
          }).finally(() => { pendingScriptFrame = undefined; });
        }
      } else {
        try { simulation.advance(elapsed); }
        catch (error) {
          stop();
          host.dispatchEvent(new CustomEvent('playsimulationerror', { detail: error }));
        }
      }
    }
    for (const object of objects) {
      const mesh = meshes.get(object.id);
      if (mesh) {
        mesh.material.color.set(object.color);
      }
    }
    updateCamera();
    updateParallax();
    renderer.render(scene, camera);
    uiOverlay.update(uiProvider?.() ?? [], uiCanvas?.() ?? defaultUiCanvas);
    frame = requestAnimationFrame(animate);
  }
  syncEdit();
  resize();
  frame = requestAnimationFrame(animate);
  return {
    play, stop,
    setGameView(settings: GameViewSettings) { gameView = validateGameView(settings); host.style.background = gameView.mode === 'Fit' ? '#000' : ''; resize(); },
    setCameraSource(provider: () => CameraView2D | undefined) { cameraProvider = provider; updateCamera(); },
    setCamera(settings: PreviewCameraSettings) { Object.assign(cameraSettings, settings); resize(); },
    setPaused(value: boolean) { if (!simulation) return; if (value) simulation.pause(); else { simulation.resume(); if (running) renderer.domElement.focus({ preventScroll: true }); } },
    step() { if (simulation?.isPaused) renderer.domElement.focus({ preventScroll: true }); void stepSimulation(); },
    getTick() { return scheduler?.tick ?? 0; },
    getDebugStats() {
      return {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        entityCount: activeSource?.objects.length ?? 0,
        tick: scheduler?.tick ?? 0,
        systems: scheduler?.getSystemTimings() ?? [],
      };
    },
    select(id: string) { selected = id; },
    update() { if (!running) syncRuntimeObjects(objects); },
    setUiPreview(provider: () => readonly UiOverlayItem[], canvas: () => UiCanvasSettings, resolveImage: (assetId: string) => Promise<string | undefined>) { uiProvider = provider; uiCanvas = canvas; uiImageResolver = resolveImage; },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); stop();
      renderer.domElement.removeEventListener('pointerdown', pick);
      inputAdapter.dispose();
      uiOverlay.dispose();
      for (const mesh of repeatedMeshes.values()) scene.remove(mesh); repeatedMeshes.clear();
      geometry.dispose();
      for (const mesh of meshes.values()) mesh.material.dispose();
      for (const loading of textureLoads.values()) void loading.then(texture => texture?.dispose());
      renderer.dispose(); surface.remove();
    },
  };
}
