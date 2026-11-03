# Editor plugins (prototype)

The editor has a versioned plugin API at `apps/editor/src/plugin-api.ts`. A plugin provides a stable `id`, plugin `version`, exact `apiVersion`, and a `setup(api)` function. API version `1.0.0` supports component schemas, script definitions, asset importers, and editor panels. Every registration is removed together when the plugin unloads; setup failures roll back earlier registrations.

`Load Example Plugin` loads the bundled Hello Plugin. Its `Plugin Note` component is available in the Inspector, its PNG-alias importer accepts PNG files ending in `.as-png`, and its workbench tab demonstrates a plugin panel. Remove any `Plugin Note` components from the scene before unloading; the editor blocks unload while contributed component data is still in use.

Plugins are trusted editor code. They execute in the editor's browser origin and can access browser APIs and project data available to that origin. The plugin API is a compatibility contract, not a sandbox or permission boundary. Only load plugins from sources you trust. Gameplay scripts remain isolated separately. This prototype does not install external packages or offer a permissions prompt.
