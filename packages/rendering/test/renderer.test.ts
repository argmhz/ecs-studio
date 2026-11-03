import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '@ecs/core';
import { registerBuiltInSceneSchemas, SceneHierarchy, SchemaRegistry, Transform2D } from '@ecs/scene';
import * as THREE from 'three';
import {
  calculateOrthographicBounds,
  collectSpriteRenderItems,
  planSpriteBatches,
  SpriteRenderer2D,
  spriteRenderer2DSchema,
  WebGLRenderer2D,
  createTilemap,
  fillTile,
  paintTile,
  parseTilemap,
  tileNeighborMask,
  SpriteAnimation2D,
  createSpriteAnimation,
  spriteAnimation2DSchema,
  sampleAnimationTrack,
  updateSpriteAnimations,
} from '../src/index.ts';
import type { AssetTextureSource, RendererBackend, SpriteRenderItem } from '../src/index.ts';

function item(entityId: string, assetId: string, order: number): SpriteRenderItem {
  return {
    entityId,
    assetId,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    width: 1,
    height: 1,
    order,
    tint: '#ffffff',
  };
}

test('orthographic camera bounds track viewport aspect and zoom', () => {
  assert.deepEqual(calculateOrthographicBounds(800, 400, 2), {
    left: -200, right: 200, top: 100, bottom: -100,
  });
  assert.throws(() => calculateOrthographicBounds(0, 400, 1), /positive/);
  assert.throws(() => calculateOrthographicBounds(400, 400, 0), /zoom/);
});

test('sprite planner sorts stably and batches contiguous shared textures only', () => {
  const batches = planSpriteBatches([
    item('high', 'texture:a', 2),
    item('first', 'texture:a', 0),
    item('middle', 'texture:b', 1),
    item('last', 'texture:a', 3),
  ]);
  assert.deepEqual(batches.map(batch => batch.items.map(sprite => sprite.entityId)), [
    ['first'], ['middle'], ['high', 'last'],
  ]);
  assert.equal(planSpriteBatches([item('a', 'same', 0), item('b', 'same', 1)]).length, 1);
});

test('tilemap brush and fill preserve disconnected regions and serialize layer cells', () => {
  const initial = createTilemap(4, 3);
  const painted = paintTile(initial, 'layer:ground', 0, 0, 'grass');
  const divided = paintTile(painted, 'layer:ground', 1, 0, 'stone');
  const filled = fillTile(divided, 'layer:ground', 2, 0, 'water');
  assert.deepEqual(parseTilemap(filled).layers[0]!.cells, ['grass', 'stone', 'water', 'water', 'water', 'water', 'water', 'water', 'water', 'water', 'water', 'water']);
});

test('tilemap computes four-way neighbor masks for explicit auto-tile variants', () => {
  let map = createTilemap(3, 3);
  map = paintTile(map, 'layer:ground', 1, 1, 'grass');
  map = paintTile(map, 'layer:ground', 1, 0, 'grass');
  const layer = parseTilemap(map).layers[0]!;
  assert.equal(tileNeighborMask(layer, 3, 3, 1, 1, id => id === 'grass' ? 'ground' : undefined), 1);
});

test('animation tracks interpolate, loop sprite frames, and override script writes consistently', () => {
  const world = new World(); const entity = world.createEntity(); const entities = new Map([['animated', entity]]);
  world.addComponent(entity, SpriteRenderer2D, { asset: { assetId: 'asset:old' }, region: null, width: 1, height: 1, order: 0, tint: '#ffffff' });
  world.addComponent(entity, Transform2D, { x: 99, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  const player = createSpriteAnimation(); const frameRegion = { atlasId: 'atlas:main', regionId: 'region:hero' }; const clip = { id: 'walk', name: 'Walk', duration: 1, loop: true, frames: [{ assetId: 'asset:a', region: frameRegion, duration: 0.25 }, { assetId: 'asset:b', duration: 0.25 }], tracks: [{ componentTypeId: 'engine.transform2d', field: 'x', keys: [{ time: 0, value: 0 }, { time: 1, value: 10 }] }] };
  world.addComponent(entity, SpriteAnimation2D, { ...player, clipsJson: JSON.stringify([clip]), clipId: 'walk' });
  const schemas = new SchemaRegistry(); registerBuiltInSceneSchemas(schemas); schemas.register(spriteRenderer2DSchema); schemas.register(spriteAnimation2DSchema);
  const state = new Map<string, { clipId: string; time: number }>();
  updateSpriteAnimations(world, entities, schemas.all(), 0.3, state);
  assert.ok(Math.abs(world.getComponent(entity, Transform2D)!.x - 3) < 1e-9);
  assert.deepEqual(world.getComponent(entity, SpriteRenderer2D)!.asset, { assetId: 'asset:b' });
  updateSpriteAnimations(world, entities, schemas.all(), 0.9, state);
  assert.ok(Math.abs(world.getComponent(entity, Transform2D)!.x - 2) < 1e-9);
  assert.deepEqual(world.getComponent(entity, SpriteRenderer2D)!.asset, { assetId: 'asset:a' });
  assert.deepEqual(world.getComponent(entity, SpriteRenderer2D)!.region, frameRegion);
  assert.equal(sampleAnimationTrack(clip.tracks[0]!, 1), 10);
});

test('Sprite Renderer schema migrates legacy components to full-image rendering', () => {
  const migrated = spriteRenderer2DSchema.migrations.get(1)!({ asset: { assetId: 'asset:old' }, width: 1, height: 1, order: 0, tint: '#ffffff' }) as { region: unknown };
  assert.equal(migrated.region, null);
  assert.deepEqual(spriteRenderer2DSchema.validate({ asset: { assetId: 'asset:old' }, ...migrated, width: 1, height: 1, order: 0, tint: '#ffffff' }), []);
});

test('scene components collect into render items using resolved global transforms', () => {
  const world = new World();
  const entity = world.createEntity();
  const entities = new Map([['sprite', entity]]);
  world.addComponent(entity, SpriteRenderer2D, {
    asset: { assetId: 'asset:pixel' }, region: null, width: 2, height: 3, order: 4, tint: '#ccaa88',
  });
  const registry = new SchemaRegistry();
  registerBuiltInSceneSchemas(registry);
  registry.register(spriteRenderer2DSchema);
  const hierarchy = new SceneHierarchy(world, entities);

  assert.deepEqual(collectSpriteRenderItems(world, entities, hierarchy), [{
    entityId: 'sprite',
    assetId: 'asset:pixel',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    width: 2,
    height: 3,
    order: 4,
    tint: '#ccaa88',
  }]);
});

test('atlas region references resolve to normalized UVs and keep atlas regions in separate batches', () => {
  const world = new World(); const entity = world.createEntity(); const entities = new Map([['hero', entity]]);
  world.addComponent(entity, SpriteRenderer2D, { asset: { assetId: 'sheet' }, region: { atlasId: 'atlas:main', regionId: 'region:hero' }, width: 1, height: 1, order: 0, tint: '#ffffff' });
  world.addComponent(entity, Transform2D, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  const hierarchy = new SceneHierarchy(world, entities);
  const atlas = { id: 'atlas:main', name: 'Main', assetId: 'sheet', width: 64, height: 32, regions: [{ id: 'region:hero', name: 'Hero', x: 16, y: 8, width: 16, height: 8, pivotX: .5, pivotY: .5 }] };
  const [item] = collectSpriteRenderItems(world, entities, hierarchy, [atlas]);
  assert.deepEqual(item?.uvRegion, { x: .25, y: .5, width: .25, height: .25 });
  const otherRegion: SpriteRenderItem = { ...item!, entityId: 'other', uvRegion: { x: 0, y: 0, width: .25, height: .25 } };
  assert.equal(planSpriteBatches([item!, otherRegion]).length, 2);
});

test('renderer resizes its drawing buffer and batches sprites sharing a texture', async () => {
  const canvas = fakeCanvas();
  const backend = new FakeBackend();
  const texture = new THREE.Texture();
  const renderer = new WebGLRenderer2D(canvas, sourceWith({ pixel: texture }), {
    observeResize: false,
    maxPixelRatio: 2,
    createRenderer: () => backend,
  });
  renderer.resize(800, 400, 3);
  await renderer.preloadAsset('pixel');
  const result = renderer.render([item('one', 'pixel', 0), item('two', 'pixel', 1)]);

  assert.equal(backend.pixelRatio, 2);
  assert.deepEqual(backend.size, [800, 400, false]);
  assert.equal(renderer.camera.left, -400);
  assert.equal(renderer.camera.top, 200);
  assert.equal(result.spritesDrawn, 2);
  assert.equal(result.batches, 1);
  assert.equal(result.drawCalls, 1);
  assert.equal(backend.renderCount, 1);
  renderer.dispose();
  assert.equal(backend.disposed, true);
});

test('renderer applies atlas UV transforms on a per-region texture clone', async () => {
  const texture = new THREE.Texture(); const renderer = new WebGLRenderer2D(fakeCanvas(), sourceWith({ sheet: texture }), { observeResize: false, createRenderer: () => new FakeBackend() });
  await renderer.preloadAsset('sheet');
  renderer.render([{ ...item('hero', 'sheet', 0), uvRegion: { x: .25, y: .5, width: .25, height: .25 } }]);
  const mesh = renderer.scene.children[0] as THREE.InstancedMesh; const map = (mesh.material as THREE.MeshBasicMaterial).map!;
  assert.deepEqual(map.repeat.toArray(), [.25, .25]); assert.deepEqual(map.offset.toArray(), [.25, .5]); assert.notEqual(map, texture);
  renderer.dispose();
});

test('lost WebGL context pauses draws and restoring redraws the latest scene', async () => {
  const canvas = fakeCanvas();
  const backend = new FakeBackend();
  const texture = new THREE.Texture();
  const stateChanges: string[] = [];
  const renderer = new WebGLRenderer2D(canvas, sourceWith({ pixel: texture }), {
    observeResize: false,
    createRenderer: () => backend,
    onContextStateChange: state => stateChanges.push(state),
  });
  await renderer.preloadAsset('pixel');
  renderer.render([item('sprite', 'pixel', 0)]);

  const lostEvent = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lostEvent);
  const whileLost = renderer.render([item('sprite', 'pixel', 0)]);
  assert.equal(lostEvent.defaultPrevented, true);
  assert.equal(whileLost.contextLost, true);
  assert.equal(backend.renderCount, 1);

  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(renderer.isContextLost, false);
  assert.equal(backend.renderCount, 2);
  assert.deepEqual(stateChanges, ['lost', 'restored']);
  renderer.dispose();
});

test('missing and unknown texture references are reported to the caller', async () => {
  const renderer = new WebGLRenderer2D(fakeCanvas(), {
    async loadTexture(assetId) {
      return { status: assetId === 'missing' ? 'missing' : 'unknown' };
    },
  }, { observeResize: false, createRenderer: () => new FakeBackend() });
  await renderer.preloadAsset('missing');
  await renderer.preloadAsset('unknown');
  const result = renderer.render([item('m', 'missing', 0), item('u', 'unknown', 1)]);
  assert.deepEqual(result.missingAssetIds, ['missing']);
  assert.deepEqual(result.unknownAssetIds, ['unknown']);
  assert.equal(result.spritesDrawn, 0);
  renderer.dispose();
});

function sourceWith(textures: Record<string, THREE.Texture>): AssetTextureSource {
  return {
    async loadTexture(assetId) {
      const texture = textures[assetId];
      return texture ? { status: 'available', texture } : { status: 'unknown' };
    },
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return Object.assign(new EventTarget(), { clientWidth: 320, clientHeight: 200 }) as HTMLCanvasElement;
}

class FakeBackend implements RendererBackend {
  pixelRatio = 1;
  size: [number, number, boolean | undefined] = [0, 0, undefined];
  renderCount = 0;
  disposed = false;

  setPixelRatio(value: number): void {
    this.pixelRatio = value;
  }

  setSize(width: number, height: number, updateStyle?: boolean): void {
    this.size = [width, height, updateStyle];
  }

  render(): void {
    this.renderCount++;
  }

  dispose(): void {
    this.disposed = true;
  }
}
