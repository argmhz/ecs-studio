import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { SchemaRegistry } from '@ecs/scene';
import { DEFAULT_INPUT_ACTIONS, type InputActionDefinition } from '@ecs/runtime';

(globalThis as typeof globalThis & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker() : new EditorWorker();
  },
};

function generateEngineTypes(schemas: SchemaRegistry, scriptProperties: Readonly<Record<string, import('@ecs/scene').FieldDefinition>>, inputActions: readonly InputActionDefinition[]) {
  const fieldScriptType = (field: import('@ecs/scene').FieldDefinition) => field.type === 'asset' ? '{ assetId: string } | null' : field.type === 'sprite-region' ? '{ atlasId: string; regionId: string } | null' : field.type === 'entity' ? 'string | null' : field.type === 'color' ? 'string' : field.type === 'enum' ? field.options.map(option => JSON.stringify(option)).join(' | ') : field.type;
  const components = schemas.all().map(schema => {
    const fields = Object.entries(schema.fields).map(([name, field]) => {
      return `    ${JSON.stringify(name)}: ${fieldScriptType(field)};`;
    }).join('\n');
    return `  interface ${componentTypeName(schema.typeId)} {\n${fields}\n  }`;
  }).join('\n');
  const ids = schemas.all().map(schema => JSON.stringify(schema.typeId)).join(' | ') || 'never';
  const propertyFields = Object.entries(scriptProperties).map(([name, field]) => `    ${JSON.stringify(name)}: ${fieldScriptType(field)};`).join('\n');
  const actionFields = inputActions.map(action => `      ${JSON.stringify(action.name)}: InputActionState;`).join('\n');
  return `
/** Generated from the same component schemas used by the Inspector. */
declare namespace engine {
  type ComponentTypeId = ${ids};
  interface InputActionState { readonly value: number; readonly pressed: boolean; readonly justPressed: boolean; readonly justReleased: boolean; }
${components}
  interface Components {\n${schemas.all().map(schema => `    ${JSON.stringify(schema.typeId)}: ${componentTypeName(schema.typeId)};`).join('\n')}\n  }
  interface ScriptApi {
    readonly entityId: string; readonly phase: 'create' | 'start' | 'update' | 'fixedUpdate' | 'event' | 'destroy';
    readonly deltaTime: number; readonly properties: Readonly<{\n${propertyFields}\n    }>;
    readonly input: { readonly actions: Readonly<{\n${actionFields}\n    }>; readonly pointer: { readonly x: number; readonly y: number; readonly inside: boolean; readonly primary: boolean; readonly secondary: boolean }; readonly connectedGamepads: readonly number[] };
    readonly events: readonly { type: string; payload: unknown }[]; state: unknown;
    getComponent<T extends ComponentTypeId>(typeId: T): Components[T] | undefined;
    getEntityComponent<T extends ComponentTypeId>(entityId: string, typeId: T): Components[T] | undefined;
    setComponent<T extends ComponentTypeId>(typeId: T, data: Components[T]): void;
    setEntityComponent<T extends ComponentTypeId>(entityId: string, typeId: T, data: Components[T]): void;
    addComponent<T extends ComponentTypeId>(typeId: T, data: Components[T]): void;
    addEntityComponent<T extends ComponentTypeId>(entityId: string, typeId: T, data: Components[T]): void;
    removeComponent(typeId: ComponentTypeId): void;
    removeEntityComponent(entityId: string, typeId: ComponentTypeId): void;
    subscribe(eventType: string): void; unsubscribe(eventType: string): void;
    on(eventType: string, listener: (event: { type: string; payload: unknown }, api: ScriptApi) => void | Promise<void>): void;
    off(eventType: string, listener: (event: { type: string; payload: unknown }, api: ScriptApi) => void | Promise<void>): void;
    emit(eventType: string, payload?: unknown): void;
  }
}
`;
}

function componentTypeName(typeId: string) {
  const parts = typeId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return `Component_${parts.map(part => part[0]!.toUpperCase() + part.slice(1)).join('')}`;
}

export function createCodeEditor(container: HTMLElement, schemas: SchemaRegistry, scriptProperties: Readonly<Record<string, import('@ecs/scene').FieldDefinition>>, files: Readonly<Record<string, string>>, onChange: (files: Readonly<Record<string, string>>) => void, initialInputActions: readonly InputActionDefinition[] = DEFAULT_INPUT_ACTIONS) {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  defaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.None,
    strict: true,
    allowNonTsExtensions: true,
  });
  defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  defaults.setEagerModelSync(true);
  let types = defaults.addExtraLib(generateEngineTypes(schemas, scriptProperties, initialInputActions), 'file:///engine.d.ts');
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;
  jsDefaults.setCompilerOptions({ allowNonTsExtensions: true, checkJs: true, target: monaco.languages.typescript.ScriptTarget.ES2020 });
  jsDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  jsDefaults.setEagerModelSync(true);
  let jsTypes = jsDefaults.addExtraLib(generateEngineTypes(schemas, scriptProperties, initialInputActions), 'file:///engine-js.d.ts');
  const models = new Map<string, monaco.editor.ITextModel>();
  for (const [path, source] of Object.entries(files)) {
    const language = path.endsWith('.js') ? 'javascript' : 'typescript';
    models.set(path, monaco.editor.createModel(source, language, monaco.Uri.parse(`file:///project/${path}`)));
  }
  const activeFile = Object.keys(files).includes('scripts/player.ts') ? 'scripts/player.ts' : Object.keys(files)[0]!;
  const model = models.get(activeFile)!;
  const editor = monaco.editor.create(container, {
    model, theme: 'vs-dark', automaticLayout: true,
    fontSize: 13, lineHeight: 22, minimap: { enabled: false },
    scrollBeyondLastLine: false, padding: { top: 20 }, tabSize: 2,
  });
  const subscriptions = [...models.entries()].map(([path, fileModel]) => fileModel.onDidChangeContent(() => onChange(Object.fromEntries([...models].map(([filePath, value]) => [filePath, value.getValue()])))));
  return {
    editor,
    setInputActions(actions: readonly InputActionDefinition[]) {
      types.dispose(); jsTypes.dispose();
      const definition = generateEngineTypes(schemas, scriptProperties, actions);
      types = defaults.addExtraLib(definition, 'file:///engine.d.ts');
      jsTypes = jsDefaults.addExtraLib(definition, 'file:///engine-js.d.ts');
    },
    getValue(path = 'scripts/player.ts') { return models.get(path)?.getValue() ?? ''; },
    getActiveFile() { return editor.getModel()?.uri.path.replace(/^\/project\//, '') ?? 'scripts/player.ts'; },
    revealLine(line: number) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); editor.focus(); },
    selectFile(path: string) { const next = models.get(path); if (!next) return false; editor.setModel(next); editor.focus(); return true; },
    async compileFiles(entryPath = 'scripts/player.ts') {
      const paths = [...models.keys()];
      const entryStem = entryPath.replace(/\.(ts|js)$/, '');
      const orderedPaths = [...paths.filter(path => path !== entryPath && path.replace(/\.(ts|js)$/, '') !== entryStem), ...paths.filter(path => path === entryPath)];
      let getWorker: Awaited<ReturnType<typeof monaco.languages.typescript.getTypeScriptWorker>> | undefined;
      for (let attempt = 0; attempt < 20 && !getWorker; attempt++) {
        try { getWorker = await monaco.languages.typescript.getTypeScriptWorker(); }
        catch (error) {
          if (!String(error).includes('not registered') || attempt === 19) throw error;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      if (!getWorker) throw new Error('TypeScript worker did not become ready.');
      const worker = await getWorker(...orderedPaths.map(path => models.get(path)!.uri));
      const output = new Map<string, string>();
      for (const path of orderedPaths.filter(filePath => filePath.endsWith('.ts'))) {
        const fileModel = models.get(path)!;
        const fileName = fileModel.uri.toString();
        const [syntax, semantic, emitted] = await Promise.all([
          worker.getSyntacticDiagnostics(fileName), worker.getSemanticDiagnostics(fileName), worker.getEmitOutput(fileName),
        ]);
        const issue = [...syntax, ...semantic, ...(emitted.diagnostics ?? [])].find(diagnostic => diagnostic.category === 1 && diagnostic.code !== 2393);
        if (issue) {
          const line = issue.start === undefined ? undefined : fileModel.getPositionAt(issue.start).lineNumber;
          const message = typeof issue.messageText === 'string' ? issue.messageText : issue.messageText.messageText;
          throw new Error(`${path}${line ? `:${line}` : ''}: ${message}`);
        }
        if (emitted.emitSkipped) throw new Error(`${path}: TypeScript worker could not emit this file.`);
        output.set(path, emitted.outputFiles[0]?.text ?? fileModel.getValue());
      }
      for (const path of orderedPaths.filter(filePath => filePath.endsWith('.js'))) output.set(path, models.get(path)!.getValue());
      return orderedPaths.map(path => output.get(path) ?? '').join('\n');
    },
    createFile(path: string) {
      if (!/^scripts\/[a-zA-Z0-9_-]+\.(ts|js)$/.test(path) || models.has(path)) return false;
      const next = monaco.editor.createModel('', path.endsWith('.js') ? 'javascript' : 'typescript', monaco.Uri.parse(`file:///project/${path}`));
      models.set(path, next);
      subscriptions.push(next.onDidChangeContent(() => onChange(Object.fromEntries([...models].map(([filePath, value]) => [filePath, value.getValue()])))));
      editor.setModel(next); editor.focus();
      onChange(Object.fromEntries([...models].map(([filePath, value]) => [filePath, value.getValue()])));
      return true;
    },
    listFiles() { return [...models.keys()]; },
    dispose() { for (const subscription of subscriptions) subscription.dispose(); editor.dispose(); for (const fileModel of models.values()) fileModel.dispose(); types.dispose(); jsTypes.dispose(); },
  };
}
