import type { ComponentSchema } from '@ecs/scene';
import type { ScriptDefinition } from '@ecs/scripting';
import type { AssetRecord } from '@ecs/assets';

export const EDITOR_PLUGIN_API_VERSION = '1.0.0' as const;

export interface EditorPluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
}

export interface PluginAssetImporter {
  readonly id: string;
  readonly label: string;
  accepts(file: File): boolean;
  import(file: File, context: { importFile(file: File, path?: string): Promise<AssetRecord> }): Promise<void>;
}

export interface PluginEditorPanel {
  readonly id: string;
  readonly label: string;
  mount(host: HTMLElement): void | (() => void);
}

export interface EditorPluginApi {
  registerComponent(schema: ComponentSchema): void;
  registerScript(definition: ScriptDefinition): void;
  registerImporter(importer: PluginAssetImporter): void;
  registerEditorPanel(panel: PluginEditorPanel): void;
}

export interface EditorPlugin {
  readonly manifest: EditorPluginManifest;
  setup(api: EditorPluginApi): void;
}

export interface EditorPluginHost {
  registerComponent(pluginId: string, schema: ComponentSchema): () => void;
  registerScript(pluginId: string, definition: ScriptDefinition): () => void;
  registerImporter(pluginId: string, importer: PluginAssetImporter): () => void;
  registerEditorPanel(pluginId: string, panel: PluginEditorPanel): () => void;
  canUnload?(pluginId: string): string | undefined;
}

/** Owns plugin registrations and rolls back every contribution if setup fails. */
export class EditorPluginManager {
  private readonly loaded = new Map<string, { plugin: EditorPlugin; disposers: (() => void)[] }>();
  private readonly host: EditorPluginHost;

  constructor(host: EditorPluginHost) { this.host = host; }

  list(): readonly EditorPluginManifest[] {
    return [...this.loaded.values()].map(({ plugin }) => plugin.manifest);
  }

  load(plugin: EditorPlugin): void {
    const { id, name, version, apiVersion } = plugin.manifest;
    if (!/^[a-z][a-z0-9.-]*$/.test(id)) throw new TypeError(`Invalid plugin ID "${id}".`);
    if (!name.trim() || !version.trim()) throw new TypeError('Plugin name and version are required.');
    if (apiVersion !== EDITOR_PLUGIN_API_VERSION) throw new Error(`Plugin "${id}" requires API ${apiVersion}; this editor provides ${EDITOR_PLUGIN_API_VERSION}.`);
    if (this.loaded.has(id)) throw new Error(`Plugin "${id}" is already loaded.`);
    const disposers: (() => void)[] = [];
    const track = (dispose: () => void) => disposers.push(dispose);
    const api: EditorPluginApi = {
      registerComponent: schema => track(this.host.registerComponent(id, schema)),
      registerScript: definition => track(this.host.registerScript(id, definition)),
      registerImporter: importer => track(this.host.registerImporter(id, importer)),
      registerEditorPanel: panel => track(this.host.registerEditorPanel(id, panel)),
    };
    try {
      plugin.setup(api);
      this.loaded.set(id, { plugin, disposers });
    } catch (error) {
      const cleanupErrors = disposeAll(disposers);
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], `Plugin "${id}" setup failed and rollback reported cleanup errors.`);
      throw error;
    }
  }

  unload(id: string): void {
    const registration = this.loaded.get(id);
    if (!registration) return;
    const reason = this.host.canUnload?.(id);
    if (reason) throw new Error(reason);
    this.loaded.delete(id);
    const errors = disposeAll(registration.disposers);
    if (errors.length) throw new AggregateError(errors, `Plugin "${id}" unloaded with cleanup errors.`);
  }
}

function disposeAll(disposers: readonly (() => void)[]): unknown[] {
  const errors: unknown[] = [];
  for (const dispose of [...disposers].reverse()) try { dispose(); } catch (error) { errors.push(error); }
  return errors;
}
