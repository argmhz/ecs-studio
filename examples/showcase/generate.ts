import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { World, defineComponent } from '@ecs/core';
import { SceneCodec, SchemaRegistry, Transform2D, Parent, registerBuiltInSceneSchemas, defineComponentSchema } from '@ecs/scene';
import { Parallax2D, parallax2DSchema, SpriteRenderer2D, spriteRenderer2DSchema, Tilemap2D, tilemap2DSchema, createTilemap, SpriteAnimation2D, spriteAnimation2DSchema } from '@ecs/rendering';
import { AudioSource2D, audioSource2DSchema } from '@ecs/audio';
import { UiCanvas, UiText, UiImage, UiButton, uiSchemas } from '@ecs/ui';
import { scriptBindingSchema, ScriptBinding } from '../../apps/editor/src/script-binding.ts';
import { encodeProjectArchive } from '../../apps/editor/src/project-storage.ts';
import { makePrefab } from '../../apps/editor/src/prefabs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../../apps/editor/public/showcase.ecsproj');
const imageId = 'asset:showcase:sheet';
const audioId = 'asset:showcase:chime';

const Name = defineComponent<{ value: string }>('Name');
const Physics = defineComponent<{ bodyType: 'Dynamic' | 'Fixed'; gravityScale: number }>('Physics2D');
const Collider = defineComponent<{ shape: 'Box' | 'Circle'; friction: number; restitution: number; sensor: boolean; groups: number; mask: number }>('Collider2D');
const nameSchema = defineComponentSchema({ typeId: 'engine.name', displayName: 'Name', version: 1, component: Name, fields: { value: { type: 'string', label: 'Name', default: 'Object' } } });
const physicsSchema = defineComponentSchema({ typeId: 'engine.physics2d', displayName: 'Physics 2D', version: 1, component: Physics, fields: { bodyType: { type: 'enum', label: 'Body Type', default: 'Dynamic', options: ['Dynamic', 'Fixed'] }, gravityScale: { type: 'number', label: 'Gravity Scale', default: 1 } } });
const colliderSchema = defineComponentSchema({ typeId: 'engine.collider2d', displayName: 'Collider 2D', version: 1, component: Collider, fields: { shape: { type: 'enum', label: 'Shape', default: 'Box', options: ['Box', 'Circle'] }, friction: { type: 'number', label: 'Friction', default: 0.7, min: 0, max: 1 }, restitution: { type: 'number', label: 'Restitution', default: 0.25, min: 0, max: 1 }, sensor: { type: 'boolean', label: 'Is Trigger', default: false }, groups: { type: 'number', label: 'Collision Group', default: 1, min: 1, max: 65535 }, mask: { type: 'number', label: 'Collision Mask', default: 65535, min: 1, max: 65535 } } });

const schemas = new SchemaRegistry();
registerBuiltInSceneSchemas(schemas);
for (const schema of [nameSchema, spriteRenderer2DSchema, parallax2DSchema, physicsSchema, colliderSchema, tilemap2DSchema, spriteAnimation2DSchema, audioSource2DSchema, ...uiSchemas, scriptBindingSchema]) schemas.register(schema);
const codec = new SceneCodec(schemas);
const world = new World();
const entities = new Map<string, ReturnType<World['createEntity']>>();
function makeEntity(id: string, name: string, x = 0, y = 0) {
  const entity = world.createEntity(); entities.set(id, entity);
  world.addComponent(entity, Name, { value: name });
  world.addComponent(entity, Transform2D, { x, y, rotation: 0, scaleX: 1, scaleY: 1 });
  return entity;
}
const pixel = { assetId: imageId };
const atlasId = 'atlas:showcase:main';
const regions = [
  { id: 'region:hero', name: 'Hero', x: 0, y: 0, width: 16, height: 16, pivotX: .5, pivotY: .5 },
  { id: 'region:grass', name: 'Grass Tile', x: 16, y: 0, width: 16, height: 16, pivotX: .5, pivotY: .5 },
  { id: 'region:stone', name: 'Stone Tile', x: 32, y: 0, width: 16, height: 16, pivotX: .5, pivotY: .5 },
  { id: 'region:gem', name: 'Gem', x: 48, y: 0, width: 16, height: 16, pivotX: .5, pivotY: .5 },
];
const region = (regionId: string) => ({ atlasId, regionId });
const sprite = (width: number, height: number, tint: string, order = 0) => ({ asset: pixel, region: null, width, height, order, tint });
const collider = (restitution = 0.3) => ({ shape: 'Box' as const, friction: 0.7, restitution, sensor: false, groups: 1, mask: 65535 });

const player = makeEntity('player', 'Player', -2.5, 1.5);
world.addComponent(player, SpriteRenderer2D, { ...sprite(0.85, 0.85, '#ffffff', 3), region: region('region:hero') });
world.addComponent(player, ScriptBinding, { enabled: true, codePath: 'scripts/player.ts', graphPath: 'scripts/player.graph.json', speed: 4 });
world.addComponent(player, SpriteAnimation2D, {
  clipsJson: JSON.stringify([{ id: 'glow', name: 'Glow', duration: 1, loop: true, frames: [{ assetId: imageId, region: region('region:hero'), duration: 0.5 }, { assetId: imageId, region: region('region:gem'), duration: 0.5 }], tracks: [{ componentTypeId: 'engine.spriteRenderer2d', field: 'tint', keys: [{ time: 0, value: '#79d7ff' }, { time: 0.5, value: '#c28bff' }] }] }]),
  clipId: 'glow', playOnStart: true, speed: 1,
});
world.addComponent(player, AudioSource2D, { asset: { assetId: audioId }, group: 'effects', volume: 0.7, loop: false, playOnStart: false });

const crate = makeEntity('crate', 'Physics Crate', 1.2, 4);
world.addComponent(crate, SpriteRenderer2D, { ...sprite(0.9, 0.9, '#ffc46d', 2), region: region('region:stone') });
world.addComponent(crate, Physics, { bodyType: 'Dynamic', gravityScale: 1 });
world.addComponent(crate, Collider, collider(0.45));
world.addComponent(crate, ScriptBinding, { enabled: true, codePath: 'scripts/crate.ts', graphPath: '', speed: 1 });

const gem = makeEntity('gem', 'Animated Gem', 3.2, 1.6);
world.addComponent(gem, SpriteRenderer2D, { ...sprite(0.75, 0.75, '#ffffff', 4), region: region('region:gem') });
world.addComponent(gem, SpriteAnimation2D, { clipsJson: JSON.stringify([{ id: 'pulse', name: 'Pulse', duration: 0.8, loop: true, frames: [{ assetId: imageId, region: region('region:gem'), duration: 0.4 }, { assetId: imageId, region: region('region:hero'), duration: 0.4 }], tracks: [] }]), clipId: 'pulse', playOnStart: true, speed: 1 });
world.addComponent(gem, ScriptBinding, { enabled: true, codePath: '', graphPath: 'scripts/gem.graph.json', speed: 1 });

const ground = makeEntity('ground', 'Ground', 0, -2.2);
world.addComponent(ground, SpriteRenderer2D, sprite(12, 0.5, '#596b79', 1));
world.addComponent(ground, Physics, { bodyType: 'Fixed', gravityScale: 0 });
world.addComponent(ground, Collider, collider());

const tilemap = makeEntity('tilemap', 'Tilemap Wall', 6.4, 1);
const map = createTilemap(4, 5, 1);
const mapLayer = JSON.parse(map.layersJson) as { id: string; name: string; visible: boolean; collidable: boolean; cells: (string | null)[] }[];
for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) if (x === 0 || x === 3 || y === 0) mapLayer[0]!.cells[y * 4 + x] = 'tile:grass';
world.addComponent(tilemap, Tilemap2D, { ...map, layersJson: JSON.stringify(mapLayer), tilesJson: JSON.stringify([{ id: 'tile:grass', asset: pixel, region: region('region:grass'), neighborGroup: 'grass' }, { id: 'tile:stone', asset: pixel, region: region('region:stone'), neighborGroup: 'stone' }]) });

const canvas = makeEntity('ui-canvas', 'UI Canvas');
world.addComponent(canvas, UiCanvas, { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' });
const title = makeEntity('ui-title', 'Title');
world.addComponent(title, Parent, { parentId: 'ui-canvas' });
world.addComponent(title, UiText, { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 20, offsetMinY: 16, offsetMaxX: 560, offsetMaxY: 58, text: 'ECS STUDIO SHOWCASE', color: '#ffffff', fontSize: 26, align: 'left' });
const status = makeEntity('ui-status', 'Status');
world.addComponent(status, Parent, { parentId: 'ui-canvas' });
world.addComponent(status, UiText, { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 20, offsetMinY: 64, offsetMaxX: 620, offsetMaxY: 96, text: 'Move with A/D or ←/→ · gamepad left stick', color: '#c8d4e2', fontSize: 15, align: 'left' });
const logo = makeEntity('ui-logo', 'Logo Image');
world.addComponent(logo, Parent, { parentId: 'ui-canvas' });
world.addComponent(logo, UiImage, { anchorMinX: 1, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 0, offsetMinX: -64, offsetMinY: 18, offsetMaxX: -20, offsetMaxY: 62, asset: pixel, fit: 'contain' });
const start = makeEntity('start-button', 'Start Button');
world.addComponent(start, Parent, { parentId: 'ui-canvas' });
world.addComponent(start, UiButton, { anchorMinX: 0.04, anchorMinY: 0.82, anchorMaxX: 0.04, anchorMaxY: 0.82, offsetMinX: 0, offsetMinY: 0, offsetMaxX: 190, offsetMaxY: 54, text: 'Start Adventure', color: '#ffffff', background: '#55458b', fontSize: 18, disabled: false });

// Three repeating layers, evaluated at the gameplay camera independently of Scene navigation.
for (const [index, layer] of ['Sky', 'Mountains', 'Hills'].entries()) {
  const entity = makeEntity(`parallax:${layer.toLowerCase()}`, `Parallax ${layer}`, 0, 2);
  world.addComponent(entity, SpriteRenderer2D, { asset: { assetId: `asset:showcase:background:${index}` }, region: null, width: 32, height: 16, order: -30 + index * 10, tint: '#ffffff' });
  world.addComponent(entity, Parallax2D, { factorX: [0, .15, .5][index]!, factorY: [0, .05, .2][index]!, repeatX: true, repeatY: index === 0, originX: 0, originY: 2 });
}

const scene = codec.serialize(world, entities, 'scene:main');
const script = `// Isolated for the duration of Play; edits apply after Stop and the next Play.
function onStart(api: engine.ScriptApi) {
  api.on('ui.button.clicked', (event, current) => {
    if (!event.payload || typeof event.payload !== 'object' || !('entityId' in event.payload) || event.payload.entityId !== 'start-button') return;
    const button = current.getEntityComponent('start-button', 'engine.uiButton');
    if (button) current.setEntityComponent('start-button', 'engine.uiButton', { ...button, text: 'Adventure Started!' });
    current.emit('audio.play', { entityId: 'player' });
  });
  api.on('showcase.position.graph', (event, current) => {
    if (!event.payload || typeof event.payload !== 'object' || !('x' in event.payload)) return;
    const label = current.getEntityComponent('ui-status', 'engine.uiText');
    if (label) current.setEntityComponent('ui-status', 'engine.uiText', { ...label, text: 'Player position: ' + Number(event.payload.x).toFixed(1) + ' · code → nodes → code' });
  });
}

function onUpdate(api: engine.ScriptApi) {
  const transform = api.getComponent('engine.transform2d');
  const move = api.input.actions.moveX?.value ?? 0;
  if (transform && move !== 0) {
    const next = { ...transform, x: transform.x + move * api.properties.speed * api.deltaTime };
    api.setComponent('engine.transform2d', next);
    api.emit('showcase.position.code', { x: next.x, y: next.y });
  }
}
`;
const crateScript = `// This file is bound to the Physics Crate in the Hierarchy.
// onStart runs once per Play; onUpdate runs each simulation frame.
function onUpdate(api: engine.ScriptApi) {
  const transform = api.getComponent('engine.transform2d');
  if (!transform) return;
  api.setComponent('engine.transform2d', {
    ...transform,
    rotation: transform.rotation + api.deltaTime * api.properties.speed,
  });
}

function onStop(_api: engine.ScriptApi) {
  // Runtime-only cleanup belongs here. Stop restores the edited scene copy.
}
`;
const graph = { version: 1, nodes: [
  { id: 'start', kind: 'event.onStart', x: 40, y: 70, data: {} },
  { id: 'on-code-position', kind: 'event.onEvent', x: 270, y: 230, data: { eventType: 'showcase.position.code' } },
  { id: 'subscribe', kind: 'event.subscribe', x: 270, y: 70, data: { eventType: 'showcase.position.code' } },
  { id: 'payload', kind: 'event.payload', x: 270, y: 220, data: { eventType: 'showcase.position.code' } },
  { id: 'emit', kind: 'event.emit', x: 560, y: 70, data: { eventType: 'showcase.position.graph' } },
  { id: 'end', kind: 'flow.end', x: 850, y: 70, data: {} },
  { id: 'event-end', kind: 'flow.end', x: 850, y: 230, data: {} },
], links: [
  { id: 'flow-1', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'subscribe', portId: 'exec' } },
  { id: 'flow-event', from: { nodeId: 'on-code-position', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
  { id: 'payload-1', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
  { id: 'flow-2', from: { nodeId: 'subscribe', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
  { id: 'flow-3', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'event-end', portId: 'exec' } },
] };

const gemGraph = { version: 1, nodes: [
  { id: 'start', kind: 'event.onUpdate', x: 40, y: 70, data: {} },
  { id: 'two', kind: 'value.number', x: 220, y: 210, data: { value: 2 } },
  { id: 'one', kind: 'value.number', x: 220, y: 360, data: { value: 1 } },
  { id: 'compare', kind: 'compare.greater', x: 440, y: 260, data: {} },
  { id: 'branch', kind: 'flow.branch', x: 650, y: 70, data: {} },
  { id: 'set', kind: 'variable.set', x: 880, y: 20, data: { name: 'gemIsReady' } },
  { id: 'trueValue', kind: 'value.number', x: 660, y: 260, data: { value: 1 } },
  { id: 'end', kind: 'flow.end', x: 1100, y: 70, data: {} },
], links: [
  { id: 'flow-1', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'branch', portId: 'exec' } },
  { id: 'left', from: { nodeId: 'two', portId: 'value' }, to: { nodeId: 'compare', portId: 'a' } },
  { id: 'right', from: { nodeId: 'one', portId: 'value' }, to: { nodeId: 'compare', portId: 'b' } },
  { id: 'condition', from: { nodeId: 'compare', portId: 'value' }, to: { nodeId: 'branch', portId: 'condition' } },
  { id: 'true-path', from: { nodeId: 'branch', portId: 'true' }, to: { nodeId: 'set', portId: 'exec' } },
  { id: 'set-value', from: { nodeId: 'trueValue', portId: 'value' }, to: { nodeId: 'set', portId: 'value' } },
  { id: 'flow-2', from: { nodeId: 'set', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
] };

function spriteSheetPng() {
  const width = 64, height = 16, raw = Buffer.alloc(height * (width * 4 + 1));
  const set = (x: number, y: number, rgba: readonly number[]) => { const offset = y * (width * 4 + 1) + 1 + x * 4; rgba.forEach((channel, i) => { raw[offset + i] = channel; }); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tile = Math.floor(x / 16), lx = x % 16;
    if (tile === 0) { // tiny hero
      const body = lx >= 4 && lx <= 11 && y >= 3 && y <= 13;
      set(x, y, body ? (y < 6 ? [255, 218, 150, 255] : [57, 174, 240, 255]) : [0, 0, 0, 0]);
      if ((lx === 6 || lx === 10) && y === 5) set(x, y, [20, 30, 50, 255]);
    } else if (tile === 1) set(x, y, y < 4 ? [73, 176, 91, 255] : (y === 4 ? [55, 132, 69, 255] : [117, 78, 54, 255]));
    else if (tile === 2) set(x, y, ((lx + y) % 7 === 0) ? [155, 161, 174, 255] : [103, 112, 132, 255]);
    else {
      const dx = Math.abs(lx - 8), dy = Math.abs(y - 8);
      set(x, y, dx + dy < 7 ? (dx + dy < 4 ? [255, 247, 174, 255] : [255, 190, 55, 255]) : [0, 0, 0, 0]);
    }
  }
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function backgroundPng(layer: number) {
  const width = 128, height = 64, raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    let color: number[];
    if (layer === 0) color = [28, 41, 71, 255]; // Uniform sky repeats seamlessly in both axes.
    else {
      const ridge = layer === 1 ? 18 + Math.abs((x % 64) - 32) * .65 : 39 + Math.sin(x * Math.PI / 64) * 7;
      color = y < ridge ? [0, 0, 0, 0] : layer === 1 ? [49, 65, 91, 255] : [43, 88, 85, 255];
    }
    color.forEach((value, channel) => { raw[offset + channel] = value; });
  }
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function wav() {
  const sampleRate = 22050, samples = 2205, data = new Uint8Array(44 + samples), view = new DataView(data.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); ascii(36, 'data'); view.setUint32(40, samples, true);
  for (let index = 0; index < samples; index++) { const fade = Math.min(1, index / 100, (samples - index) / 500); data[44 + index] = 128 + Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 660) * 45 * fade); }
  return data;
}
const png = spriteSheetPng();
const atlas = { id: atlasId, name: 'Showcase Sprite Sheet', assetId: imageId, width: 64, height: 16, regions };
const prefabScene = { ...scene, sceneId: 'scene:prefab:bouncy-crate', entities: scene.entities.filter(entity => entity.id === 'crate') };
const prefab = makePrefab('prefab:bouncy-crate', 'Bouncy Crate', prefabScene, 'crate');
const assets = [
  ...[0, 1, 2].map(index => { const data = backgroundPng(index); return { assetId: `asset:showcase:background:${index}`, path: `Textures/Parallax-${['Sky', 'Mountains', 'Hills'][index]}.png`, name: `Parallax-${['Sky', 'Mountains', 'Hills'][index]}.png`, kind: 'image' as const, mimeType: 'image/png', size: data.byteLength, revision: 1, data }; }),
  { assetId: imageId, path: 'Textures/Showcase-Spritesheet.png', name: 'Showcase-Spritesheet.png', kind: 'image' as const, mimeType: 'image/png', size: png.byteLength, revision: 1, data: png },
  { assetId: audioId, path: 'Audio/Chime.wav', name: 'Chime.wav', kind: 'audio' as const, mimeType: 'audio/wav', size: wav().byteLength, revision: 1, data: wav() },
];
const archive = encodeProjectArchive('ECS Studio Showcase', scene, assets, { 'scripts/player.ts': script, 'scripts/crate.ts': crateScript }, { speed: 4 }, { 'scripts/player.graph.json': graph, 'scripts/gem.graph.json': gemGraph }, [prefab], [atlas]);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive, 'utf8');
console.log(`Generated ${output}`);
