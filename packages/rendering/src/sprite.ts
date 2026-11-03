import type { Parallax2DData } from './parallax.ts';
import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import type { AssetReference } from '@ecs/scene';
import type { SpriteRegionReference } from '@ecs/assets';
import type { AffineTransform2D } from '@ecs/scene';

export interface SpriteRenderer2DData {
  readonly asset: AssetReference | null;
  readonly region: SpriteRegionReference | null;
  readonly width: number;
  readonly height: number;
  /** Ascending render layer/order. Equal values preserve scene entity order. */
  readonly order: number;
  /** CSS color accepted by Three.js, for example #ffffff. */
  readonly tint: string;
}

export const SpriteRenderer2D = defineComponent<SpriteRenderer2DData>('SpriteRenderer2D');

export const spriteRenderer2DSchema = defineComponentSchema({
  typeId: 'engine.spriteRenderer2d',
  displayName: 'Sprite Renderer 2D',
  version: 2,
  component: SpriteRenderer2D,
  migrations: { 1: data => ({ ...(data as Record<string, unknown>), region: null }) },
  fields: {
    asset: { type: 'asset', label: 'Texture', default: null },
    region: { type: 'sprite-region', label: 'Atlas Region', default: null },
    width: { type: 'number', label: 'Width', default: 1 },
    height: { type: 'number', label: 'Height', default: 1 },
    order: { type: 'number', label: 'Sorting Order', default: 0 },
    tint: { type: 'color', label: 'Tint', default: '#ffffff' },
  },
});

export interface SpriteRenderItem {
  readonly entityId: string;
  readonly parallax?: Parallax2DData;
  readonly assetId: string;
  readonly region?: SpriteRegionReference;
  readonly uvRegion?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly transform: AffineTransform2D;
  readonly width: number;
  readonly height: number;
  readonly order: number;
  readonly tint: string;
}

export interface SpriteBatchPlan {
  readonly assetId: string;
  readonly uvRegion?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly items: readonly SpriteRenderItem[];
}

/** Stable back-to-front order, grouped only across contiguous sprites sharing a texture. */
export function planSpriteBatches(items: readonly SpriteRenderItem[]): readonly SpriteBatchPlan[] {
  const sorted = items
    .map((item, insertionIndex) => ({ item, insertionIndex }))
    .sort((a, b) => a.item.order - b.item.order || a.insertionIndex - b.insertionIndex);
  const batches: Array<{ assetId: string; uvRegion?: SpriteRenderItem['uvRegion']; items: SpriteRenderItem[] }> = [];
  for (const { item } of sorted) {
    let lastBatch = batches[batches.length - 1];
    const regionKey = (region: SpriteRenderItem['uvRegion']) => region ? `${region.x},${region.y},${region.width},${region.height}` : 'full';
    if (!lastBatch || lastBatch.assetId !== item.assetId || regionKey(lastBatch.uvRegion) !== regionKey(item.uvRegion)) {
      lastBatch = { assetId: item.assetId, ...(item.uvRegion ? { uvRegion: item.uvRegion } : {}), items: [] };
      batches.push(lastBatch);
    }
    lastBatch.items.push(item);
  }
  return batches;
}
