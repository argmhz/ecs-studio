import type { World } from '@ecs/core';
import type { Entity } from '@ecs/core';
import type { SceneHierarchy } from '@ecs/scene';
import { Parallax2D } from './parallax.ts';
import { SpriteRenderer2D } from './sprite.ts';
import { spriteRenderer2DSchema } from './sprite.ts';
import type { SpriteRenderItem } from './sprite.ts';
import type { SpriteAtlas } from '@ecs/assets';

/** Convert scene components and global transforms into renderer input. */
export function collectSpriteRenderItems(
  world: World,
  entities: ReadonlyMap<string, Entity>,
  hierarchy: SceneHierarchy,
  atlases: readonly SpriteAtlas[] = [],
): readonly SpriteRenderItem[] {
  const items: SpriteRenderItem[] = [];
  const regionLookup = new Map(atlases.flatMap(atlas => atlas.regions.map(region => [`${atlas.id}:${region.id}`, { assetId: atlas.assetId, uvRegion: { x: region.x / atlas.width, y: 1 - (region.y + region.height) / atlas.height, width: region.width / atlas.width, height: region.height / atlas.height } }] as const)));
  for (const [entityId, entity] of entities) {
    if (!world.isAlive(entity) || !world.hasComponent(entity, SpriteRenderer2D)) continue;
    const sprite = world.getComponent(entity, SpriteRenderer2D)!;
    const issues = spriteRenderer2DSchemaValidate(sprite);
    if (issues) throw new Error(`Invalid Sprite Renderer 2D on "${entityId}": ${issues}`);
    if (sprite.asset === null) continue;
    items.push({
      entityId,
      ...(world.hasComponent(entity, Parallax2D) ? { parallax: world.getComponent(entity, Parallax2D)! } : {}),
      assetId: sprite.asset.assetId,
      ...(sprite.region && regionLookup.get(`${sprite.region.atlasId}:${sprite.region.regionId}`)?.assetId === sprite.asset.assetId ? { region: sprite.region, uvRegion: regionLookup.get(`${sprite.region.atlasId}:${sprite.region.regionId}`)!.uvRegion } : {}),
      transform: hierarchy.getGlobalTransform(entityId),
      width: sprite.width,
      height: sprite.height,
      order: sprite.order,
      tint: sprite.tint,
    });
  }
  return items;
}

function spriteRenderer2DSchemaValidate(value: unknown): string | undefined {
  const issues = spriteRenderer2DSchema.validate(value);
  if (issues.length === 0) return undefined;
  const first = issues[0]!;
  return `${first.path}: ${first.message}${issues.length > 1 ? ` (${issues.length - 1} more)` : ''}`;
}
