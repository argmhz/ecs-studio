import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import type { AffineTransform2D } from '@ecs/scene';
import type { SpriteRenderItem } from './sprite.ts';

export interface Parallax2DData {
  readonly factorX: number;
  readonly factorY: number;
  readonly repeatX: boolean;
  readonly repeatY: boolean;
  readonly originX: number;
  readonly originY: number;
}
export interface ParallaxView { readonly x: number; readonly y: number; readonly halfWidth: number; readonly halfHeight: number; readonly parallaxCamera?: { readonly x: number; readonly y: number }; }
export const Parallax2D = defineComponent<Parallax2DData>('Parallax2D');
export const parallax2DSchema = defineComponentSchema({
  typeId: 'engine.parallax2d', displayName: 'Parallax 2D', version: 1, component: Parallax2D,
  fields: {
    factorX: { type: 'number', label: 'Factor X', default: .5 },
    factorY: { type: 'number', label: 'Factor Y', default: .5 },
    repeatX: { type: 'boolean', label: 'Repeat X', default: false },
    repeatY: { type: 'boolean', label: 'Repeat Y', default: false },
    originX: { type: 'number', label: 'Origin X', default: 0 },
    originY: { type: 'number', label: 'Origin Y', default: 0 },
  },
});

/** Only render positions move: the component's origin is in world coordinates. */
export function parallaxTransform(transform: AffineTransform2D, data: Parallax2DData, camera: { x: number; y: number }): AffineTransform2D {
  return { ...transform, tx: transform.tx + (camera.x - data.originX) * (1 - data.factorX), ty: transform.ty + (camera.y - data.originY) * (1 - data.factorY) };
}

/** Repeat in the sprite's transformed local axes, including rotated/scaled parents. */
export function parallaxTransforms(transform: AffineTransform2D, width: number, height: number, data: Parallax2DData | undefined, view: ParallaxView): readonly AffineTransform2D[] {
  if (!data) return [transform];
  const base = parallaxTransform(transform, data, view.parallaxCamera ?? view);
  if (!data.repeatX && !data.repeatY) return [base];
  const ux = base.a * width, uy = base.b * width, vx = base.c * height, vy = base.d * height;
  const determinant = ux * vy - uy * vx;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return [base];
  const corners = [-1, 1].flatMap(x => [-1, 1].map(y => {
    const dx = view.x + x * view.halfWidth - base.tx, dy = view.y + y * view.halfHeight - base.ty;
    return { x: (vy * dx - vx * dy) / determinant, y: (-uy * dx + ux * dy) / determinant };
  }));
  let left = data.repeatX ? Math.ceil(Math.min(...corners.map(p => p.x)) - .5) : 0;
  let right = data.repeatX ? Math.floor(Math.max(...corners.map(p => p.x)) + .5) : 0;
  let bottom = data.repeatY ? Math.ceil(Math.min(...corners.map(p => p.y)) - .5) : 0;
  let top = data.repeatY ? Math.floor(Math.max(...corners.map(p => p.y)) + .5) : 0;
  // Keep pathological tiny sprites/huge viewports from exhausting the editor.
  // Normal backgrounds use far fewer than 4096 visible copies per layer.
  const columns = Math.max(0, right - left + 1), rows = Math.max(0, top - bottom + 1);
  if (columns * rows > 4096) {
    const scale = Math.sqrt(4096 / (columns * rows));
    const limitX = Math.max(1, Math.min(4096, Math.floor(columns * scale)));
    const limitY = Math.max(1, Math.min(Math.floor(4096 / limitX), Math.floor(rows * scale)));
    const centerX = Math.round((left + right) / 2), centerY = Math.round((bottom + top) / 2);
    left = centerX - Math.floor((limitX - 1) / 2); right = left + limitX - 1;
    bottom = centerY - Math.floor((limitY - 1) / 2); top = bottom + limitY - 1;
  }
  const result: AffineTransform2D[] = [];
  const countX = Math.max(0, Math.min(4096, right - left + 1));
  const countY = Math.max(0, Math.min(Math.floor(4096 / Math.max(1, countX)), top - bottom + 1));
  // Increment bounded counters instead of huge world indices (x++ may stop
  // advancing when indices exceed Number.MAX_SAFE_INTEGER).
  for (let row = 0; row < countY; row++) for (let column = 0; column < countX; column++) {
    const x = left + column, y = bottom + row;
    result.push({ ...base, tx: base.tx + x * ux + y * vx, ty: base.ty + x * uy + y * vy });
  }
  return result;
}
export function expandParallaxSprites(items: readonly SpriteRenderItem[], view: ParallaxView): readonly SpriteRenderItem[] {
  return items.flatMap(item => parallaxTransforms(item.transform, item.width, item.height, item.parallax, view).map(transform => ({ ...item, transform })));
}
