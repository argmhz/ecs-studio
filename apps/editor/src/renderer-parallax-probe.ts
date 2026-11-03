import { AssetDatabase, MemoryAssetStore } from '@ecs/assets';
import { applySpriteUvRegion, createAssetTextureSource, WebGLRenderer2D, type Parallax2DData } from '@ecs/rendering';
import { createScene } from '@ecs/browser-preview';

/** Browser-only regression probe comparing Scene and the real Game renderer. */
export async function probeParallax(bytes: number[], factor: number) {
  const assets = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:parallax-probe');
  const asset = await assets.importAsset({ path: 'probe.png', data: Uint8Array.from(bytes), mimeType: 'image/png' });
  const source = createAssetTextureSource(assets);
  const host = document.createElement('div'); host.style.cssText = 'width:320px;height:240px'; document.body.append(host);
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:320px;height:240px'; document.body.append(canvas);
  const data: Parallax2DData = { factorX: factor, factorY: factor, repeatX: true, repeatY: true, originX: 5, originY: 10 };
  const object = { id: 'background', name: 'Background', x: 0, y: 0, width: 80, height: 80, color: '#ffffff', dynamic: false, assetId: asset.assetId, parallax: data, region: { atlasId: 'test', regionId: 'left-half' } };
  const gameTexture = await source.loadTexture(asset.assetId);
  if (gameTexture.status !== 'available') throw new Error('Probe texture did not load.');
  applySpriteUvRegion(gameTexture.texture, { x: 0, y: 0, width: .5, height: 1 });
  const preview = await createScene(host, [object], () => {}, async () => gameTexture.texture, { x: 0, y: 0, worldUnitsPerPixel: 1 });
  const scene = new WebGLRenderer2D(canvas, source, { maxPixelRatio: 1, observeResize: false });
  const sample = (target: HTMLCanvasElement) => {
    const gl = target.getContext('webgl2')!; const pixels: number[][] = [];
    for (const y of [20, 120, 220]) for (let x = 15; x < 320; x += 20) {
      const rgba = new Uint8Array(4); gl.readPixels(Math.floor(x * target.width / 320), Math.floor(y * target.height / 240), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); pixels.push([...rgba]);
    }
    return pixels;
  };
  try {
    await scene.preloadAsset(asset.assetId);
    const frames: { scene: number[][]; game: number[][]; copies: number }[] = [];
    for (const [x, y] of [[0, 0], [20, 0], [10020, 10000], [-9980, -10000]]) {
      preview.setCamera({ x: x!, y: y!, worldUnitsPerPixel: 1 });
      scene.setCamera({ x: x!, y: y!, zoom: 1 });
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const stats = scene.render([{ entityId: object.id, assetId: asset.assetId, transform: { a: 1, b: 0, c: 0, d: 1, tx: object.x, ty: object.y }, width: object.width, height: object.height, tint: object.color, order: 0, parallax: data, uvRegion: { x: 0, y: 0, width: .5, height: 1 } }]);
      frames.push({ scene: sample(canvas), game: sample(host.querySelector('canvas')!), copies: stats.spritesDrawn });
    }
    return { frames, original: object };
  } finally { preview.dispose(); scene.dispose(); host.remove(); canvas.remove(); }
}

export async function probeEditorParallaxZoom(bytes: number[], factor: number) {
  const assets = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:zoom-probe');
  const asset = await assets.importAsset({ path: 'probe.png', data: Uint8Array.from(bytes), mimeType: 'image/png' });
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:320px;height:240px'; document.body.append(canvas);
  const renderer = new WebGLRenderer2D(canvas, createAssetTextureSource(assets), { maxPixelRatio: 1, observeResize: false });
  renderer.setParallaxCamera({ x: 0, y: 0 });
  const parallax = { factorX: factor, factorY: factor, repeatX: true, repeatY: true, originX: 5, originY: 10 };
  const base = { assetId: asset.assetId, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, tint: '#ffffff', order: 0 };
  const camera = { x: 0, y: 0, zoom: 1 };
  const frames: number[][][] = [];
  try {
    await renderer.preloadAsset(asset.assetId);
    for (const zoom of [1, .7, .3, 1.4, 1]) {
      camera.x += -80 * (1 / camera.zoom - 1 / zoom);
      camera.y += -45 * (1 / zoom - 1 / camera.zoom);
      camera.zoom = zoom; renderer.setCamera(camera);
      renderer.render([
        { ...base, entityId: 'background', width: 80, height: 80, parallax, uvRegion: { x: 0, y: 0, width: .5, height: 1 } },
        { ...base, entityId: 'foreground', order: 1, transform: { ...base.transform, tx: 20, ty: 20 }, width: 10, height: 10, uvRegion: { x: .5, y: 0, width: .5, height: 1 } },
      ]);
      const gl = canvas.getContext('webgl2')!;
      frames.push([[-20, 0], [10, 0], [25, 0], [20, 20]].map(([x, y]) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(160 + (x! - camera.x) * zoom), Math.floor(120 + (y! - camera.y) * zoom), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      }));
    }
    return frames;
  } finally { renderer.dispose(); canvas.remove(); }
}
