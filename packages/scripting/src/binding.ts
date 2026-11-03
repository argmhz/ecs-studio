import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';

export interface ScriptBindingData {
  enabled: boolean;
  codePath: string;
  graphPath: string;
  speed: number;
}

export const ScriptBinding = defineComponent<ScriptBindingData>('ScriptBinding');

export const scriptBindingSchema = defineComponentSchema({
  typeId: 'engine.scriptBinding', displayName: 'Script Binding', version: 2,
  component: ScriptBinding,
  migrations: {
    1(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
      const { entryFunction: _entryFunction, ...binding } = data as Record<string, unknown>;
      return binding;
    },
  },
  fields: {
    enabled: { type: 'boolean', label: 'Enabled', default: true },
    codePath: { type: 'string', label: 'Code File', default: 'scripts/player.ts' },
    graphPath: { type: 'string', label: 'Node Graph', default: 'scripts/player.graph.json' },
    speed: { type: 'number', label: 'Speed', default: 5, min: 0, max: 100 },
  },
});
