import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EDITOR_PLUGIN_API_VERSION, type EditorPlugin } from './plugin-api';

export type GettingStartedAction = 'load-showcase' | 'load-pong' | 'view-scene' | 'view-code' | 'view-nodes' | 'play';
export const GETTING_STARTED_EVENT = 'ecs-editor:getting-started-action';
const run = (action: GettingStartedAction) => window.dispatchEvent(new CustomEvent<GettingStartedAction>(GETTING_STARTED_EVENT, { detail: action }));

function GettingStartedPanel() {
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const action = (id: string, value: GettingStartedAction) => {
    setCompleted(current => new Set(current).add(id));
    run(value);
  };
  const step = (id: string, title: string, description: string, label: string, value: GettingStartedAction) => <li className={completed.has(id) ? 'guide-step is-complete' : 'guide-step'} key={id}>
    <div><strong>{title}</strong><p>{description}</p></div>
    <button type="button" onClick={() => action(id, value)}>{completed.has(id) ? 'Done ✓' : label}</button>
  </li>;
  return <main className="getting-started-guide">
    <header><div><span className="guide-eyebrow">YOUR FIRST SCENE</span><h2>Getting Started</h2><p>Follow these steps to explore the editor. Nothing changes until you choose an example or press Play.</p></div></header>
    <section className="guide-card"><h3>1 · Choose an example</h3><p>Open a complete project with editable objects, scripts, assets and nodes.</p><div className="guide-actions"><button type="button" onClick={() => action('showcase', 'load-showcase')}>Load Showcase</button><button type="button" onClick={() => action('pong', 'load-pong')}>Load Pong</button></div></section>
    <ol className="guide-steps">
      {step('scene', '2 · Explore the scene', 'Select objects in Hierarchy and inspect their components. Move and zoom around the Scene view.', 'Open Scene', 'view-scene')}
      {step('code', '3 · Read a script', 'Select an object with Script Binding and open its code file. Changes take effect on the next Play.', 'Open Code', 'view-code')}
      {step('nodes', '4 · Explore nodes', 'Open a bound node graph to see how visual scripts read input, react to events and change components.', 'Open Nodes', 'view-nodes')}
      {step('play', '5 · Run the game', 'Start Play, try the controls, then Stop to return to the edited scene.', 'Play', 'play')}
    </ol>
    <p className="guide-manual">Need more detail? <a href="./manual.html" target="_blank" rel="noreferrer">Open the editor manual</a></p>
  </main>;
}

export const gettingStartedPlugin: EditorPlugin = {
  manifest: { id: 'ecs.getting-started', name: 'Getting Started Guide', version: '1.0.0', apiVersion: EDITOR_PLUGIN_API_VERSION },
  setup(api) {
    api.registerEditorPanel({
      id: 'editor.getting-started', label: 'Getting Started',
      mount(host) {
        const root = createRoot(host);
        root.render(<GettingStartedPanel />);
        return () => root.unmount();
      },
    });
  },
};
