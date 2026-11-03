import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetDatabase,
  AssetPipelineError,
  MemoryAssetStore,
} from '../src/index.ts';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const wav = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
const ogg = new Uint8Array([79, 103, 103, 83, 0]);

test('images and audio import with stable IDs and reload from the manifest/store', async () => {
  const store = new MemoryAssetStore();
  const database = await AssetDatabase.open(store, () => 'asset:stable-image');
  const image = await database.importAsset({ path: 'textures/hero.png', data: png, mimeType: 'image/png' });
  const audioDatabase = await AssetDatabase.open(store, () => 'asset:stable-audio');
  const audio = await audioDatabase.importAsset({ path: 'audio/theme.wav', data: wav, mimeType: 'audio/wav' });

  const reloaded = await AssetDatabase.open(store);
  assert.equal(reloaded.getAsset(image.assetId)?.kind, 'image');
  assert.equal(reloaded.getAsset(audio.assetId)?.kind, 'audio');
  assert.deepEqual(await reloaded.resolveAsset(image.assetId), { status: 'available', record: image, data: png });
  assert.deepEqual((await reloaded.resolveAsset(audio.assetId)).status, 'available');
});

test('reimport at the same path updates bytes and revision while keeping the asset ID', async () => {
  const database = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:hero');
  const first = await database.importAsset({ path: 'sprites/hero.png', data: png, mimeType: 'image/png' });
  const nextBytes = new Uint8Array([...png, 1]);
  const updated = await database.importAsset({ path: 'sprites/hero.png', data: nextBytes, mimeType: 'image/png' });

  assert.equal(updated.assetId, first.assetId);
  assert.equal(updated.revision, 2);
  assert.equal(updated.size, nextBytes.length);
  assert.deepEqual((await database.resolveAsset(first.assetId)).status, 'available');
});

test('moving an asset changes its path but scene references still resolve by stable ID', async () => {
  const store = new MemoryAssetStore();
  const database = await AssetDatabase.open(store, () => 'asset:player');
  const imported = await database.importAsset({ path: 'sprites/player.png', data: png });
  const moved = await database.moveAsset(imported.assetId, 'characters/player/avatar.png');
  const reopened = await AssetDatabase.open(store);

  assert.equal(moved.assetId, imported.assetId);
  assert.equal(moved.path, 'characters/player/avatar.png');
  assert.equal((await reopened.resolveAsset({ assetId: imported.assetId })).status, 'available');
});

test('missing files and unknown references have different states', async () => {
  const store = new MemoryAssetStore();
  const database = await AssetDatabase.open(store, () => 'asset:gone');
  const asset = await database.importAsset({ path: 'audio/voice.ogg', data: ogg, mimeType: 'audio/ogg' });
  await store.deleteAsset(asset.assetId);
  const reopened = await AssetDatabase.open(store);

  assert.deepEqual(await reopened.resolveAsset(asset.assetId), { status: 'missing', record: asset });
  assert.deepEqual(await reopened.resolveAsset('asset:unknown'), { status: 'unknown', assetId: 'asset:unknown' });
  assert.deepEqual(await reopened.getAssetStatuses(), [{ record: asset, status: 'missing' }]);
});

test('remove, duplicate paths, and path traversal are handled explicitly', async () => {
  let nextId = 1;
  const database = await AssetDatabase.open(new MemoryAssetStore(), () => `asset:${nextId++}`);
  const first = await database.importAsset({ path: 'images/one.jpg', data: jpeg, mimeType: 'image/jpeg' });
  await assert.rejects(() => database.moveAsset(first.assetId, '../two.jpg'), /invalid path segment/);
  const second = await database.importAsset({ path: 'images/two.jpg', data: jpeg, mimeType: 'image/jpeg' });
  await assert.rejects(() => database.moveAsset(first.assetId, second.path), /already in use/);
  assert.equal(await database.removeAsset(first.assetId), true);
  assert.equal(await database.removeAsset(first.assetId), false);
  assert.deepEqual(await database.resolveAsset(first.assetId), { status: 'unknown', assetId: first.assetId });
});

test('unsupported, mismatched, empty, and absolute assets are rejected', async () => {
  const database = await AssetDatabase.open(new MemoryAssetStore(), () => 'asset:bad');
  await assert.rejects(() => database.importAsset({ path: 'script.js', data: png }), /Unsupported image or audio type/);
  await assert.rejects(() => database.importAsset({ path: 'image.png', data: png, mimeType: 'audio/wav' }), /does not match MIME type/);
  await assert.rejects(() => database.importAsset({ path: 'image.png', data: new Uint8Array() }), /empty/);
  await assert.rejects(() => database.importAsset({ path: 'image.png', data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }), /does not match its declared MIME type/);
  await assert.rejects(() => database.importAsset({ path: 'image.jpg', data: png, mimeType: 'image/jpeg' }), /does not match its declared MIME type/);
  await assert.rejects(() => database.importAsset({ path: '/image.png', data: png }), /must be relative/);
  await assert.rejects(() => database.moveAsset('unknown', 'image.png'), AssetPipelineError);
});

test('invalid manifests fail with a useful error', async () => {
  const store = new MemoryAssetStore();
  await store.writeManifest('{');
  await assert.rejects(() => AssetDatabase.open(store), /Could not parse asset manifest/);
  await store.writeManifest(JSON.stringify({ format: 'ecs-assets', version: 42, assets: [] }));
  await assert.rejects(() => AssetDatabase.open(store), /Unsupported asset manifest version 42/);
});
