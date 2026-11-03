import { defineComponent } from '@ecs/core';
import { defineComponentSchema, type AssetReference } from '@ecs/scene';

export type AudioGroup = 'music' | 'effects';

export interface AudioSource2DData {
  asset: AssetReference | null;
  group: AudioGroup;
  volume: number;
  loop: boolean;
  playOnStart: boolean;
}

export const AudioSource2D = defineComponent<AudioSource2DData>('AudioSource2D');

export const audioSource2DSchema = defineComponentSchema({
  typeId: 'engine.audioSource2d',
  displayName: 'Audio Source 2D',
  version: 1,
  component: AudioSource2D,
  fields: {
    asset: { type: 'asset', label: 'Audio Clip', default: null, kind: 'audio' },
    group: { type: 'enum', label: 'Volume Group', default: 'effects', options: ['effects', 'music'] },
    volume: { type: 'number', label: 'Volume', default: 1, min: 0, max: 1 },
    loop: { type: 'boolean', label: 'Loop', default: false },
    playOnStart: { type: 'boolean', label: 'Play On Start', default: false },
  },
});
