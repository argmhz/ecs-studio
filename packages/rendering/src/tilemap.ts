import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import type { AssetReference, AffineTransform2D } from '@ecs/scene';
import type { World, Entity } from '@ecs/core';
import type { SceneHierarchy } from '@ecs/scene';
import type { SpriteRenderItem } from './sprite.ts';
import type { SpriteAtlas, SpriteRegionReference } from '@ecs/assets';

export interface TilemapLayer { id: string; name: string; visible: boolean; collidable: boolean; cells: (string | null)[]; }
export interface TileDefinition { id: string; asset: AssetReference; region?: SpriteRegionReference; neighborGroup?: string; variants?: Record<string, string>; }
export interface Tilemap2DData { width: number; height: number; tileSize: number; layersJson: string; tilesJson: string; }
export const Tilemap2D = defineComponent<Tilemap2DData>('Tilemap2D');
export const tilemap2DSchema = defineComponentSchema({
  typeId: 'engine.tilemap2d', displayName: 'Tilemap 2D', version: 1, component: Tilemap2D,
  fields: {
    width: { type: 'number', label: 'Width', default: 16, min: 1, max: 512 },
    height: { type: 'number', label: 'Height', default: 12, min: 1, max: 512 },
    tileSize: { type: 'number', label: 'Tile Size', default: 1, min: 0.01, max: 256 },
    layersJson: { type: 'string', label: 'Layers (editor data)', default: '[]' },
    tilesJson: { type: 'string', label: 'Tiles (editor data)', default: '[]' },
  },
  validate: data => validateTilemap(data),
});

export function validateTilemap(data: Tilemap2DData): readonly { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  let layers: unknown; let tiles: unknown;
  try { layers = JSON.parse(data.layersJson); } catch { issues.push({ path: 'engine.tilemap2d.layersJson', message: 'Must contain valid JSON.' }); }
  try { tiles = JSON.parse(data.tilesJson); } catch { issues.push({ path: 'engine.tilemap2d.tilesJson', message: 'Must contain valid JSON.' }); }
  if (!Array.isArray(layers)) issues.push({ path: 'engine.tilemap2d.layersJson', message: 'Expected an array of layers.' });
  else for (const [i, layer] of layers.entries()) {
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || typeof layer.name !== 'string' || typeof layer.visible !== 'boolean' || typeof layer.collidable !== 'boolean' || !Array.isArray(layer.cells) || layer.cells.length !== data.width * data.height || layer.cells.some((cell: unknown) => cell !== null && typeof cell !== 'string')) issues.push({ path: `engine.tilemap2d.layersJson[${i}]`, message: 'Layer fields or cell count are invalid.' });
  }
  if (!Array.isArray(tiles)) issues.push({ path: 'engine.tilemap2d.tilesJson', message: 'Expected an array of tile definitions.' });
  else for (const [i, tile] of tiles.entries()) if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || !tile.asset || typeof tile.asset.assetId !== 'string' || (tile.region !== undefined && (!tile.region || typeof tile.region.atlasId !== 'string' || typeof tile.region.regionId !== 'string')) || (tile.neighborGroup !== undefined && typeof tile.neighborGroup !== 'string') || (tile.variants !== undefined && (typeof tile.variants !== 'object' || Array.isArray(tile.variants) || Object.values(tile.variants).some(value => typeof value !== 'string')))) issues.push({ path: `engine.tilemap2d.tilesJson[${i}]`, message: 'Tile definition is invalid.' });
  return issues;
}
export function parseTilemap(data: Tilemap2DData): { layers: TilemapLayer[]; tiles: TileDefinition[] } {
  const issues = tilemap2DSchema.validate(data); if (issues.length) throw new Error(`${issues[0]!.path}: ${issues[0]!.message}`);
  return { layers: JSON.parse(data.layersJson) as TilemapLayer[], tiles: JSON.parse(data.tilesJson) as TileDefinition[] };
}
const parsedCache = new WeakMap<Tilemap2DData, { layers: TilemapLayer[]; tiles: TileDefinition[] }>();
export function createTilemap(width = 16, height = 12, tileSize = 1): Tilemap2DData {
  return { width, height, tileSize, layersJson: JSON.stringify([{ id: 'layer:ground', name: 'Ground', visible: true, collidable: true, cells: Array(width * height).fill(null) }]), tilesJson: '[]' };
}
export function paintTile(data: Tilemap2DData, layerId: string, x: number, y: number, tileId: string | null): Tilemap2DData {
  const { layers } = parseTilemap(data); if (x < 0 || y < 0 || x >= data.width || y >= data.height) return data;
  const layer = layers.find(item => item.id === layerId); if (!layer) throw new Error(`Unknown tilemap layer "${layerId}".`);
  layer.cells[y * data.width + x] = tileId;
  return { ...data, layersJson: JSON.stringify(layers) };
}
export function fillTile(data: Tilemap2DData, layerId: string, x: number, y: number, tileId: string | null): Tilemap2DData {
  const { layers } = parseTilemap(data); const layer = layers.find(item => item.id === layerId); if (!layer || x < 0 || y < 0 || x >= data.width || y >= data.height) return data;
  const start = y * data.width + x; const target = layer.cells[start]!; if (target === tileId) return data;
  const queue = [start]; layer.cells[start] = tileId;
  for (let i = 0; i < queue.length; i++) { const cell = queue[i]!; const cx = cell % data.width; const cy = Math.floor(cell / data.width);
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) if (nx >= 0 && ny >= 0 && nx < data.width && ny < data.height) { const index = ny * data.width + nx; if (layer.cells[index] === target) { layer.cells[index] = tileId; queue.push(index); } }
  }
  return { ...data, layersJson: JSON.stringify(layers) };
}
export function tileNeighborMask(layer: TilemapLayer, width: number, height: number, x: number, y: number, groupFor: (id: string) => string | undefined): number {
  const cell = layer.cells[y * width + x]; if (!cell) return 0; const group = groupFor(cell); if (!group) return 0;
  return (y > 0 && groupFor(layer.cells[(y - 1) * width + x] ?? '') === group ? 1 : 0)
    | (x + 1 < width && groupFor(layer.cells[y * width + x + 1] ?? '') === group ? 2 : 0)
    | (y + 1 < height && groupFor(layer.cells[(y + 1) * width + x] ?? '') === group ? 4 : 0)
    | (x > 0 && groupFor(layer.cells[y * width + x - 1] ?? '') === group ? 8 : 0);
}
export function collectTileRenderItems(world: World, entities: ReadonlyMap<string, Entity>, hierarchy: SceneHierarchy, atlases: readonly SpriteAtlas[] = []): SpriteRenderItem[] {
  const output: SpriteRenderItem[] = [];
  const regionLookup = new Map(atlases.flatMap(atlas => atlas.regions.map(region => [`${atlas.id}:${region.id}`, { assetId: atlas.assetId, uvRegion: { x: region.x / atlas.width, y: 1 - (region.y + region.height) / atlas.height, width: region.width / atlas.width, height: region.height / atlas.height } }] as const)));
  for (const [entityId, entity] of entities) if (world.isAlive(entity) && world.hasComponent(entity, Tilemap2D)) {
    const data = world.getComponent(entity, Tilemap2D)!; let parsed = parsedCache.get(data); if (!parsed) { parsed = parseTilemap(data); parsedCache.set(data, parsed); } const { layers, tiles } = parsed; const definitions = new Map(tiles.map(tile => [tile.id, tile])); const transform = hierarchy.getGlobalTransform(entityId);
    layers.forEach((layer, layerIndex) => { if (!layer.visible) return; for (let index = 0; index < layer.cells.length; index++) { const tileId = layer.cells[index]; if (!tileId) continue; const tile = definitions.get(tileId); if (!tile) continue;
      const x = index % data.width; const y = Math.floor(index / data.width); const mask = tile.neighborGroup ? tileNeighborMask(layer, data.width, data.height, x, y, id => definitions.get(id)?.neighborGroup) : 0; const chosen = tile.variants?.[String(mask)] ? definitions.get(tile.variants[String(mask)]!) ?? tile : tile;
      const localX = (x - (data.width - 1) / 2) * data.tileSize; const localY = ((data.height - 1) / 2 - y) * data.tileSize; const t: AffineTransform2D = { ...transform, tx: transform.tx + transform.a * localX + transform.c * localY, ty: transform.ty + transform.b * localX + transform.d * localY };
      const uvRegion = chosen.region ? regionLookup.get(`${chosen.region.atlasId}:${chosen.region.regionId}`) : undefined;
      output.push({ entityId: `${entityId}:tile:${layer.id}:${index}`, assetId: chosen.asset.assetId, ...(uvRegion?.assetId === chosen.asset.assetId ? { uvRegion: uvRegion.uvRegion, region: chosen.region } : {}), transform: t, width: data.tileSize, height: data.tileSize, order: layerIndex, tint: '#ffffff' });
    } });
  }
  return output;
}
