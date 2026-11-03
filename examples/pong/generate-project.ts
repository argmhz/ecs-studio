import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { World, defineComponent } from '@ecs/core';
import { SceneCodec, SchemaRegistry, Transform2D, Parent, registerBuiltInSceneSchemas, defineComponentSchema } from '@ecs/scene';
import { SpriteRenderer2D, spriteRenderer2DSchema } from '@ecs/rendering';
import { UiCanvas, UiText, uiSchemas } from '@ecs/ui';
import { ScriptBinding, scriptBindingSchema } from '../../apps/editor/src/script-binding.ts';
import { encodeProjectArchive } from '../../apps/editor/src/project-storage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../../apps/editor/public/pong.ecsproj');
const whitePixelAssetId = 'asset:pong:white-pixel';
const centerLineAssetId = 'asset:pong:center-line';
const Name = defineComponent<{ value: string }>('Name');
const nameSchema = defineComponentSchema({
  typeId: 'engine.name', displayName: 'Name', version: 1, component: Name,
  fields: { value: { type: 'string', label: 'Name', default: 'Object' } },
});
const schemas = new SchemaRegistry();
registerBuiltInSceneSchemas(schemas);
for (const schema of [nameSchema, spriteRenderer2DSchema, ...uiSchemas, scriptBindingSchema]) schemas.register(schema);
const codec = new SceneCodec(schemas);
const world = new World();
const entities = new Map<string, ReturnType<World['createEntity']>>();
function entity(id: string, name: string, x = 0, y = 0) {
  const result = world.createEntity(); entities.set(id, result);
  world.addComponent(result, Name, { value: name });
  world.addComponent(result, Transform2D, { x, y, rotation: 0, scaleX: 1, scaleY: 1 });
  return result;
}
function rectangle(id: string, name: string, x: number, y: number, width: number, height: number, tint: string, order = 0, assetId = whitePixelAssetId) {
  const result = entity(id, name, x, y);
  world.addComponent(result, SpriteRenderer2D, { asset: { assetId }, region: null, width, height, tint, order });
  return result;
}

rectangle('left-paddle', 'Left Paddle · W / S', -4.5, 0, 0.22, 1.45, '#77c8ff', 2);
rectangle('right-paddle', 'Right Paddle · A / D', 4.5, 0, 0.22, 1.45, '#ffbd70', 2);
rectangle('ball', 'Ball', 0, 0, 0.28, 0.28, '#ffffff', 3);
rectangle('top-wall', 'Top Wall', 0, 3.35, 11, 0.08, '#424b5d', 1);
rectangle('bottom-wall', 'Bottom Wall', 0, -3.35, 11, 0.08, '#424b5d', 1);
rectangle('center-line', 'Center Line', 0, 0, 0.055, 6.12, '#485162', 1, centerLineAssetId);
const controller = entity('game-controller', 'Game Controller');
world.addComponent(controller, ScriptBinding, { enabled: true, codePath: 'scripts/pong.ts', graphPath: 'scripts/score.graph.json', speed: 5.5 });

const canvas = entity('ui-canvas', 'UI Canvas');
world.addComponent(canvas, UiCanvas, { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' });
function label(id: string, text: string, x: number, y: number, width: number, height: number, size: number, align: 'left' | 'center' | 'right' = 'center') {
  const item = entity(id, id, 0, 0); world.addComponent(item, Parent, { parentId: 'ui-canvas' });
  world.addComponent(item, UiText, { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: x, offsetMinY: y, offsetMaxX: x + width, offsetMaxY: y + height, text, color: '#e8edf7', fontSize: size, align });
}
label('score-left', '0', 310, 36, 70, 62, 40);
label('score-separator', '—', 380, 36, 40, 62, 26);
label('score-right', '0', 420, 36, 70, 62, 40);
label('game-title', 'PONG', 330, 4, 140, 28, 14);
label('controls', 'W / S  ·  LEFT PLAYER                         RIGHT PLAYER  ·  A / D', 180, 560, 440, 24, 12);

const scene = codec.serialize(world, entities, 'scene:pong');
const script = `// This script belongs to Game Controller and coordinates the other scene objects.
// W/S move the left paddle; A/D move the right paddle.
type Transform = engine.Components['engine.transform2d'];
type PongState = {
  velocityX: number;
  velocityY: number;
  serveTimer: number;
  leftScore: number;
  rightScore: number;
};

const ARENA = {
  paddleX: 4.5,
  paddleHalfWidth: 0.11,
  paddleReach: 0.92,
  paddleLimit: 2.55,
  ballLimitY: 3.05,
  goalX: 5.35,
  initialVelocityX: 4.1,
  initialVelocityY: 0.7,
  maximumVelocityX: 6.5,
};

function onStart(api: engine.ScriptApi) {
  api.subscribe('pong.scored');
}

function readState(value: unknown): PongState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      velocityX: ARENA.initialVelocityX,
      velocityY: ARENA.initialVelocityY,
      serveTimer: 0,
      leftScore: 0,
      rightScore: 0,
    };
  }

  const saved = value as Partial<PongState>;
  return {
    velocityX: saved.velocityX ?? ARENA.initialVelocityX,
    velocityY: saved.velocityY ?? ARENA.initialVelocityY,
    serveTimer: saved.serveTimer ?? 0,
    leftScore: saved.leftScore ?? 0,
    rightScore: saved.rightScore ?? 0,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function movePaddle(
  transform: Transform,
  direction: number,
  speed: number,
  deltaTime: number,
): Transform {
  return {
    ...transform,
    y: clamp(
      transform.y + direction * speed * deltaTime,
      -ARENA.paddleLimit,
      ARENA.paddleLimit,
    ),
  };
}

function updateBall(
  api: engine.ScriptApi,
  ball: Transform,
  leftPaddle: Transform,
  rightPaddle: Transform,
  state: PongState,
  deltaTime: number,
): Transform {
  if (state.serveTimer > 0) {
    state.serveTimer = Math.max(0, state.serveTimer - deltaTime);
    return ball;
  }

  let x = ball.x + state.velocityX * deltaTime;
  let y = ball.y + state.velocityY * deltaTime;

  if (y > ARENA.ballLimitY || y < -ARENA.ballLimitY) {
    y = clamp(y, -ARENA.ballLimitY, ARENA.ballLimitY);
    state.velocityY *= -1;
  }

  const leftBounce = tryBounceFromPaddle(x, y, leftPaddle, 'left', state);
  const rightBounce = leftBounce
    ? false
    : tryBounceFromPaddle(x, y, rightPaddle, 'right', state);

  if (leftBounce) x = -ARENA.paddleX + ARENA.paddleHalfWidth;
  if (rightBounce) x = ARENA.paddleX - ARENA.paddleHalfWidth;

  if (x < -ARENA.goalX || x > ARENA.goalX) {
    const missedLeftPaddle = x < 0;
    api.emit('pong.point', { scorer: missedLeftPaddle ? 'right' : 'left' });
    state.velocityX = missedLeftPaddle
      ? ARENA.initialVelocityX
      : -ARENA.initialVelocityX;
    state.velocityY = ARENA.initialVelocityY;
    state.serveTimer = 0.65;
    return { ...ball, x: 0, y: 0 };
  }

  return { ...ball, x, y };
}

function tryBounceFromPaddle(
  ballX: number,
  ballY: number,
  paddle: Transform,
  side: 'left' | 'right',
  state: PongState,
): boolean {
  const paddleX = side === 'left' ? -ARENA.paddleX : ARENA.paddleX;
  const isMovingTowardPaddle = side === 'left'
    ? state.velocityX < 0
    : state.velocityX > 0;
  const reachedPaddle = Math.abs(ballX - paddleX) <= ARENA.paddleHalfWidth + 0.14;
  const hitPaddle = Math.abs(ballY - paddle.y) < ARENA.paddleReach;

  if (!isMovingTowardPaddle || !reachedPaddle || !hitPaddle) return false;

  const hitOffset = (ballY - paddle.y) / ARENA.paddleReach;
  state.velocityX = clamp(
    Math.abs(state.velocityX) * 1.04,
    0,
    ARENA.maximumVelocityX,
  ) * (side === 'left' ? 1 : -1);
  state.velocityY = hitOffset * 2.8;
  return true;
}

function updateScore(api: engine.ScriptApi, state: PongState): void {
  let changed = false;
  for (const event of api.events) {
    if (event.type !== 'pong.scored') continue;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;

    const scorer = (event.payload as { scorer?: unknown }).scorer;
    if (scorer === 'left') {
      state.leftScore += 1;
      changed = true;
    }
    if (scorer === 'right') {
      state.rightScore += 1;
      changed = true;
    }
  }
  if (!changed) return;

  const leftScore = api.getEntityComponent('score-left', 'engine.uiText');
  const rightScore = api.getEntityComponent('score-right', 'engine.uiText');
  if (leftScore) {
    api.setEntityComponent('score-left', 'engine.uiText', {
      ...leftScore,
      text: String(state.leftScore),
    });
  }
  if (rightScore) {
    api.setEntityComponent('score-right', 'engine.uiText', {
      ...rightScore,
      text: String(state.rightScore),
    });
  }
}

function onUpdate(api: engine.ScriptApi) {
  const leftPaddle = api.getEntityComponent('left-paddle', 'engine.transform2d');
  const rightPaddle = api.getEntityComponent('right-paddle', 'engine.transform2d');
  const ball = api.getEntityComponent('ball', 'engine.transform2d');
  if (!leftPaddle || !rightPaddle || !ball) return;

  const state = readState(api.state);
  const deltaTime = Math.min(api.deltaTime, 0.05);
  const paddleSpeed = Number(api.properties.speed ?? 5.5);
  const nextLeftPaddle = movePaddle(
    leftPaddle,
    api.input.actions.moveY?.value ?? 0,
    paddleSpeed,
    deltaTime,
  );
  const nextRightPaddle = movePaddle(
    rightPaddle,
    api.input.actions.moveX?.value ?? 0,
    paddleSpeed,
    deltaTime,
  );

  api.setEntityComponent('left-paddle', 'engine.transform2d', nextLeftPaddle);
  api.setEntityComponent('right-paddle', 'engine.transform2d', nextRightPaddle);
  api.setEntityComponent(
    'ball',
    'engine.transform2d',
    updateBall(api, ball, nextLeftPaddle, nextRightPaddle, state, deltaTime),
  );

  updateScore(api, state);
  api.state = state;
}
`;
const graph = { version: 1, nodes: [
  { id: 'start', kind: 'event.onStart', x: 40, y: 100, data: {} },
  { id: 'subscribe', kind: 'event.subscribe', x: 230, y: 100, data: { eventType: 'pong.point' } },
  { id: 'on-point', kind: 'event.onEvent', x: 230, y: 270, data: { eventType: 'pong.point' } },
  { id: 'payload', kind: 'event.payload', x: 470, y: 330, data: { eventType: 'pong.point' } },
  { id: 'emit', kind: 'event.emit', x: 700, y: 100, data: { eventType: 'pong.scored' } },
  { id: 'end', kind: 'flow.end', x: 940, y: 100, data: {} },
  { id: 'start-end', kind: 'flow.end', x: 470, y: 400, data: {} },
], links: [
  { id: 'start-subscribe', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'subscribe', portId: 'exec' } },
  { id: 'subscribe-done', from: { nodeId: 'subscribe', portId: 'then' }, to: { nodeId: 'start-end', portId: 'exec' } },
  { id: 'event-flow', from: { nodeId: 'on-point', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
  { id: 'payload', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
  { id: 'done', from: { nodeId: 'emit', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
] };
const whitePixel = makeWhitePixelPng();
const centerLine = makeDashedLinePng();
const assets = [{
  assetId: whitePixelAssetId,
  path: 'Textures/Pong-White.png',
  name: 'Pong-White.png',
  kind: 'image' as const,
  mimeType: 'image/png',
  size: whitePixel.byteLength,
  revision: 1,
  data: whitePixel,
}, {
  assetId: centerLineAssetId,
  path: 'Textures/Pong-Center-Line.png',
  name: 'Pong-Center-Line.png',
  kind: 'image' as const,
  mimeType: 'image/png',
  size: centerLine.byteLength,
  revision: 1,
  data: centerLine,
}];
const archive = encodeProjectArchive('Pong', scene, assets, { 'scripts/pong.ts': script }, {}, { 'scripts/score.graph.json': graph });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive, 'utf8');
console.log(`Generated ${output}`);

function makeWhitePixelPng(): Uint8Array {
  return makePng(1, 1, Buffer.from([0, 255, 255, 255, 255]));
}

function makeDashedLinePng(): Uint8Array {
  const width = 4, height = 64;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const alpha = y % 8 < 4 ? 255 : 0;
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rows[offset] = 255; rows[offset + 1] = 255; rows[offset + 2] = 255; rows[offset + 3] = alpha;
    }
  }
  return makePng(width, height, rows);
}

function makePng(width: number, height: number, pixels: Buffer): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(body.length + 8);
    result.writeUInt32BE(data.length, 0);
    body.copy(result, 4);
    result.writeUInt32BE(crc32(body), body.length + 4);
    return result;
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
