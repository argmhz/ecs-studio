export const ASSET_MANIFEST_FORMAT = 'ecs-assets';
export const ASSET_MANIFEST_VERSION = 1;

export type AssetKind = 'image' | 'audio';

export interface AssetReference {
  readonly assetId: string;
}

export interface AssetRecord {
  readonly assetId: string;
  readonly path: string;
  readonly name: string;
  readonly kind: AssetKind;
  readonly mimeType: string;
  readonly size: number;
  readonly revision: number;
}

export interface AssetManifest {
  readonly format: typeof ASSET_MANIFEST_FORMAT;
  readonly version: number;
  readonly assets: readonly AssetRecord[];
}

export interface AssetInput {
  readonly path: string;
  readonly data: Uint8Array;
  readonly mimeType?: string;
}

export interface AssetStore {
  readManifest(): Promise<string | undefined>;
  writeManifest(contents: string): Promise<void>;
  readAsset(assetId: string): Promise<Uint8Array | undefined>;
  writeAsset(assetId: string, data: Uint8Array): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
}

export type AssetResolution =
  | { readonly status: 'available'; readonly record: AssetRecord; readonly data: Uint8Array }
  | { readonly status: 'missing'; readonly record: AssetRecord }
  | { readonly status: 'unknown'; readonly assetId: string };

export type AssetIdFactory = () => string;

export class AssetPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetPipelineError';
  }
}

const MIME_TO_KIND = new Map<string, { kind: AssetKind; canonicalMime: string; extension: string }>([
  ['image/png', { kind: 'image', canonicalMime: 'image/png', extension: 'png' }],
  ['image/jpeg', { kind: 'image', canonicalMime: 'image/jpeg', extension: 'jpg' }],
  ['image/webp', { kind: 'image', canonicalMime: 'image/webp', extension: 'webp' }],
  ['image/gif', { kind: 'image', canonicalMime: 'image/gif', extension: 'gif' }],
  ['audio/mpeg', { kind: 'audio', canonicalMime: 'audio/mpeg', extension: 'mp3' }],
  ['audio/wav', { kind: 'audio', canonicalMime: 'audio/wav', extension: 'wav' }],
  ['audio/x-wav', { kind: 'audio', canonicalMime: 'audio/wav', extension: 'wav' }],
  ['audio/ogg', { kind: 'audio', canonicalMime: 'audio/ogg', extension: 'ogg' }],
  ['audio/mp4', { kind: 'audio', canonicalMime: 'audio/mp4', extension: 'm4a' }],
  ['audio/aac', { kind: 'audio', canonicalMime: 'audio/aac', extension: 'aac' }],
  ['audio/webm', { kind: 'audio', canonicalMime: 'audio/webm', extension: 'webm' }],
]);

const EXTENSION_TO_MIME = new Map<string, string>([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif'],
  ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'], ['webm', 'audio/webm'],
]);

/** Stable-ID catalog over an application-provided persistence store. */
export class AssetDatabase {
  private readonly records = new Map<string, AssetRecord>();
  private readonly idByPath = new Map<string, string>();
  private readonly store: AssetStore;
  private readonly createId: AssetIdFactory;

  private constructor(store: AssetStore, createId: AssetIdFactory) {
    this.store = store;
    this.createId = createId;
  }

  static async open(store: AssetStore, createId: AssetIdFactory = defaultAssetId): Promise<AssetDatabase> {
    const database = new AssetDatabase(store, createId);
    const text = await store.readManifest();
    if (text === undefined) return database;
    let manifest: unknown;
    try {
      manifest = JSON.parse(text) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid JSON.';
      throw new AssetPipelineError(`Could not parse asset manifest: ${reason}`);
    }
    database.loadManifest(manifest);
    return database;
  }

  listAssets(): readonly AssetRecord[] {
    return [...this.records.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  getAsset(assetId: string): AssetRecord | undefined {
    return this.records.get(assetId);
  }

  async importAsset(input: AssetInput): Promise<AssetRecord> {
    const path = normalizeAssetPath(input.path);
    const media = resolveMediaType(path, input.mimeType);
    if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0) {
      throw new AssetPipelineError(`Asset "${path}" is empty or does not contain byte data.`);
    }
    const detectedMimeType = sniffAssetMimeType(input.data);
    if (!detectedMimeType || detectedMimeType !== media.mimeType) {
      throw new AssetPipelineError(`File data in "${path}" does not match its declared MIME type "${media.mimeType}".`);
    }
    const previousId = this.idByPath.get(path);
    const assetId = previousId ?? this.createId();
    if (!assetId.trim()) throw new AssetPipelineError('Asset ID factory returned an empty ID.');
    if (!previousId && this.records.has(assetId)) throw new AssetPipelineError(`Asset ID "${assetId}" is already in use.`);
    const previous = previousId ? this.records.get(previousId) : undefined;
    if (previous && previous.kind !== media.kind) {
      throw new AssetPipelineError(`Cannot reimport "${path}" as ${media.kind}; its existing type is ${previous.kind}.`);
    }

    const record: AssetRecord = {
      assetId,
      path,
      name: fileName(path),
      kind: media.kind,
      mimeType: media.mimeType,
      size: input.data.byteLength,
      revision: previous ? previous.revision + 1 : 1,
    };
    const previousData = previous ? await this.store.readAsset(assetId) : undefined;
    await this.store.writeAsset(assetId, input.data.slice());
    this.records.set(assetId, record);
    this.idByPath.set(path, assetId);
    try {
      await this.persistManifest();
    } catch (error) {
      if (previous) {
        this.records.set(assetId, previous);
        if (previousData) await this.store.writeAsset(assetId, previousData);
        else await this.store.deleteAsset(assetId);
      } else {
        this.records.delete(assetId);
        this.idByPath.delete(path);
        await this.store.deleteAsset(assetId);
      }
      throw error;
    }
    return record;
  }

  async importFile(file: Blob & { readonly name: string }, path = file.name): Promise<AssetRecord> {
    const data = new Uint8Array(await file.arrayBuffer());
    return this.importAsset({ path, data, mimeType: file.type || undefined });
  }

  async moveAsset(assetId: string, nextPath: string): Promise<AssetRecord> {
    const current = this.requireAsset(assetId);
    const path = normalizeAssetPath(nextPath);
    const occupiedBy = this.idByPath.get(path);
    if (occupiedBy && occupiedBy !== assetId) throw new AssetPipelineError(`Asset path "${path}" is already in use.`);
    const next = { ...current, path, name: fileName(path) };
    this.records.set(assetId, next);
    this.idByPath.delete(current.path);
    this.idByPath.set(path, assetId);
    try {
      await this.persistManifest();
    } catch (error) {
      this.records.set(assetId, current);
      this.idByPath.delete(path);
      this.idByPath.set(current.path, assetId);
      throw error;
    }
    return next;
  }

  async removeAsset(assetId: string): Promise<boolean> {
    const current = this.records.get(assetId);
    if (!current) return false;
    this.records.delete(assetId);
    this.idByPath.delete(current.path);
    try {
      await this.persistManifest();
    } catch (error) {
      this.records.set(assetId, current);
      this.idByPath.set(current.path, assetId);
      throw error;
    }
    await this.store.deleteAsset(assetId);
    return true;
  }

  async resolveAsset(reference: AssetReference | string): Promise<AssetResolution> {
    const assetId = typeof reference === 'string' ? reference : reference.assetId;
    const record = this.records.get(assetId);
    if (!record) return { status: 'unknown', assetId };
    const data = await this.store.readAsset(assetId);
    if (!data) return { status: 'missing', record };
    return { status: 'available', record, data: data.slice() };
  }

  async getAssetStatuses(): Promise<readonly { readonly record: AssetRecord; readonly status: 'available' | 'missing' }[]> {
    const statuses = await Promise.all(this.listAssets().map(async record => ({
      record,
      status: (await this.store.readAsset(record.assetId)) ? 'available' as const : 'missing' as const,
    })));
    return statuses;
  }

  private requireAsset(assetId: string): AssetRecord {
    const record = this.records.get(assetId);
    if (!record) throw new AssetPipelineError(`Unknown asset ID "${assetId}".`);
    return record;
  }

  private async persistManifest(): Promise<void> {
    const manifest: AssetManifest = {
      format: ASSET_MANIFEST_FORMAT,
      version: ASSET_MANIFEST_VERSION,
      assets: this.listAssets(),
    };
    await this.store.writeManifest(JSON.stringify(manifest, null, 2));
  }

  private loadManifest(input: unknown): void {
    if (!isRecord(input) || input.format !== ASSET_MANIFEST_FORMAT) {
      throw new AssetPipelineError(`Expected an asset manifest with format "${ASSET_MANIFEST_FORMAT}".`);
    }
    if (input.version !== ASSET_MANIFEST_VERSION) {
      throw new AssetPipelineError(`Unsupported asset manifest version ${String(input.version)}; expected ${ASSET_MANIFEST_VERSION}.`);
    }
    if (!Array.isArray(input.assets)) throw new AssetPipelineError('Asset manifest "assets" must be an array.');
    for (let index = 0; index < input.assets.length; index++) {
      const value = input.assets[index];
      const path = `assets[${index}]`;
      if (!isRecord(value)) throw new AssetPipelineError(`${path} must be an asset record.`);
      if (typeof value.assetId !== 'string' || !value.assetId.trim()) throw new AssetPipelineError(`${path}.assetId must be a non-empty stable ID.`);
      const normalizedPath = normalizeAssetPath(String(value.path));
      if (typeof value.name !== 'string' || value.name !== fileName(normalizedPath)) throw new AssetPipelineError(`${path}.name must match its project path.`);
      if (value.kind !== 'image' && value.kind !== 'audio') throw new AssetPipelineError(`${path}.kind must be image or audio.`);
      const media = MIME_TO_KIND.get(String(value.mimeType).toLowerCase());
      if (!media || media.kind !== value.kind) throw new AssetPipelineError(`${path}.mimeType is not supported for ${String(value.kind)} assets.`);
      if (!Number.isSafeInteger(value.size) || (value.size as number) < 1) throw new AssetPipelineError(`${path}.size must be a positive integer.`);
      if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) throw new AssetPipelineError(`${path}.revision must be a positive integer.`);
      if (this.records.has(value.assetId)) throw new AssetPipelineError(`${path}.assetId "${value.assetId}" is duplicated.`);
      if (this.idByPath.has(normalizedPath)) throw new AssetPipelineError(`${path}.path "${normalizedPath}" is duplicated.`);
      const record: AssetRecord = {
        assetId: value.assetId,
        path: normalizedPath,
        name: value.name,
        kind: value.kind,
        mimeType: media.canonicalMime,
        size: value.size as number,
        revision: value.revision as number,
      };
      this.records.set(record.assetId, record);
      this.idByPath.set(record.path, record.assetId);
    }
  }
}

/** Simple persistence adapter for previews, tests and short-lived projects. */
export class MemoryAssetStore implements AssetStore {
  private manifest?: string;
  private readonly assets = new Map<string, Uint8Array>();

  async readManifest(): Promise<string | undefined> {
    return this.manifest;
  }

  async writeManifest(contents: string): Promise<void> {
    this.manifest = contents;
  }

  async readAsset(assetId: string): Promise<Uint8Array | undefined> {
    return this.assets.get(assetId)?.slice();
  }

  async writeAsset(assetId: string, data: Uint8Array): Promise<void> {
    this.assets.set(assetId, data.slice());
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assets.delete(assetId);
  }
}

function normalizeAssetPath(path: string): string {
  if (typeof path !== 'string' || !path.trim()) throw new AssetPipelineError('Asset path must not be empty.');
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new AssetPipelineError(`Asset path "${path}" must be relative to the project.`);
  }
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new AssetPipelineError(`Asset path "${path}" contains an invalid path segment.`);
  }
  return segments.join('/');
}

function resolveMediaType(path: string, requestedMimeType?: string): { kind: AssetKind; mimeType: string } {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const extensionMime = EXTENSION_TO_MIME.get(extension);
  const requested = requestedMimeType?.split(';', 1)[0]?.trim().toLowerCase();
  const mimeType = requested || extensionMime;
  const media = mimeType ? MIME_TO_KIND.get(mimeType) : undefined;
  if (!media) throw new AssetPipelineError(`Unsupported image or audio type for "${path}"${requested ? ` (${requested})` : ''}.`);
  if (extensionMime && MIME_TO_KIND.get(extensionMime)?.canonicalMime !== media.canonicalMime) {
    throw new AssetPipelineError(`File extension in "${path}" does not match MIME type "${media.canonicalMime}".`);
  }
  return { kind: media.kind, mimeType: media.canonicalMime };
}

function sniffAssetMimeType(data: Uint8Array): string | undefined {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  const textAt = (offset: number, text: string) =>
    [...text].every((character, index) => data[offset + index] === character.charCodeAt(0));
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (textAt(0, 'GIF87a') || textAt(0, 'GIF89a')) return 'image/gif';
  if (textAt(0, 'RIFF') && textAt(8, 'WEBP')) return 'image/webp';
  if (textAt(0, 'RIFF') && textAt(8, 'WAVE')) return 'audio/wav';
  if (textAt(0, 'OggS')) return 'audio/ogg';
  if (textAt(0, 'ID3')) return 'audio/mpeg';
  if (textAt(4, 'ftyp')) return 'audio/mp4';
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'audio/webm';
  if (data[0] === 0xff && ((data[1] ?? 0) & 0xf6) === 0xf0) return 'audio/aac';
  if (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return undefined;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function defaultAssetId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `asset:${globalThis.crypto.randomUUID()}`;
  throw new AssetPipelineError('No secure UUID generator is available; provide an AssetIdFactory.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
