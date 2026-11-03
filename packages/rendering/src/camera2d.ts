import { defineComponent, type World, type Entity } from '@ecs/core';
import { defineComponentSchema, type SceneHierarchy } from '@ecs/scene';

export interface Camera2DData { readonly enabled: boolean; readonly priority: number; readonly visibleHeight: number; readonly followTarget: string | null; readonly offsetX: number; readonly offsetY: number; }
export interface CameraView2D { readonly entityId: string; readonly x: number; readonly y: number; readonly visibleHeight: number; }
export interface GameViewSettings { readonly mode: 'Free' | 'Fit'; readonly width: number; readonly height: number; }
export const DEFAULT_GAME_VIEW: GameViewSettings = Object.freeze({ mode: 'Free', width: 1280, height: 720 });
export const Camera2D = defineComponent<Camera2DData>('Camera2D');
export const camera2DSchema = defineComponentSchema({ typeId: 'engine.camera2d', displayName: 'Camera 2D', version: 1, component: Camera2D, fields: {
  enabled: { type: 'boolean', label: 'Enabled', default: true },
  priority: { type: 'number', label: 'Priority', default: 0 },
  visibleHeight: { type: 'number', label: 'Visible Height', default: 16, min: .01, max: 1000000 },
  followTarget: { type: 'entity', label: 'Follow Target', default: null },
  offsetX: { type: 'number', label: 'Offset X', default: 0 },
  offsetY: { type: 'number', label: 'Offset Y', default: 0 },
} });

export function resolveCamera2D(world: World, entities: ReadonlyMap<string, Entity>, hierarchy: SceneHierarchy): CameraView2D | undefined {
  const candidates = [...entities].filter(([, entity]) => world.isAlive(entity) && world.getComponent(entity, Camera2D)?.enabled)
    .sort(([idA, a], [idB, b]) => world.getComponent(b, Camera2D)!.priority - world.getComponent(a, Camera2D)!.priority || idA.localeCompare(idB));
  const candidate = candidates[0]; if (!candidate) return undefined;
  const [entityId, entity] = candidate, data = world.getComponent(entity, Camera2D)!;
  const target = data.followTarget && entities.get(data.followTarget);
  const transform = hierarchy.getGlobalTransform(target && world.isAlive(target) ? data.followTarget! : entityId);
  return { entityId, x: transform.tx + data.offsetX, y: transform.ty + data.offsetY, visibleHeight: data.visibleHeight };
}
export function validateGameView(value: unknown = DEFAULT_GAME_VIEW): GameViewSettings {
  if (!value || typeof value !== 'object') throw new Error('Game View settings must be an object.');
  const data = value as GameViewSettings;
  if (!['Free', 'Fit'].includes(data.mode) || !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || data.width > 8192 || data.height > 8192) throw new Error('Game View needs Free/Fit mode and integer dimensions from 1 to 8192.');
  return { mode: data.mode, width: data.width, height: data.height };
}
export function fitGameViewport(width: number, height: number, settings: GameViewSettings) {
  if (settings.mode === 'Free') return { left: 0, top: 0, width, height };
  const scale = Math.min(width / settings.width, height / settings.height);
  const fittedWidth = settings.width * scale, fittedHeight = settings.height * scale;
  return { left: (width - fittedWidth) / 2, top: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}
