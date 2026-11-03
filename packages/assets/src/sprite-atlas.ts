/** A named pixel region within an imported image asset. */
export interface SpriteAtlasRegion {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pivotX: number;
  readonly pivotY: number;
}

/** Editor metadata for slicing one image into reusable sprite and tile regions. */
export interface SpriteAtlas {
  readonly id: string;
  readonly name: string;
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly regions: readonly SpriteAtlasRegion[];
}

/** Stable reference used by scene data; geometry is resolved from the project atlas. */
export interface SpriteRegionReference {
  readonly atlasId: string;
  readonly regionId: string;
}

export function validateSpriteAtlases(value: unknown): readonly SpriteAtlas[] {
  if (!Array.isArray(value)) throw new Error('Project sprite atlases must be an array.');
  const ids = new Set<string>();
  for (const [index, atlas] of value.entries()) {
    if (!atlas || typeof atlas !== 'object') throw new Error(`Sprite atlas ${index + 1} is invalid.`);
    const item = atlas as SpriteAtlas;
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || typeof item.assetId !== 'string' || !item.assetId || !positiveInteger(item.width) || !positiveInteger(item.height) || !Array.isArray(item.regions)) throw new Error(`Sprite atlas ${index + 1} has invalid fields.`);
    ids.add(item.id); const regionIds = new Set<string>();
    for (const [regionIndex, region] of item.regions.entries()) {
      if (!region || typeof region.id !== 'string' || !region.id || regionIds.has(region.id) || typeof region.name !== 'string' || !region.name.trim() || !Number.isInteger(region.x) || !Number.isInteger(region.y) || !positiveInteger(region.width) || !positiveInteger(region.height) || !Number.isFinite(region.pivotX) || !Number.isFinite(region.pivotY) || region.pivotX < 0 || region.pivotX > 1 || region.pivotY < 0 || region.pivotY > 1 || region.x < 0 || region.y < 0 || region.x + region.width > item.width || region.y + region.height > item.height) throw new Error(`Sprite atlas "${item.name}" region ${regionIndex + 1} is invalid or outside the image.`);
      regionIds.add(region.id);
    }
  }
  return value as readonly SpriteAtlas[];
}
function positiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0; }
