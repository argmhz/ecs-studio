import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createAssetTextureSource, applySpriteUvRegion } from '../src/asset-texture-source.ts';
import type { AssetDatabase } from '@ecs/assets';

test('asset bitmaps decode with vertical orientation and straight alpha for Three.js textures', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const bitmap = { close() {} } as ImageBitmap;
  let decodeOptions: ImageBitmapOptions | undefined;
  globalThis.createImageBitmap = (async (_image, options) => { decodeOptions = options as ImageBitmapOptions | undefined; return bitmap; }) as typeof createImageBitmap;
  try {
    const assets = {
      resolveAsset: async () => ({
        status: 'available' as const,
        data: new Uint8Array([1, 2, 3]),
        record: { assetId: 'asset:test', path: 'Textures/test.png', name: 'test.png', kind: 'image' as const, mimeType: 'image/png', size: 3, revision: 1 },
      }),
    } as unknown as AssetDatabase;
    const loaded = await createAssetTextureSource(assets).loadTexture('asset:test');
    assert.equal(loaded.status, 'available');
    assert.deepEqual(decodeOptions, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    if (loaded.status === 'available') {
      assert.equal(loaded.texture.image, bitmap);
      loaded.texture.dispose();
    }
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('atlas texture sampling excludes neighbor texels and whole-sheet mipmaps, including single-pixel regions', () => {
  const texture = new THREE.Texture({ width: 64, height: 32 } as HTMLImageElement);
  applySpriteUvRegion(texture, { x: .25, y: .5, width: .25, height: .25 });
  assert.deepEqual(texture.offset.toArray(), [16.5 / 64, 16.5 / 32]);
  assert.deepEqual(texture.repeat.toArray(), [15 / 64, 7 / 32]);
  assert.equal(texture.generateMipmaps, false); assert.equal(texture.minFilter, THREE.LinearFilter);
  applySpriteUvRegion(texture, { x: 0, y: 0, width: 1 / 64, height: 1 / 32 });
  assert.deepEqual(texture.repeat.toArray(), [0, 0]); assert.deepEqual(texture.offset.toArray(), [.5 / 64, .5 / 32]);
});
