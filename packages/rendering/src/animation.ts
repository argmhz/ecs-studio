import { defineComponent } from '@ecs/core';
import type { Entity, World } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import type { ComponentSchema } from '@ecs/scene';
import { SpriteRenderer2D } from './sprite.ts';
import type { SpriteRegionReference } from '@ecs/assets';

export interface SpriteAnimationKey { readonly time: number; readonly value: number | string | boolean; }
export interface SpriteAnimationTrack { readonly componentTypeId: string; readonly field: string; readonly keys: readonly SpriteAnimationKey[]; }
export interface SpriteAnimationFrame { readonly assetId: string; readonly region?: SpriteRegionReference; readonly duration: number; }
export interface SpriteAnimationClip { readonly id: string; readonly name: string; readonly duration: number; readonly loop: boolean; readonly frames: readonly SpriteAnimationFrame[]; readonly tracks: readonly SpriteAnimationTrack[]; }
export interface SpriteAnimation2DData { readonly clipsJson: string; readonly clipId: string; readonly playOnStart: boolean; readonly speed: number; }

export const SpriteAnimation2D = defineComponent<SpriteAnimation2DData>('SpriteAnimation2D');
export const spriteAnimation2DSchema = defineComponentSchema({
  typeId: 'engine.spriteAnimation2d', displayName: 'Sprite Animation 2D', version: 1, component: SpriteAnimation2D,
  fields: {
    clipsJson: { type: 'string', label: 'Clips (animation editor)', default: '[]' },
    clipId: { type: 'string', label: 'Active Clip', default: '' },
    playOnStart: { type: 'boolean', label: 'Play On Start', default: true },
    speed: { type: 'number', label: 'Playback Speed', default: 1, min: 0, max: 20 },
  },
  validate: data => validateAnimationClips(data.clipsJson),
});

export function parseAnimationClips(value: string): SpriteAnimationClip[] {
  const issues = validateAnimationClips(value); if (issues.length) throw new Error(`${issues[0]!.path}: ${issues[0]!.message}`);
  return JSON.parse(value) as SpriteAnimationClip[];
}
function validateAnimationClips(value: string): readonly { path: string; message: string }[] {
  let clips: unknown;
  try { clips = JSON.parse(value); } catch { return [{ path: 'engine.spriteAnimation2d.clipsJson', message: 'Must contain valid JSON.' }]; }
  if (!Array.isArray(clips)) return [{ path: 'engine.spriteAnimation2d.clipsJson', message: 'Expected an array of clips.' }];
  for (const [ci, clip] of clips.entries()) {
    const path = `engine.spriteAnimation2d.clipsJson[${ci}]`;
    if (!clip || typeof clip !== 'object' || typeof clip.id !== 'string' || !clip.id || typeof clip.name !== 'string' || !clip.name || typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0 || typeof clip.loop !== 'boolean' || !Array.isArray(clip.frames) || !Array.isArray(clip.tracks)) return [{ path, message: 'Clip fields are invalid.' }];
    for (const [fi, frame] of clip.frames.entries()) if (!frame || typeof frame.assetId !== 'string' || !frame.assetId || (frame.region !== undefined && (!frame.region || typeof frame.region.atlasId !== 'string' || typeof frame.region.regionId !== 'string')) || typeof frame.duration !== 'number' || !Number.isFinite(frame.duration) || frame.duration <= 0) return [{ path: `${path}.frames[${fi}]`, message: 'Frame needs an asset ID and positive duration.' }];
    for (const [ti, track] of clip.tracks.entries()) {
      if (!track || typeof track.componentTypeId !== 'string' || !track.componentTypeId || typeof track.field !== 'string' || !track.field || !Array.isArray(track.keys) || !track.keys.length) return [{ path: `${path}.tracks[${ti}]`, message: 'Track fields and at least one key are required.' }];
      let previous = -1;
      for (const [ki, key] of track.keys.entries()) {
        if (!key || typeof key.time !== 'number' || !Number.isFinite(key.time) || key.time < 0 || key.time > clip.duration || key.time < previous || !['number', 'string', 'boolean'].includes(typeof key.value) || (typeof key.value === 'number' && !Number.isFinite(key.value))) return [{ path: `${path}.tracks[${ti}].keys[${ki}]`, message: 'Keys need ordered times within the clip and serializable scalar values.' }];
        previous = key.time;
      }
    }
  }
  return [];
}
export function createSpriteAnimation(): SpriteAnimation2DData { return { clipsJson: '[]', clipId: '', playOnStart: true, speed: 1 }; }

export interface AnimationPlayerState { clipId: string; time: number; }
/** Advance autoplay clips. Script updates run first; animation owns keyed fields for this tick. */
export function updateSpriteAnimations(
  world: World,
  entities: ReadonlyMap<string, Entity>,
  schemas: readonly ComponentSchema[],
  deltaTime: number,
  states: Map<string, AnimationPlayerState>,
): void {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Animation deltaTime must be finite and non-negative.');
  const byTypeId = new Map(schemas.map(schema => [schema.typeId, schema]));
  for (const [entityId, entity] of entities) {
    if (!world.isAlive(entity) || !world.hasComponent(entity, SpriteAnimation2D)) { states.delete(entityId); continue; }
    const player = world.getComponent(entity, SpriteAnimation2D)!;
    if (!player.playOnStart) continue;
    const clips = parseAnimationClips(player.clipsJson); const clip = clips.find(item => item.id === player.clipId); if (!clip) continue;
    const previous = states.get(entityId); const advancedTime = (previous?.clipId === clip.id ? previous.time : 0) + deltaTime * player.speed;
    const time = clip.loop ? advancedTime : Math.min(clip.duration, advancedTime);
    const playhead = clip.loop ? ((time % clip.duration) + clip.duration) % clip.duration : time;
    states.set(entityId, { clipId: clip.id, time: playhead });
    for (const track of clip.tracks) {
      const schema = byTypeId.get(track.componentTypeId); if (!schema || !world.hasComponent(entity, schema.component) || !(track.field in schema.fields)) continue;
      const value = sampleAnimationTrack(track, playhead); const current = world.getComponent(entity, schema.component) as Record<string, unknown>; const updated = { ...current, [track.field]: value };
      const issues = schema.validate(updated); if (issues.length) throw new Error(`Animation on "${entityId}" cannot set ${track.componentTypeId}.${track.field}: ${issues[0]!.message}`);
      world.setComponent(entity, schema.component, updated);
    }
    if (clip.frames.length && world.hasComponent(entity, SpriteRenderer2D)) {
      const total = clip.frames.reduce((sum, frame) => sum + frame.duration, 0); let frameTime = clip.loop ? playhead % total : Math.min(playhead, total - Number.EPSILON); let frame = clip.frames[0]!;
      for (const candidate of clip.frames) { if (frameTime < candidate.duration) { frame = candidate; break; } frameTime -= candidate.duration; }
      const sprite = world.getComponent(entity, SpriteRenderer2D)!; world.setComponent(entity, SpriteRenderer2D, { ...sprite, asset: { assetId: frame.assetId }, region: frame.region ?? null });
    }
  }
}

export function sampleAnimationTrack(track: SpriteAnimationTrack, time: number): number | string | boolean {
  const keys = track.keys; if (time <= keys[0]!.time) return keys[0]!.value;
  for (let index = 1; index < keys.length; index++) {
    const next = keys[index]!; const previous = keys[index - 1]!; if (time > next.time) continue;
    if (typeof previous.value === 'number' && typeof next.value === 'number') { const alpha = next.time === previous.time ? 1 : (time - previous.time) / (next.time - previous.time); return previous.value + (next.value - previous.value) * alpha; }
    return previous.value;
  }
  return keys.at(-1)!.value;
}
