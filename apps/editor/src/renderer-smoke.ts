import { AssetDatabase, MemoryAssetStore } from '@ecs/assets';
import { createAssetTextureSource, WebGLRenderer2D } from '@ecs/rendering';

const canvas = document.querySelector<HTMLCanvasElement>('#renderer');
const output = document.querySelector<HTMLOutputElement>('#render-status');
if (!canvas || !output) throw new Error('Renderer smoke page is missing its canvas or status output.');

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const data = Uint8Array.from(atob(onePixelPng), character => character.charCodeAt(0));
const store = new MemoryAssetStore();
const assets = await AssetDatabase.open(store, () => 'asset:smoke-pixel');
const pixel = await assets.importAsset({ path: 'smoke/pixel.png', data, mimeType: 'image/png' });
const renderer = new WebGLRenderer2D(canvas, createAssetTextureSource(assets), {
  clearColor: '#000000',
  onContextStateChange(state) {
    output.dataset.context = state;
  },
});
await renderer.preloadAsset(pixel.assetId);
const drawItem = {
  entityId: 'smoke:sprite',
  assetId: pixel.assetId,
  transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  width: 80,
  height: 80,
  order: 0,
  tint: '#ffffff',
};
const benchmarkCount = Number(new URLSearchParams(location.search).get('sprites') ?? 2);
if (!Number.isInteger(benchmarkCount) || benchmarkCount < 1 || benchmarkCount > 5000) throw new RangeError('Use a sprite count from 1 to 5000.');
const drawItems = Array.from({ length: benchmarkCount }, (_, index) => ({
  ...drawItem,
  entityId: `smoke:sprite-${index}`,
  transform: { ...drawItem.transform, tx: (index % 50) * 90, ty: Math.floor(index / 50) * -90 },
}));
const stats = renderer.render(drawItems);
output.dataset.status = renderer.getAssetLoadStatus(pixel.assetId) === 'loaded' ? 'ready' : 'texture-error';
output.dataset.error = renderer.getAssetLoadError(pixel.assetId) ?? '';
output.dataset.drawCalls = String(stats.drawCalls);
output.dataset.sprites = String(stats.spritesDrawn);
output.dataset.benchmarkCount = String(benchmarkCount);
output.dataset.webgl = renderer.camera.isOrthographicCamera ? 'orthographic' : 'invalid';
if (new URLSearchParams(location.search).has('sprites')) {
  for (let index = 0; index < 5; index++) renderer.render(drawItems);
  const durations = Array.from({ length: 30 }, () => {
    const start = performance.now(); renderer.render(drawItems); return performance.now() - start;
  }).sort((a, b) => a - b);
  output.dataset.renderMedianMs = durations[Math.floor(durations.length * 0.5)]!.toFixed(3);
  output.dataset.renderP95Ms = durations[Math.ceil(durations.length * 0.95) - 1]!.toFixed(3);
}

const context = canvas.getContext('webgl2');
if (context) {
  const centerPixel = new Uint8Array(4);
  context.readPixels(160, 120, 1, 1, context.RGBA, context.UNSIGNED_BYTE, centerPixel);
  output.dataset.centerRed = String(centerPixel[0]);
}
const loseContext = context?.getExtension('WEBGL_lose_context');
(window as typeof window & { rendererSmoke?: { renderer: WebGLRenderer2D; loseContext?: WEBGL_lose_context } }).rendererSmoke = {
  renderer,
  loseContext: loseContext ?? undefined,
};
