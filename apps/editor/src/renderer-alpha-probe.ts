import { AssetDatabase, MemoryAssetStore } from '@ecs/assets';
import { applySpriteUvRegion, createAssetTextureSource, WebGLRenderer2D } from '@ecs/rendering';

/** Pixel probe for the browser renderer tests; not included in the editor build. */
export async function probeSpriteAlpha(bytes: number[], uvRegion?: { x: number; y: number; width: number; height: number }) {
  const assets = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:alpha-probe');
  const asset = await assets.importAsset({ path: 'probe.png', data: Uint8Array.from(bytes), mimeType: 'image/png' });
  const canvas = document.createElement('canvas'); canvas.style.width = '320px'; canvas.style.height = '240px';
  document.body.append(canvas);
  const renderer = new WebGLRenderer2D(canvas, createAssetTextureSource(assets), { clearColor: '#20232c', maxPixelRatio: 1, observeResize: false });
  try {
    await renderer.preloadAsset(asset.assetId);
    renderer.render([{ entityId: 'probe', assetId: asset.assetId, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, width: 128, height: 128, order: 0, tint: '#ffffff', ...(uvRegion ? { uvRegion } : {}) }]);
    const gl = canvas.getContext('webgl2')!;
    const pixels: number[][] = [];
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      const pixel = new Uint8Array(4);
      gl.readPixels(112 + column * 32, 168 - row * 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      pixels.push([...pixel]);
    }
    return pixels;
  } finally { renderer.dispose(); canvas.remove(); }
}

/** Exercise the actual Game/standalone adapter with animation and overlapping entities. */
export async function probeGameAlpha(bytes: number[]) {
  const { createScene } = await import('@ecs/browser-preview');
  const { World } = await import('@ecs/core');
  const assets = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:game-alpha');
  const asset = await assets.importAsset({ path: 'probe.png', data: Uint8Array.from(bytes), mimeType: 'image/png' });
  const source = createAssetTextureSource(assets);
  const host = document.createElement('div'); host.style.cssText = 'width:320px;height:240px'; document.body.append(host);
  const frameA = { atlasId: 'test', regionId: 'a' }; const frameB = { atlasId: 'test', regionId: 'b' };
  const common = { x: 0, y: 0, color: '#ffffff', dynamic: false };
  const objects = [
    { ...common, id: 'backdrop', name: 'Backdrop', width: 180, height: 160, color: '#ff0000', order: -1 },
    { ...common, id: 'animated', name: 'Animated', width: 128, height: 128, assetId: asset.assetId, region: frameA },
    { ...common, id: 'other', name: 'Other', x: 100, width: 16, height: 32, color: '#0000ff' },
  ];
  const scene = await createScene(host, objects, () => {}, async (assetId, region) => {
    // Model a frame whose texture is not ready when the animation changes.
    await new Promise(resolve => setTimeout(resolve, 40));
    const result = await source.loadTexture(assetId); if (result.status !== 'available') return null;
    applySpriteUvRegion(result.texture, { x: region?.regionId === 'b' ? .5 : 0, y: 0, width: .5, height: 1 });
    return result.texture;
  }, { x: 0, y: 0, worldUnitsPerPixel: 1 });
  let frame = 0;
  try {
    scene.play({ objects, world: new World(), onFrame: async () => { frame++; }, syncObjects: () => objects.map(object => object.id === 'animated' ? { ...object, region: Math.floor(frame / 15) % 2 ? frameB : frameA } : object) });
    const canvas = host.querySelector('canvas')!; const gl = canvas.getContext('webgl2')!;
    const sample = (x: number, y: number) => {
      const pixel = new Uint8Array(4); gl.readPixels(Math.round(x * canvas.width / 320), Math.round(y * canvas.height / 240), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel];
    };
    const frames: number[][][] = [];
    for (let index = 0; index < 50; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (index >= 10) frames.push([sample(112, 120), sample(192, 120), sample(260, 120), sample(80, 120)]);
    }
    return frames;
  } finally { scene.dispose(); host.remove(); }
}
