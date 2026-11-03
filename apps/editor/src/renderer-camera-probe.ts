import { createScene } from '@ecs/browser-preview';
import { World } from '@ecs/core';
import { SceneHierarchy, Transform2D } from '@ecs/scene';
import { Camera2D, resolveCamera2D } from '@ecs/rendering';

/** Real Game renderer: follow, fixed render resolution, letterbox and UI share one surface. */
export async function probeGameCamera() {
  const host = document.createElement('div'); host.style.cssText = 'position:relative;width:320px;height:240px'; document.body.append(host);
  const world = new World(), target = world.createEntity(), camera = world.createEntity();
  const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  world.addComponent(target, Transform2D, transform); world.addComponent(camera, Transform2D, transform);
  world.addComponent(camera, Camera2D, { enabled: true, priority: 0, visibleHeight: 10, followTarget: 'target', offsetX: 0, offsetY: 0 });
  const entities = new Map([['target', target], ['camera', camera]]), hierarchy = new SceneHierarchy(world, entities);
  const object = { id: 'target', name: 'Red', x: 0, y: 0, width: 2, height: 2, color: '#ff0000', dynamic: false, assetId: null };
  const style = document.createElement('style'); style.textContent = '.game-ui-overlay { position:absolute; inset:0; }'; host.append(style);
  const scene = await createScene(host, [object], () => {});
  scene.setGameView({ mode: 'Fit', width: 640, height: 360 }); scene.setCameraSource(() => resolveCamera2D(world, entities, hierarchy));
  scene.setUiPreview(() => [{ id: 'button', entityId: 'target', kind: 'button', text: 'Button', color: '#ffffff', background: '#222222', fontSize: 16, disabled: false, layout: { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 10, offsetMinY: 10, offsetMaxX: 110, offsetMaxY: 50 } }], () => ({ referenceWidth: 640, referenceHeight: 360, scaleMode: 'fit' }), async () => undefined);
  const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const samples: { center: number[]; size: number[]; display: number[]; ui: number[] }[] = [];
  try {
    for (const [x, width] of [[0, 320], [10, 320], [-12, 640]]) {
      object.x = x!; world.setComponent(target, Transform2D, { ...transform, x: x! }); host.style.width = `${width}px`; scene.update(); await settle();
      const canvas = host.querySelector('canvas')!, gl = canvas.getContext('webgl2')!;
      const pixel = new Uint8Array(4); gl.readPixels(320, 180, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const surface = host.querySelector('.game-surface')!.getBoundingClientRect(), ui = host.querySelector('.game-ui-overlay')!.getBoundingClientRect();
      samples.push({ center: [...pixel], size: [canvas.width, canvas.height], display: [surface.width, surface.height], ui: [ui.width, ui.height] });
    }
    return samples;
  } finally { scene.dispose(); host.remove(); }
}
