import { defineComponent } from '@ecs/core';
import { defineComponentSchema } from '@ecs/scene';
import { defineScriptDefinition } from '@ecs/scripting';
import { EDITOR_PLUGIN_API_VERSION, type EditorPlugin } from './plugin-api';

export const PluginNote = defineComponent<{ text: string }>('PluginNote');
export const pluginNoteSchema = defineComponentSchema({
  typeId: 'example.plugin-note', displayName: 'Plugin Note', version: 1, component: PluginNote,
  fields: { text: { type: 'string', label: 'Text', default: 'Hello from a plugin' } },
});

export const sampleEditorPlugin: EditorPlugin = {
  manifest: { id: 'example.hello-plugin', name: 'Hello Plugin', version: '1.0.0', apiVersion: EDITOR_PLUGIN_API_VERSION },
  setup(api) {
    api.registerComponent(pluginNoteSchema);
    api.registerScript(defineScriptDefinition({ scriptId: 'example.hello-script', version: 1, properties: { message: { type: 'string', label: 'Message', default: 'Hello' } } }));
    api.registerImporter({
      id: 'example.png-alias', label: 'PNG alias',
      accepts: file => file.name.endsWith('.as-png') && file.type === 'image/png',
      async import(file, context) {
        const record = await context.importFile(file, `Textures/${file.name.replace(/\.as-png$/, '.png')}`);
        console.info(`Imported ${record.path} with the example plugin.`);
      },
    });
    api.registerEditorPanel({
      id: 'example.hello-panel', label: 'Plugin Demo',
      mount(host) {
        const heading = document.createElement('h3'); heading.textContent = 'Hello from the example plugin';
        const note = document.createElement('p'); note.textContent = 'This panel, component, script definition, and importer were registered by one versioned plugin.';
        host.replaceChildren(heading, note);
        return () => host.replaceChildren();
      },
    });
  },
};
