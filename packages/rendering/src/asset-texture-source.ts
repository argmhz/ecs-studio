import * as THREE from 'three';
import type { AssetDatabase } from '@ecs/assets';

export type TextureLoadResult =
  | { readonly status: 'available'; readonly texture: THREE.Texture }
  | { readonly status: 'missing' | 'unknown' | 'unsupported' };

export interface AssetTextureSource {
  loadTexture(assetId: string): Promise<TextureLoadResult>;
}

/** Browser adapter that decodes imported image bytes into renderer-owned textures. */
export function createAssetTextureSource(assets: AssetDatabase): AssetTextureSource {
  return {
    async loadTexture(assetId) {
      const result = await assets.resolveAsset(assetId);
      if (result.status !== 'available') return { status: result.status };
      if (result.record.kind !== 'image') return { status: 'unsupported' };
      if (typeof createImageBitmap !== 'function') throw new Error('ImageBitmap decoding is not available in this browser.');
      const blob = new Blob([result.data.slice().buffer], { type: result.record.mimeType });
      // Three.js cannot apply Texture.flipY to ImageBitmap sources, so orient
      // the pixels during decoding. This keeps WebGL sprites and tilemaps
      // consistent with regular top-left-origin image assets.
      // Materials use straight-alpha blending. ImageBitmap's default may
      // premultiply colors, and Three.js cannot undo it during texture upload.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      texture.addEventListener('dispose', () => bitmap.close());
      return { status: 'available', texture };
    },
  };
}

/** Restrict linear sampling to texel centers inside an atlas region. */
export function applySpriteUvRegion(texture: THREE.Texture, region: { x: number; y: number; width: number; height: number }): void {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const insetX = image?.width && Number.isFinite(image.width) ? Math.min(.5 / image.width, region.width / 2) : 0;
  const insetY = image?.height && Number.isFinite(image.height) ? Math.min(.5 / image.height, region.height / 2) : 0;
  texture.repeat.set(Math.max(0, region.width - 2 * insetX), Math.max(0, region.height - 2 * insetY));
  texture.offset.set(region.x + insetX, region.y + insetY);
  // Whole-sheet mipmaps mix unrelated neighboring regions before UV clipping.
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
}
