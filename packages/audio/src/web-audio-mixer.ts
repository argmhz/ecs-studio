import type { AudioGroup } from './source.ts';

export interface AudioPlayOptions {
  readonly ownerId: string;
  readonly group: AudioGroup;
  readonly volume: number;
  readonly loop: boolean;
}

/** Small structural surface so tests can inject a deterministic Web Audio context. */
export interface AudioContextLike {
  readonly destination: AudioNode;
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  close(): Promise<void>;
}

export interface AudioMixer {
  unlock(): Promise<void>;
  pause(): Promise<void>;
  setMasterVolume(value: number): void;
  setGroupVolume(group: AudioGroup, value: number): void;
  play(assetId: string, bytes: Uint8Array, options: AudioPlayOptions): Promise<void>;
  stop(ownerId: string): void;
  stopAll(): void;
  dispose(): void;
}

/** Web Audio mixer with independent master/music/effects gains and cached decoded clips. */
export class WebAudioMixer implements AudioMixer {
  private readonly context: AudioContextLike;
  private readonly master: GainNode;
  private readonly groups: Record<AudioGroup, GainNode>;
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();
  private readonly sources = new Map<string, Set<AudioBufferSourceNode>>();
  private disposed = false;

  constructor(createContext: () => AudioContextLike = () => new AudioContext() as AudioContextLike) {
    this.context = createContext();
    this.master = this.context.createGain();
    this.groups = { music: this.context.createGain(), effects: this.context.createGain() };
    this.groups.music.connect(this.master);
    this.groups.effects.connect(this.master);
    this.master.connect(this.context.destination);
    this.master.gain.value = 1;
    this.groups.music.gain.value = 1;
    this.groups.effects.gain.value = 1;
  }

  async unlock(): Promise<void> {
    this.assertActive();
    if (this.context.state !== 'running') await this.context.resume();
  }

  async pause(): Promise<void> { this.assertActive(); if (this.context.state === 'running') await this.context.suspend(); }

  setMasterVolume(value: number): void { this.master.gain.value = normalizedVolume(value); }
  setGroupVolume(group: AudioGroup, value: number): void { this.groups[group].gain.value = normalizedVolume(value); }

  async play(assetId: string, bytes: Uint8Array, options: AudioPlayOptions): Promise<void> {
    this.assertActive();
    if (!assetId.trim() || !options.ownerId.trim()) throw new TypeError('Audio asset and owner IDs must not be empty.');
    if (this.context.state !== 'running') throw new Error('Audio is locked by the browser. Press Play or interact with the game first.');
    if (!Number.isFinite(options.volume) || options.volume < 0 || options.volume > 1) throw new RangeError('Audio source volume must be between 0 and 1.');
    let decoded = this.decoded.get(assetId);
    if (!decoded) {
      const copy = bytes.slice().buffer;
      decoded = this.context.decodeAudioData(copy).catch(error => { this.decoded.delete(assetId); throw error; });
      this.decoded.set(assetId, decoded);
    }
    const buffer = await decoded;
    this.assertActive();
    const source = this.context.createBufferSource();
    const sourceGain = this.context.createGain();
    source.buffer = buffer;
    source.loop = options.loop;
    sourceGain.gain.value = options.volume;
    source.connect(sourceGain);
    sourceGain.connect(this.groups[options.group]);
    const active = this.sources.get(options.ownerId) ?? new Set<AudioBufferSourceNode>();
    active.add(source);
    this.sources.set(options.ownerId, active);
    source.onended = () => {
      active.delete(source);
      if (!active.size) this.sources.delete(options.ownerId);
      source.disconnect(); sourceGain.disconnect();
    };
    source.start();
  }

  stop(ownerId: string): void {
    for (const source of this.sources.get(ownerId) ?? []) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.sources.delete(ownerId);
  }

  stopAll(): void { for (const ownerId of this.sources.keys()) this.stop(ownerId); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    void this.context.close();
  }

  private assertActive(): void { if (this.disposed) throw new Error('Audio mixer has been disposed.'); }
}

function normalizedVolume(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('Audio volume must be finite.');
  return Math.max(0, Math.min(1, value));
}
