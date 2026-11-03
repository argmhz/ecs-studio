import assert from 'node:assert/strict';
import test from 'node:test';
import { WebAudioMixer, type AudioContextLike } from '../src/web-audio-mixer.ts';
import { World } from '@ecs/core';
import { SchemaRegistry, SceneCodec } from '@ecs/scene';
import { AudioSource2D, audioSource2DSchema } from '../src/source.ts';

function createMockContext() {
  const gains: { gain: { value: number }; connections: unknown[]; disconnect(): void }[] = [];
  const sources: { buffer: unknown; loop: boolean; connections: unknown[]; onended: (() => void) | null; started: number; stopped: number; connect(target: unknown): void; disconnect(): void; start(): void; stop(): void }[] = [];
  let decodeCount = 0; let resumeCount = 0; let closeCount = 0; let state = 'suspended';
  const destination = {} as AudioNode;
  const context: AudioContextLike = {
    destination,
    get state() { return state; },
    async resume() { resumeCount++; state = 'running'; },
    async suspend() { state = 'suspended'; },
    async decodeAudioData(_data) { decodeCount++; return { duration: 0.1 } as AudioBuffer; },
    createGain() {
      const gain = { gain: { value: 1 }, connections: [] as unknown[], connect(target: unknown) { this.connections.push(target); return this; }, disconnect() {} };
      gains.push(gain); return gain as unknown as GainNode;
    },
    createBufferSource() {
      const source = { buffer: null as unknown, loop: false, connections: [] as unknown[], onended: null as (() => void) | null, started: 0, stopped: 0,
        connect(target: unknown) { this.connections.push(target); return this; }, disconnect() {}, start() { this.started++; }, stop() { this.stopped++; this.onended?.(); } };
      sources.push(source); return source as unknown as AudioBufferSourceNode;
    },
    async close() { closeCount++; state = 'closed'; },
  };
  return { context, gains, sources, get decodeCount() { return decodeCount; }, get resumeCount() { return resumeCount; }, get closeCount() { return closeCount; } };
}

test('Web Audio mixer unlocks from gesture, caches clips, routes groups, clamps levels and stops owners', async () => {
  const mock = createMockContext();
  const mixer = new WebAudioMixer(() => mock.context);
  assert.equal(mock.gains.length, 3);
  mixer.setMasterVolume(2); mixer.setGroupVolume('music', -1);
  assert.equal(mock.gains[0]!.gain.value, 1);
  assert.equal(mock.gains[1]!.gain.value, 0);
  await assert.rejects(() => mixer.play('asset:music', new Uint8Array([1]), { ownerId: 'entity:1', group: 'music', volume: 0.5, loop: true }), /locked by the browser/);
  await mixer.unlock();
  const wav = new Uint8Array([1, 2, 3]);
  await mixer.play('asset:music', wav, { ownerId: 'entity:1', group: 'music', volume: 0.5, loop: true });
  await mixer.play('asset:music', wav, { ownerId: 'entity:1', group: 'music', volume: 0.25, loop: false });
  assert.equal(mock.decodeCount, 1);
  assert.equal(mock.sources.length, 2);
  assert.equal(mock.sources[0]!.started, 1);
  assert.equal(mock.sources[0]!.loop, true);
  assert.equal(mock.sources[0]!.connections[0], mock.gains[3]);
  mixer.stop('entity:1');
  assert.equal(mock.sources[0]!.stopped, 1);
  mixer.dispose(); mixer.dispose();
  assert.equal(mock.closeCount, 1);
});

test('Audio Source is schema-validated and survives a versioned scene round-trip', () => {
  const schemas = new SchemaRegistry(); schemas.register(audioSource2DSchema);
  const world = new World(); const entity = world.createEntity();
  world.addComponent(entity, AudioSource2D, { asset: { assetId: 'asset:music' }, group: 'music', volume: 0.65, loop: true, playOnStart: true });
  const codec = new SceneCodec(schemas);
  const loaded = codec.deserialize(codec.stringify(world, new Map([['music', entity]]), 'scene:audio'));
  assert.deepEqual(loaded.world.getComponent(loaded.entities.get('music')!, AudioSource2D), { asset: { assetId: 'asset:music' }, group: 'music', volume: 0.65, loop: true, playOnStart: true });
  assert.ok(audioSource2DSchema.validate({ asset: null, group: 'invalid', volume: 1, loop: false, playOnStart: false }).length > 0);
});
