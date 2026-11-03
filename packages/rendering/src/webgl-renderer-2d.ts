import * as THREE from 'three';
import { calculateOrthographicBounds } from './camera.ts';
import { applySpriteUvRegion } from './asset-texture-source.ts';
import type { AssetTextureSource } from './asset-texture-source.ts';
import { expandParallaxSprites } from './parallax.ts';
import { planSpriteBatches } from './sprite.ts';
import type { SpriteBatchPlan, SpriteRenderItem } from './sprite.ts';

export type AssetLoadStatus = 'pending' | 'loaded' | 'missing' | 'unknown' | 'unsupported' | 'failed';

export interface Renderer2DOptions {
  readonly clearColor?: string | number;
  readonly maxPixelRatio?: number;
  readonly observeResize?: boolean;
  readonly createRenderer?: (canvas: HTMLCanvasElement) => RendererBackend;
  readonly onContextStateChange?: (state: 'lost' | 'restored') => void;
}

export interface RendererBackend {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export interface RenderFrameStats {
  readonly spritesDrawn: number;
  readonly batches: number;
  readonly drawCalls: number;
  readonly pendingAssetIds: readonly string[];
  readonly missingAssetIds: readonly string[];
  readonly unknownAssetIds: readonly string[];
  readonly failedAssetIds: readonly string[];
  readonly contextLost: boolean;
}

interface BatchSlot {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

/** Three.js-backed WebGL 2 renderer for ordered, textured 2D sprites. */
export class WebGLRenderer2D {
  readonly camera: THREE.OrthographicCamera;
  readonly scene: THREE.Scene;

  private readonly backend: RendererBackend;
  private readonly canvas: HTMLCanvasElement;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly regionTextures = new Map<string, THREE.Texture>();
  private readonly loadStatuses = new Map<string, AssetLoadStatus>();
  private readonly loadErrors = new Map<string, string>();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private readonly slots: BatchSlot[] = [];
  private readonly resizeObserver?: ResizeObserver;
  private readonly maxPixelRatio: number;
  private readonly clearColor: string | number;
  private readonly onContextStateChange?: (state: 'lost' | 'restored') => void;
  private readonly assetSource: AssetTextureSource;
  private parallaxCamera?: { readonly x: number; readonly y: number };
  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;
  private contextLost = false;
  private disposed = false;
  private latestItems: readonly SpriteRenderItem[] = [];

  constructor(canvas: HTMLCanvasElement, assetSource: AssetTextureSource, options: Renderer2DOptions = {}) {
    this.canvas = canvas;
    this.assetSource = assetSource;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    if (!Number.isFinite(this.maxPixelRatio) || this.maxPixelRatio <= 0) {
      throw new RangeError('maxPixelRatio must be a finite positive number.');
    }
    this.clearColor = options.clearColor ?? '#20232c';
    this.onContextStateChange = options.onContextStateChange;
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1000);
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.clearColor);
    this.backend = options.createRenderer
      ? options.createRenderer(canvas)
      : new THREE.WebGLRenderer({ canvas, antialias: true }) as RendererBackend;

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    if (options.observeResize !== false && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeToDisplaySize());
      this.resizeObserver.observe(canvas);
    }
    this.resizeToDisplaySize();
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  getAssetLoadStatus(assetId: string): AssetLoadStatus | undefined {
    return this.loadStatuses.get(assetId);
  }

  getAssetLoadError(assetId: string): string | undefined {
    return this.loadErrors.get(assetId);
  }

  async preloadAsset(assetId: string): Promise<void> {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    if (this.textures.has(assetId)) return;
    const existing = this.loadPromises.get(assetId);
    if (existing) return existing;

    this.loadStatuses.set(assetId, 'pending');
    this.loadErrors.delete(assetId);
    const loading = this.assetSource.loadTexture(assetId).then(result => {
      if (this.disposed) {
        if (result.status === 'available') result.texture.dispose();
        return;
      }
      if (result.status === 'available') {
        this.textures.set(assetId, result.texture);
        this.loadStatuses.set(assetId, 'loaded');
      } else {
        this.loadStatuses.set(assetId, result.status);
      }
    }).catch(error => {
      this.loadStatuses.set(assetId, 'failed');
      this.loadErrors.set(assetId, error instanceof Error ? error.message : String(error));
    }).finally(() => {
      this.loadPromises.delete(assetId);
    });
    this.loadPromises.set(assetId, loading);
    return loading;
  }

  /** Editor navigation can inspect a composition evaluated at another camera. */
  setParallaxCamera(position?: { readonly x: number; readonly y: number }): void {
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) throw new RangeError('Parallax camera position must be finite.');
    this.parallaxCamera = position ? { ...position } : undefined;
  }

  setCamera(position: { readonly x: number; readonly y: number; readonly zoom: number }): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new RangeError('Camera position must be finite.');
    }
    if (!Number.isFinite(position.zoom) || position.zoom <= 0) throw new RangeError('Camera zoom must be positive and finite.');
    this.cameraX = position.x;
    this.cameraY = position.y;
    this.zoom = position.zoom;
    this.camera.position.set(this.cameraX, this.cameraY, 100);
    this.updateCameraBounds();
  }

  /** Resize by CSS-pixel dimensions; drawing-buffer resolution is capped by pixelRatio. */
  resize(width: number, height: number, pixelRatio = currentPixelRatio(), updateStyle = false): void {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('pixelRatio must be a finite positive number.');
    this.backend.setPixelRatio(Math.min(pixelRatio, this.maxPixelRatio));
    this.backend.setSize(width, height, updateStyle);
    this.updateCameraBounds(width, height);
  }

  resizeToDisplaySize(): void {
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  render(items: readonly SpriteRenderItem[]): RenderFrameStats {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    this.latestItems = items.slice();
    const assetIds = new Set(items.map(item => item.assetId));
    for (const assetId of assetIds) {
      if (!this.loadStatuses.has(assetId)) void this.preloadAsset(assetId);
    }

    const pendingAssetIds = [...assetIds].filter(id => this.loadStatuses.get(id) === 'pending');
    const missingAssetIds = [...assetIds].filter(id => this.loadStatuses.get(id) === 'missing');
    const unknownAssetIds = [...assetIds].filter(id => this.loadStatuses.get(id) === 'unknown');
    const failedAssetIds = [...assetIds].filter(id => {
      const status = this.loadStatuses.get(id);
      return status === 'failed' || status === 'unsupported';
    });

    if (this.contextLost) {
      return { spritesDrawn: 0, batches: 0, drawCalls: 0, pendingAssetIds, missingAssetIds, unknownAssetIds, failedAssetIds, contextLost: true };
    }

    const visibleItems = expandParallaxSprites(items, { x: this.cameraX, y: this.cameraY, halfWidth: this.camera.right, halfHeight: this.camera.top, parallaxCamera: this.parallaxCamera });
    const plans = planSpriteBatches(visibleItems).filter(plan => this.textures.has(plan.assetId));
    this.updateBatches(plans);
    this.backend.render(this.scene, this.camera);
    const spritesDrawn = plans.reduce((count, plan) => count + plan.items.length, 0);
    return {
      spritesDrawn,
      batches: plans.length,
      drawCalls: plans.length,
      pendingAssetIds,
      missingAssetIds,
      unknownAssetIds,
      failedAssetIds,
      contextLost: false,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.mesh.dispose();
    }
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    for (const texture of this.regionTextures.values()) texture.dispose();
    this.geometry.dispose();
    this.backend.dispose();
    this.textures.clear();
    this.regionTextures.clear();
    this.materials.clear();
    this.slots.length = 0;
  }

  private updateBatches(plans: readonly SpriteBatchPlan[]): void {
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index]!;
      let slot = this.slots[index];
      if (!slot || slot.capacity < plan.items.length) {
        if (slot) {
          this.scene.remove(slot.mesh);
          slot.mesh.dispose();
        }
        const capacity = Math.max(1, plan.items.length);
        const mesh = new THREE.InstancedMesh(this.geometry, this.materialFor(plan), capacity);
        mesh.frustumCulled = false;
        slot = { mesh, capacity };
        this.slots[index] = slot;
        this.scene.add(mesh);
      }
      slot.mesh.material = this.materialFor(plan);
      slot.mesh.count = plan.items.length;
      slot.mesh.renderOrder = index;
      slot.mesh.visible = true;
      for (let instanceIndex = 0; instanceIndex < plan.items.length; instanceIndex++) {
        const item = plan.items[instanceIndex]!;
        const matrix = new THREE.Matrix4().set(
          item.transform.a * item.width, item.transform.c * item.height, 0, item.transform.tx,
          item.transform.b * item.width, item.transform.d * item.height, 0, item.transform.ty,
          0, 0, 1, 0,
          0, 0, 0, 1,
        );
        slot.mesh.setMatrixAt(instanceIndex, matrix);
        slot.mesh.setColorAt(instanceIndex, new THREE.Color(item.tint));
      }
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
    }
    for (let index = plans.length; index < this.slots.length; index++) {
      this.slots[index]!.mesh.count = 0;
      this.slots[index]!.mesh.visible = false;
    }
  }

  private materialFor(plan: SpriteBatchPlan): THREE.MeshBasicMaterial {
    const assetId = plan.assetId;
    const region = plan.uvRegion;
    const key = `${assetId}|${region ? `${region.x},${region.y},${region.width},${region.height}` : 'full'}`;
    let material = this.materials.get(key);
    if (!material) {
      let map = this.textures.get(assetId);
      if (region && map) {
        map = this.regionTextures.get(key);
        if (!map) {
          map = this.textures.get(assetId)!.clone();
          applySpriteUvRegion(map, region);
          this.regionTextures.set(key, map);
        }
      }
      material = new THREE.MeshBasicMaterial({
        map,
        color: 0xffffff,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private updateCameraBounds(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    if (width <= 0 || height <= 0) return;
    const bounds = calculateOrthographicBounds(width, height, this.zoom);
    this.camera.left = bounds.left;
    this.camera.right = bounds.right;
    this.camera.top = bounds.top;
    this.camera.bottom = bounds.bottom;
    this.camera.updateProjectionMatrix();
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextStateChange?.('lost');
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    for (const texture of this.textures.values()) texture.needsUpdate = true;
    for (const texture of this.regionTextures.values()) texture.needsUpdate = true;
    this.onContextStateChange?.('restored');
    this.render(this.latestItems);
  };
}

function currentPixelRatio(): number {
  return typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
}
