import { validateProjectScenes, sceneLoadTarget, type ProjectScene, type ProjectScenes } from '@ecs/scene';
import './style.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { strToU8, zipSync } from 'fflate';
import type { createCodeEditor } from './code-editor';
import { createScene, createUiOverlay, type PlaySceneSource } from '@ecs/browser-preview';
import { initialObjects } from '@ecs/example-physics-playground';
import { AssetDatabase, ASSET_MANIFEST_FORMAT, ASSET_MANIFEST_VERSION } from '@ecs/assets';
import type { SpriteAtlas, SpriteAtlasRegion, SpriteRegionReference } from '@ecs/assets';
import { defineComponent, World } from '@ecs/core';
import { SchemaRegistry, SceneHierarchy, Transform2D, registerBuiltInSceneSchemas, transform2DSchema, defineComponentSchema, type ComponentSchema } from '@ecs/scene';
import { parentSchema } from '@ecs/scene';
import { Camera2D, camera2DSchema, resolveCamera2D, DEFAULT_GAME_VIEW, validateGameView, fitGameViewport, type GameViewSettings, applySpriteUvRegion, Parallax2D, parallax2DSchema, parallaxTransform, expandParallaxSprites, type Parallax2DData, collectSpriteRenderItems, collectTileRenderItems, createAssetTextureSource, createTilemap, fillTile, paintTile, parseTilemap, tilemap2DSchema, Tilemap2D, spriteAnimation2DSchema, SpriteAnimation2D, createSpriteAnimation, parseAnimationClips, updateSpriteAnimations, type SpriteAnimationClip, type SpriteAnimationTrack, spriteRenderer2DSchema, SpriteRenderer2D, WebGLRenderer2D } from '@ecs/rendering';
import { CODE_SCRIPT_ERROR_LINE_OFFSET, createCodeScriptSource, createSandboxedSession, createScriptApi, defineScriptDefinition, evaluateVisualGraph, runSandboxed, validateScriptProperties } from '@ecs/scripting';
import type { VisualGraph } from '../../../packages/scripting/src/visual-graph.ts';
import type { ScriptJson } from '../../../packages/scripting/src/api.ts';
import { SceneCodec } from '@ecs/scene';
import { EditHistory } from './edit-history';
import { findInProjectScripts } from './code-search';
import { base64ToBytes, bytesToBase64, decodeProjectArchive, encodeProjectArchive, IndexedDbProjectStore } from './project-storage';
import { createVisualGraphEditor } from './visual-graph-editor';
import { ScriptBinding, scriptBindingSchema, type ScriptBindingData } from './script-binding';
import { applyScriptCommandBuffer } from './script-command-buffer';
import { AudioSource2D, audioSource2DSchema, WebAudioMixer, type AudioGroup, type AudioMixer } from '@ecs/audio';
import { UiCanvas, UiImage, UiButton, UiText, layoutAnchoredRect, uiSchemas, type UiTextData, type UiImageData, type UiButtonData } from '@ecs/ui';
import type { UiCanvasSettings, UiOverlayItem } from '@ecs/browser-preview';
import { makePrefab, mergePrefabComponents, type PrefabDocument } from './prefabs';
import { EditorPluginManager, type PluginAssetImporter, type PluginEditorPanel } from './plugin-api';
import type { ScriptDefinition } from '@ecs/scripting';
import { sampleEditorPlugin } from './sample-plugin';
import { DEFAULT_INPUT_ACTIONS, type InputActionDefinition } from '@ecs/runtime';
import { renderGameViewEditor } from './game-view-editor';
import { renderInputActionsEditor } from './input-actions-editor';
import { InspectorView, type InspectorOption, type InspectorViewField, type InspectorViewGroup } from './inspector-view';
import { gettingStartedPlugin, GETTING_STARTED_EVENT, type GettingStartedAction } from './getting-started-plugin';

const app = document.querySelector<HTMLDivElement>('#app')!;
const starterScript = `// Isolated for this Play session; edits apply after Stop and the next Play.\nfunction onStart(api: engine.ScriptApi) {\n  api.on('game.graph.position', (event, current) => {\n    if (event.payload && typeof event.payload === 'object' && 'x' in event.payload) current.state = { lastGraphX: Number(event.payload.x) };\n  });\n}\n\nfunction onUpdate(api: engine.ScriptApi) {\n  const transform = api.getComponent('engine.transform2d');\n  if (transform) {\n    const moveX = api.input.actions.moveX?.value ?? 0;\n    const moveY = api.input.actions.moveY?.value ?? 0;\n    const next = { ...transform, x: transform.x + moveX * api.properties.speed * api.deltaTime, y: transform.y + moveY * api.properties.speed * api.deltaTime };\n    api.setComponent('engine.transform2d', next);\n    api.emit('game.code.position', next);\n  }\n}\n`;
const playerScriptDefinition = defineScriptDefinition({ scriptId: 'game.player', version: 1, properties: { speed: { type: 'number', label: 'Speed', default: 5, min: 0, max: 100 } } });
let scriptProperties: Record<string, unknown> = { speed: playerScriptDefinition.properties.speed!.default };
let visualGraph: VisualGraph = { version: 1, nodes: [
  { id: 'graph:start', kind: 'event.onStart', x: 45, y: 90, data: {} },
  { id: 'graph:update', kind: 'event.onUpdate', x: 45, y: 360, data: {} },
  { id: 'graph:on-event', kind: 'event.onEvent', x: 330, y: 360, data: { eventType: 'game.code.position' } },
  { id: 'graph:subscribe', kind: 'event.subscribe', x: 330, y: 90, data: { eventType: 'game.code.position' } },
  { id: 'graph:payload', kind: 'event.payload', x: 330, y: 255, data: { eventType: 'game.code.position' } },
  { id: 'graph:emit', kind: 'event.emit', x: 650, y: 90, data: { eventType: 'game.graph.position' } },
  { id: 'graph:end', kind: 'flow.end', x: 950, y: 90, data: {} },
  { id: 'graph:event-end', kind: 'flow.end', x: 950, y: 360, data: {} },
], links: [
  { id: 'graph:flow-1', from: { nodeId: 'graph:start', portId: 'then' }, to: { nodeId: 'graph:subscribe', portId: 'exec' } },
  { id: 'graph:flow-2', from: { nodeId: 'graph:subscribe', portId: 'then' }, to: { nodeId: 'graph:end', portId: 'exec' } },
  { id: 'graph:event-flow', from: { nodeId: 'graph:on-event', portId: 'then' }, to: { nodeId: 'graph:emit', portId: 'exec' } },
  { id: 'graph:data-1', from: { nodeId: 'graph:payload', portId: 'value' }, to: { nodeId: 'graph:emit', portId: 'payload' } },
  { id: 'graph:flow-3', from: { nodeId: 'graph:emit', portId: 'then' }, to: { nodeId: 'graph:event-end', portId: 'exec' } },
] };
let visualGraphs: Record<string, unknown> = { 'scripts/player.graph.json': visualGraph };
let prefabs: PrefabDocument[] = [];
let atlases: SpriteAtlas[] = [];
let atlasDraft: SpriteAtlas | undefined;
let atlasImage: HTMLImageElement | undefined;
let atlasDragStart: { x: number; y: number } | undefined;
let atlasDragEnd: { x: number; y: number } | undefined;
let atlasPanStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | undefined;
let atlasZoom = 1;
let selectedAtlasRegionId = '';
app.innerHTML = `
  <header class="topbar"><div class="brand"><span class="brand-mark">E</span> ECS <strong>STUDIO</strong><span class="badge">PROTOTYPE</span></div><span class="project-name"><strong id="project-name-current">Physics playground</strong> <span id="active-scene-name">/ Main scene</span></span><nav class="project-actions" aria-label="Project and editor menus"><span id="project-state" role="status">Loading project…</span><details class="topbar-menu"><summary>Project</summary><div class="topbar-menu-content"><button id="project-new">New Project</button><label class="menu-file-button">Open Project<input id="project-import" type="file" accept=".ecsproj,.json,application/json" hidden></label><button id="project-save">Save</button><button id="project-settings">Project Settings</button><button id="reset-layout">Reset layout</button></div></details><details class="topbar-menu"><summary>Examples</summary><div class="topbar-menu-content"><button id="project-showcase">Load Showcase</button><button id="project-pong">Load Pong</button></div></details><details class="topbar-menu"><summary>Plugins</summary><div class="topbar-menu-content"><button id="example-plugin-toggle">Load Example Plugin</button></div></details><details class="topbar-menu"><summary>Build</summary><div class="topbar-menu-content"><button id="project-export">Export Project</button><button id="web-game-export">Export Web Game</button></div></details><details class="topbar-menu"><summary>Help</summary><div class="topbar-menu-content"><button id="getting-started-open">Getting Started</button><a class="import-button" href="./manual.html" target="_blank" rel="noreferrer">Manual</a></div></details></nav></header>
  <div class="toolbar"><span class="workspace-label">2D WORKSPACE</span><div class="scene-tools" aria-label="Scene tools"><button data-tool="select" aria-pressed="true" title="Select (Q)">Select</button><button data-tool="move" aria-pressed="false" title="Move (W)">Move</button><button data-tool="rotate" aria-pressed="false" title="Rotate (E)">Rotate</button><button data-tool="scale" aria-pressed="false" title="Scale (R)">Scale</button><label class="snap-toggle"><input id="snap-toggle" type="checkbox"> Snap</label><button id="orientation" aria-pressed="false">Local</button><div id="scene-zoom-controls" class="scene-zoom-controls" aria-label="Scene zoom"><button id="scene-zoom-out" aria-label="Zoom out scene">−</button><output id="scene-zoom-value" aria-live="polite">100%</output><button id="scene-zoom-in" aria-label="Zoom in scene">＋</button><button id="scene-zoom-reset" aria-label="Reset scene zoom">Reset</button></div><div id="tilemap-tools" class="tilemap-tools" hidden><button id="tile-paint" aria-pressed="false">Tile Brush</button><button id="tile-fill" aria-pressed="false">Fill</button><select id="tile-layer" aria-label="Tilemap layer"></select><button id="tile-layer-add">＋ Layer</button><button id="tile-layer-remove">− Layer</button><button id="tile-layer-collision">Collision</button><button id="tile-layer-visibility">Visibility</button><select id="tile-asset" aria-label="Tile palette"></select></div><button id="undo" title="Undo (Ctrl+Z)" disabled>↶ Undo</button><button id="redo" title="Redo (Ctrl+Shift+Z)" disabled>↷ Redo</button></div><div class="transport" aria-label="Simulation controls"><button id="play" disabled>▶ Play</button><button id="pause" disabled>Ⅱ Pause</button><button id="step" disabled>▷ Step</button><button id="stop" disabled>■ Stop</button></div><span id="mode">Loading libraries…</span></div>
  <main id="workspace" class="workspace">
    <aside class="panel hierarchy"><h2>Hierarchy <span>MAIN SCENE</span></h2><div id="hierarchy-resize-handle" class="panel-resize-handle vertical" role="separator" tabindex="0" aria-label="Resize Hierarchy panel" aria-orientation="vertical"></div><div class="scene-manager"><select id="scene-select" aria-label="Active scene"></select><div><button id="scene-new" title="New scene">New</button><button id="scene-rename" title="Rename scene">Rename</button><button id="scene-duplicate" title="Duplicate scene">Copy</button><button id="scene-delete" title="Delete scene">Delete</button></div></div><div class="scene-name">⌄ &nbsp; ◇ <span id="hierarchy-scene-name">Main scene</span> <button id="add-object" title="Create object">＋</button></div><div id="object-list" aria-label="Scene objects" role="tree"></div><p class="panel-note">Select · Ctrl-click for multiple · right-click for actions</p></aside>
    <section class="center panel"><nav class="tabs" aria-label="Workspace views"><button id="scene-tab" aria-pressed="true">◇ Scene</button><button id="game-tab" aria-pressed="false">▷ Game</button><button id="code-tab" aria-pressed="false">{ } player.ts</button><button id="nodes-tab" aria-pressed="false">◇ Nodes</button></nav>
      <div class="view-area"><div id="viewport" aria-label="Scene viewport"></div><div id="game-view" hidden></div><div id="code-view" hidden><div class="code-notice">Local TypeScript diagnostics · changes apply on next Play <label>Script <select id="script-file" aria-label="Script files"></select></label><button id="script-new-file">New File</button><label><span id="script-speed-label">Speed</span> <input id="script-speed" type="number" min="0" max="100" step="0.5" value="5"></label><label>Find <input id="script-search" type="search" placeholder="Search project scripts"></label><button id="script-search-button">Search</button><div id="script-search-results" role="list"></div></div><div id="code-editor"></div></div><div id="nodes-view" hidden><div class="graph-notice">Graph for selected object's Script Binding · On Update runs during Play. Click an output, then a matching input to connect; click a wire to remove it. <button id="graph-run">Run Graph Once</button></div><div id="graph-editor"></div></div><div id="scene-label">ORTHOGRAPHIC <span>•</span> WEBGL 2 <span>·</span> Wheel zoom · Shift+wheel horizontal · Ctrl+wheel vertical · Middle drag pan</div></div>
    </section>
    <aside class="panel inspector"><h2>Inspector</h2><div id="inspector-resize-handle" class="panel-resize-handle vertical" role="separator" tabindex="0" aria-label="Resize Inspector panel" aria-orientation="vertical"></div><div class="object-heading"><span class="object-icon">◇</span><div><strong id="object-name"></strong><small>Scene object</small></div></div><div id="component-inspector"></div><p class="panel-note">Play simulates a copy.<br>Stop restores the edited positions.</p></aside>
    <section class="panel bottom"><div id="bottom-resize-handle" class="panel-resize-handle horizontal" role="separator" tabindex="0" aria-label="Resize bottom panel" aria-orientation="horizontal"></div><nav id="bottom-tabs" class="bottom-tabs"><button id="assets-tab" aria-pressed="true">Assets <span id="asset-count">0</span></button><button id="animation-tab" aria-pressed="false">Animation</button><button id="tilemap-tab" aria-pressed="false">Tilemap</button><button id="audio-tab" aria-pressed="false">Audio Mixer</button><button id="console-tab" aria-pressed="false">Console <span class="tab-dot"></span></button></nav>
      <div id="assets-panel"><div class="asset-toolbar"><span>Project assets</span><label class="import-button">＋ Import files<input id="asset-import" type="file" accept="image/*,audio/*" multiple hidden></label><button id="atlas-create">＋ Create/Edit Atlas</button><button id="prefab-create">＋ Create Prefab from Selection</button></div><div id="prefab-list" class="prefab-list" aria-label="Project prefabs"></div><div id="atlas-list" class="atlas-list" aria-label="Sprite atlases"></div><div id="asset-list" role="listbox" aria-label="Project assets"></div></div>
      <div id="tilemap-panel" hidden><div class="asset-toolbar"><span>Tile definitions · select a tile, then paint in the Scene view</span><div class="tile-image-picker"><span>Images</span><button id="tile-image-picker" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Choose images for new tiles"><span class="asset-icon">▧</span><span id="tile-image-name">Choose image…</span><span id="tile-image-selected-count">0 selected</span><span aria-hidden="true">▾</span></button><div id="tile-image-options" role="listbox" aria-multiselectable="true" aria-label="Image assets for new tiles" hidden></div><select id="tile-definition-asset" aria-label="Image for new tile" hidden></select></div><button id="tile-definition-add">＋ Add Tile</button></div><div class="tilemap-editor"><div id="tile-definition-list" role="list" aria-label="Tile definitions"></div><div class="tile-definition-fields"><label>Autotile group <input id="tile-neighbor-group" type="text" placeholder="Optional group"></label><button id="tile-definition-remove">Remove selected tile</button><span id="tile-definition-help" class="muted">Tiles with the same group can use neighbor variants.</span></div><div class="tile-variant-editor"><label>Neighbor mask <select id="tile-variant-mask" aria-label="Neighbor mask"></select></label><label>Use tile <select id="tile-variant-tile" aria-label="Variant tile"></select></label><button id="tile-variant-set">＋ Set Variant</button><div id="tile-variant-list" role="list" aria-label="Tile variants"></div></div></div></div>
      <div id="animation-panel" hidden><div class="animation-panel-head"><strong>Clips</strong><div id="animation-clip-list" role="list" aria-label="Animation clips"></div><button id="animation-clip-add">＋ New Clip</button></div><div class="animation-toolbar"><select id="animation-clip" aria-label="Animation clip" hidden></select><button id="animation-clip-remove">− Remove Clip</button><label>Clip name <input id="animation-clip-name" type="text"></label><label>Duration <input id="animation-duration" type="number" min="0.01" step="0.1"></label><label><input id="animation-loop" type="checkbox"> Loop</label><label><input id="animation-autoplay" type="checkbox" checked> Play On Start</label></div><div class="animation-editor-grid"><section><h3>Sprite Frames</h3><div class="animation-toolbar"><select id="animation-frame-asset" aria-label="Sprite frame asset"></select><input id="animation-frame-duration" aria-label="New frame duration" type="number" min="0.01" step="0.05" value="0.1"><button id="animation-frame-add">＋ Add Frame</button></div><div id="animation-frames" role="list" aria-label="Sprite frames"></div></section><section><h3>Animated Properties</h3><div class="animation-toolbar"><select id="animation-property" aria-label="Animated property"></select><input id="animation-key-time" aria-label="New keyframe time" type="number" min="0" step="0.1" value="0"><input id="animation-key-value" aria-label="New keyframe value" type="number" step="0.1" value="0"><select id="animation-key-value-select" aria-label="New keyframe option" hidden></select><button id="animation-key-add">＋ Add Key</button></div><div id="animation-timeline" role="list" aria-label="Animation keyframes"></div></section></div></div>
      <div id="audio-panel" hidden><div class="audio-mixer" aria-label="Audio volume groups"><label>Master <input id="audio-master-volume" type="range" min="0" max="1" step="0.01" value="1"><output id="audio-master-value">100%</output></label><label>Music <input id="audio-music-volume" type="range" min="0" max="1" step="0.01" value="1"><output id="audio-music-value">100%</output></label><label>Effects <input id="audio-effects-volume" type="range" min="0" max="1" step="0.01" value="1"><output id="audio-effects-value">100%</output></label><span id="audio-status">Audio starts after Play is pressed.</span></div></div>
      <div id="console-panel" hidden><div class="debug-grid"><section class="debug-card"><h3>Selected Play Entity</h3><div id="debug-entity" aria-live="polite">Start Play and select an object in Game view.</div></section><section class="debug-card"><h3>System Timings <small id="debug-tick">Tick 0</small></h3><div id="debug-systems">No active simulation.</div></section><section class="debug-card"><h3>Render Statistics</h3><div id="debug-render">No active Game view.</div></section></div><div class="experiment-bar"><span>Script sandbox checks</span><button id="script-success">Return value</button><button id="script-error">Throw error</button><button id="script-loop">Infinite loop</button><button id="script-probe">Security probe</button><button id="script-data">Copy payload</button><button id="script-clone-error">Invalid result</button><button id="script-data-limit">Payload limits</button><button id="script-cancel">Cancel run</button><button id="clear-console">Clear</button></div><div id="console" role="log" aria-label="Console output" aria-live="polite"></div></div>
    </section>
  </main><dialog id="project-settings-dialog" class="project-settings-dialog"><form method="dialog" class="project-settings-shell"><header><div><strong>Project Settings</strong><p>Configure named actions and their input bindings.</p></div><button value="cancel" aria-label="Close project settings">×</button></header><h3>Scenes</h3><label>Start scene <select id="start-scene" aria-label="Start scene"></select></label><p>Active scene ID: <code id="active-scene-id"></code></p><p>Play and web export start here. scene.load events change scenes during Play.</p><h3>Game View</h3><div id="game-view-settings"></div><h3>Input Actions</h3><div id="input-actions-editor"></div></form></dialog><dialog id="atlas-picker-dialog" class="atlas-picker-dialog"><form method="dialog" class="atlas-picker-shell"><header><div><strong>Choose an image for a Sprite Atlas</strong><p>Pick an image to create a new atlas or edit its existing regions.</p></div><button value="cancel" aria-label="Close atlas image picker">×</button></header><div id="atlas-picker-list" class="atlas-picker-list" aria-label="Image assets"></div></form></dialog><dialog id="sprite-atlas-dialog" class="sprite-atlas-dialog"><form method="dialog" class="sprite-atlas-shell"><header><strong id="atlas-dialog-title">Sprite Atlas</strong><button value="cancel" aria-label="Close atlas editor">×</button></header><div class="atlas-editor-toolbar"><label>Name <input id="atlas-name" type="text"></label><label>Cell width <input id="atlas-cell-width" type="number" min="1" value="16"></label><label>Cell height <input id="atlas-cell-height" type="number" min="1" value="16"></label><label title="Empty border at the left and right edges, in image pixels">Margin X <input id="atlas-margin-x" type="number" min="0" step="1" value="0"></label><label title="Empty border at the top and bottom edges, in image pixels">Margin Y <input id="atlas-margin-y" type="number" min="0" step="1" value="0"></label><label title="Empty space between columns, in image pixels">Spacing X <input id="atlas-spacing-x" type="number" min="0" step="1" value="0"></label><label title="Empty space between rows, in image pixels">Spacing Y <input id="atlas-spacing-y" type="number" min="0" step="1" value="0"></label><button id="atlas-slice-grid" type="button">Slice grid</button><label>Region name <input id="atlas-region-name" type="text" value="Sprite"></label><button id="atlas-add-region" type="button">Add selected region</button><div class="atlas-zoom-controls" aria-label="Atlas zoom"><button id="atlas-zoom-out" type="button" aria-label="Zoom out atlas">−</button><output id="atlas-zoom-value" aria-live="polite">100%</output><button id="atlas-zoom-in" type="button" aria-label="Zoom in atlas">＋</button><button id="atlas-zoom-fit" type="button">Fit</button></div></div><div class="atlas-editor-body"><div id="atlas-canvas-wrap" class="atlas-canvas-wrap"><canvas id="atlas-canvas" aria-label="Atlas image; drag to select a region"></canvas></div><div id="atlas-regions-resize" role="separator" tabindex="0" aria-label="Resize Atlas Regions panel" aria-orientation="vertical" aria-valuemin="240" aria-valuenow="420"></div><section id="atlas-regions-panel"><strong>Regions</strong><p class="muted">Drag to mark a region · Wheel zoom · Middle-drag pan. Select a row to highlight it.</p><div id="atlas-region-list" role="list" aria-label="Atlas regions"></div></section></div><footer><span id="atlas-image-size"></span><button id="atlas-save" type="button">Save Atlas</button></footer></form></dialog><div id="object-menu" class="object-menu" role="menu" hidden></div><footer><span><span class="status-dot"></span> Local technical prototype</span><span id="storage-status">Project saves locally in this browser · T109</span></footer>`;

const inspectorRoot = createRoot(document.getElementById('component-inspector')!);

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function openScriptSource(path: string, line: number) { if (!code) return; const sourceLine = Math.max(1, path === 'scripts/player.ts' ? line - CODE_SCRIPT_ERROR_LINE_OFFSET : line); activateView('code'); code.selectFile(path); code.revealLine(sourceLine); }
function log(message: string, error = false) {
  const row = document.createElement('div'); row.className = error ? 'log error' : 'log';
  row.append(document.createTextNode(`${new Date().toLocaleTimeString()}  `));
  const sourcePattern = /(scripts\/[^:\s]+\.tsx?):(\d+)/g; let cursor = 0; let match: RegExpExecArray | null;
  while ((match = sourcePattern.exec(message))) {
    row.append(document.createTextNode(message.slice(cursor, match.index)));
    const path = match[1]!; const lineNumber = Number(match[2]); const link = document.createElement('button'); link.type = 'button'; link.className = 'source-link'; link.textContent = `${path}:${lineNumber}`; link.setAttribute('aria-label', `Open ${link.textContent}`); link.onclick = () => openScriptSource(path, lineNumber); row.append(link); cursor = sourcePattern.lastIndex;
  }
  row.append(document.createTextNode(message.slice(cursor)));
  const output = element('console'); output.append(row); while (output.children.length > 100) output.firstElementChild?.remove(); output.scrollTop = output.scrollHeight;
}

interface SceneObject { parallax?: Parallax2DData; id: string; name: string; x: number; y: number; width: number; height: number; color: string; dynamic: boolean; rotation: number; order?: number; hasSprite: boolean; assetId?: string | null; region?: SpriteRegionReference | null; physics?: PhysicsData; collider?: ColliderData; }
interface PhysicsData { bodyType: 'Dynamic' | 'Fixed'; gravityScale: number; }
interface ColliderData { shape: 'Box' | 'Circle'; friction: number; restitution: number; sensor: boolean; groups: number; mask: number; }
const Name = defineComponent<{ value: string }>('Name');
const Physics = defineComponent<PhysicsData>('Physics2D');
const Collider = defineComponent<ColliderData>('Collider2D');
interface PrefabLinkData { prefabId: string; sourceEntityId: string; instanceId: string; baselineJson: string; overridesJson: string; broken: boolean; }
const PrefabLink = defineComponent<PrefabLinkData>('PrefabInstance');
const prefabLinkSchema = defineComponentSchema({ typeId: 'engine.prefab-instance', displayName: 'Prefab Instance', version: 1, component: PrefabLink, fields: { prefabId: { type: 'string', label: 'Prefab ID', default: '' }, sourceEntityId: { type: 'string', label: 'Source Entity', default: '' }, instanceId: { type: 'string', label: 'Instance ID', default: '' }, baselineJson: { type: 'string', label: 'Baseline', default: '' }, overridesJson: { type: 'string', label: 'Overrides', default: '[]' }, broken: { type: 'boolean', label: 'Broken Reference', default: false } } });
const nameSchema = defineComponentSchema({ typeId: 'engine.name', displayName: 'Name', version: 1, component: Name, fields: { value: { type: 'string', label: 'Name', default: 'Object' } } });
const physicsSchema = defineComponentSchema({ typeId: 'engine.physics2d', displayName: 'Physics 2D', version: 1, component: Physics, fields: { bodyType: { type: 'enum', label: 'Body Type', default: 'Dynamic', options: ['Dynamic', 'Fixed'] }, gravityScale: { type: 'number', label: 'Gravity Scale', default: 1 } } });
const colliderSchema = defineComponentSchema({ typeId: 'engine.collider2d', displayName: 'Collider 2D', version: 1, component: Collider, fields: { shape: { type: 'enum', label: 'Shape', default: 'Box', options: ['Box', 'Circle'] }, friction: { type: 'number', label: 'Friction', default: 0.7, min: 0, max: 1 }, restitution: { type: 'number', label: 'Restitution', default: 0.25, min: 0, max: 1 }, sensor: { type: 'boolean', label: 'Is Trigger', default: false }, groups: { type: 'number', label: 'Collision Group', default: 1, min: 1, max: 65535 }, mask: { type: 'number', label: 'Collision Mask', default: 65535, min: 1, max: 65535 } } });
const schemas = new SchemaRegistry(); registerBuiltInSceneSchemas(schemas); schemas.register(nameSchema); schemas.register(spriteRenderer2DSchema); schemas.register(camera2DSchema); schemas.register(parallax2DSchema); schemas.register(physicsSchema); schemas.register(colliderSchema); schemas.register(tilemap2DSchema); schemas.register(spriteAnimation2DSchema); schemas.register(prefabLinkSchema);
schemas.register(scriptBindingSchema);
schemas.register(audioSource2DSchema);
for (const schema of uiSchemas) schemas.register(schema);
let world = new World();
const objects = structuredClone(initialObjects) as SceneObject[];
let entities = new Map<string, ReturnType<World['createEntity']>>();
for (const object of objects) {
  const entity = world.createEntity(); entities.set(object.id, entity);
  world.addComponent(entity, Name, { value: object.name });
  world.addComponent(entity, Transform2D, { x: object.x, y: object.y, rotation: 0, scaleX: 1, scaleY: 1 });
  world.addComponent(entity, SpriteRenderer2D, { asset: null, region: null, width: object.width, height: object.height, order: object.y, tint: object.color });
  world.addComponent(entity, Physics, { bodyType: object.dynamic ? 'Dynamic' : 'Fixed', gravityScale: 1 });
  world.addComponent(entity, Collider, { shape: 'Box', friction: 0.7, restitution: 0.25, sensor: false, groups: 1, mask: 65535 });
  if (object.id === 'player') world.addComponent(entity, ScriptBinding, { enabled: true, codePath: 'scripts/player.ts', graphPath: 'scripts/player.graph.json', speed: Number(scriptProperties.speed ?? 5) });
}
let hierarchy = new SceneHierarchy(world, entities);
let selectedId = objects[0]!.id;
let selectedIds = [selectedId];
const collapsedInspectorComponents = new Set<string>();
let animationSelectedProperty = '';
let projectScenes: ProjectScene[] = [];
let activeSceneId = 'scene:main';
let startSceneId = 'scene:main';
let gameViewSettings: GameViewSettings = { ...DEFAULT_GAME_VIEW };
let sceneCameraFrame: SVGSVGElement | undefined;
let sceneRenderer: WebGLRenderer2D | undefined;
let sceneUiOverlay: ReturnType<typeof createUiOverlay> | undefined;
let sceneSelectionOverlay: HTMLDivElement | undefined;
let sceneTilemapGrid: SVGSVGElement | undefined;
let sceneTilemapGridSignature = '';
let gameScene: Awaited<ReturnType<typeof createScene>> | undefined;
let selectedPlayEntityId: string | undefined;
let scriptUpdateDurationMs = 0;
let gamePreviewSignature = '';
let gamePreviewRevision = 0;
let assets: AssetDatabase | undefined;
let audioMixer: AudioMixer | undefined;
const audioVolumes: { master: number; music: number; effects: number } = { master: 1, music: 1, effects: 1 };
let editorTextureSource: ReturnType<typeof createAssetTextureSource> | undefined;
let projectStore: IndexedDbProjectStore | undefined;
let projectId = localStorage.getItem('ecs-studio-active-project') ?? 'project:physics-playground';
let projectName = localStorage.getItem(`ecs-studio-project-name:${projectId}`) ?? 'Physics playground';
let scriptFiles: Record<string, string> = { 'scripts/player.ts': starterScript };
let inputActions: readonly InputActionDefinition[] = DEFAULT_INPUT_ACTIONS;
let saveTimer: number | undefined;
let defaultAssetId = '';
let playing = false; let paused = false;
let code: ReturnType<typeof createCodeEditor> | undefined;
let graphEditor: ReturnType<typeof createVisualGraphEditor> | undefined;
let activeGraphPath = 'scripts/player.graph.json';
let selectedTileDefinitionId = '';
let selectedTileAssetIds = new Set<string>();
let tileEraseSelected = false;
const pluginComponents = new Map<string, Set<string>>();
const pluginScripts = new Map<string, ScriptDefinition>();
const pluginImporters = new Map<string, PluginAssetImporter>();
const pluginPanels = new Map<string, { tab: HTMLButtonElement; host: HTMLDivElement; dispose: () => void }>();
let activeBottomPanel = 'assets';
const objectButtons = new Map<string, HTMLButtonElement>();
const codec = new SceneCodec(schemas);
interface EditorSnapshot { readonly document: string; readonly selection: readonly string[]; }
const editHistory = new EditHistory<EditorSnapshot>();
let activeTool: 'select' | 'move' | 'rotate' | 'scale' | 'tile' | 'fill' = 'select';
function setActiveTool(tool: typeof activeTool) {
  activeTool = tool;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  element<HTMLButtonElement>('tile-paint').setAttribute('aria-pressed', String(tool === 'tile'));
  element<HTMLButtonElement>('tile-fill').setAttribute('aria-pressed', String(tool === 'fill'));
}
let globalOrientation = false;
let lastSelectedId = selectedId;

const pluginManager = new EditorPluginManager({
  registerComponent(pluginId, schema) {
    schemas.register(schema);
    const owned = pluginComponents.get(pluginId) ?? new Set<string>(); owned.add(schema.typeId); pluginComponents.set(pluginId, owned);
    return () => { schemas.unregister(schema.typeId); owned.delete(schema.typeId); };
  },
  registerScript(pluginId, definition) {
    if (pluginScripts.has(definition.scriptId)) throw new Error(`Script definition "${definition.scriptId}" is already registered.`);
    pluginScripts.set(definition.scriptId, definition);
    return () => { pluginScripts.delete(definition.scriptId); };
  },
  registerImporter(_pluginId, importer) {
    if (pluginImporters.has(importer.id)) throw new Error(`Asset importer "${importer.id}" is already registered.`);
    pluginImporters.set(importer.id, importer);
    return () => { pluginImporters.delete(importer.id); };
  },
  registerEditorPanel(_pluginId, panel: PluginEditorPanel) {
    if (pluginPanels.has(panel.id)) throw new Error(`Editor panel "${panel.id}" is already registered.`);
    const section = document.querySelector<HTMLElement>('.bottom')!;
    const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = panel.label;
    const host = document.createElement('div'); host.className = 'plugin-panel'; host.dataset.pluginPanelId = panel.id; host.hidden = true; section.append(host);
    let dispose = () => {};
    try { dispose = panel.mount(host) ?? dispose; }
    catch (error) { host.remove(); throw error; }
    tab.onclick = () => bottomPanel(panel.id);
    element('bottom-tabs').append(tab);
    pluginPanels.set(panel.id, { tab, host, dispose });
    return () => { if (activeBottomPanel === panel.id) bottomPanel('assets'); dispose(); tab.remove(); host.remove(); pluginPanels.delete(panel.id); };
  },
  canUnload(pluginId) {
    const used = pluginComponents.get(pluginId);
    if (used) for (const [entityId, entity] of entities) for (const typeId of used) if (schemas.get(typeId) && world.hasComponent(entity, schemas.get(typeId)!.component)) {
      return `Remove plugin component "${typeId}" from entity "${entityId}" before unloading this plugin.`;
    }
    if (used) for (const entry of projectScenes) if (entry.id !== activeSceneId) for (const entity of (entry.document as import('@ecs/scene').SceneDocument).entities) for (const component of entity.components) if (used.has(component.typeId)) return `Remove plugin component "${component.typeId}" from scene "${entry.name}" before unloading this plugin.`;
    return undefined;
  },
});

function graphPathFor(entityId: string) {
  const entity = entities.get(entityId);
  return entity && world.hasComponent(entity, ScriptBinding) ? world.getComponent(entity, ScriptBinding)!.graphPath.trim() || 'scripts/player.graph.json' : 'scripts/player.graph.json';
}
function graphForPath(path: string): VisualGraph {
  const current = visualGraphs[path];
  if (current && typeof current === 'object') return structuredClone(current) as VisualGraph;
  const graph: VisualGraph = { version: 1, nodes: [{ id: 'graph:start', kind: 'event.onUpdate', x: 45, y: 90, data: {} }, { id: 'graph:end', kind: 'flow.end', x: 340, y: 90, data: {} }], links: [{ id: 'graph:end-link', from: { nodeId: 'graph:start', portId: 'then' }, to: { nodeId: 'graph:end', portId: 'exec' } }] };
  visualGraphs[path] = graph;
  return graph;
}
function syncSelectedGraph() {
  const path = graphPathFor(selectedId);
  if (path === activeGraphPath) return;
  activeGraphPath = path;
  visualGraph = graphForPath(path);
  graphEditor?.setGraph(visualGraph);
}
function syncSelectedCodeFile() {
  const entity = entities.get(selectedId); const path = entity && world.hasComponent(entity, ScriptBinding) ? world.getComponent(entity, ScriptBinding)!.codePath : 'scripts/player.ts';
  if (!path || !scriptFiles[path]) return;
  const select = element<HTMLSelectElement>('script-file');
  if ([...select.options].some(option => option.value === path)) select.value = path;
  code?.selectFile(path);
}

function renderScene() {
  sceneRenderer?.setParallaxCamera(editingGameCamera());
  if (sceneRenderer) sceneRenderer.render([...collectSpriteRenderItems(world, entities, hierarchy, atlases), ...collectTileRenderItems(world, entities, hierarchy, atlases)]);
  sceneUiOverlay?.update(collectUiElements(world, entities), uiCanvasSettings(world, entities));
  updateSceneTilemapGrid();
  updateSceneSelectionOverlay(); updateSceneCameraFrame();
}
function updateSceneTilemapGrid() {
  const svg = sceneTilemapGrid; const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas');
  const entity = entities.get(selectedId); const map = entity && world.getComponent(entity, Tilemap2D);
  if (!svg || !canvas || !map) { if (svg) svg.style.display = 'none'; sceneTilemapGridSignature = ''; return; }
  const { width: viewportWidth, height: viewportHeight } = canvas.getBoundingClientRect();
  if (!viewportWidth || !viewportHeight) { svg.style.display = 'none'; return; }
  const { zoom: cameraZoom, x: cameraX, y: cameraY } = sceneCamera; const transform = hierarchy.getGlobalTransform(selectedId);
  const signature = [selectedId, map.width, map.height, map.tileSize, viewportWidth, viewportHeight, cameraZoom, cameraX, cameraY, transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty].join(':');
  if (signature === sceneTilemapGridSignature) { svg.style.display = ''; return; }
  sceneTilemapGridSignature = signature;
  const toScreen = (x: number, y: number) => ({
    x: (transform.a * x + transform.c * y + transform.tx - cameraX) * cameraZoom + viewportWidth / 2,
    y: (cameraY - (transform.b * x + transform.d * y + transform.ty)) * cameraZoom + viewportHeight / 2,
  });
  const path: string[] = [];
  for (let x = 0; x <= map.width; x++) {
    const localX = (x - map.width / 2) * map.tileSize;
    const a = toScreen(localX, -map.height * map.tileSize / 2); const b = toScreen(localX, map.height * map.tileSize / 2);
    path.push(`M${a.x},${a.y}L${b.x},${b.y}`);
  }
  for (let y = 0; y <= map.height; y++) {
    const localY = (y - map.height / 2) * map.tileSize;
    const a = toScreen(-map.width * map.tileSize / 2, localY); const b = toScreen(map.width * map.tileSize / 2, localY);
    path.push(`M${a.x},${a.y}L${b.x},${b.y}`);
  }
  svg.setAttribute('viewBox', `0 0 ${viewportWidth} ${viewportHeight}`);
  svg.innerHTML = `<path d="${path.join('')}" fill="none" stroke="#d7d1ff" stroke-opacity=".42" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  svg.style.display = '';
}
let selectedParallaxCopy: { id: string; column: number; row: number } | undefined;
function hitTestScene(wx: number, wy: number, ignoreParallax = false): string | undefined {
  const canvas = element('viewport').querySelector('canvas');
  const items = expandParallaxSprites([...collectSpriteRenderItems(world, entities, hierarchy, atlases), ...collectTileRenderItems(world, entities, hierarchy, atlases)], { x: sceneCamera.x, y: sceneCamera.y, halfWidth: (canvas?.clientWidth ?? 0) / sceneCamera.zoom / 2, halfHeight: (canvas?.clientHeight ?? 0) / sceneCamera.zoom / 2, parallaxCamera: editingGameCamera() })
    .filter(item => !ignoreParallax || !item.parallax)
    .map((item, insertionIndex) => ({ item, insertionIndex }))
    .sort((a, b) => a.item.order - b.item.order || a.insertionIndex - b.insertionIndex);
  // Match the renderer's back-to-front ordering, testing the visually topmost item first.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!.item;
    const tileMarker = item.entityId.indexOf(':tile:');
    const entityId = tileMarker >= 0 ? item.entityId.slice(0, tileMarker) : item.entityId;
    const dx = wx - item.transform.tx; const dy = wy - item.transform.ty;
    const determinant = item.transform.a * item.transform.d - item.transform.b * item.transform.c;
    if (Math.abs(determinant) < 1e-8) continue;
    const localX = (item.transform.d * dx - item.transform.c * dy) / determinant;
    const localY = (-item.transform.b * dx + item.transform.a * dy) / determinant;
    if (Math.abs(localX) <= item.width / 2 && Math.abs(localY) <= item.height / 2) {
      selectedParallaxCopy = undefined;
      if (item.parallax) {
        const base = parallaxTransform(hierarchy.getGlobalTransform(entityId), item.parallax, editingGameCamera());
        const ux = base.a * item.width, uy = base.b * item.width, vx = base.c * item.height, vy = base.d * item.height;
        const det = ux * vy - uy * vx, dx = item.transform.tx - base.tx, dy = item.transform.ty - base.ty;
        if (Math.abs(det) > 1e-10) selectedParallaxCopy = { id: entityId, column: Math.round((vy * dx - vx * dy) / det), row: Math.round((-uy * dx + ux * dy) / det) };
      }
      return entityId;
    }
  }
  // Empty cells still belong to their tilemap, but only after checking visible sprites/tiles.
  for (const [id, entity] of [...entities].reverse()) {
    const map = world.getComponent(entity, Tilemap2D); if (!map) continue;
    const transform = hierarchy.getGlobalTransform(id); const dx = wx - transform.tx; const dy = wy - transform.ty;
    const determinant = transform.a * transform.d - transform.b * transform.c;
    if (Math.abs(determinant) < 1e-8) continue;
    const x = (transform.d * dx - transform.c * dy) / determinant;
    const y = (-transform.b * dx + transform.a * dy) / determinant;
    if (Math.abs(x) <= map.width * map.tileSize / 2 && Math.abs(y) <= map.height * map.tileSize / 2) return id;
  }
  return undefined;
}
function updateSceneSelectionOverlay() {
  const marker = sceneSelectionOverlay; const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas');
  const entity = entities.get(selectedId);
  if (!marker || !canvas || !entity || !selectedId) { if (marker) marker.hidden = true; return; }
  const rect = canvas.getBoundingClientRect(); let transform = hierarchy.getGlobalTransform(selectedId);
  const sprite = world.getComponent(entity, SpriteRenderer2D); const tilemap = world.getComponent(entity, Tilemap2D);
  if (sprite && world.hasComponent(entity, Parallax2D)) {
    const base = parallaxTransform(transform, world.getComponent(entity, Parallax2D)!, editingGameCamera());
    const copy = selectedParallaxCopy?.id === selectedId ? selectedParallaxCopy : { column: 0, row: 0 };
    transform = { ...base, tx: base.tx + copy.column * base.a * sprite.width + copy.row * base.c * sprite.height, ty: base.ty + copy.column * base.b * sprite.width + copy.row * base.d * sprite.height };
  }
  const ui = world.getComponent(entity, UiText) ?? world.getComponent(entity, UiImage) ?? world.getComponent(entity, UiButton);
  if (ui) {
    const uiRect = layoutAnchoredRect(ui, { width: rect.width, height: rect.height, ...uiCanvasSettings(world, entities) });
    const zoom = sceneCamera.zoom / 45;
    const left = rect.width / 2 + (uiRect.left - rect.width / 2) * zoom - sceneCamera.x * sceneCamera.zoom;
    const top = rect.height / 2 + (uiRect.top - rect.height / 2) * zoom + (sceneCamera.y - 2) * sceneCamera.zoom;
    marker.hidden = false; marker.style.left = `${left}px`; marker.style.top = `${top}px`; marker.style.width = `${uiRect.width * zoom}px`; marker.style.height = `${uiRect.height * zoom}px`;
    const name = world.getComponent(entity, Name)?.value ?? selectedId;
    marker.querySelector<HTMLElement>('.scene-selection-label')!.textContent = `${name}${selectedIds.length > 1 ? ` (+${selectedIds.length - 1})` : ''}`;
    return;
  }
  const width = tilemap ? tilemap.width * tilemap.tileSize : sprite?.width ?? 0.5;
  const height = tilemap ? tilemap.height * tilemap.tileSize : sprite?.height ?? 0.5;
  const points = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]].map(([x, y]) => {
    const worldX = transform.a * x! + transform.c * y! + transform.tx;
    const worldY = transform.b * x! + transform.d * y! + transform.ty;
    return { x: rect.width / 2 + (worldX - sceneCamera.x) * sceneCamera.zoom, y: rect.height / 2 - (worldY - sceneCamera.y) * sceneCamera.zoom };
  });
  const minX = Math.min(...points.map(point => point.x)); const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)); const maxY = Math.max(...points.map(point => point.y));
  marker.hidden = false; marker.style.left = `${minX}px`; marker.style.top = `${minY}px`; marker.style.width = `${Math.max(14, maxX - minX)}px`; marker.style.height = `${Math.max(14, maxY - minY)}px`;
  const name = world.getComponent(entity, Name)?.value ?? selectedId;
  marker.querySelector<HTMLElement>('.scene-selection-label')!.textContent = `${name}${selectedIds.length > 1 ? ` (+${selectedIds.length - 1})` : ''}`;
}
const sharedPreviewCamera = { x: 0, y: 2, worldUnitsPerPixel: 1 / 45 };
const sceneCamera = { x: 0, y: 2, zoom: 45 };
function editingGameCamera() { return resolveCamera2D(world, entities, hierarchy) ?? sharedPreviewCamera; }
function updateSceneCameraFrame() {
  const svg = sceneCameraFrame; const canvas = element('viewport').querySelector('canvas'); if (!svg || !canvas) return;
  const active = resolveCamera2D(world, entities, hierarchy);
  if (!active && gameViewSettings.mode === 'Free') { svg.style.display = 'none'; return; }
  const view = editingGameCamera(); const width = canvas.clientWidth, height = canvas.clientHeight;
  const rect = fitGameViewport(width, height, gameViewSettings);
  const visibleHeight = active?.visibleHeight ?? rect.height / 45;
  const aspect = gameViewSettings.mode === 'Fit' ? gameViewSettings.width / gameViewSettings.height : width / height;
  const w = visibleHeight * aspect * sceneCamera.zoom, h = visibleHeight * sceneCamera.zoom;
  const x = width / 2 + (view.x - sceneCamera.x) * sceneCamera.zoom - w / 2;
  const y = height / 2 - (view.y - sceneCamera.y) * sceneCamera.zoom - h / 2;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.style.display = '';
  svg.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffd37a" stroke-width="1.5"/><text x="${x + 5}" y="${y + 15}" fill="#ffd37a" font-size="11">Game Camera</text>`;
}
function createCameraObject() {
  if (playing) return;
  performEdit('Create Camera', () => {
    const id = `camera:${crypto.randomUUID()}`, entity = world.createEntity(), view = editingGameCamera(); entities.set(id, entity);
    world.addComponent(entity, Name, { value: 'Main Camera' });
    world.addComponent(entity, Transform2D, { x: view.x, y: view.y, rotation: 0, scaleX: 1, scaleY: 1 });
    world.addComponent(entity, Camera2D, Object.fromEntries(Object.entries(camera2DSchema.fields).map(([key, field]) => [key, field.default])) as unknown as import('@ecs/rendering').Camera2DData);
    hierarchy = new SceneHierarchy(world, entities); selectedId = id; selectedIds = [id];
  });
  element<HTMLDialogElement>('project-settings-dialog').close();
}
function applySceneCamera() {
  sceneRenderer?.setCamera(sceneCamera); sceneTilemapGridSignature = '';
  const uiOverlay = element<HTMLElement>('viewport').querySelector<HTMLElement>('.scene-ui-overlay');
  if (uiOverlay) {
    const scale = sceneCamera.zoom / 45;
    uiOverlay.style.transformOrigin = '50% 50%';
    uiOverlay.style.transform = `translate(${-sceneCamera.x * sceneCamera.zoom}px, ${(sceneCamera.y - 2) * sceneCamera.zoom}px) scale(${scale})`;
  }
  element('scene-zoom-value').textContent = `${Math.round(sceneCamera.zoom / 45 * 100)}%`;
  updateSceneTilemapGrid(); updateSceneSelectionOverlay();
}
function setSceneZoom(zoom: number, anchor?: { x: number; y: number }) {
  const previous = sceneCamera.zoom; const next = Math.max(12, Math.min(180, zoom));
  if (anchor && next !== previous) {
    sceneCamera.x += anchor.x * (1 / previous - 1 / next);
    sceneCamera.y += anchor.y * (1 / next - 1 / previous);
  }
  sceneCamera.zoom = next; applySceneCamera();
}
function resetSceneCamera() { sceneCamera.x = 0; sceneCamera.y = 2; setSceneZoom(45); }
function collectUiElements(sourceWorld: World, sourceEntities: ReadonlyMap<string, ReturnType<World['createEntity']>>): readonly UiOverlayItem[] {
  const result: UiOverlayItem[] = [];
  for (const [entityId, entity] of sourceEntities) {
    if (sourceWorld.hasComponent(entity, UiText)) { const value = sourceWorld.getComponent(entity, UiText)!; const { text, color, fontSize, align, ...layout } = value; result.push({ id: `${entityId}:text`, entityId, kind: 'text', text, color, fontSize, align, layout }); }
    if (sourceWorld.hasComponent(entity, UiImage)) { const value = sourceWorld.getComponent(entity, UiImage)!; const { asset, fit, ...layout } = value; result.push({ id: `${entityId}:image`, entityId, kind: 'image', assetId: asset?.assetId ?? null, fit, layout }); }
    if (sourceWorld.hasComponent(entity, UiButton)) { const value = sourceWorld.getComponent(entity, UiButton)!; const { text, color, background, fontSize, disabled, ...layout } = value; result.push({ id: `${entityId}:button`, entityId, kind: 'button', text, color, background, fontSize, disabled, layout }); }
  }
  return result;
}
function uiCanvasSettings(sourceWorld: World, sourceEntities: ReadonlyMap<string, ReturnType<World['createEntity']>>): UiCanvasSettings {
  for (const entity of sourceEntities.values()) if (sourceWorld.hasComponent(entity, UiCanvas)) { const canvas = sourceWorld.getComponent(entity, UiCanvas)!; return { referenceWidth: canvas.referenceWidth, referenceHeight: canvas.referenceHeight, scaleMode: canvas.scaleMode }; }
  return { referenceWidth: 800, referenceHeight: 600, scaleMode: 'fit' };
}
const uiImageUrls = new Map<string, string>();
async function resolveUiImage(assetId: string): Promise<string | undefined> {
  const cached = uiImageUrls.get(assetId); if (cached) return cached;
  const resolved = await assets?.resolveAsset(assetId);
  if (!resolved || resolved.status !== 'available' || resolved.record.kind !== 'image') return undefined;
  const url = URL.createObjectURL(new Blob([resolved.data.slice().buffer], { type: resolved.record.mimeType })); uiImageUrls.set(assetId, url); return url;
}
function setupUiPreview(scene: Awaited<ReturnType<typeof createScene>>) { scene.setGameView(gameViewSettings); scene.setCameraSource(() => resolveCamera2D(world, entities, hierarchy)); scene.setUiPreview(() => collectUiElements(world, entities), () => uiCanvasSettings(world, entities), resolveUiImage); }
async function loadEditorTexture(assetId: string, regionRef?: SpriteRegionReference | null) {
  const result = await editorTextureSource?.loadTexture(assetId); if (result?.status !== 'available') return null;
  if (!regionRef) return result.texture;
  const atlas = atlases.find(item => item.id === regionRef.atlasId && item.assetId === assetId); const region = atlas?.regions.find(item => item.id === regionRef.regionId); if (!atlas || !region) return result.texture;
  applySpriteUvRegion(result.texture, { x: region.x / atlas.width, y: 1 - (region.y + region.height) / atlas.height, width: region.width / atlas.width, height: region.height / atlas.height }); return result.texture;
}
function captureSnapshot(): EditorSnapshot { return { document: codec.stringify(world, entities, activeSceneId), selection: [...selectedIds] }; }
function ensureSceneNames(targetWorld: World, targetEntities: ReadonlyMap<string, ReturnType<World['createEntity']>>) {
  for (const entity of targetEntities.values()) if (!targetWorld.hasComponent(entity, Name)) targetWorld.addComponent(entity, Name, { value: 'Object' });
}
function sceneObjectsFrom(sourceWorld: World, sourceEntities: ReadonlyMap<string, ReturnType<World['createEntity']>>, sourceHierarchy: SceneHierarchy): SceneObject[] {
  const result: SceneObject[] = [];
  for (const [id, entity] of sourceEntities) {
    const name = sourceWorld.getComponent(entity, Name)?.value ?? 'Object'; const transform = sourceHierarchy.getGlobalTransform(id);
    const sprite = sourceWorld.getComponent(entity, SpriteRenderer2D); const physics = sourceWorld.getComponent(entity, Physics); const collider = sourceWorld.getComponent(entity, Collider);
    const scaleX = Math.hypot(transform.a, transform.b); const scaleY = Math.hypot(transform.c, transform.d); const rotation = Math.atan2(transform.b, transform.a);
    result.push({ ...(sourceWorld.hasComponent(entity, Parallax2D) ? { parallax: sourceWorld.getComponent(entity, Parallax2D)! } : {}), id, name, x: transform.tx, y: transform.ty, rotation, width: (sprite?.width ?? 1) * scaleX, height: (sprite?.height ?? 1) * scaleY, color: sprite?.tint ?? '#ffffff', order: sprite?.order ?? 0, dynamic: physics?.bodyType === 'Dynamic', hasSprite: Boolean(sprite), assetId: sprite?.asset?.assetId ?? null, region: sprite?.region ?? null, ...(physics ? { physics } : {}), ...(collider ? { collider } : {}) });
  }
  for (const item of collectTileRenderItems(sourceWorld, sourceEntities, sourceHierarchy, atlases)) {
    const scaleX = Math.hypot(item.transform.a, item.transform.b); const scaleY = Math.hypot(item.transform.c, item.transform.d);
    result.push({ id: item.entityId, name: item.entityId, x: item.transform.tx, y: item.transform.ty, rotation: Math.atan2(item.transform.b, item.transform.a), width: item.width * scaleX, height: item.height * scaleY, color: item.tint, order: item.order, dynamic: false, hasSprite: true, assetId: item.assetId, region: item.region });
  }
  for (const [id, entity] of sourceEntities) if (sourceWorld.hasComponent(entity, Tilemap2D)) {
    const map = sourceWorld.getComponent(entity, Tilemap2D)!; const { layers } = parseTilemap(map); const transform = sourceHierarchy.getGlobalTransform(id);
    for (const layer of layers) if (layer.collidable) layer.cells.forEach((tile, index) => { if (!tile) return; const x = (index % map.width - (map.width - 1) / 2) * map.tileSize; const y = ((map.height - 1) / 2 - Math.floor(index / map.width)) * map.tileSize;
      result.push({ id: `${id}:tile-collider:${layer.id}:${index}`, name: `${layer.name} tile`, x: transform.tx + transform.a * x + transform.c * y, y: transform.ty + transform.b * x + transform.d * y, width: map.tileSize, height: map.tileSize, color: '#ffffff', dynamic: false, rotation: Math.atan2(transform.b, transform.a), hasSprite: false, assetId: null, physics: { bodyType: 'Fixed', gravityScale: 1 }, collider: { shape: 'Box', friction: 0.7, restitution: 0, sensor: false, groups: 1, mask: 65535 } });
    });
  }
  return result;
}
function syncLegacyObjects() {
  objects.splice(0, objects.length, ...sceneObjectsFrom(world, entities, hierarchy));
}
function renderHierarchy() {
  const host = element('object-list'); const rows: HTMLButtonElement[] = [];
  for (const [id, button] of objectButtons) if (!entities.has(id)) { button.remove(); objectButtons.delete(id); }
  const addRow = (id: string, depth: number) => {
    const entity = entities.get(id)!; const name = world.getComponent(entity, Name)?.value ?? id;
    const button = objectButtons.get(id) ?? document.createElement('button'); button.className = 'object-row'; button.setAttribute('role', 'treeitem'); button.setAttribute('aria-level', String(depth + 1)); button.setAttribute('aria-selected', String(selectedIds.includes(id))); button.style.paddingLeft = `${14 + depth * 16}px`; button.textContent = `${hierarchy.getChildren(id).length ? '⌄' : '◇'}  ${name}`;
    button.onclick = event => selectObject(id, event.ctrlKey || event.metaKey, event.shiftKey);
    button.oncontextmenu = event => { event.preventDefault(); if (!selectedIds.includes(id)) selectObject(id); showObjectMenu(id, event.clientX, event.clientY); };
    objectButtons.set(id, button); rows.push(button); for (const child of hierarchy.getChildren(id)) addRow(child, depth + 1);
  };
  for (const id of entities.keys()) if (!hierarchy.getParent(id)) addRow(id, 0);
  rows.forEach((row, index) => { if (host.children[index] !== row) host.insertBefore(row, host.children[index] ?? null); });
}
function updateHistoryControls() { element<HTMLButtonElement>('undo').disabled = !editHistory.canUndo || playing; element<HTMLButtonElement>('redo').disabled = !editHistory.canRedo || playing; element<HTMLButtonElement>('undo').textContent = editHistory.undoLabel ? `↶ ${editHistory.undoLabel}` : '↶ Undo'; element<HTMLButtonElement>('redo').textContent = editHistory.redoLabel ? `↷ ${editHistory.redoLabel}` : '↷ Redo'; }
function refreshEditor() {
  if (!entities.has(selectedId)) selectedId = entities.keys().next().value ?? '';
  selectedIds = selectedIds.filter(id => entities.has(id)); if (!selectedIds.length && selectedId) selectedIds = [selectedId];
  syncLegacyObjects(); renderHierarchy(); refreshGamePreviewIfStructureChanged();
  const selectedEntity = entities.get(selectedId); element('object-name').textContent = selectedEntity ? world.getComponent(selectedEntity, Name)?.value ?? selectedId : 'No objects';
  if (selectedEntity && world.hasComponent(selectedEntity, ScriptBinding)) element<HTMLInputElement>('script-speed').value = String(world.getComponent(selectedEntity, ScriptBinding)!.speed);
  syncSelectedGraph();
  syncSelectedCodeFile();
  renderInspector(); renderScene(); updateTileTools(); updateAnimationPanel(); refreshAssetUsageIndicators(); updateHistoryControls();
}
function updateTileTools() {
  const layerSelect = element<HTMLSelectElement>('tile-layer'); const assetSelect = element<HTMLSelectElement>('tile-asset');
  const entity = entities.get(selectedId); const map = entity && world.hasComponent(entity, Tilemap2D) ? world.getComponent(entity, Tilemap2D)! : undefined;
  element('tilemap-tools').hidden = !map; element('tilemap-tab').hidden = !map;
  if (!map && activeBottomPanel === 'tilemap') bottomPanel('assets');
  const tiles = map ? parseTilemap(map).tiles : [];
  const layerId = layerSelect.value; layerSelect.replaceChildren();
  if (map) for (const layer of parseTilemap(map).layers) { const option = document.createElement('option'); option.value = layer.id; option.textContent = layer.name + (layer.collidable ? ' · collision' : ''); layerSelect.append(option); }
  if ([...layerSelect.options].some(option => option.value === layerId)) layerSelect.value = layerId;
  const currentLayer = map && parseTilemap(map).layers.find(layer => layer.id === layerSelect.value);
  element<HTMLButtonElement>('tile-layer-collision').textContent = currentLayer?.collidable ? 'Collision: On' : 'Collision: Off';
  element<HTMLButtonElement>('tile-layer-visibility').textContent = currentLayer?.visible ? 'Visible: On' : 'Visible: Off';
  // An explicit Erase choice is distinct from an uninitialized palette,
  // which should default to the first available tile.
  const selectedTile = tileEraseSelected ? '' : selectedTileDefinitionId || assetSelect.value || tiles[0]?.id || ''; assetSelect.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Erase tile'; assetSelect.append(empty);
  for (const tile of tiles) { const asset = assets?.getAsset(tile.asset.assetId); const option = document.createElement('option'); option.value = tile.id; option.textContent = `${asset?.name ?? tile.asset.assetId}${tile.neighborGroup ? ` · ${tile.neighborGroup}` : ''}`; assetSelect.append(option); }
  if ([...assetSelect.options].some(option => option.value === selectedTile)) assetSelect.value = selectedTile;
  selectedTileDefinitionId = assetSelect.value;
  const sourceSelect = element<HTMLSelectElement>('tile-definition-asset'); const selectedAsset = sourceSelect.value; sourceSelect.replaceChildren();
  const imageAssets = assets?.listAssets().filter(item => item.kind === 'image') ?? [];
  for (const asset of imageAssets) { const option = document.createElement('option'); option.value = asset.assetId; option.textContent = asset.path; sourceSelect.append(option); }
  if ([...sourceSelect.options].some(option => option.value === selectedAsset)) sourceSelect.value = selectedAsset;
  else if (sourceSelect.options.length) sourceSelect.selectedIndex = 0;
  const spriteChoices = spriteSourceChoices(); selectedTileAssetIds = new Set([...selectedTileAssetIds].filter(value => spriteChoices.some(choice => spriteSourceValue(choice) === value)));
  const picker = element<HTMLButtonElement>('tile-image-picker'); const pickerMenu = element('tile-image-options'); const selectedImage = imageAssets.find(asset => asset.assetId === sourceSelect.value);
  picker.disabled = !selectedImage || playing; picker.setAttribute('aria-expanded', String(!pickerMenu.hidden));
  element('tile-image-name').textContent = selectedImage?.path ?? 'No image assets';
  element('tile-image-selected-count').textContent = `${selectedTileAssetIds.size} selected`;
  const pickerIcon = picker.querySelector('.asset-icon')!; pickerIcon.replaceChildren();
  if (selectedImage) { const thumb = document.createElement('img'); thumb.alt = ''; void resolveUiImage(selectedImage.assetId).then(url => { if (url && thumb.isConnected) thumb.src = url; }); pickerIcon.append(thumb); } else pickerIcon.textContent = '▧';
  pickerMenu.replaceChildren();
  for (const choice of spriteChoices) {
    const value = spriteSourceValue(choice); const option = document.createElement('button'); option.type = 'button'; option.className = 'tile-image-option'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(selectedTileAssetIds.has(value))); option.setAttribute('aria-label', choice.label);
    const thumb = document.createElement('img'); thumb.alt = ''; void spriteSourcePreviewUrl(choice).then(url => { if (url && thumb.isConnected) thumb.src = url; });
    const name = document.createElement('span'); name.textContent = choice.label; const check = document.createElement('span'); check.className = 'tile-image-check'; check.textContent = selectedTileAssetIds.has(value) ? '✓' : '+'; option.append(thumb, name, check);
    option.onclick = () => { if (selectedTileAssetIds.has(value)) selectedTileAssetIds.delete(value); else selectedTileAssetIds.add(value); sourceSelect.value = choice.assetId; updateTileTools(); };
    pickerMenu.append(option);
  }
  const addTileButton = element<HTMLButtonElement>('tile-definition-add');
  addTileButton.textContent = selectedTileAssetIds.size > 0 ? `＋ Add ${selectedTileAssetIds.size} Tiles` : '＋ Add Tile';
  addTileButton.disabled = !map || (!sourceSelect.value && selectedTileAssetIds.size === 0) || playing;
  const list = element('tile-definition-list'); list.replaceChildren();
  for (const [index, tile] of tiles.entries()) {
    const asset = assets?.getAsset(tile.asset.assetId); const button = document.createElement('button'); button.type = 'button'; button.className = `tile-definition${tile.id === selectedTileDefinitionId ? ' selected' : ''}`; button.setAttribute('aria-pressed', String(tile.id === selectedTileDefinitionId));
    const image = document.createElement('img'); image.alt = ''; image.src = ''; void spriteSourcePreviewUrl({ assetId: tile.asset.assetId, ...(tile.region ? { region: tile.region } : {}) }).then(url => { if (url && button.isConnected) image.src = url; });
    const regionName = tile.region ? atlases.find(item => item.id === tile.region!.atlasId)?.regions.find(item => item.id === tile.region!.regionId)?.name : undefined;
    const text = document.createElement('span'); text.textContent = `${regionName ?? asset?.name ?? tile.asset.assetId} · ${index + 1}`; button.append(image, text);
    button.onclick = () => { selectedTileDefinitionId = tile.id; tileEraseSelected = false; assetSelect.value = tile.id; updateTileTools(); };
    list.append(button);
  }
  const selectedDefinition = tiles.find(tile => tile.id === selectedTileDefinitionId);
  const groupInput = element<HTMLInputElement>('tile-neighbor-group'); groupInput.disabled = !map || !selectedDefinition || playing; groupInput.value = selectedDefinition?.neighborGroup ?? '';
  element<HTMLButtonElement>('tile-definition-add').disabled = !map || !sourceSelect.value || playing;
  element<HTMLButtonElement>('tile-definition-remove').disabled = !map || !selectedDefinition || playing;
  const maskSelect = element<HTMLSelectElement>('tile-variant-mask'); const previousMask = maskSelect.value || '0'; maskSelect.replaceChildren();
  for (let mask = 0; mask < 16; mask++) { const option = document.createElement('option'); option.value = String(mask); option.textContent = `${mask} · ${['Up', 'Right', 'Down', 'Left'].filter((_, bit) => mask & (1 << bit)).join(' + ') || 'No neighbors'}`; maskSelect.append(option); }
  if ([...maskSelect.options].some(option => option.value === previousMask)) maskSelect.value = previousMask;
  const variantSelect = element<HTMLSelectElement>('tile-variant-tile'); const previousVariant = variantSelect.value; variantSelect.replaceChildren();
  for (const [index, tile] of tiles.entries()) if (tile.id !== selectedDefinition?.id) { const option = document.createElement('option'); option.value = tile.id; option.textContent = `${assets?.getAsset(tile.asset.assetId)?.name ?? 'Tile'} · ${index + 1}`; variantSelect.append(option); }
  if ([...variantSelect.options].some(option => option.value === previousVariant)) variantSelect.value = previousVariant;
  maskSelect.disabled = variantSelect.disabled = !map || !selectedDefinition || playing;
  element<HTMLButtonElement>('tile-variant-set').disabled = !map || !selectedDefinition || !variantSelect.value || playing;
  const variants = element('tile-variant-list'); variants.replaceChildren();
  for (const [mask, variantId] of Object.entries(selectedDefinition?.variants ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const row = document.createElement('div'); row.className = 'tile-variant-row'; const target = tiles.find(tile => tile.id === variantId); const targetName = target ? assets?.getAsset(target.asset.assetId)?.name ?? target.asset.assetId : `${variantId} (missing)`;
    const label = document.createElement('span'); label.textContent = `${mask}: ${targetName}`; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = !map || playing; remove.onclick = () => editTileVariant(mask, null); row.append(label, remove); variants.append(row);
  }
  const help = element('tile-definition-help'); const painted = map ? parseTilemap(map).layers.reduce((sum, layer) => sum + layer.cells.filter(Boolean).length, 0) : 0; help.dataset.paintedCells = String(painted);
  help.textContent = map ? `${tiles.length} tile${tiles.length === 1 ? '' : 's'} · ${painted} painted cells · same-group tiles can use neighbor variants.` : 'Select an object with Tilemap 2D to edit its tiles.';
  element<HTMLButtonElement>('tile-paint').disabled = !map || playing; element<HTMLButtonElement>('tile-fill').disabled = !map || playing;
}
function editTileVariant(mask: string, variantId: string | null) {
  const entity = entities.get(selectedId); const tileId = selectedTileDefinitionId;
  if (!entity || !world.hasComponent(entity, Tilemap2D) || !tileId || playing) return;
  performEdit(variantId ? 'Set Tile Variant' : 'Remove Tile Variant', () => { const map = world.getComponent(entity, Tilemap2D)!; const { tiles } = parseTilemap(map); const tile = tiles.find(item => item.id === tileId); if (!tile) return; const variants = { ...(tile.variants ?? {}) }; if (variantId) variants[mask] = variantId; else delete variants[mask]; tile.variants = Object.keys(variants).length ? variants : undefined; world.setComponent(entity, Tilemap2D, { ...map, tilesJson: JSON.stringify(tiles) }); });
}
function updateAnimationPanel() {
  const entity = entities.get(selectedId); const data = entity && world.hasComponent(entity, SpriteAnimation2D) ? world.getComponent(entity, SpriteAnimation2D)! : undefined;
  const clips = data ? parseAnimationClips(data.clipsJson) : []; const clipSelect = element<HTMLSelectElement>('animation-clip'); const selectedClipId = clipSelect.value || data?.clipId || '';
  clipSelect.replaceChildren(); for (const clip of clips) { const option = document.createElement('option'); option.value = clip.id; option.textContent = clip.name; clipSelect.append(option); }
  if ([...clipSelect.options].some(option => option.value === selectedClipId)) clipSelect.value = selectedClipId;
  const clipList = element('animation-clip-list'); clipList.replaceChildren();
  for (const item of clips) { const button = document.createElement('button'); button.type = 'button'; button.className = `animation-clip-card${item.id === clipSelect.value ? ' selected' : ''}`; button.setAttribute('aria-pressed', String(item.id === clipSelect.value)); const title = document.createElement('strong'); title.textContent = item.name; const meta = document.createElement('small'); meta.textContent = `${item.duration}s · ${item.frames.length} frames · ${item.tracks.reduce((sum, track) => sum + track.keys.length, 0)} keys`; button.append(title, meta); button.onclick = () => { clipSelect.value = item.id; clipSelect.dispatchEvent(new Event('change')); }; clipList.append(button); }
  const clip = clips.find(item => item.id === clipSelect.value); const active = Boolean(data && clip && !playing);
  for (const id of ['animation-clip-remove', 'animation-frame-add', 'animation-key-add']) element<HTMLButtonElement>(id).disabled = !active;
  element<HTMLButtonElement>('animation-clip-add').disabled = !data || playing;
  const name = element<HTMLInputElement>('animation-clip-name'); name.disabled = !active; name.value = clip?.name ?? '';
  const duration = element<HTMLInputElement>('animation-duration'); duration.disabled = !active; duration.value = clip ? String(clip.duration) : '';
  const loop = element<HTMLInputElement>('animation-loop'); loop.disabled = !active; loop.checked = clip?.loop ?? true;
  const autoplay = element<HTMLInputElement>('animation-autoplay'); autoplay.disabled = !data || playing; autoplay.checked = data?.playOnStart ?? true;
  const frameAssets = element<HTMLSelectElement>('animation-frame-asset'); const chosenAsset = frameAssets.value; frameAssets.replaceChildren();
  fillSpriteSourceSelect(frameAssets, chosenAsset);
  frameAssets.disabled = !active;
  element<HTMLButtonElement>('animation-frame-add').disabled = !active || !frameAssets.value;
  const propertySelect = element<HTMLSelectElement>('animation-property'); const prior = animationSelectedProperty; propertySelect.replaceChildren();
  for (const schema of schemas.all()) if (schema.component !== SpriteAnimation2D) for (const [fieldName, field] of Object.entries(schema.fields)) if (['number', 'string', 'color', 'enum', 'boolean'].includes(field.type)) { const option = document.createElement('option'); option.value = `${schema.typeId}.${fieldName}`; option.textContent = `${schema.displayName} · ${field.label}`; propertySelect.append(option); }
  if ([...propertySelect.options].some(option => option.value === prior)) propertySelect.value = prior; else animationSelectedProperty = propertySelect.value;
  propertySelect.disabled = !active;
  const valueInput = element<HTMLInputElement>('animation-key-value'); const optionInput = element<HTMLSelectElement>('animation-key-value-select'); const propertySeparator = propertySelect.value.lastIndexOf('.'); const typeId = propertySelect.value.slice(0, propertySeparator); const fieldName = propertySelect.value.slice(propertySeparator + 1); const field = schemas.get(typeId)?.fields[fieldName];
  const optionValues = field?.type === 'enum' ? field.options : field?.type === 'boolean' ? ['true', 'false'] : [];
  optionInput.replaceChildren(...optionValues.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; })); optionInput.hidden = optionValues.length === 0; optionInput.disabled = !active || !optionValues.length;
  valueInput.hidden = optionValues.length > 0; valueInput.type = field?.type === 'color' ? 'color' : field?.type === 'number' ? 'number' : 'text'; valueInput.step = field?.type === 'number' ? '0.1' : ''; valueInput.disabled = !active || !field || optionValues.length > 0;
  element<HTMLButtonElement>('animation-key-add').disabled = !active || !field;
  element<HTMLInputElement>('animation-key-time').disabled = !active;
  element<HTMLInputElement>('animation-frame-duration').disabled = !active || frameAssets.options.length === 0;
  const framesList = element('animation-frames'); const timeline = element('animation-timeline'); framesList.replaceChildren(); timeline.replaceChildren();
  if (!data || !clip) { const note = document.createElement('span'); note.className = 'muted'; note.textContent = data ? 'Select a clip or press New Clip to begin.' : 'Add Sprite Animation 2D to the selected object to create clips.'; framesList.append(note); return; }
  clip.frames.forEach((frame, index) => {
    const row = document.createElement('div'); row.className = 'animation-row animation-frame-row';
    const label = document.createElement('span'); label.textContent = `Frame ${index + 1}`;
    const assetSelect = document.createElement('select'); assetSelect.setAttribute('aria-label', `Frame ${index + 1} image`);
    fillSpriteSourceSelect(assetSelect, spriteSourceValue({ assetId: frame.assetId, ...(frame.region ? { region: frame.region } : {}) }));
    assetSelect.disabled = !active; assetSelect.onchange = () => { const source = parseSpriteSourceValue(assetSelect.value); if (source) editSelectedAnimation('Change Sprite Frame', (_data, nextClip) => ({ ...nextClip, frames: nextClip.frames.map((item, i) => i === index ? { ...item, ...source } : item) })); };
    const frameTime = document.createElement('input'); frameTime.type = 'number'; frameTime.min = '0.01'; frameTime.step = '0.05'; frameTime.value = String(frame.duration); frameTime.setAttribute('aria-label', `Frame ${index + 1} duration`); frameTime.disabled = !active; frameTime.onchange = () => { const nextTime = Number(frameTime.value); if (nextTime > 0) editSelectedAnimation('Change Frame Duration', (_data, nextClip) => { const frames = nextClip.frames.map((item, i) => i === index ? { ...item, duration: nextTime } : item); return { ...nextClip, duration: Math.max(nextClip.duration, frames.reduce((sum, item) => sum + item.duration, 0)), frames }; }); };
    const earlier = document.createElement('button'); earlier.type = 'button'; earlier.textContent = '↑'; earlier.title = 'Move frame earlier'; earlier.setAttribute('aria-label', `Move frame ${index + 1} earlier`); earlier.disabled = !active || index === 0; earlier.onclick = () => editSelectedAnimation('Reorder Sprite Frames', (_data, nextClip) => { const next = [...nextClip.frames]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return { ...nextClip, frames: next }; });
    const later = document.createElement('button'); later.type = 'button'; later.textContent = '↓'; later.title = 'Move frame later'; later.setAttribute('aria-label', `Move frame ${index + 1} later`); later.disabled = !active || index === clip.frames.length - 1; later.onclick = () => editSelectedAnimation('Reorder Sprite Frames', (_data, nextClip) => { const next = [...nextClip.frames]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return { ...nextClip, frames: next }; });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = !active; remove.onclick = () => editSelectedAnimation('Remove Sprite Frame', (_data, nextClip) => ({ ...nextClip, frames: nextClip.frames.filter((_, i) => i !== index) })); row.append(label, assetSelect, frameTime, earlier, later, remove); framesList.append(row);
  });
  clip.tracks.forEach((track, trackIndex) => track.keys.forEach((key, keyIndex) => {
    const row = document.createElement('div'); row.className = 'animation-row animation-key-row'; const schema = schemas.get(track.componentTypeId); const definition = schema?.fields[track.field];
    const label = document.createElement('span'); label.textContent = `${schema?.displayName ?? track.componentTypeId} · ${definition?.label ?? track.field}`;
    const keyTime = document.createElement('input'); keyTime.type = 'number'; keyTime.min = '0'; keyTime.max = String(clip.duration); keyTime.step = '0.1'; keyTime.value = String(key.time); keyTime.setAttribute('aria-label', `Key ${keyIndex + 1} time`); keyTime.disabled = !active; keyTime.onchange = () => { const time = Number(keyTime.value); if (!Number.isFinite(time) || time < 0 || time > clip.duration) return; editSelectedAnimation('Move Keyframe', (_data, nextClip) => ({ ...nextClip, tracks: nextClip.tracks.map((item, i) => i !== trackIndex ? item : { ...item, keys: item.keys.map((candidate, j) => j === keyIndex ? { ...candidate, time } : candidate).sort((a, b) => a.time - b.time) }) })); };
    let keyEditor: HTMLInputElement | HTMLSelectElement;
    if (definition?.type === 'enum' || definition?.type === 'boolean') { const select = document.createElement('select'); const choices = definition.type === 'enum' ? definition.options : ['true', 'false']; for (const choice of choices) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; select.append(option); } select.value = String(key.value); select.disabled = !active; select.setAttribute('aria-label', `Key ${keyIndex + 1} value`); select.onchange = () => updateAnimationKeyValue(trackIndex, keyIndex, definition.type === 'boolean' ? select.value === 'true' : select.value); keyEditor = select; }
    else { const input = document.createElement('input'); input.setAttribute('aria-label', `Key ${keyIndex + 1} value`); input.disabled = !active; input.type = definition?.type === 'color' ? 'color' : definition?.type === 'number' ? 'number' : 'text'; input.value = String(key.value); input.step = definition?.type === 'number' ? '0.1' : ''; input.onchange = () => { const value = definition?.type === 'number' ? Number(input.value) : input.value; updateAnimationKeyValue(trackIndex, keyIndex, value); }; keyEditor = input; }
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = !active; remove.onclick = () => editSelectedAnimation('Remove Keyframe', (_data, nextClip) => ({ ...nextClip, tracks: nextClip.tracks.map((item, i) => i !== trackIndex ? item : { ...item, keys: item.keys.filter((_, j) => j !== keyIndex) }).filter(item => item.keys.length) })); row.append(label, keyTime, keyEditor, remove); timeline.append(row);
  }));
}
function updateAnimationKeyValue(trackIndex: number, keyIndex: number, value: number | string | boolean) { editSelectedAnimation('Change Keyframe Value', (_data, clip) => ({ ...clip, tracks: clip.tracks.map((track, index) => index !== trackIndex ? track : { ...track, keys: track.keys.map((key, index) => index !== keyIndex ? key : { ...key, value }) }) })); }
function editSelectedAnimation(label: string, edit: (data: ReturnType<typeof createSpriteAnimation>, clip: SpriteAnimationClip) => SpriteAnimationClip | null) {
  const entity = entities.get(selectedId); if (!entity || !world.hasComponent(entity, SpriteAnimation2D) || playing) return;
  const beforeData = world.getComponent(entity, SpriteAnimation2D)!; const clips = parseAnimationClips(beforeData.clipsJson); const clip = clips.find(item => item.id === element<HTMLSelectElement>('animation-clip').value); if (!clip) return;
  performEdit(label, () => { const updatedClip = edit(beforeData, clip); const nextClips = updatedClip ? clips.map(item => item.id === clip.id ? updatedClip : item) : clips.filter(item => item.id !== clip.id); world.setComponent(entity, SpriteAnimation2D, { ...beforeData, clipsJson: JSON.stringify(nextClips), clipId: nextClips.some(item => item.id === beforeData.clipId) ? beforeData.clipId : nextClips[0]?.id ?? '' }); });
}
function refreshGamePreviewIfStructureChanged() {
  const nextSignature = JSON.stringify(objects);
  if (nextSignature === gamePreviewSignature) return;
  gamePreviewSignature = nextSignature; const revision = ++gamePreviewRevision;
  if (!gameScene || playing) return;
  gameScene.dispose(); gameScene = undefined;
  void createScene(element('game-view'), objects, selectObject, loadEditorTexture, sharedPreviewCamera).then(scene => {
    if (revision !== gamePreviewRevision) { scene.dispose(); return; }
    gameScene = scene; setupUiPreview(scene); controls();
  }).catch(error => log(`Game preview refresh failed: ${String(error)}`, true));
}
function recordEdit(label: string, before: EditorSnapshot) {
  const after = captureSnapshot(); if (before.document !== after.document) { editHistory.record(label, before, after); scheduleSave(); } updateHistoryControls();
  try { refreshEditor(); } catch (error) { log(`Scene changed, but editor refresh failed: ${String(error)}`, true); }
}
function performEdit(label: string, operation: () => void) {
  const before = captureSnapshot(); operation(); recordEdit(label, before);
}
function restoreSnapshot(snapshot: EditorSnapshot) {
  const loaded = codec.deserialize(snapshot.document); world = loaded.world; entities = new Map(loaded.entities); ensureSceneNames(world, entities); hierarchy = new SceneHierarchy(world, entities); selectedIds = snapshot.selection.filter(id => entities.has(id)); selectedId = selectedIds.at(-1) ?? entities.keys().next().value ?? ''; refreshEditor(); scheduleSave();
}
function undo() { const command = editHistory.undo(); if (command) { restoreSnapshot(command.before); log(`Undo: ${command.label}`); } updateHistoryControls(); }
function redo() { const command = editHistory.redo(); if (command) { restoreSnapshot(command.after); log(`Redo: ${command.label}`); } updateHistoryControls(); }
function selectObject(id: string, additive = false, range = false) {
  finishInspectorEdit(false);
  if (!entities.has(id)) return;
  if (range && lastSelectedId) { const ids = [...entities.keys()]; const a = ids.indexOf(lastSelectedId); const b = ids.indexOf(id); selectedIds = ids.slice(Math.min(a, b), Math.max(a, b) + 1); }
  else if (additive) selectedIds = selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id];
  else selectedIds = [id];
  if (!selectedIds.length) selectedIds = [id]; selectedId = id; lastSelectedId = id;
  gameScene?.select(id); refreshEditor();
}
function rebuildHierarchy() { hierarchy = new SceneHierarchy(world, entities); }
function createObject(name = 'Object') {
  if (playing) return;
  const id = `entity:${crypto.randomUUID()}`;
  performEdit('Create Object', () => {
    const entity = world.createEntity(); entities.set(id, entity);
    world.addComponent(entity, Name, { value: name }); world.addComponent(entity, Transform2D, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    world.addComponent(entity, SpriteRenderer2D, { asset: defaultAssetId ? { assetId: defaultAssetId } : null, region: null, width: 1, height: 1, order: 0, tint: '#ffffff' });
    world.addComponent(entity, Physics, { bodyType: 'Dynamic', gravityScale: 1 }); world.addComponent(entity, Collider, { shape: 'Box', friction: 0.7, restitution: 0.25, sensor: false, groups: 1, mask: 65535 }); selectedId = id; selectedIds = [id]; rebuildHierarchy();
  });
}
function serializedComponents(id: string, doc: ReturnType<typeof codec.serialize>) {
  return doc.entities.find(record => record.id === id)?.components ?? [];
}
function createPrefabFromSelection() {
  if (playing || !selectedId) return;
  const name = window.prompt('Prefab name', world.getComponent(entities.get(selectedId)!, Name)?.value ?? 'New Prefab')?.trim();
  if (name === undefined || !name) return;
  const descendants = new Set<string>(); const visit = (id: string) => { descendants.add(id); for (const child of hierarchy.getChildren(id)) visit(child); }; visit(selectedId);
  const source = codec.serialize(world, entities, 'scene:prefab');
  const records = source.entities.filter(item => descendants.has(item.id)).map(item => ({ ...item, components: item.id === selectedId ? item.components.filter(component => component.typeId !== parentSchema.typeId) : item.components }));
  const scene = { ...source, entities: records };
  const prefab = makePrefab(`prefab:${crypto.randomUUID()}`, name, scene, selectedId);
  prefabs = [...prefabs, prefab]; renderAssets(); scheduleSave(); log(`Created prefab "${name}" with ${records.length} object${records.length === 1 ? '' : 's'}.`);
}
function updatePrefabSourceFromSelection(prefabId: string) {
  if (playing) return;
  const prefab = prefabs.find(item => item.prefabId === prefabId); if (!prefab) return;
  const selectedLink = world.getComponent(entities.get(selectedId)!, PrefabLink);
  const sourceRootId = selectedLink?.prefabId === prefabId ? selectedLink.sourceEntityId : selectedId;
  if (sourceRootId !== prefab.rootEntityId) { log(`Select the prefab source root "${world.getComponent(entities.get(prefab.rootEntityId)!, Name)?.value ?? prefab.name}" to update this source.`, true); return; }
  const descendants = new Set<string>(); const visit = (id: string) => { descendants.add(id); for (const child of hierarchy.getChildren(id)) visit(child); }; visit(selectedId);
  const document = codec.serialize(world, entities, 'scene:prefab');
  const records = document.entities.filter(item => descendants.has(item.id)).map(item => ({ id: selectedLink ? world.getComponent(entities.get(item.id)!, PrefabLink)?.sourceEntityId ?? item.id : item.id, components: item.components.filter(component => component.typeId !== prefabLinkSchema.typeId && !(item.id === selectedId && component.typeId === parentSchema.typeId)) }));
  const sourceScene = { ...document, entities: records };
  prefabs = prefabs.map(item => item.prefabId === prefabId ? makePrefab(item.prefabId, item.name, sourceScene, prefab.rootEntityId) : item);
  renderAssets(); scheduleSave(); log(`Updated prefab source "${prefab.name}" from the selected hierarchy.`);
}
function instantiatePrefab(prefabId: string) {
  if (playing) return;
  const prefab = prefabs.find(item => item.prefabId === prefabId); if (!prefab) { log('Prefab reference is broken. Reimport or restore the prefab source.', true); return; }
  const source = codec.deserialize(prefab.scene); const sourceDocument = codec.serialize(source.world, source.entities, 'scene:prefab'); const idMap = new Map([...source.entities.keys()].map(id => [id, `entity:${crypto.randomUUID()}`]));
  const instanceId = `prefab-instance:${crypto.randomUUID()}`; const rootId = idMap.get(prefab.rootEntityId)!;
  performEdit('Instantiate Prefab', () => {
    for (const [sourceId, sourceEntity] of source.entities) {
      const id = idMap.get(sourceId)!; const entity = world.createEntity(); entities.set(id, entity);
      const components = serializedComponents(sourceId, sourceDocument);
      for (const schema of schemas.all()) {
        const component = components.find(item => item.typeId === schema.typeId); if (!component) continue;
        const data = structuredClone(component.data) as Record<string, unknown>; remapPrefabEntityReferences(data, schema, idMap);
        if (schema === transform2DSchema && sourceId === prefab.rootEntityId) { data.x = Number(data.x) + 1; data.y = Number(data.y) + 1; }
        world.addComponent(entity, schema.component, data);
      }
      const baseline = components.filter(component => component.typeId !== prefabLinkSchema.typeId).map(component => structuredClone(component));
      world.addComponent(entity, PrefabLink, { prefabId, sourceEntityId: sourceId, instanceId, baselineJson: JSON.stringify(baseline), overridesJson: '[]', broken: false });
    }
    for (const [sourceId, id] of idMap) { const parentId = source.world.getComponent(source.entities.get(sourceId)!, parentSchema.component)?.parentId; if (parentId && idMap.has(parentId)) hierarchy.setParent(id, idMap.get(parentId)!); }
    rebuildHierarchy(); selectedId = rootId; selectedIds = [rootId];
  });
}
function remapPrefabEntityReferences(data: Record<string, unknown>, schema: ComponentSchema, ids: ReadonlyMap<string, string>) {
  for (const [key, field] of Object.entries(schema.fields)) if (field.type === 'entity' && typeof data[key] === 'string' && ids.has(data[key] as string)) data[key] = ids.get(data[key] as string)!;
}
function updatePrefabInstances(prefabId: string) {
  const prefab = prefabs.find(item => item.prefabId === prefabId); if (!prefab) { log('Prefab source is missing; instances cannot be updated.', true); return; }
  const source = codec.deserialize(prefab.scene); const sourceDocument = codec.serialize(source.world, source.entities, 'scene:prefab'); const groups = new Map<string, [string, ReturnType<typeof world.createEntity>][] >();
  for (const [id, entity] of entities) { const link = world.getComponent(entity, PrefabLink); if (!link || link.prefabId !== prefabId) continue; const group = groups.get(link.instanceId) ?? []; group.push([id, entity]); groups.set(link.instanceId, group); }
  if (!groups.size) { log('No instances of this prefab exist in the scene.'); return; }
  performEdit('Update Prefab Instances', () => {
    for (const group of groups.values()) {
      const ids = new Map(group.map(([id, entity]) => [world.getComponent(entity, PrefabLink)!.sourceEntityId, id]));
      for (const [id, entity] of group) {
        const link = world.getComponent(entity, PrefabLink)!; const sourceEntity = source.entities.get(link.sourceEntityId);
        if (!sourceEntity) { world.setComponent(entity, PrefabLink, { ...link, broken: true }); continue; }
        const sourceRecords = serializedComponents(link.sourceEntityId, sourceDocument);
        const baseline = JSON.parse(link.baselineJson) as { typeId: string; version: number; data: unknown }[];
        const current = schemas.all().flatMap(schema => schema !== prefabLinkSchema && world.hasComponent(entity, schema.component) ? [{ typeId: schema.typeId, version: schema.version, data: world.getComponent(entity, schema.component) }] : []);
        const remappedSource = sourceRecords.map(record => { const schema = schemas.get(record.typeId); const data = structuredClone(record.data) as Record<string, unknown>; if (schema) remapPrefabEntityReferences(data, schema, ids); return { ...record, data }; });
        const remappedBaseline = baseline.map(record => { const schema = schemas.get(record.typeId); const data = structuredClone(record.data) as Record<string, unknown>; if (schema) remapPrefabEntityReferences(data, schema, ids); return { ...record, data }; });
        const merged = mergePrefabComponents(remappedSource, remappedBaseline, current);
        for (const schema of schemas.all()) if (schema !== prefabLinkSchema) {
          const next = merged.components.find(component => component.typeId === schema.typeId);
          if (!next && world.hasComponent(entity, schema.component)) world.removeComponent(entity, schema.component);
          else if (next) world.setComponent(entity, schema.component, next.data);
        }
        const baselineJson = JSON.stringify(remappedSource);
        world.setComponent(entity, PrefabLink, { ...link, baselineJson, overridesJson: JSON.stringify(merged.overrides), broken: false });
      }
      rebuildHierarchy();
    }
  });
  log(`Updated ${groups.size} prefab instance${groups.size === 1 ? '' : 's'}; local component overrides were preserved.`);
}
function duplicateSelection() {
  if (playing) return;
  const sourceIds = [...selectedIds]; const copies: string[] = [];
  performEdit('Duplicate', () => {
    for (const sourceId of sourceIds) {
      const source = entities.get(sourceId); if (!source) continue;
      const id = `entity:${crypto.randomUUID()}`; const entity = world.createEntity(); entities.set(id, entity); copies.push(id);
      for (const schema of schemas.all()) { if (!world.hasComponent(source, schema.component)) continue; const data = structuredClone(world.getComponent(source, schema.component)); world.addComponent(entity, schema.component, data); }
      const name = world.getComponent(entity, Name); if (name) world.setComponent(entity, Name, { value: `${name.value} Copy` });
      const transform = hierarchy.getLocalTransform(sourceId); world.setComponent(entity, Transform2D, { ...transform, x: transform.x + 0.5, y: transform.y - 0.5 });
    }
    rebuildHierarchy();
    for (let index = 0; index < sourceIds.length; index++) { const parent = hierarchy.getParent(sourceIds[index]!); if (parent && copies[index]) hierarchy.setParent(copies[index]!, parent); }
    selectedIds = copies; selectedId = copies.at(-1) ?? selectedId;
  });
}
function deleteSelection() {
  if (playing) return;
  if (entities.size <= selectedIds.length) { log('At least one scene object must remain.', true); return; }
  const deleting = new Set(selectedIds);
  performEdit('Delete', () => {
    for (const id of deleting) for (const child of hierarchy.getChildren(id)) if (!deleting.has(child)) hierarchy.setParent(child, null);
    for (const id of deleting) { const entity = entities.get(id); if (entity) world.destroyEntity(entity); entities.delete(id); }
    rebuildHierarchy(); selectedId = entities.keys().next().value!; selectedIds = [selectedId];
  });
}
function reparentSelection(parentId: string | null) {
  if (playing) return;
  if (parentId && selectedIds.some(id => { let current: string | null = parentId; while (current) { if (current === id) return true; current = hierarchy.getParent(current); } return false; })) { log('Reparenting would create a hierarchy cycle.', true); return; }
  performEdit(parentId ? 'Set Parent' : 'Make Root', () => { for (const id of selectedIds) hierarchy.setParent(id, parentId); rebuildHierarchy(); });
}
function showObjectMenu(targetId: string, x: number, y: number) {
  const menu = element('object-menu'); menu.replaceChildren(); menu.hidden = false; menu.style.left = `${Math.min(x, innerWidth - 220)}px`; menu.style.top = `${Math.min(y, innerHeight - 180)}px`;
  const add = (label: string, action: () => void) => { const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.textContent = label; button.onclick = () => { menu.hidden = true; action(); }; menu.append(button); };
  add('Duplicate  Ctrl+D', duplicateSelection); add('Delete  Del', deleteSelection);
  const makeRoot = document.createElement('button'); makeRoot.setAttribute('role', 'menuitem'); makeRoot.textContent = 'Make Root'; makeRoot.onclick = () => { menu.hidden = true; reparentSelection(null); }; menu.append(makeRoot);
  for (const [id, entity] of entities) if (id !== targetId && !selectedIds.includes(id)) { const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.textContent = `Make child of ${world.getComponent(entity, Name)?.value ?? id}`; button.onclick = () => { menu.hidden = true; reparentSelection(id); }; menu.append(button); }
}
document.addEventListener('pointerdown', event => { if (!element('object-menu').contains(event.target as Node)) element('object-menu').hidden = true; });
element<HTMLButtonElement>('add-object').onclick = () => createObject();
renderHierarchy();

function buildInspectorField(schema: ComponentSchema, key: string, field: import('@ecs/scene').FieldDefinition, data: Record<string, unknown>): InspectorViewField | undefined {
  if (schema === spriteAnimation2DSchema && ['clipsJson', 'clipId'].includes(key)) return undefined;
  if (schema === tilemap2DSchema && ['layersJson', 'tilesJson'].includes(key)) return undefined;
  let value: unknown = data[key] ?? field.default;
  let options: InspectorOption[] | undefined;
  let actionLabel: string | undefined;
  if (schema === scriptBindingSchema && (key === 'codePath' || key === 'graphPath')) {
    const paths = (key === 'codePath' ? Object.keys(scriptFiles) : Object.keys(visualGraphs)).sort();
    options = [{ value: '', label: 'None' }, ...paths.map(path => ({ value: path, label: path }))];
    if (typeof value === 'string' && value && !paths.includes(value)) options.push({ value, label: `${value} (missing)` });
    value = String(value ?? '');
    actionLabel = key === 'codePath' ? 'Create a script file' : 'Create a node graph';
  } else if (field.type === 'enum') options = field.options.map(option => ({ value: option, label: option }));
  else if (field.type === 'sprite-region') {
    const sourceAssetId = schema === spriteRenderer2DSchema ? (data.asset as { assetId: string } | null)?.assetId : undefined;
    options = [{ value: '', label: 'Full image' }, ...atlases.filter(atlas => sourceAssetId && atlas.assetId === sourceAssetId).flatMap(atlas => atlas.regions.map(region => ({ value: JSON.stringify({ atlasId: atlas.id, regionId: region.id }), label: `${atlas.name} / ${region.name}` })))];
    value = value ? JSON.stringify(value) : '';
  } else if (field.type === 'asset') {
    options = [{ value: '', label: 'None' }, ...(assets?.listAssets().filter(record => record.kind === (field.kind ?? 'image')) ?? []).map(record => ({ value: record.assetId, label: record.path }))];
    value = (value as { assetId: string } | null)?.assetId ?? '';
  } else if (field.type === 'entity') {
    options = [{ value: '', label: 'None' }, ...[...entities].filter(([id]) => id !== selectedId).map(([id, entity]) => ({ value: id, label: world.getComponent(entity, Name)?.value ?? id }))];
    value = String(value ?? '');
  }
  return { key, label: field.label, type: field.type, value, ...(field.type === 'number' ? { min: field.min, max: field.max } : {}), ...(options ? { options } : {}), ...(actionLabel ? { actionLabel } : {}) };
}

let inspectorEdit: { before: EditorSnapshot; label: string } | undefined;
let inspectorPreviewFrame: number | undefined;
function beginInspectorEdit(label: string) {
  finishInspectorEdit(false); inspectorEdit = { before: captureSnapshot(), label: `Set ${label}` };
}
function finishInspectorEdit(cancel: boolean) {
  const edit = inspectorEdit; if (!edit) return; inspectorEdit = undefined;
  if (inspectorPreviewFrame !== undefined) { cancelAnimationFrame(inspectorPreviewFrame); inspectorPreviewFrame = undefined; }
  if (cancel) restoreSnapshot(edit.before);
  else if (edit.before.document !== captureSnapshot().document) {
    syncLegacyObjects(); gameScene?.update(); gamePreviewSignature = JSON.stringify(objects);
    recordEdit(edit.label, edit.before);
  }
}
function queueInspectorPreview() {
  if (inspectorPreviewFrame !== undefined) return;
  inspectorPreviewFrame = requestAnimationFrame(() => {
    inspectorPreviewFrame = undefined; syncLegacyObjects(); gameScene?.update();
    gamePreviewSignature = JSON.stringify(objects); renderScene();
  });
}
function updateInspectorField(entityId: string, schema: ComponentSchema, key: string, field: import('@ecs/scene').FieldDefinition, raw: unknown, preview = false): boolean {
  const entity = entities.get(entityId); if (!entity || playing) return false;
  let next: unknown = raw;
  if (field.type === 'asset') next = raw ? { assetId: String(raw) } : null;
  else if (field.type === 'sprite-region') next = raw ? JSON.parse(String(raw)) as SpriteRegionReference : null;
  else if (field.type === 'entity') next = raw ? String(raw) : null;
  else if (field.type === 'number') next = Number(raw);
  else if (field.type === 'boolean') next = Boolean(raw);
  const currentValue = world.getComponent(entity, schema.component) as Record<string, unknown>;
  let updated = { ...currentValue, [key]: next };
  if (schema === tilemap2DSchema && (key === 'width' || key === 'height')) {
    const oldMap = currentValue as unknown as ReturnType<typeof createTilemap>; const width = key === 'width' ? Number(next) : oldMap.width; const height = key === 'height' ? Number(next) : oldMap.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512) return false;
    const { layers } = parseTilemap(oldMap);
    for (const layer of layers) { const cells = Array<string | null>(width * height).fill(null); for (let y = 0; y < Math.min(height, oldMap.height); y++) for (let x = 0; x < Math.min(width, oldMap.width); x++) cells[y * width + x] = layer.cells[y * oldMap.width + x] ?? null; layer.cells = cells; }
    updated = { ...updated, layersJson: JSON.stringify(layers) };
  }
  const issues = schema.validate(updated); if (issues.length) { if (!preview) { log(`${issues[0]!.path}: ${issues[0]!.message}`, true); renderInspector(); } return false; }
  if (schema === parentSchema && key === 'parentId') { reparentSelection(typeof next === 'string' && next ? next : null); return true; }
  if (currentValue[key] === next) return true;
  if (preview) {
    world.setComponent(entity, schema.component, updated); queueInspectorPreview(); scheduleSave(); return true;
  }
  performEdit(`Set ${field.label}`, () => world.setComponent(entity, schema.component, updated));
  if (schema === scriptBindingSchema && (key === 'codePath' || key === 'graphPath')) {
    if (key === 'codePath') syncSelectedCodeFile();
    else syncSelectedGraph();
  }
  if (schema === transform2DSchema || schema === spriteRenderer2DSchema || schema === nameSchema) gameScene?.update();
  return true;
}

function createBoundScriptResource(entity: ReturnType<World['createEntity']>, key: 'codePath' | 'graphPath') {
  const graph = key === 'graphPath';
  const suggested = graph ? 'scripts/new.graph.json' : 'scripts/new-script.ts';
  const path = window.prompt(graph ? 'New node graph path' : 'New script path', suggested)?.trim();
  if (!path) return;
  const valid = graph ? path.endsWith('.graph.json') : /^scripts\/[^\s]+\.(ts|js)$/.test(path);
  const known = graph ? visualGraphs : scriptFiles;
  if (!valid || path in known) { log(graph ? 'Use a unique *.graph.json path.' : 'Use a unique scripts/*.ts or scripts/*.js path.', true); return; }
  if (graph) graphForPath(path);
  else if (code) { if (!code.createFile(path)) { log('The code editor could not create that file path.', true); return; } }
  else scriptFiles[path] = 'function update(api: engine.ScriptApi) {\n  // Add gameplay logic here.\n}\n';
  const current = world.getComponent(entity, ScriptBinding); if (!current) return;
  performEdit(`Create ${graph ? 'Node Graph' : 'Script File'}`, () => world.setComponent(entity, ScriptBinding, { ...current, [key]: path }));
  if (!graph) refreshScriptFiles();
}

function renderInspector() {
  const entity = entities.get(selectedId);
  if (!entity) { inspectorRoot.render(React.createElement(InspectorView, { groups: [], addable: [], collapsed: collapsedInspectorComponents, disabled: playing, onToggle: () => {}, onRemove: () => {}, onChange: () => {}, onAdd: () => {}, onFieldAction: () => {} })); return; }
  const groups: InspectorViewGroup[] = [];
  const prefabLink = world.getComponent(entity, PrefabLink);
  let prefabStatus: string | undefined;
  if (prefabLink) {
    const source = prefabs.find(item => item.prefabId === prefabLink.prefabId);
    const baseline = JSON.parse(prefabLink.baselineJson || '[]') as { typeId: string; version: number; data: unknown }[];
    const current = schemas.all().flatMap(schema => schema !== prefabLinkSchema && world.hasComponent(entity, schema.component) ? [{ typeId: schema.typeId, version: schema.version, data: world.getComponent(entity, schema.component) }] : []);
    const changed = mergePrefabComponents([], baseline, current).overrides;
    prefabStatus = !source ? 'Broken Prefab Reference · source asset is missing' : changed.length ? `Prefab: ${source.name} · Local overrides: ${changed.map(id => schemas.get(id)?.displayName ?? id).join(', ')}` : `Prefab: ${source.name} · No local overrides`;
  }
  const appendGroup = (key: string, title: string, schemasToRender: readonly ComponentSchema[], removable: boolean) => {
    const fields = schemasToRender.flatMap(schema => {
      const data = world.getComponent(entity, schema.component) as Record<string, unknown>;
      return Object.entries(schema.fields).map(([fieldKey, field]) => buildInspectorField(schema, fieldKey, field, data)).filter((field): field is InspectorViewField => field !== undefined);
    });
    groups.push({ key, title, removable, fields });
  };
  if (world.hasComponent(entity, Name) && world.hasComponent(entity, Transform2D)) appendGroup('engine.object', 'Object', [nameSchema, transform2DSchema], false);
  for (const schema of schemas.all()) {
    if (schema.component === Name || schema.component === Transform2D || schema.component === PrefabLink || !world.hasComponent(entity, schema.component)) continue;
    appendGroup(schema.typeId, schema.displayName, [schema], true);
  }
  const addable = schemas.all().filter(schema => schema.component !== PrefabLink && !world.hasComponent(entity, schema.component)).map(schema => ({ value: schema.typeId, label: schema.displayName }));
  inspectorRoot.render(React.createElement(InspectorView, {
    key: selectedId, prefabStatus, groups, addable, collapsed: collapsedInspectorComponents, disabled: playing,
    onToggle: key => { if (collapsedInspectorComponents.has(key)) collapsedInspectorComponents.delete(key); else collapsedInspectorComponents.add(key); renderInspector(); },
    onRemove: key => { const schema = schemas.get(key); if (schema) performEdit(`Remove ${schema.displayName}`, () => world.removeComponent(entity, schema.component)); },
    onChange: (groupKey, fieldKey, value) => {
      const groupSchemas = groupKey === 'engine.object' ? [nameSchema, transform2DSchema] : [schemas.get(groupKey)].filter((schema): schema is ComponentSchema => Boolean(schema));
      const schema = groupSchemas.find(item => fieldKey in item.fields); const field = schema?.fields[fieldKey];
      if (schema && field) updateInspectorField(selectedId, schema, fieldKey, field, value);
    },
    onEditBegin: beginInspectorEdit,
    onEditEnd: finishInspectorEdit,
    onPreview: (groupKey, fieldKey, value) => {
      const groupSchemas = groupKey === 'engine.object' ? [nameSchema, transform2DSchema] : [schemas.get(groupKey)].filter((schema): schema is ComponentSchema => Boolean(schema));
      const schema = groupSchemas.find(item => fieldKey in item.fields); const field = schema?.fields[fieldKey];
      return Boolean(schema && field && updateInspectorField(selectedId, schema, fieldKey, field, value, true));
    },
    onAdd: typeId => {
      const schema = schemas.get(typeId); if (!schema) return;
      const data = schema.component === Tilemap2D ? createTilemap() : Object.fromEntries(Object.entries(schema.fields).map(([key, field]) => [key, field.default]));
      const issues = schema.validate(data); if (issues.length) { log(`Cannot add ${schema.displayName}: ${issues[0]!.message}`, true); return; }
      performEdit(`Add ${schema.displayName}`, () => world.addComponent(entity, schema.component, data));
      requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('#component-inspector select[aria-label="Component to add"]')?.focus());
    },
    onFieldAction: (groupKey, fieldKey) => { if (groupKey !== 'engine.object' && (fieldKey === 'codePath' || fieldKey === 'graphPath')) createBoundScriptResource(entity, fieldKey); },
  }));
}

async function boot() {
  pluginManager.load(gettingStartedPlugin);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  projectStore = await IndexedDbProjectStore.open(projectId);
  const savedProject = await projectStore.loadProject();
  if (savedProject) { const collection = validateProjectScenes(savedProject.sceneCollection, savedProject.scene); projectScenes = [...collection.scenes]; activeSceneId = collection.activeSceneId; startSceneId = collection.startSceneId; }
  if (savedProject) {
    projectName = savedProject.projectName;
    scriptFiles = { ...savedProject.scripts };
    scriptProperties = { ...scriptProperties, ...savedProject.scriptProperties };
    visualGraphs = { ...savedProject.visualGraphs };
    inputActions = savedProject.inputActions ?? DEFAULT_INPUT_ACTIONS;
    gameViewSettings = validateGameView(savedProject.gameView);
    const savedGraph = visualGraphs['scripts/player.graph.json'];
    if (savedGraph && typeof savedGraph === 'object') visualGraph = structuredClone(savedGraph) as VisualGraph;
    const loaded = codec.deserialize(savedProject.scene); world = loaded.world; entities = new Map(loaded.entities); prefabs = [...(savedProject.prefabs ?? [])]; atlases = [...(savedProject.atlases ?? [])]; ensureSceneNames(world, entities); hierarchy = new SceneHierarchy(world, entities);
    selectedId = entities.keys().next().value ?? ''; selectedIds = selectedId ? [selectedId] : [];
  }
  renderSceneManager();
  element('project-name-current').textContent = projectName;
  element('script-speed-label').textContent = playerScriptDefinition.properties.speed!.label;
  element<HTMLInputElement>('script-speed').value = String(scriptProperties.speed);
  assets = await AssetDatabase.open(projectStore, () => `asset:${crypto.randomUUID()}`); editorTextureSource = createAssetTextureSource(assets);
  let defaultTexture = assets.listAssets().find(asset => asset.path === 'Textures/Default.png');
  if (!defaultTexture) defaultTexture = await assets.importAsset({ path: 'Textures/Default.png', data: base64ToBytes(png), mimeType: 'image/png' });
  defaultAssetId = defaultTexture.assetId;
  for (const object of objects) {
    const entity = entities.get(object.id); if (!entity) continue;
    const sprite = world.getComponent(entity, SpriteRenderer2D)!;
    if (sprite && !sprite.asset) world.setComponent(entity, SpriteRenderer2D, { ...sprite, asset: { assetId: defaultAssetId } });
  }
  syncLegacyObjects();
  renderHierarchy();
  if (!savedProject) await saveProjectNow(); else setProjectState('Saved');
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '2D scene viewport'); element('viewport').append(canvas);
  sceneCameraFrame = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sceneCameraFrame.classList.add('game-camera-frame'); sceneCameraFrame.setAttribute('aria-label', 'Game camera frame'); element('viewport').append(sceneCameraFrame);
  sceneTilemapGrid = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sceneTilemapGrid.classList.add('tilemap-grid-overlay'); sceneTilemapGrid.setAttribute('aria-hidden', 'true'); sceneTilemapGrid.style.display = 'none'; element('viewport').append(sceneTilemapGrid);
  sceneUiOverlay = createUiOverlay(element('viewport'), resolveUiImage, () => undefined, false, 'game-ui-overlay scene-ui-overlay');
  sceneSelectionOverlay = document.createElement('div'); sceneSelectionOverlay.className = 'scene-selection-marker'; sceneSelectionOverlay.innerHTML = '<span class="scene-selection-label"></span>'; sceneSelectionOverlay.hidden = true; element('viewport').append(sceneSelectionOverlay);
  sceneRenderer = new WebGLRenderer2D(canvas, editorTextureSource, { clearColor: '#20232c' }); sceneRenderer.setParallaxCamera(sharedPreviewCamera); sceneRenderer.setCamera(sceneCamera); applySceneCamera();
  const render = () => { renderScene(); frame = requestAnimationFrame(render); }; let frame = requestAnimationFrame(render);
  let dragBefore: EditorSnapshot | undefined;
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.shiftKey || event.ctrlKey) {
      const delta = event.deltaY || event.deltaX;
      if (event.shiftKey) sceneCamera.x += delta / sceneCamera.zoom;
      if (event.ctrlKey) sceneCamera.y += delta / sceneCamera.zoom;
      applySceneCamera(); return;
    }
    const rect = canvas.getBoundingClientRect();
    setSceneZoom(sceneCamera.zoom * Math.exp(-event.deltaY * 0.001), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 1) return;
    event.preventDefault(); event.stopImmediatePropagation(); canvas.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { sceneCamera.x -= moveEvent.movementX / sceneCamera.zoom; sceneCamera.y += moveEvent.movementY / sceneCamera.zoom; applySceneCamera(); };
    const end = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }, true);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect(); const scale = sceneCamera.zoom;
    const wx = (event.clientX - rect.left - rect.width / 2) / scale;
    const wy = -(event.clientY - rect.top - rect.height / 2) / scale + sceneCamera.y;
    const worldX = wx + sceneCamera.x;
    const pointerX = event.clientX - rect.left; const pointerY = event.clientY - rect.top;
    const uiZoom = sceneCamera.zoom / 45;
    const uiPointerX = rect.width / 2 + (pointerX - rect.width / 2 + sceneCamera.x * sceneCamera.zoom) / uiZoom;
    const uiPointerY = rect.height / 2 + (pointerY - rect.height / 2 - (sceneCamera.y - 2) * sceneCamera.zoom) / uiZoom;
    const uiViewport = { width: rect.width, height: rect.height, ...uiCanvasSettings(world, entities) };
    const uiHit = [...entities.keys()].reverse().find(id => {
      const entity = entities.get(id)!;
      const ui = world.getComponent(entity, UiText) ?? world.getComponent(entity, UiImage) ?? world.getComponent(entity, UiButton);
      if (!ui) return false;
      const bounds = layoutAnchoredRect(ui, uiViewport);
      return uiPointerX >= bounds.left && uiPointerX <= bounds.left + bounds.width && uiPointerY >= bounds.top && uiPointerY <= bounds.top + bounds.height;
    });
    // UI elements use anchored layout offsets rather than their world Transform2D.
    // Select them as usual, and let the Move tool drag those offsets in the Scene view.
    if (uiHit) {
      if (activeTool === 'tile' || activeTool === 'fill') setActiveTool('select');
      if (!selectedIds.includes(uiHit)) selectObject(uiHit, event.ctrlKey || event.metaKey);
      if (activeTool !== 'move' || playing) return;
      const uiEntity = entities.get(uiHit); if (!uiEntity) return;
      const ui = world.getComponent(uiEntity, UiText) ?? world.getComponent(uiEntity, UiImage) ?? world.getComponent(uiEntity, UiButton);
      if (!ui) return;
      const settings = uiCanvasSettings(world, entities);
      const sx = settings.scaleMode === 'stretch' ? rect.width / settings.referenceWidth : Math.min(rect.width / settings.referenceWidth, rect.height / settings.referenceHeight);
      const sy = settings.scaleMode === 'stretch' ? rect.height / settings.referenceHeight : sx;
      const initialX = event.clientX; const initialY = event.clientY; const initialUi = { ...ui };
      dragBefore = captureSnapshot(); canvas.setPointerCapture(event.pointerId);
      const moveUi = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - initialX) / (sx * uiZoom); const dy = (moveEvent.clientY - initialY) / (sy * uiZoom);
        const updated = { ...initialUi, offsetMinX: initialUi.offsetMinX + dx, offsetMaxX: initialUi.offsetMaxX + dx, offsetMinY: initialUi.offsetMinY + dy, offsetMaxY: initialUi.offsetMaxY + dy };
        if (world.hasComponent(uiEntity, UiText)) world.setComponent(uiEntity, UiText, updated as UiTextData);
        else if (world.hasComponent(uiEntity, UiImage)) world.setComponent(uiEntity, UiImage, updated as UiImageData);
        else world.setComponent(uiEntity, UiButton, updated as UiButtonData);
        renderScene();
      };
      const endUi = () => { canvas.removeEventListener('pointermove', moveUi); canvas.removeEventListener('pointerup', endUi); canvas.removeEventListener('pointercancel', endUi); if (dragBefore) recordEdit('Move UI Element', dragBefore); dragBefore = undefined; };
      canvas.addEventListener('pointermove', moveUi); canvas.addEventListener('pointerup', endUi); canvas.addEventListener('pointercancel', endUi);
      return;
    }
    if ((activeTool === 'tile' || activeTool === 'fill') && !playing) {
      // Background repeats must not intercept brush clicks in empty map cells.
      const sceneHit = hitTestScene(worldX, wy, true);
      if (sceneHit && sceneHit !== selectedId) { selectObject(sceneHit, event.ctrlKey || event.metaKey); return; }
      const mapEntity = entities.get(selectedId); if (!mapEntity || !world.hasComponent(mapEntity, Tilemap2D)) return;
      const data = world.getComponent(mapEntity, Tilemap2D)!; const transform = hierarchy.getGlobalTransform(selectedId); const determinant = transform.a * transform.d - transform.b * transform.c; if (Math.abs(determinant) < 1e-8) return;
      const dx = worldX - transform.tx; const dy = wy - transform.ty; const lx = (transform.d * dx - transform.c * dy) / determinant; const ly = (-transform.b * dx + transform.a * dy) / determinant;
      const tx = Math.floor(lx / data.tileSize + data.width / 2); const ty = Math.floor(data.height / 2 - ly / data.tileSize); const layerId = element<HTMLSelectElement>('tile-layer').value; const tileId = element<HTMLSelectElement>('tile-asset').value;
      const paint = () => { const current = world.getComponent(mapEntity, Tilemap2D)!; let updated = current;
        if (activeTool === 'fill') updated = fillTile(current, layerId, tx, ty, tileId || null);
        else if (tileId) updated = paintTile(current, layerId, tx, ty, tileId);
        else updated = paintTile(current, layerId, tx, ty, null);
        world.setComponent(mapEntity, Tilemap2D, updated); renderScene();
      };
      dragBefore = captureSnapshot(); paint(); canvas.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => { if (activeTool !== 'tile') return; const r = canvas.getBoundingClientRect(); const x = (moveEvent.clientX - r.left - r.width / 2) / scale + sceneCamera.x; const y = -(moveEvent.clientY - r.top - r.height / 2) / scale + sceneCamera.y; const px = x - transform.tx; const py = y - transform.ty; const cx = Math.floor(((transform.d * px - transform.c * py) / determinant) / data.tileSize + data.width / 2); const cy = Math.floor(data.height / 2 - ((-transform.b * px + transform.a * py) / determinant) / data.tileSize); const now = world.getComponent(mapEntity, Tilemap2D)!; const next = tileId ? paintTile(now, layerId, cx, cy, tileId) : paintTile(now, layerId, cx, cy, null); world.setComponent(mapEntity, Tilemap2D, next); renderScene(); };
      const end = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end); if (dragBefore) recordEdit(activeTool === 'fill' ? 'Fill Tiles' : 'Paint Tiles', dragBefore); dragBefore = undefined; };
      canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); return;
    }
    const hit = uiHit ?? hitTestScene(worldX, wy);
    if (!hit) { if (!event.ctrlKey && !event.metaKey) { selectedIds = []; selectedId = ''; refreshEditor(); } return; }
    if (activeTool === 'select') { selectObject(hit, event.ctrlKey || event.metaKey); return; }
    if (!selectedIds.includes(hit)) selectObject(hit, event.ctrlKey || event.metaKey);
    if (playing) return;
    dragBefore = captureSnapshot(); const draggingIds = [...selectedIds]; const initialTransforms = new Map(draggingIds.map(id => [id, hierarchy.getLocalTransform(id)])); let totalX = 0; let totalY = 0;
    canvas.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      totalX += moveEvent.movementX; totalY += moveEvent.movementY;
      const dxWorld = totalX / scale; const dyWorld = -totalY / scale;
      for (const id of draggingIds) {
        const entity = entities.get(id); if (!entity) continue;
        const transform = initialTransforms.get(id)!;
        if (activeTool === 'move') {
          let dx = dxWorld; let dy = dyWorld;
          // Free dragging follows the viewport/world delta. Local/Global only changes
          // gizmo-axis interpretation once constrained axis handles exist; rotating
          // the unconstrained pointer delta made a rotated object drift away from it.
          const parent = hierarchy.getParent(id); if (parent) { const p = hierarchy.getGlobalTransform(parent); const determinant = p.a * p.d - p.b * p.c; if (Math.abs(determinant) > 1e-8) [dx, dy] = [(p.d * dx - p.c * dy) / determinant, (-p.b * dx + p.a * dy) / determinant]; }
          const snap = element<HTMLInputElement>('snap-toggle').checked ? 0.5 : 0; const x = transform.x + dx; const y = transform.y + dy;
          world.setComponent(entity, Transform2D, { ...transform, x: snap ? Math.round(x / snap) * snap : x, y: snap ? Math.round(y / snap) * snap : y });
        } else if (activeTool === 'rotate') {
          let rotation = transform.rotation + totalX * 0.01; if (element<HTMLInputElement>('snap-toggle').checked) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
          world.setComponent(entity, Transform2D, { ...transform, rotation });
        } else if (activeTool === 'scale') {
          let factor = Math.exp(-totalY * 0.01); let scaleX = transform.scaleX * factor; let scaleY = transform.scaleY * factor;
          if (element<HTMLInputElement>('snap-toggle').checked) { scaleX = Math.round(scaleX * 4) / 4; scaleY = Math.round(scaleY * 4) / 4; }
          world.setComponent(entity, Transform2D, { ...transform, scaleX: Math.max(0.05, scaleX), scaleY: Math.max(0.05, scaleY) });
        }
      }
      syncLegacyObjects(); renderScene();
    };
    const end = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end); if (dragBefore) recordEdit(activeTool === 'move' ? 'Move' : activeTool === 'rotate' ? 'Rotate' : 'Scale', dragBefore); dragBefore = undefined; };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  });
  gameScene = await createScene(element('game-view'), objects, selectObject, loadEditorTexture, sharedPreviewCamera); setupUiPreview(gameScene); gamePreviewSignature = JSON.stringify(objects);
  element('game-view').addEventListener('playsimulationerror', event => {
    scriptAbort?.abort(); audioMixer?.stopAll(); const error = (event as CustomEvent<unknown>).detail; playing = false; paused = false; playDebugWorld = undefined; playDebugEntities = undefined; showPlayEntity(); controls(); log(`Play mode stopped after a simulation error: ${String(error)}`, true); revealScriptError(String(error));
  });
  element<HTMLButtonElement>('play').disabled = false; element('mode').textContent = 'Editing';
  renderAssets(); renderInspector(); renderScene(); log('Scene, schemas, asset pipeline and WebGL viewport are connected.');
  activeGraphPath = graphPathFor(selectedId); visualGraph = graphForPath(activeGraphPath);
  graphEditor = createVisualGraphEditor(element('graph-editor'), visualGraph, graph => { visualGraph = graph; visualGraphs = { ...visualGraphs, [activeGraphPath]: graph }; scheduleSave(); });
  element<HTMLButtonElement>('graph-run').onclick = () => {
    try {
      const owner = entities.get(selectedId); if (!owner) throw new Error('Select a scene object to preview this graph.');
      const components: Record<string, ScriptJson> = {};
      for (const schema of schemas.all()) if (world.hasComponent(owner, schema.component)) components[schema.typeId] = world.getComponent(owner, schema.component) as ScriptJson;
      const entityComponents: Record<string, Record<string, ScriptJson>> = {};
      for (const [id, candidate] of entities) if (id !== selectedId) { const values: Record<string, ScriptJson> = {}; for (const schema of schemas.all()) if (world.hasComponent(candidate, schema.component)) values[schema.typeId] = world.getComponent(candidate, schema.component) as ScriptJson; entityComponents[id] = values; }
      const api = createScriptApi({ entityId: selectedId, phase: 'update', deltaTime: 1 / 60, components, entityComponents, availableComponentTypeIds: schemas.all().map(schema => schema.typeId) });
      const result = evaluateVisualGraph(graphEditor!.getGraph(), { api });
      log(`Visual graph preview: ${JSON.stringify({ variables: result.variables, commands: result.output.componentCommands.length, events: result.output.emittedEvents.length })}`);
    }
    catch (error) { log(`Visual graph failed: ${String(error)}`, true); }
  };
  window.addEventListener('pagehide', () => { clearInterval(debugRefreshTimer); cancelAnimationFrame(frame); sceneRenderer?.dispose(); sceneUiOverlay?.dispose(); gameScene?.dispose(); code?.dispose(); graphEditor?.dispose(); audioMixer?.dispose(); }, { once: true });
}

function captureProjectScenes(): ProjectScenes {
  const document = JSON.parse(codec.stringify(world, entities, activeSceneId)) as unknown;
  if (!projectScenes.length) projectScenes = [{ id: activeSceneId, name: 'Main scene', document }];
  projectScenes = projectScenes.map(scene => scene.id === activeSceneId ? { ...scene, document } : scene);
  return validateProjectScenes({ scenes: projectScenes, activeSceneId, startSceneId }, document);
}
function renderSceneManager() {
  if (!projectScenes.length) captureProjectScenes();
  const options = () => projectScenes.map(scene => { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.name; return option; });
  element<HTMLSelectElement>('scene-select').replaceChildren(...options()); element<HTMLSelectElement>('scene-select').value = activeSceneId;
  element<HTMLSelectElement>('start-scene').replaceChildren(...options()); element<HTMLSelectElement>('start-scene').value = startSceneId;
  const name = projectScenes.find(scene => scene.id === activeSceneId)!.name;
  element('active-scene-id').textContent = activeSceneId;
  element('active-scene-name').textContent = `/ ${name}`; element('hierarchy-scene-name').textContent = name;
  element<HTMLButtonElement>('scene-delete').disabled = playing || projectScenes.length === 1;
}
function switchEditorScene(id: string) {
  finishInspectorEdit(false);
  if (playing || id === activeSceneId) return;
  captureProjectScenes();
  const target = projectScenes.find(scene => scene.id === id); if (!target) return;
  const loaded = codec.deserialize(target.document);
  world = loaded.world; entities = new Map(loaded.entities); activeSceneId = id;
  ensureSceneNames(world, entities); hierarchy = new SceneHierarchy(world, entities);
  selectedId = entities.keys().next().value ?? ''; selectedIds = selectedId ? [selectedId] : []; selectedParallaxCopy = undefined;
  editHistory.clear(); renderSceneManager(); refreshEditor(); scheduleSave();
}
element<HTMLSelectElement>('scene-select').onchange = event => switchEditorScene((event.currentTarget as HTMLSelectElement).value);
element<HTMLSelectElement>('start-scene').onchange = event => { if (playing) return; startSceneId = (event.currentTarget as HTMLSelectElement).value; scheduleSave(); };
element('scene-new').onclick = () => {
  if (playing) return;
  const name = window.prompt('Scene name', 'New scene')?.trim(); if (!name) return;
  captureProjectScenes(); const id = `scene:${crypto.randomUUID()}`;
  projectScenes.push({ id, name, document: { format: 'ecs-scene', version: 1, sceneId: id, entities: [] } }); switchEditorScene(id);
};
element('scene-rename').onclick = () => {
  if (playing) return;
  const current = projectScenes.find(scene => scene.id === activeSceneId)!;
  const name = window.prompt('Scene name', current.name)?.trim(); if (!name) return;
  projectScenes = projectScenes.map(scene => scene.id === activeSceneId ? { ...scene, name } : scene); renderSceneManager(); scheduleSave();
};
element('scene-duplicate').onclick = () => {
  if (playing) return;
  const current = captureProjectScenes().scenes.find(scene => scene.id === activeSceneId)!;
  const name = window.prompt('Scene name', `${current.name} Copy`)?.trim(); if (!name) return;
  const id = `scene:${crypto.randomUUID()}`; const document = { ...(structuredClone(current.document) as object), sceneId: id };
  projectScenes.push({ id, name, document }); switchEditorScene(id);
};
element('scene-delete').onclick = () => {
  if (playing || projectScenes.length < 2) return;
  const removed = activeSceneId; const target = projectScenes.find(scene => scene.id !== removed)!;
  switchEditorScene(target.id); projectScenes = projectScenes.filter(scene => scene.id !== removed);
  if (startSceneId === removed) startSceneId = target.id; renderSceneManager(); scheduleSave();
};
function setProjectState(state: string) { element('project-state').textContent = state; }
async function saveProjectNow() {
  if (!projectStore) return;
  if (saveTimer !== undefined) { window.clearTimeout(saveTimer); saveTimer = undefined; }
  setProjectState('Saving…');
  try { await projectStore.saveProject(projectName, JSON.parse(codec.stringify(world, entities, activeSceneId)) as unknown, scriptFiles, scriptProperties, visualGraphs, prefabs, atlases, inputActions, gameViewSettings, captureProjectScenes()); setProjectState('Saved'); }
  catch (error) { setProjectState('Save failed'); log(`Local save failed: ${String(error)}. Use Export to download a project file.`, true); }
}
function scheduleSave() {
  if (!projectStore) return;
  setProjectState('Unsaved changes');
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void saveProjectNow(); }, 250);
}
function downloadFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadBytes(name: string, contents: Uint8Array, type: string) {
  const bytes = contents.slice().buffer as ArrayBuffer; const url = URL.createObjectURL(new Blob([bytes], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element('project-save').onclick = () => { void saveProjectNow(); };
element('project-settings').onclick = () => { renderSceneManager(); renderGameViewEditor(element('game-view-settings'), gameViewSettings, settings => { gameViewSettings = settings; gameScene?.setGameView(settings); renderScene(); scheduleSave(); }, createCameraObject, playing); renderInputActionsEditor(element('input-actions-editor'), inputActions, actions => { inputActions = actions; code?.setInputActions(actions); scheduleSave(); }); element<HTMLDialogElement>('project-settings-dialog').showModal(); };
element<HTMLInputElement>('script-speed').oninput = element<HTMLInputElement>('script-speed').onchange = event => {
  const speed = Number((event.currentTarget as HTMLInputElement).value); const entity = entities.get(selectedId);
  scriptProperties.speed = speed;
  if (entity && world.hasComponent(entity, ScriptBinding)) { const binding = world.getComponent(entity, ScriptBinding)!; if (binding.speed !== speed) world.setComponent(entity, ScriptBinding, { ...binding, speed }); }
  scheduleSave();
};
element('project-export').onclick = async () => {
  try {
    if (!assets || !projectStore) throw new Error('Project storage is not ready.');
    const records = assets.listAssets(); const contents = encodeProjectArchive(projectName, JSON.parse(codec.stringify(world, entities, activeSceneId)) as unknown, await projectStore.readAllAssets(records), scriptFiles, scriptProperties, visualGraphs, prefabs, atlases, inputActions, gameViewSettings, captureProjectScenes());
    downloadFile(`${projectName.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'project'}.ecsproj`, contents, 'application/json');
    log('Project archive downloaded.');
  } catch (error) { log(`Project export failed: ${String(error)}`, true); }
};
element<HTMLButtonElement>('web-game-export').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  try {
    if (!assets || !projectStore) throw new Error('Project assets are not ready.');
    const sceneCollection = captureProjectScenes();
    const scene = sceneCollection.scenes.find(item => item.id === startSceneId)!.document;
    const documents = sceneCollection.scenes.map(item => codec.deserialize(item.document));
    const supported = new Set(['engine.name', 'engine.transform2d', 'engine.parent', 'engine.spriteRenderer2d', 'engine.parallax2d', 'engine.camera2d', 'engine.physics2d', 'engine.collider2d', 'engine.tilemap2d', 'engine.spriteAnimation2d', 'engine.scriptBinding', 'engine.audioSource2d', 'engine.uiCanvas', 'engine.uiText', 'engine.uiImage', 'engine.uiButton', 'engine.prefab-instance']);
    const unsupported = [...new Set(sceneCollection.scenes.flatMap(item => (item.document as import('@ecs/scene').SceneDocument).entities.flatMap(entity => entity.components.map(component => component.typeId).filter(typeId => !supported.has(typeId)))))];
    if (unsupported.length) throw new Error(`Web export does not support runtime plugins yet: ${unsupported.join(', ')}.`);
    const bindings = documents.flatMap(loaded => [...loaded.entities.values()].flatMap(entity => loaded.world.hasComponent(entity, ScriptBinding) ? [loaded.world.getComponent(entity, ScriptBinding)!] : [])).filter(binding => binding.enabled && binding.codePath.trim());
    const compiledScripts: Record<string, string> = {};
    for (const binding of bindings) if (!compiledScripts[binding.codePath]) compiledScripts[binding.codePath] = await compilePlayerScript(binding.codePath);
    const records = assets.listAssets(); const loadedAssets = await projectStore.readAllAssets(records);
    const dataById = new Map(loadedAssets.map(asset => [asset.assetId, asset.data]));
    const exportedAssets = records.map(record => {
      const bytes = dataById.get(record.assetId); if (!bytes) throw new Error(`Asset "${record.path}" could not be read for export.`);
      return { ...record, url: `data:${record.mimeType};base64,${bytesToBase64(bytes)}` };
    });
    const runtimePath = `${import.meta.env.BASE_URL}export-runtime.js`;
    const runtimeResponse = await fetch(runtimePath); if (!runtimeResponse.ok) throw new Error(`Could not load standalone game runtime (${runtimeResponse.status}). Run the development/build command first.`);
    const runtime = new Uint8Array(await runtimeResponse.arrayBuffer());
    const exportName = projectName.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'game';
    const gameData = JSON.stringify({ format: 'ecs-web-game', version: 1, projectName, scene, sceneCollection, gameView: gameViewSettings, scripts: compiledScripts, visualGraphs, atlases, inputActions, assets: exportedAssets }).replace(/</g, '\\u003c');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta name="theme-color" content="#17191f"><title>${exportName}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#17191f;color:#e2e4ec;font:14px system-ui,sans-serif}#game{position:absolute;inset:0}#game canvas{display:block;width:100%;height:100%;touch-action:none}.game-ui-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2}.game-ui-overlay button{touch-action:manipulation}#controls{position:absolute;z-index:4;right:12px;top:12px;display:flex;gap:6px}#controls button{padding:7px 12px;color:#eee;background:#292c36;border:1px solid #454957;border-radius:5px}#error{position:absolute;z-index:5;left:12px;bottom:12px;max-width:min(700px,90vw);padding:10px 12px;white-space:pre-wrap;color:#ffd2cb;background:#431f27;border:1px solid #a64c55;border-radius:4px}</style></head><body><script id="game-data" type="application/json">${gameData}</script><main id="game" aria-label="${exportName}"></main><nav id="controls" aria-label="Game controls"><button id="play">Play</button><button id="pause">Pause</button><button id="resume">Resume</button><button id="stop">Stop</button></nav><div id="error" role="alert" hidden></div><script src="./game.js"></script></body></html>`;
    const files: Record<string, Uint8Array> = {
      'index.html': strToU8(html), 'game.js': runtime,
      'README.txt': strToU8('Self-contained web game export. Open index.html directly or upload index.html and game.js to static hosting. Scene, scripts, atlases and assets are embedded in index.html. Web export currently does not include runtime plugins.'),
    };
    downloadBytes(`${exportName}-web.zip`, zipSync(files, { level: 6 }), 'application/zip');
    log(`Standalone web game exported with ${records.length} asset${records.length === 1 ? '' : 's'}. Upload the ZIP contents to static hosting.`);
  } catch (error) { log(`Web game export failed: ${String(error)}`, true); }
  finally { button.disabled = false; }
};
element('project-new').onclick = () => {
  const nextId = `project:${crypto.randomUUID()}`; const nextName = window.prompt('Project name', 'Untitled Project')?.trim();
  if (nextName === undefined) return;
  projectId = nextId; projectName = nextName || 'Untitled Project'; localStorage.setItem('ecs-studio-active-project', projectId); localStorage.setItem(`ecs-studio-project-name:${projectId}`, projectName); window.location.reload();
};
async function importProjectArchive(archive: ReturnType<typeof decodeProjectArchive>) {
  const validateCompatibleScene = (scene: unknown, label: string) => {
    try { return codec.deserialize(scene); }
    catch (error) {
      const message = String(error);
      const unknownComponent = message.match(/Unknown component type \"([^\"]+)\"/);
      if (unknownComponent) throw new Error(`${label} requires component "${unknownComponent[1]}" from a plugin or engine version that is not loaded. Load the compatible plugin, then import the project again. Your current project was not changed.`);
      throw new Error(`${label} could not be loaded: ${message}. Your current project was not changed.`);
    }
  };
  for (const entry of archive.sceneCollection.scenes) validateCompatibleScene(entry.document, `Scene "${entry.name}"`);
  const loadedArchiveScene = validateCompatibleScene(archive.scene, 'Project scene');
  for (const prefab of archive.prefabs) validateCompatibleScene(prefab.scene, `Prefab "${prefab.name}"`);
  ensureSceneNames(loadedArchiveScene.world, loadedArchiveScene.entities);
  const sceneDocument = JSON.parse(codec.stringify(loadedArchiveScene.world, loadedArchiveScene.entities, archive.sceneCollection.activeSceneId)) as unknown;
  const nextId = `project:${crypto.randomUUID()}`; const store = await IndexedDbProjectStore.open(nextId);
  const records = archive.assets.map(({ data, ...record }) => record);
  for (const asset of archive.assets) await store.writeAsset(asset.assetId, base64ToBytes(asset.data));
  await store.writeManifest(JSON.stringify({ format: ASSET_MANIFEST_FORMAT, version: ASSET_MANIFEST_VERSION, assets: records }));
  await AssetDatabase.open(store);
  scriptFiles = { ...archive.scripts };
  scriptProperties = { ...archive.scriptProperties };
  visualGraphs = { ...archive.visualGraphs };
  inputActions = archive.inputActions;
  gameViewSettings = archive.gameView;
  projectScenes = [...archive.sceneCollection.scenes]; activeSceneId = archive.sceneCollection.activeSceneId; startSceneId = archive.sceneCollection.startSceneId;
  prefabs = [...archive.prefabs];
  atlases = [...archive.atlases];
  await store.saveProject(archive.projectName, sceneDocument, scriptFiles, scriptProperties, visualGraphs, prefabs, atlases, inputActions, gameViewSettings, archive.sceneCollection);
  store.close(); localStorage.setItem('ecs-studio-active-project', nextId); localStorage.setItem(`ecs-studio-project-name:${nextId}`, archive.projectName); window.location.reload();
}
element<HTMLInputElement>('project-import').onchange = async event => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
  try { await importProjectArchive(decodeProjectArchive(await file.text())); }
  catch (error) { log(`Project import failed: ${String(error)}`, true); }
};
element<HTMLButtonElement>('project-showcase').onclick = async () => {
  try {
    const response = await fetch('./showcase.ecsproj'); if (!response.ok) throw new Error(`Could not load the showcase (${response.status}).`);
    await importProjectArchive(decodeProjectArchive(await response.text()));
  } catch (error) { log(`Showcase could not be opened: ${String(error)}`, true); }
};
element<HTMLButtonElement>('project-pong').onclick = async () => {
  try {
    const response = await fetch('./pong.ecsproj'); if (!response.ok) throw new Error(`Could not load Pong (${response.status}).`);
    await importProjectArchive(decodeProjectArchive(await response.text()));
  } catch (error) { log(`Pong project could not be opened: ${String(error)}`, true); }
};
element<HTMLButtonElement>('example-plugin-toggle').onclick = () => {
  const button = element<HTMLButtonElement>('example-plugin-toggle');
  try {
    if (pluginManager.list().some(plugin => plugin.id === sampleEditorPlugin.manifest.id)) {
      pluginManager.unload(sampleEditorPlugin.manifest.id); button.textContent = 'Load Example Plugin'; refreshEditor();
      log('Unloaded Hello Plugin.');
    } else {
      pluginManager.load(sampleEditorPlugin); button.textContent = 'Unload Example Plugin'; refreshEditor();
      log('Loaded Hello Plugin: component, script definition, asset importer, and editor panel registered.');
    }
  } catch (error) { log(`Plugin operation failed: ${String(error)}`, true); }
};
const topbarMenus = [...document.querySelectorAll<HTMLDetailsElement>('details.topbar-menu')];
for (const menu of topbarMenus) menu.addEventListener('toggle', () => {
  if (menu.open) for (const other of topbarMenus) if (other !== menu) other.open = false;
});
document.addEventListener('click', event => {
  if (!(event.target as HTMLElement).closest('.project-actions')) for (const menu of topbarMenus) menu.open = false;
  const action = (event.target as HTMLElement).closest('.topbar-menu-content > button, .topbar-menu-content > a');
  const menu = action?.closest<HTMLDetailsElement>('details.topbar-menu');
  if (menu) menu.open = false;
});

function unlockAudioFromGesture(): Promise<void> | undefined {
  try {
    if (!audioMixer) {
      audioMixer = new WebAudioMixer();
      audioMixer.setMasterVolume(audioVolumes.master); audioMixer.setGroupVolume('music', audioVolumes.music); audioMixer.setGroupVolume('effects', audioVolumes.effects);
    }
    return audioMixer.unlock().then(() => { element('audio-status').textContent = 'Audio ready'; }).catch(error => { element('audio-status').textContent = 'Audio needs a user gesture'; log(`Audio could not start: ${String(error)}`, true); });
  } catch (error) { element('audio-status').textContent = 'Web Audio is unavailable'; log(`Audio is unavailable in this browser: ${String(error)}`, true); return undefined; }
}
async function previewAudioAsset(assetId: string) {
  const unlocked = unlockAudioFromGesture();
  if (!unlocked || !assets || !audioMixer) return;
  try {
    const resolved = await assets.resolveAsset(assetId); await unlocked;
    if (resolved.status !== 'available' || resolved.record.kind !== 'audio') throw new Error('Audio asset is missing or has the wrong type.');
    await audioMixer.play(assetId, resolved.data, { ownerId: 'editor:asset-preview', group: 'effects', volume: 1, loop: false });
  } catch (error) { log(`Audio preview failed: ${String(error)}`, true); }
}
type SpriteSourceChoice = { assetId: string; region?: SpriteRegionReference; label: string };
function spriteSourceChoices(): SpriteSourceChoice[] {
  const choices: SpriteSourceChoice[] = [];
  for (const asset of assets?.listAssets().filter(item => item.kind === 'image') ?? []) choices.push({ assetId: asset.assetId, label: asset.path });
  for (const atlas of atlases) for (const region of atlas.regions) choices.push({ assetId: atlas.assetId, region: { atlasId: atlas.id, regionId: region.id }, label: `${atlas.name} / ${region.name}` });
  return choices;
}
function spriteSourceValue(choice: Pick<SpriteSourceChoice, 'assetId' | 'region'>): string { return JSON.stringify({ assetId: choice.assetId, ...(choice.region ? { region: choice.region } : {}) }); }
function parseSpriteSourceValue(value: string): Pick<SpriteSourceChoice, 'assetId' | 'region'> | undefined {
  try { const parsed = JSON.parse(value) as { assetId?: unknown; region?: unknown }; if (typeof parsed.assetId !== 'string') return undefined; return { assetId: parsed.assetId, ...(parsed.region && typeof parsed.region === 'object' && typeof (parsed.region as SpriteRegionReference).atlasId === 'string' && typeof (parsed.region as SpriteRegionReference).regionId === 'string' ? { region: parsed.region as SpriteRegionReference } : {}) }; } catch { return undefined; }
}
function fillSpriteSourceSelect(select: HTMLSelectElement, selectedValue = select.value) {
  select.replaceChildren();
  for (const choice of spriteSourceChoices()) { const option = document.createElement('option'); option.value = spriteSourceValue(choice); option.textContent = choice.label; select.append(option); }
  if ([...select.options].some(option => option.value === selectedValue)) select.value = selectedValue;
}
const regionPreviewCache = new Map<string, string>();
async function spriteSourcePreviewUrl(choice: Pick<SpriteSourceChoice, 'assetId' | 'region'>, size = 64): Promise<string | undefined> {
  if (!choice.region) return resolveUiImage(choice.assetId);
  const cacheKey = `${choice.region.atlasId}:${choice.region.regionId}:${size}`; const cached = regionPreviewCache.get(cacheKey); if (cached) return cached;
  const atlas = atlases.find(item => item.id === choice.region!.atlasId); const region = atlas?.regions.find(item => item.id === choice.region!.regionId); const url = await resolveUiImage(choice.assetId); if (!atlas || !region || !url) return undefined;
  const image = new Image(); image.src = url; try { await image.decode(); } catch { return undefined; }
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const ctx = canvas.getContext('2d'); if (!ctx) return undefined;
  const scale = Math.min(size / region.width, size / region.height); const width = region.width * scale; const height = region.height * scale;
  ctx.drawImage(image, region.x, region.y, region.width, region.height, (size - width) / 2, (size - height) / 2, width, height);
  const result = canvas.toDataURL(); regionPreviewCache.set(cacheKey, result); return result;
}
async function openSpriteAtlas(assetId: string, existing = atlases.find(item => item.assetId === assetId)) {
  const resolved = await assets?.resolveAsset(assetId); if (resolved?.status !== 'available' || resolved.record.kind !== 'image') { log('The atlas source image is missing.', true); return; }
  const url = await resolveUiImage(assetId); if (!url) { log('Could not load the atlas source image.', true); return; }
  const image = new Image(); image.src = url;
  try { await image.decode(); } catch { log('Could not decode the atlas source image.', true); return; }
  atlasImage = image; atlasDragStart = undefined; atlasDragEnd = undefined; selectedAtlasRegionId = ''; element<HTMLButtonElement>('atlas-add-region').dataset.selection = '';
  atlasDraft = existing ? { ...structuredClone(existing), width: image.naturalWidth, height: image.naturalHeight, regions: existing.regions.flatMap(region => { const x = Math.min(region.x, image.naturalWidth - 1); const y = Math.min(region.y, image.naturalHeight - 1); const width = Math.min(region.width, image.naturalWidth - x); const height = Math.min(region.height, image.naturalHeight - y); return width > 0 && height > 0 ? [{ ...region, x, y, width, height }] : []; }) } : { id: `atlas:${crypto.randomUUID()}`, name: resolved.record.name.replace(/\.[^.]+$/, ''), assetId, width: image.naturalWidth, height: image.naturalHeight, regions: [] };
  element<HTMLInputElement>('atlas-name').value = atlasDraft.name; element('atlas-dialog-title').textContent = `${existing ? 'Edit' : 'Create'} Sprite Atlas · ${resolved.record.name}`;
  const canvas = element<HTMLCanvasElement>('atlas-canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.style.width = ''; canvas.style.height = '';
  renderAtlasDraft(); element<HTMLDialogElement>('sprite-atlas-dialog').showModal();
  requestAnimationFrame(fitAtlasCanvas);
}
function setAtlasZoom(nextZoom: number, anchor?: { x: number; y: number }) {
  if (!atlasImage) return;
  const wrap = element<HTMLDivElement>('atlas-canvas-wrap'); const canvas = element<HTMLCanvasElement>('atlas-canvas');
  const before = canvas.getBoundingClientRect(); const wrapRect = wrap.getBoundingClientRect();
  const clientX = anchor?.x ?? wrapRect.left + wrap.clientWidth / 2; const clientY = anchor?.y ?? wrapRect.top + wrap.clientHeight / 2;
  const localX = clientX - wrapRect.left; const localY = clientY - wrapRect.top;
  const imageX = (clientX - before.left) / atlasZoom; const imageY = (clientY - before.top) / atlasZoom;
  const originX = before.left - wrapRect.left + wrap.scrollLeft; const originY = before.top - wrapRect.top + wrap.scrollTop;
  atlasZoom = Math.max(0.1, Math.min(8, nextZoom));
  canvas.style.width = `${atlasImage.naturalWidth * atlasZoom}px`; canvas.style.height = `${atlasImage.naturalHeight * atlasZoom}px`;
  element<HTMLOutputElement>('atlas-zoom-value').value = `${Math.round(atlasZoom * 100)}%`;
  if (anchor) {
    wrap.scrollLeft = imageX * atlasZoom + originX - localX;
    wrap.scrollTop = imageY * atlasZoom + originY - localY;
  }
}
function fitAtlasCanvas() {
  if (!atlasImage) return;
  const wrap = element<HTMLDivElement>('atlas-canvas-wrap');
  const scale = Math.min(1, wrap.clientWidth / atlasImage.naturalWidth, wrap.clientHeight / atlasImage.naturalHeight);
  setAtlasZoom(Math.max(0.1, scale)); wrap.scrollLeft = 0; wrap.scrollTop = 0;
}
function renderAtlasDraft() {
  if (!atlasDraft || !atlasImage) return;
  const canvas = element<HTMLCanvasElement>('atlas-canvas'); const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(atlasImage, 0, 0);
  for (const [index, region] of atlasDraft.regions.entries()) {
    const selected = region.id === selectedAtlasRegionId; ctx.strokeStyle = selected ? '#61d9b2' : '#bcaaff'; ctx.lineWidth = Math.max(1, canvas.width / 900); ctx.strokeRect(region.x + .5, region.y + .5, region.width - 1, region.height - 1);
    const label = selected ? region.name : String(index + 1); ctx.font = `${Math.max(10, canvas.width / 120)}px sans-serif`; const labelWidth = ctx.measureText(label).width + 8; const labelHeight = Math.max(14, canvas.width / 90);
    ctx.fillStyle = selected ? '#256d58' : '#343047'; ctx.fillRect(region.x + 1, region.y + 1, Math.min(labelWidth, region.width - 2), labelHeight);
    ctx.fillStyle = '#f2efff'; ctx.fillText(label, region.x + 4, region.y + labelHeight - 3, Math.max(1, region.width - 8));
  }
  if (atlasDragStart && atlasDragEnd) { ctx.strokeStyle = '#61d9b2'; ctx.lineWidth = Math.max(1, canvas.width / 700); ctx.strokeRect(Math.min(atlasDragStart.x, atlasDragEnd.x), Math.min(atlasDragStart.y, atlasDragEnd.y), Math.abs(atlasDragEnd.x - atlasDragStart.x), Math.abs(atlasDragEnd.y - atlasDragStart.y)); }
  const list = element('atlas-region-list'); list.replaceChildren();
  for (const region of atlasDraft.regions) {
    const row = document.createElement('div'); row.className = 'atlas-region-row'; row.classList.toggle('selected', region.id === selectedAtlasRegionId); row.onclick = event => { if ((event.target as HTMLElement).closest('input, button')) return; selectedAtlasRegionId = region.id; renderAtlasDraft(); }; const name = document.createElement('input'); name.value = region.name; name.setAttribute('aria-label', `${region.name} region name`); name.onchange = () => { atlasDraft = { ...atlasDraft!, regions: atlasDraft!.regions.map(item => item.id === region.id ? { ...item, name: name.value.trim() || item.name } : item) }; renderAtlasDraft(); };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.onclick = () => { atlasDraft = { ...atlasDraft!, regions: atlasDraft!.regions.filter(item => item.id !== region.id) }; renderAtlasDraft(); };
    const editCoordinate = (field: 'x' | 'y' | 'width' | 'height', label: string) => { const input = document.createElement('input'); input.type = 'number'; input.min = field === 'width' || field === 'height' ? '1' : '0'; input.value = String(region[field]); input.title = label; input.setAttribute('aria-label', `${region.name} ${label}`); input.onchange = () => { const nextValue = Math.floor(Number(input.value)); const updated = { ...region, [field]: nextValue }; const valid = Number.isInteger(nextValue) && nextValue >= 0 && updated.width > 0 && updated.height > 0 && updated.x + updated.width <= atlasDraft!.width && updated.y + updated.height <= atlasDraft!.height; if (!valid) { log('Atlas region coordinates must stay inside the source image.', true); renderAtlasDraft(); return; } atlasDraft = { ...atlasDraft!, regions: atlasDraft!.regions.map(item => item.id === region.id ? updated : item) }; renderAtlasDraft(); }; return input; };
    const bounds = document.createElement('small'); bounds.textContent = 'px'; row.append(name, remove, editCoordinate('x', 'X'), editCoordinate('y', 'Y'), editCoordinate('width', 'Width'), editCoordinate('height', 'Height'), bounds); list.append(row);
  }
  element('atlas-image-size').textContent = `${atlasDraft.width} × ${atlasDraft.height} px · ${atlasDraft.regions.length} regions`;
}
function atlasCanvasPoint(event: PointerEvent) {
  const canvas = element<HTMLCanvasElement>('atlas-canvas'); const bounds = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - bounds.left) * canvas.width / bounds.width))), y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - bounds.top) * canvas.height / bounds.height))) };
}
function assetUsage(assetId: string): string | undefined {
  for (const atlas of atlases) if (atlas.assetId === assetId) return `Sprite Atlas: ${atlas.name}`;
  const schemasById = new Map(schemas.all().map(schema => [schema.typeId, schema]));
  const findInComponents = (components: readonly { typeId: string; data: unknown }[], owner: string): string | undefined => {
    for (const component of components) {
      const schema = schemasById.get(component.typeId);
      const data = component.data && typeof component.data === 'object' ? component.data as Record<string, unknown> : {};
      for (const [fieldName, field] of Object.entries(schema?.fields ?? {})) {
        const reference = data[fieldName];
        if (field.type === 'asset' && reference && typeof reference === 'object' && (reference as { assetId?: unknown }).assetId === assetId) return `${owner} · ${schema!.displayName}`;
      }
      if (component.typeId === tilemap2DSchema.typeId) {
        try { if (parseTilemap(data as unknown as Parameters<typeof parseTilemap>[0]).tiles.some(tile => tile.asset.assetId === assetId)) return `${owner} · Tilemap tiles`; } catch { /* Ignore malformed editor data. */ }
      }
      if (component.typeId === spriteAnimation2DSchema.typeId) {
        try { if (parseAnimationClips(String(data.clipsJson ?? '[]')).some(clip => clip.frames.some(frame => frame.assetId === assetId))) return `${owner} · Animation frames`; } catch { /* Ignore malformed editor data. */ }
      }
    }
    return undefined;
  };
  const scene = codec.serialize(world, entities, activeSceneId);
  for (const entity of scene.entities) {
    const use = findInComponents(entity.components, world.getComponent(entities.get(entity.id)!, Name)?.value ?? entity.id);
    if (use) return use;
  }
  for (const entry of projectScenes) {
    if (entry.id === activeSceneId) continue;
    for (const entity of (entry.document as import('@ecs/scene').SceneDocument).entities) {
      const use = findInComponents(entity.components, `Scene ${entry.name}`); if (use) return use;
    }
  }
  for (const prefab of prefabs) {
    const prefabScene = prefab.scene as { entities?: { id: string; components: { typeId: string; data: unknown }[] }[] };
    for (const entity of prefabScene.entities ?? []) {
      const use = findInComponents(entity.components, `Prefab ${prefab.name}`);
      if (use) return use;
    }
  }
  return undefined;
}

function refreshAssetUsageIndicators() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.asset-remove')) {
    const usage = assetUsage(button.dataset.assetId ?? '');
    button.textContent = usage ? 'In use' : 'Remove';
    button.title = usage ? `Cannot remove: used by ${usage}` : 'Remove this unused asset from the project';
    button.disabled = playing || Boolean(usage);
  }
}

function openAtlasPicker() {
  if (playing) return;
  const host = element('atlas-picker-list'); host.replaceChildren();
  const images = (assets?.listAssets() ?? []).filter(record => record.kind === 'image');
  if (!images.length) { const empty = document.createElement('p'); empty.className = 'atlas-picker-empty'; empty.textContent = 'Import an image first to create a sprite atlas.'; host.append(empty); }
  for (const record of images) {
    const existing = atlases.find(atlas => atlas.assetId === record.assetId);
    const card = document.createElement('button'); card.type = 'button'; card.className = 'atlas-source-card';
    const preview = document.createElement('span'); preview.className = 'atlas-source-preview'; const image = document.createElement('img'); image.alt = `${record.name} preview`; void resolveUiImage(record.assetId).then(url => { if (url && image.isConnected) image.src = url; }); preview.append(image);
    const details = document.createElement('span'); details.className = 'atlas-source-details'; const name = document.createElement('strong'); name.textContent = record.name; const path = document.createElement('small'); path.textContent = record.path; const status = document.createElement('small'); status.className = existing ? 'atlas-source-status is-ready' : 'atlas-source-status'; status.textContent = existing ? `Atlas ready · ${existing.regions.length} region${existing.regions.length === 1 ? '' : 's'}` : 'No atlas yet'; details.append(name, path, status);
    const action = document.createElement('span'); action.className = 'atlas-source-action'; action.textContent = existing ? 'Edit Atlas →' : 'Create Atlas →';
    card.append(preview, details, action); card.disabled = playing; card.setAttribute('aria-label', `${existing ? 'Edit Atlas from' : 'Create Atlas from'} ${record.name}`); card.onclick = () => { element<HTMLDialogElement>('atlas-picker-dialog').close(); void openSpriteAtlas(record.assetId, existing); }; host.append(card);
  }
  element<HTMLDialogElement>('atlas-picker-dialog').showModal();
}

function renderAssets() {
  const prefabHost = element('prefab-list'); prefabHost.replaceChildren();
  for (const prefab of prefabs) {
    const card = document.createElement('div'); card.className = 'prefab-card';
    const title = document.createElement('strong'); title.textContent = prefab.name;
    const sourceCount = (prefab.scene as { entities: unknown[] }).entities.length;
    const instances = [...entities.values()].filter(entity => world.getComponent(entity, PrefabLink)?.prefabId === prefab.prefabId);
    const summary = document.createElement('small'); summary.textContent = `${sourceCount} source object${sourceCount === 1 ? '' : 's'} · ${instances.length} linked instance object${instances.length === 1 ? '' : 's'}`;
    const add = document.createElement('button'); add.textContent = '＋ Add Instance'; add.disabled = playing; add.onclick = () => instantiatePrefab(prefab.prefabId);
    const source = document.createElement('button'); source.textContent = 'Update Source'; source.title = 'Select the original prefab root, then update this reusable source'; source.disabled = playing; source.onclick = () => updatePrefabSourceFromSelection(prefab.prefabId);
    const update = document.createElement('button'); update.textContent = 'Update Instances'; update.disabled = playing || !instances.length; update.onclick = () => updatePrefabInstances(prefab.prefabId);
    const remove = document.createElement('button'); remove.textContent = 'Remove Source'; remove.title = 'Existing instances will show a broken prefab reference'; remove.disabled = playing; remove.onclick = () => { prefabs = prefabs.filter(item => item.prefabId !== prefab.prefabId); scheduleSave(); renderAssets(); renderInspector(); log(`Removed prefab source "${prefab.name}". Existing instances are now broken references.`, true); };
    card.append(title, summary, add, source, update, remove); prefabHost.append(card);
  }
  const host = element('asset-list'); host.replaceChildren(); const records = assets?.listAssets() ?? []; element('asset-count').textContent = String(records.length);
  element<HTMLButtonElement>('atlas-create').disabled = !records.some(item => item.kind === 'image') || playing;
  const atlasHost = element('atlas-list'); atlasHost.replaceChildren();
  for (const atlas of atlases) { const card = document.createElement('button'); card.type = 'button'; card.className = 'atlas-card'; card.disabled = playing; const image = document.createElement('img'); image.alt = ''; void resolveUiImage(atlas.assetId).then(url => { if (url && image.isConnected) image.src = url; }); const label = document.createElement('span'); label.innerHTML = '<strong></strong><br><small></small>'; label.querySelector('strong')!.textContent = atlas.name; label.querySelector('small')!.textContent = `${atlas.regions.length} regions`; card.append(image, label); card.onclick = () => { void openSpriteAtlas(atlas.assetId, atlas); }; atlasHost.append(card); }
  for (const record of records) { const card = document.createElement('div'); card.className = 'asset-card'; const button = document.createElement('button'); button.className = 'asset-row'; button.setAttribute('role', 'option'); button.setAttribute('aria-label', `Select ${record.name}`); button.disabled = playing; const icon = document.createElement('span'); icon.className = 'asset-icon'; if (record.kind === 'image') { const image = document.createElement('img'); image.alt = `${record.name} preview`; void resolveUiImage(record.assetId).then(url => { if (url && image.isConnected) image.src = url; }); icon.append(image); } else icon.textContent = '♫'; const details = document.createElement('span'); const title = document.createElement('strong'); title.textContent = record.name; const path = document.createElement('small'); path.textContent = record.path; details.append(title, path); button.append(icon, details); button.onclick = () => {
    if (record.kind === 'audio') { void previewAudioAsset(record.assetId); return; }
    const entity = entities.get(selectedId); const sprite = entity && world.getComponent(entity, SpriteRenderer2D); if (!entity || !sprite) { log('Select an object with Sprite Renderer 2D to assign an image.', true); return; }
    performEdit('Assign Sprite', () => world.setComponent(entity, SpriteRenderer2D, { ...sprite, asset: { assetId: record.assetId }, region: null })); log(`Assigned ${record.name} to ${objects.find(item => item.id === selectedId)!.name}.`);
  }; const usage = assetUsage(record.assetId); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'asset-remove'; remove.dataset.assetId = record.assetId; remove.textContent = usage ? 'In use' : 'Remove'; remove.title = usage ? `Cannot remove: used by ${usage}` : 'Remove this unused asset from the project'; remove.disabled = playing || Boolean(usage); remove.onclick = async () => {
    if (playing || assetUsage(record.assetId)) return;
    if (!window.confirm(`Remove unused asset “${record.name}” from this project?`)) return;
    try {
      const removed = await assets?.removeAsset(record.assetId);
      if (!removed) return;
      const cachedUrl = uiImageUrls.get(record.assetId); if (cachedUrl) URL.revokeObjectURL(cachedUrl); uiImageUrls.delete(record.assetId);
      regionPreviewCache.clear(); scheduleSave(); renderAssets(); renderInspector(); updateAnimationPanel(); updateTileTools(); log(`Removed unused asset ${record.path}.`);
    } catch (error) { log(`Could not remove ${record.path}: ${String(error)}`, true); }
  }; card.append(button, remove); host.append(card); }
  updateTileTools();
}
element<HTMLInputElement>('asset-import').onchange = async event => { const input = event.currentTarget as HTMLInputElement; const files = [...input.files ?? []]; for (const file of files) { try { const importer = [...pluginImporters.values()].find(candidate => candidate.accepts(file)); if (importer) { await importer.import(file, { importFile: (source, path) => assets!.importFile(source, path) }); log(`Imported ${file.name} with ${importer.label}.`); } else { const record = await assets!.importFile(file, `${file.type.startsWith('audio/') ? 'Audio' : 'Textures'}/${file.name}`); log(`Imported ${record.path}.`); } } catch (error) { log(String(error), true); } } input.value = ''; renderAssets(); renderInspector(); };
element<HTMLButtonElement>('prefab-create').onclick = createPrefabFromSelection;
element<HTMLButtonElement>('atlas-create').onclick = openAtlasPicker;
element<HTMLButtonElement>('atlas-slice-grid').onclick = () => {
  if (!atlasDraft) return;
  const readPixels = (id: string) => Math.floor(Number(element<HTMLInputElement>(id).value));
  const cellWidth = readPixels('atlas-cell-width'); const cellHeight = readPixels('atlas-cell-height');
  const marginX = readPixels('atlas-margin-x'); const marginY = readPixels('atlas-margin-y');
  const spacingX = readPixels('atlas-spacing-x'); const spacingY = readPixels('atlas-spacing-y');
  if (![cellWidth, cellHeight, marginX, marginY, spacingX, spacingY].every(Number.isFinite) || cellWidth < 1 || cellHeight < 1 || Math.min(marginX, marginY, spacingX, spacingY) < 0) return;
  const right = atlasDraft.width - marginX; const bottom = atlasDraft.height - marginY;
  if (marginX >= right || marginY >= bottom) { log('Atlas margins leave no space for regions.', true); return; }
  const regions: SpriteAtlasRegion[] = []; let index = 0;
  for (let y = marginY; y < bottom; y += cellHeight + spacingY) for (let x = marginX; x < right; x += cellWidth + spacingX) {
    const width = Math.min(cellWidth, right - x); const height = Math.min(cellHeight, bottom - y);
    regions.push({ id: `region:${crypto.randomUUID()}`, name: `Sprite ${++index}`, x, y, width, height, pivotX: .5, pivotY: .5 });
  }
  atlasDraft = { ...atlasDraft, regions }; renderAtlasDraft();
};
const atlasRegionsResize = element<HTMLDivElement>('atlas-regions-resize');
function resizeAtlasRegions(width: number) {
  const body = atlasRegionsResize.parentElement!;
  const maximum = Math.max(240, body.clientWidth - 188);
  const next = Math.round(Math.max(240, Math.min(maximum, width)));
  body.style.setProperty('--atlas-regions-width', `${next}px`);
  atlasRegionsResize.setAttribute('aria-valuemax', String(maximum));
  atlasRegionsResize.setAttribute('aria-valuenow', String(next));
}
atlasRegionsResize.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault(); atlasRegionsResize.focus(); atlasRegionsResize.setPointerCapture(event.pointerId);
  const startX = event.clientX; const startWidth = element('atlas-regions-panel').getBoundingClientRect().width;
  const move = (next: PointerEvent) => resizeAtlasRegions(startWidth + startX - next.clientX);
  const end = () => {
    atlasRegionsResize.removeEventListener('pointermove', move);
    atlasRegionsResize.removeEventListener('pointerup', end);
    atlasRegionsResize.removeEventListener('pointercancel', end);
    atlasRegionsResize.removeEventListener('lostpointercapture', end);
  };
  atlasRegionsResize.addEventListener('pointermove', move);
  atlasRegionsResize.addEventListener('pointerup', end);
  atlasRegionsResize.addEventListener('pointercancel', end);
  atlasRegionsResize.addEventListener('lostpointercapture', end);
});
atlasRegionsResize.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const width = element('atlas-regions-panel').getBoundingClientRect().width;
  resizeAtlasRegions(event.key === 'Home' ? 240 : event.key === 'End' ? atlasRegionsResize.parentElement!.clientWidth - 188 : width + (event.key === 'ArrowLeft' ? 20 : -20));
});
atlasRegionsResize.addEventListener('dblclick', () => resizeAtlasRegions(420));
element<HTMLButtonElement>('atlas-zoom-in').onclick = () => setAtlasZoom(atlasZoom * 1.25);
element<HTMLButtonElement>('atlas-zoom-out').onclick = () => setAtlasZoom(atlasZoom / 1.25);
element<HTMLButtonElement>('atlas-zoom-fit').onclick = fitAtlasCanvas;
element<HTMLDivElement>('atlas-canvas-wrap').addEventListener('wheel', event => { event.preventDefault(); const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15; setAtlasZoom(atlasZoom * factor, { x: event.clientX, y: event.clientY }); }, { passive: false });
element<HTMLDivElement>('atlas-canvas-wrap').addEventListener('pointerdown', event => { if (event.button !== 1) return; event.preventDefault(); const wrap = event.currentTarget as HTMLDivElement; atlasPanStart = { x: event.clientX, y: event.clientY, scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop }; wrap.setPointerCapture(event.pointerId); });
element<HTMLDivElement>('atlas-canvas-wrap').addEventListener('pointermove', event => { if (!atlasPanStart) return; const wrap = event.currentTarget as HTMLDivElement; wrap.scrollLeft = atlasPanStart.scrollLeft - (event.clientX - atlasPanStart.x); wrap.scrollTop = atlasPanStart.scrollTop - (event.clientY - atlasPanStart.y); });
element<HTMLDivElement>('atlas-canvas-wrap').addEventListener('pointerup', () => { atlasPanStart = undefined; });
element<HTMLCanvasElement>('atlas-canvas').addEventListener('pointerdown', event => { if (event.button !== 0) return; atlasDragStart = atlasCanvasPoint(event); atlasDragEnd = atlasDragStart; (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId); renderAtlasDraft(); });
element<HTMLCanvasElement>('atlas-canvas').addEventListener('pointermove', event => { if (!atlasDragStart) return; atlasDragEnd = atlasCanvasPoint(event); renderAtlasDraft(); });
element<HTMLCanvasElement>('atlas-canvas').addEventListener('pointerup', event => { if (!atlasDragStart) return; atlasDragEnd = atlasCanvasPoint(event); const left = Math.min(atlasDragStart.x, atlasDragEnd.x); const top = Math.min(atlasDragStart.y, atlasDragEnd.y); const width = Math.abs(atlasDragEnd.x - atlasDragStart.x); const height = Math.abs(atlasDragEnd.y - atlasDragStart.y); if (width > 0 && height > 0) { element<HTMLInputElement>('atlas-region-name').value = `Sprite ${atlasDraft?.regions.length ? atlasDraft.regions.length + 1 : 1}`; element<HTMLButtonElement>('atlas-add-region').dataset.selection = `${left},${top},${width},${height}`; } atlasDragStart = undefined; atlasDragEnd = undefined; renderAtlasDraft(); });
element<HTMLButtonElement>('atlas-add-region').onclick = event => { if (!atlasDraft) return; const raw = (event.currentTarget as HTMLButtonElement).dataset.selection; if (!raw) { log('Drag on the atlas image to select a region first.', true); return; } const [x, y, width, height] = raw.split(',').map(Number); const name = element<HTMLInputElement>('atlas-region-name').value.trim() || `Sprite ${atlasDraft.regions.length + 1}`; atlasDraft = { ...atlasDraft, regions: [...atlasDraft.regions, { id: `region:${crypto.randomUUID()}`, name, x: x!, y: y!, width: width!, height: height!, pivotX: .5, pivotY: .5 }] }; (event.currentTarget as HTMLButtonElement).dataset.selection = ''; renderAtlasDraft(); };
element<HTMLButtonElement>('atlas-save').onclick = () => { if (!atlasDraft) return; const next = { ...atlasDraft, name: element<HTMLInputElement>('atlas-name').value.trim() || atlasDraft.name }; atlases = [...atlases.filter(item => item.id !== next.id), next]; regionPreviewCache.clear(); atlasDraft = undefined; atlasImage = undefined; element<HTMLDialogElement>('sprite-atlas-dialog').close(); renderAssets(); renderInspector(); updateAnimationPanel(); updateTileTools(); scheduleSave(); log(`Saved sprite atlas "${next.name}" with ${next.regions.length} regions.`); };

function controls() { for (const field of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.scene-manager button, .scene-manager select, #start-scene')) field.disabled = playing; element<HTMLButtonElement>('scene-delete').disabled = playing || projectScenes.length < 2; element<HTMLButtonElement>('play').disabled = !gameScene || playing; element<HTMLButtonElement>('stop').disabled = !playing; element<HTMLButtonElement>('pause').disabled = !playing; element<HTMLButtonElement>('step').disabled = !playing || !paused; element('pause').textContent = paused ? '▶ Resume' : 'Ⅱ Pause'; element('mode').textContent = playing ? paused ? 'Paused' : 'Playing' : 'Editing'; code?.editor.updateOptions({ readOnly: playing }); for (const input of element('component-inspector').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = playing; for (const input of element('animation-panel').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = playing; for (const button of document.querySelectorAll<HTMLButtonElement>('.scene-tools button, #add-object, .object-menu button, #atlas-create, .atlas-source-card, .asset-row, .asset-remove, #tilemap-panel button')) button.disabled = playing || (button.classList.contains('asset-row') && button.getAttribute('role') === 'option' && button.querySelector('.asset-icon')?.textContent === '♫') || (button.classList.contains('asset-remove') && Boolean(assetUsage(button.dataset.assetId ?? ''))); updateAnimationPanel(); updateTileTools(); updateHistoryControls(); }
function updateDebugView() {
  if (!gameScene || !playing) return;
  const stats = gameScene.getDebugStats();
  element('debug-tick').textContent = `Tick ${stats.tick} · ${paused ? 'Paused' : 'Running'}`;
  const systemRows = [...stats.systems.map(item => ({ name: item.name, ms: item.lastDurationMs })), { name: 'Code & nodes', ms: scriptUpdateDurationMs }];
  element('debug-systems').replaceChildren(...systemRows.map(item => { const row = document.createElement('div'); row.className = 'debug-stat'; const name = document.createElement('span'); name.textContent = item.name; const value = document.createElement('strong'); value.textContent = `${item.ms.toFixed(3)} ms`; row.append(name, value); return row; }));
  element('debug-render').replaceChildren(...[
    ['Draw calls', String(stats.drawCalls)], ['Triangles', stats.triangles.toLocaleString()], ['Entities', String(stats.entityCount)], ['GPU geometries', String(stats.geometries)], ['Textures', String(stats.textures)],
  ].map(([name, value]) => { const row = document.createElement('div'); row.className = 'debug-stat'; const label = document.createElement('span'); label.textContent = name; const result = document.createElement('strong'); result.textContent = value!; row.append(label, result); return row; }));
}
function showPlayEntity(entityId?: string) {
  selectedPlayEntityId = entityId;
  const host = element('debug-entity'); host.replaceChildren();
  if (!entityId || !playDebugWorld || !playDebugEntities) { host.textContent = 'Start Play and select an object in Game view.'; return; }
  const resolvedId = playDebugEntities.has(entityId) ? entityId : [...playDebugEntities.keys()].find(id => entityId.startsWith(`${id}:tile`));
  if (!resolvedId) { host.textContent = `No ECS entity for ${entityId}`; return; }
  const entity = playDebugEntities.get(resolvedId)!; const title = document.createElement('strong'); title.textContent = `${playDebugWorld.getComponent(entity, Name)?.value ?? resolvedId} (${resolvedId})`; host.append(title);
  for (const schema of schemas.all()) if (playDebugWorld.hasComponent(entity, schema.component)) {
    const details = document.createElement('details'); details.open = true; const summary = document.createElement('summary'); summary.textContent = schema.displayName; details.append(summary);
    const value = document.createElement('pre'); value.textContent = JSON.stringify(playDebugWorld.getComponent(entity, schema.component), null, 2); details.append(value); host.append(details);
  }
}
let playDebugWorld: World | undefined;
let playDebugEntities: Map<string, ReturnType<World['createEntity']>> | undefined;
const debugRefreshTimer = window.setInterval(updateDebugView, 250);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => setActiveTool(button.dataset.tool as typeof activeTool);
element('orientation').onclick = event => { globalOrientation = !globalOrientation; (event.currentTarget as HTMLButtonElement).textContent = globalOrientation ? 'Global' : 'Local'; (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(globalOrientation)); };
element('scene-zoom-out').onclick = () => setSceneZoom(sceneCamera.zoom / 1.2);
element('scene-zoom-in').onclick = () => setSceneZoom(sceneCamera.zoom * 1.2);
element('scene-zoom-reset').onclick = resetSceneCamera;
element('undo').onclick = undo; element('redo').onclick = redo;
element<HTMLButtonElement>('tile-paint').onclick = () => setActiveTool(activeTool === 'tile' ? 'select' : 'tile');
element<HTMLButtonElement>('tile-fill').onclick = () => setActiveTool(activeTool === 'fill' ? 'select' : 'fill');
element<HTMLSelectElement>('tile-layer').onchange = () => updateTileTools();
element<HTMLSelectElement>('tile-asset').onchange = () => { selectedTileDefinitionId = element<HTMLSelectElement>('tile-asset').value; tileEraseSelected = !selectedTileDefinitionId; updateTileTools(); };
element<HTMLButtonElement>('tile-image-picker').onclick = () => { const menu = element('tile-image-options'); menu.hidden = !menu.hidden; element<HTMLButtonElement>('tile-image-picker').setAttribute('aria-expanded', String(!menu.hidden)); };
element<HTMLSelectElement>('tile-definition-asset').onchange = event => { const assetId = (event.currentTarget as HTMLSelectElement).value; selectedTileAssetIds = assetId ? new Set([spriteSourceValue({ assetId })]) : new Set(); updateTileTools(); };
document.addEventListener('pointerdown', event => {
  const target = event.target;
  if (target instanceof Element && target.closest('.tile-image-picker')) return;
  const menu = element('tile-image-options'); menu.hidden = true; element<HTMLButtonElement>('tile-image-picker').setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || element('tile-image-options').hidden) return;
  element('tile-image-options').hidden = true; element<HTMLButtonElement>('tile-image-picker').setAttribute('aria-expanded', 'false'); element<HTMLButtonElement>('tile-image-picker').focus();
});
element<HTMLButtonElement>('tile-definition-add').onclick = () => {
  const entity = entities.get(selectedId); const selectedSources: Array<Pick<SpriteSourceChoice, 'assetId' | 'region'>> = selectedTileAssetIds.size ? [...selectedTileAssetIds].map(parseSpriteSourceValue).filter((value): value is NonNullable<typeof value> => Boolean(value)) : [element<HTMLSelectElement>('tile-definition-asset').value].filter(Boolean).map(assetId => ({ assetId }));
  if (!entity || !world.hasComponent(entity, Tilemap2D) || !selectedSources.length || playing) return;
  const tileIds = selectedSources.map(() => `tile:${crypto.randomUUID()}`); selectedTileDefinitionId = tileIds.at(-1)!; tileEraseSelected = false; selectedTileAssetIds.clear();
  performEdit('Add Tile Definitions', () => { const map = world.getComponent(entity, Tilemap2D)!; const { tiles } = parseTilemap(map); tiles.push(...selectedSources.map((source, index) => ({ id: tileIds[index]!, asset: { assetId: source.assetId }, ...(source.region ? { region: source.region } : {}) }))); world.setComponent(entity, Tilemap2D, { ...map, tilesJson: JSON.stringify(tiles) }); });
};
element<HTMLInputElement>('tile-neighbor-group').onchange = event => {
  const entity = entities.get(selectedId); if (!entity || !world.hasComponent(entity, Tilemap2D) || playing) return;
  const tileId = selectedTileDefinitionId; const group = (event.currentTarget as HTMLInputElement).value.trim();
  performEdit('Set Tile Autotile Group', () => { const map = world.getComponent(entity, Tilemap2D)!; const { tiles } = parseTilemap(map); const tile = tiles.find(item => item.id === tileId); if (!tile) return; tile.neighborGroup = group || undefined; world.setComponent(entity, Tilemap2D, { ...map, tilesJson: JSON.stringify(tiles) }); });
};
element<HTMLButtonElement>('tile-definition-remove').onclick = () => {
  const entity = entities.get(selectedId); const tileId = selectedTileDefinitionId;
  if (!entity || !world.hasComponent(entity, Tilemap2D) || !tileId || playing) return;
  selectedTileDefinitionId = ''; tileEraseSelected = false;
  performEdit('Remove Tile Definition', () => { const map = world.getComponent(entity, Tilemap2D)!; const { layers, tiles } = parseTilemap(map); for (const layer of layers) layer.cells = layer.cells.map(cell => cell === tileId ? null : cell); world.setComponent(entity, Tilemap2D, { ...map, layersJson: JSON.stringify(layers), tilesJson: JSON.stringify(tiles.filter(tile => tile.id !== tileId)) }); });
};
element<HTMLButtonElement>('tile-variant-set').onclick = () => editTileVariant(element<HTMLSelectElement>('tile-variant-mask').value, element<HTMLSelectElement>('tile-variant-tile').value || null);
element<HTMLButtonElement>('tile-layer-add').onclick = () => { const entity = entities.get(selectedId); if (!entity || playing) return; performEdit('Add Tilemap Layer', () => { const map = world.getComponent(entity, Tilemap2D)!; const { layers } = parseTilemap(map); const index = layers.length + 1; layers.push({ id: `layer:${crypto.randomUUID()}`, name: `Layer ${index}`, visible: true, collidable: true, cells: Array(map.width * map.height).fill(null) }); world.setComponent(entity, Tilemap2D, { ...map, layersJson: JSON.stringify(layers) }); }); };
element<HTMLButtonElement>('tile-layer-remove').onclick = () => { const entity = entities.get(selectedId); if (!entity || playing) return; performEdit('Remove Tilemap Layer', () => { const map = world.getComponent(entity, Tilemap2D)!; const { layers } = parseTilemap(map); if (layers.length < 2) return; const index = layers.findIndex(layer => layer.id === element<HTMLSelectElement>('tile-layer').value); if (index >= 0) layers.splice(index, 1); world.setComponent(entity, Tilemap2D, { ...map, layersJson: JSON.stringify(layers) }); }); };
for (const [buttonId, property, label] of [['tile-layer-collision', 'collidable', 'Toggle Layer Collision'], ['tile-layer-visibility', 'visible', 'Toggle Layer Visibility']] as const) element<HTMLButtonElement>(buttonId).onclick = () => { const entity = entities.get(selectedId); if (!entity || playing) return; performEdit(label, () => { const map = world.getComponent(entity, Tilemap2D)!; const { layers } = parseTilemap(map); const layer = layers.find(item => item.id === element<HTMLSelectElement>('tile-layer').value); if (!layer) return; layer[property] = !layer[property]; world.setComponent(entity, Tilemap2D, { ...map, layersJson: JSON.stringify(layers) }); }); };
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement; if (target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) return;
  const key = event.key.toLowerCase(); const modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if (modifier && key === 'y') { event.preventDefault(); redo(); return; }
  if (modifier && key === 'd') { event.preventDefault(); if (!playing) duplicateSelection(); return; }
  if (!modifier && (key === 'delete' || key === 'backspace')) { event.preventDefault(); if (!playing) deleteSelection(); return; }
  if (modifier) return;
  const tool = ({ q: 'select', w: 'move', e: 'rotate', r: 'scale' } as const)[key as 'q' | 'w' | 'e' | 'r'];
  if (tool) setActiveTool(tool);
});
let scriptAbort: AbortController | undefined;
let stopPlayScripts: (() => Promise<void>) | undefined;
interface ScriptInstanceState { state: ScriptJson; subscriptions: string[]; session?: ReturnType<typeof createSandboxedSession>; started?: boolean; lastInput?: Record<string, unknown>; }
type QueuedScriptEvent = { type: string; payload: ScriptJson };
function revealScriptError(message: string) {
  const match = /(?:ecs:\/\/)?(scripts\/[^:\s]+\.tsx?):(\d+)/.exec(message);
  if (match && code) {
    const line = match[1] === 'scripts/player.ts' ? Number(match[2]) - CODE_SCRIPT_ERROR_LINE_OFFSET : Number(match[2]);
    const sourceLine = Math.max(1, line);
    log(`${match[1]}:${sourceLine}`, true);
    openScriptSource(match[1]!, line);
  }
}
async function compilePlayerScript(entryPath = 'scripts/player.ts') {
  if (!scriptFiles[entryPath]) throw new Error(`Script file "${entryPath}" is missing from the project.`);
  if (!code) {
    const { createCodeEditor } = await import('./code-editor');
    code = createCodeEditor(element('code-editor'), schemas, playerScriptDefinition.properties, scriptFiles, files => { scriptFiles = { ...files }; scheduleSave(); }, inputActions);
    refreshScriptFiles();
  }
  return code.compileFiles(entryPath);
}
let playSceneRevision = 0;
let pendingPlayFrame: Promise<void> | undefined;
async function startPlayScene(document?: unknown) {
  if (!gameScene || playing) return;
  if (!audioMixer) {
    try {
      audioMixer = new WebAudioMixer();
      audioMixer.setMasterVolume(audioVolumes.master); audioMixer.setGroupVolume('music', audioVolumes.music); audioMixer.setGroupVolume('effects', audioVolumes.effects);
    } catch (error) { element('audio-status').textContent = 'Web Audio is unavailable'; log(`Audio is unavailable in this browser: ${String(error)}`, true); }
  }
  // Call resume directly in the user click handler before Play performs async compilation.
  const audioUnlock = audioMixer?.unlock().then(() => { element('audio-status').textContent = 'Audio ready'; }).catch(error => { element('audio-status').textContent = 'Audio needs a user gesture'; log(`Audio could not start: ${String(error)}`, true); });
  audioMixer?.stopAll();
  element<HTMLButtonElement>('play').disabled = true;
  try {
    const revision = ++playSceneRevision;
    const collection = captureProjectScenes();
    const playCopy = codec.deserialize(document ?? collection.scenes.find(scene => scene.id === startSceneId)!.document);
    const copyEntities = new Map(playCopy.entities); const copyHierarchy = new SceneHierarchy(playCopy.world, copyEntities);
    playDebugWorld = playCopy.world; playDebugEntities = copyEntities; scriptUpdateDurationMs = 0; showPlayEntity();
    ensureSceneNames(playCopy.world, copyEntities);
    const bindings = [...copyEntities].flatMap(([entityId, entity]) => {
      if (!playCopy.world.hasComponent(entity, ScriptBinding)) return [];
      const binding = playCopy.world.getComponent(entity, ScriptBinding)!;
      return binding.enabled && (binding.codePath.trim() || binding.graphPath.trim()) ? [{ entityId, binding }] : [];
    }).sort((a, b) => a.entityId.localeCompare(b.entityId));
    const compiledSources = new Map<string, string>();
    for (const { binding } of bindings) if (binding.codePath.trim() && !compiledSources.has(binding.codePath)) compiledSources.set(binding.codePath, await compilePlayerScript(binding.codePath));
    const scriptInstances = new Map<string, { code: ScriptInstanceState; graph: ScriptInstanceState }>();
    const autoplaySources = new Set<string>();
    const playAudioSource = async (entityId: string) => {
      const entity = copyEntities.get(entityId);
      if (!entity || !playCopy.world.hasComponent(entity, AudioSource2D)) { log(`Audio source entity "${entityId}" is missing.`, true); return; }
      const audio = playCopy.world.getComponent(entity, AudioSource2D)!;
      if (!audio.asset) { log(`Audio source "${entityId}" has no clip assigned.`, true); return; }
      if (!audioMixer || !assets) { log('Web Audio is unavailable; audio sources cannot play.', true); return; }
      try {
        const resolved = await assets.resolveAsset(audio.asset.assetId);
        if (resolved.status !== 'available') throw new Error(resolved.status === 'missing' ? `Audio asset "${resolved.record.path}" is missing.` : `Unknown audio asset "${audio.asset.assetId}".`);
        if (resolved.record.kind !== 'audio') throw new Error(`Asset "${resolved.record.path}" is not an audio file.`);
        await audioMixer.play(resolved.record.assetId, resolved.data, { ownerId: entityId, group: audio.group, volume: audio.volume, loop: audio.loop });
      } catch (error) { log(`Audio source "${entityId}" failed: ${String(error)}`, true); }
    };
    const getScriptInstance = (entityId: string, binding: ScriptBindingData) => {
      const key = JSON.stringify([entityId, binding.codePath, binding.graphPath]);
      let instance = scriptInstances.get(key);
      if (!instance) { instance = { code: { state: null, subscriptions: [] }, graph: { state: null, subscriptions: [] } }; scriptInstances.set(key, instance); }
      return instance;
    };
    scriptAbort = new AbortController();
    const animationStates = new Map<string, { clipId: string; time: number }>();
    let pendingEvents: QueuedScriptEvent[] = [];
    const queuedUiEvents: QueuedScriptEvent[] = [];
    const queueUiButtonClick = (entityId: string) => {
      if (queuedUiEvents.length >= 512) { log('UI button input queue is full; ignored a click.', true); return; }
      queuedUiEvents.push({ type: 'ui.button.clicked', payload: { entityId } });
    };
    const source: PlaySceneSource = {
      objects: sceneObjectsFrom(playCopy.world, copyEntities, copyHierarchy), world: playCopy.world,
      inputActions,
      camera: () => resolveCamera2D(playCopy.world, copyEntities, copyHierarchy),
      onEntitySelected: entityId => showPlayEntity(entityId),
      uiElements: () => collectUiElements(playCopy.world, copyEntities), uiCanvas: () => uiCanvasSettings(playCopy.world, copyEntities), resolveUiImage, onUiButtonClick: queueUiButtonClick,
      syncTransform(id, x, y, rotation) {
        const entity = copyEntities.get(id); if (!entity) return;
        const transform = playCopy.world.getComponent(entity, Transform2D); if (transform) playCopy.world.setComponent(entity, Transform2D, { ...transform, x, y, rotation });
      },
      async onFrame(deltaTime, input) {
        const frameTask = (async () => {
        const scriptStartedAt = performance.now();
        const deliveredEvents = [...pendingEvents, ...queuedUiEvents.splice(0)];
        for (const [id, entity] of copyEntities) {
          if (!playCopy.world.hasComponent(entity, AudioSource2D)) continue;
          if (playCopy.world.getComponent(entity, AudioSource2D)!.playOnStart && !autoplaySources.has(id)) { autoplaySources.add(id); await playAudioSource(id); }
        }
        for (const event of deliveredEvents) {
          if (event.type !== 'audio.play' && event.type !== 'audio.stop') continue;
          const payload = event.payload;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.entityId !== 'string') { log(`Ignored invalid ${event.type} event payload.`, true); continue; }
          if (event.type === 'audio.play') await playAudioSource(payload.entityId);
          else audioMixer?.stop(payload.entityId);
        }
        const snapshots = new Map<string, Record<string, ScriptJson>>();
        for (const [id, entity] of copyEntities) {
          const components: Record<string, ScriptJson> = {};
          for (const schema of schemas.all()) if (playCopy.world.hasComponent(entity, schema.component)) components[schema.typeId] = playCopy.world.getComponent(entity, schema.component) as ScriptJson;
          snapshots.set(id, components);
        }
        const outputs: { componentCommands: readonly import('@ecs/scripting').ScriptComponentCommand[]; emittedEvents: readonly QueuedScriptEvent[]; subscriptions: readonly string[]; state: ScriptJson }[] = [];
        const producedEvents: QueuedScriptEvent[] = [];
        const liveBindings = [...copyEntities].flatMap(([entityId, entity]) => {
          if (!playCopy.world.hasComponent(entity, ScriptBinding)) return [];
          const binding = playCopy.world.getComponent(entity, ScriptBinding)!;
          return binding.enabled && (binding.codePath.trim() || binding.graphPath.trim()) ? [{ entityId, binding }] : [];
        }).sort((a, b) => a.entityId.localeCompare(b.entityId));
        for (const { entityId, binding } of liveBindings) {
          if (binding.codePath.trim() && !compiledSources.has(binding.codePath)) compiledSources.set(binding.codePath, await compilePlayerScript(binding.codePath));
          const ownerComponents = snapshots.get(entityId); const instance = getScriptInstance(entityId, binding);
          if (!ownerComponents || !instance) continue;
          const entityComponents = Object.fromEntries([...snapshots].filter(([id]) => id !== entityId));
          const validatedProperties = validateScriptProperties(playerScriptDefinition, { speed: binding.speed });
          if (validatedProperties.issues.length) throw new Error(`Invalid properties on "${entityId}": ${validatedProperties.issues.map(issue => issue.message).join(' ')}`);
          const baseInvocation = {
            entityId, phase: 'update' as const, deltaTime, input, components: ownerComponents, entityComponents,
            availableComponentTypeIds: schemas.all().map(schema => schema.typeId),
          };
          if (binding.codePath.trim()) {
            instance.code.session ??= createSandboxedSession(createCodeScriptSource(compiledSources.get(binding.codePath)!), { timeoutMs: 500, signal: scriptAbort?.signal });
            const invokeCode = (phase: 'start' | 'event' | 'update', events: readonly QueuedScriptEvent[] = []) => instance.code.session!.invoke({
              ...baseInvocation, phase, state: instance.code.state, properties: validatedProperties.values, subscriptions: instance.code.subscriptions, events,
            }) as Promise<import('@ecs/scripting').ScriptApiOutput>;
            const invokeWithSnapshot = (phase: 'start' | 'event' | 'update', events: readonly QueuedScriptEvent[] = []) => {
              instance.code.lastInput = { ...baseInvocation, phase, state: instance.code.state, properties: validatedProperties.values, subscriptions: instance.code.subscriptions, events };
              return invokeCode(phase, events);
            };
            if (!instance.code.started) {
              const startOutput = await invokeWithSnapshot('start');
              instance.code.started = true; instance.code.state = startOutput.state ?? null; instance.code.subscriptions = [...startOutput.subscriptions];
              outputs.push(startOutput); producedEvents.push(...startOutput.emittedEvents);
            }
            const matchingEvents = deliveredEvents.filter(event => instance.code.subscriptions.includes(event.type));
            if (matchingEvents.length) {
              const eventOutput = await invokeWithSnapshot('event', matchingEvents);
              instance.code.state = eventOutput.state ?? null; instance.code.subscriptions = [...eventOutput.subscriptions];
              outputs.push(eventOutput); producedEvents.push(...eventOutput.emittedEvents);
            }
            // Keep api.events populated for legacy update(api) scripts; lifecycle listeners already received these events above.
            const codeOutput = await invokeWithSnapshot('update', matchingEvents);
            instance.code.state = codeOutput.state ?? null; instance.code.subscriptions = [...codeOutput.subscriptions];
            outputs.push(codeOutput); producedEvents.push(...codeOutput.emittedEvents);
          }
          const graph = binding.graphPath.trim() ? visualGraphs[binding.graphPath] as VisualGraph | undefined : undefined;
          if (graph) {
            const invokeGraph = (entry: import('../../../packages/scripting/src/visual-graph.ts').VisualGraphNode, phase: 'start' | 'update' | 'event', events: readonly QueuedScriptEvent[] = []) => {
              const graphApi = createScriptApi({ ...baseInvocation, phase, state: instance.graph.state, properties: validatedProperties.values, subscriptions: instance.graph.subscriptions, events });
              const graphOutput = evaluateVisualGraph(graph, { signal: scriptAbort?.signal, api: graphApi, entryNodeId: entry.id }).output;
              instance.graph.state = graphOutput.state; instance.graph.subscriptions = [...graphOutput.subscriptions];
              outputs.push(graphOutput); producedEvents.push(...graphOutput.emittedEvents);
            };
            if (!instance.graph.started) {
              for (const entry of graph.nodes.filter(node => node.kind === 'event.onStart')) invokeGraph(entry, 'start');
              instance.graph.started = true;
            }
            const updateEntries = graph.nodes.filter(node => node.kind === 'event.onUpdate');
            for (const entry of updateEntries.length ? updateEntries : graph.nodes.filter(node => node.kind === 'event.start')) invokeGraph(entry, 'update', deliveredEvents.filter(event => instance.graph.subscriptions.includes(event.type)));
            const subscribedEvents = deliveredEvents.filter(event => instance.graph.subscriptions.includes(event.type));
            for (const event of subscribedEvents) for (const entry of graph.nodes.filter(node => node.kind === 'event.onEvent' && String(node.data.eventType ?? '') === event.type)) invokeGraph(entry, 'event', [event]);
          } else if (binding.graphPath.trim()) throw new Error(`Node graph "${binding.graphPath}" is missing from the project.`);
        }
        applyScriptCommandBuffer(outputs, playCopy.world, copyEntities, schemas, new Set(['engine.name', 'engine.transform2d']));
        pendingEvents = producedEvents;
        const request = producedEvents.find(event => event.type === 'scene.load');
        if (request) {
          const target = sceneLoadTarget(request.payload, collection.scenes);
          window.setTimeout(() => { if (revision === playSceneRevision && playing) void transitionPlayScene(target); }, 0);
        }
        updateSpriteAnimations(playCopy.world, copyEntities, schemas.all(), deltaTime, animationStates);
        if (pendingEvents.length > 512) throw new Error('Scripts emitted more than 512 events in one tick.');
        scriptUpdateDurationMs = performance.now() - scriptStartedAt;
        })(); pendingPlayFrame = frameTask;
        try { await frameTask; } finally { if (pendingPlayFrame === frameTask) pendingPlayFrame = undefined; }
      },
      syncObjects() { return sceneObjectsFrom(playCopy.world, copyEntities, copyHierarchy); },
      onPhysicsEvents(events) {
        pendingEvents.push(...events);
        if (pendingEvents.length > 512) throw new Error('Physics and script events exceeded the 512-event pending queue limit.');
      },
    };
    stopPlayScripts = async () => {
      await pendingPlayFrame?.catch(() => {});
      for (const instance of scriptInstances.values()) {
        const code = instance.code;
        if (!code.session) continue;
        if (code.started && code.lastInput) {
          try { await code.session.invoke({ ...code.lastInput, phase: 'destroy', state: code.state, events: [] }); }
          catch (error) { log(`Script onStop failed: ${String(error)}`, true); }
        }
        code.session.close(); code.session = undefined;
      }
      stopPlayScripts = undefined;
    };
    await audioUnlock;
    activateView('game'); gameScene.play(source); playing = true; paused = false; controls(); log(`Play mode started with ${bindings.length} scene script binding${bindings.length === 1 ? '' : 's'} on a copied scene.`);
  } catch (error) { log(`Could not start Play mode: ${String(error)}`, true); revealScriptError(String(error)); element<HTMLButtonElement>('play').disabled = false; }
}
element('play').onclick = () => { void startPlayScene(); };
async function transitionPlayScene(target: ProjectScene) {
  const revision = ++playSceneRevision; gameScene?.stop(); await stopPlayScripts?.(); scriptAbort?.abort(); audioMixer?.stopAll();
  if (revision !== playSceneRevision) return; playing = false;
  await startPlayScene(target.document);
}
element('pause').onclick = () => { paused = !paused; gameScene?.setPaused(paused); if (paused) void audioMixer?.pause().catch(error => log(`Audio could not pause: ${String(error)}`, true)); else void unlockAudioFromGesture(); controls(); };
element('step').onclick = () => gameScene?.step();
element('stop').onclick = async () => { ++playSceneRevision; gameScene?.stop(); await stopPlayScripts?.(); scriptAbort?.abort(); scriptAbort = undefined; audioMixer?.stopAll(); gameScene?.stop(); if (gameScene) setupUiPreview(gameScene); playing = false; paused = false; playDebugWorld = undefined; playDebugEntities = undefined; showPlayEntity(); controls(); log('Stopped. Edited scene restored.'); };

let codeLoading = false;
function activateView(view: 'scene' | 'game' | 'code' | 'nodes') { element('viewport').hidden = view !== 'scene'; element('scene-label').hidden = view !== 'scene'; element('scene-zoom-controls').hidden = view !== 'scene'; element('game-view').hidden = view !== 'game'; element('code-view').hidden = view !== 'code'; element('nodes-view').hidden = view !== 'nodes'; for (const id of ['scene', 'game', 'code', 'nodes']) element(`${id}-tab`).setAttribute('aria-pressed', String(id === view)); code?.editor.layout(); if (view === 'nodes') graphEditor?.refresh(); }
element('scene-tab').onclick = () => activateView('scene'); element('game-tab').onclick = () => activateView('game');
element('nodes-tab').onclick = () => activateView('nodes');
element('code-tab').onclick = async () => { activateView('code'); if (code || codeLoading) { syncSelectedCodeFile(); return; } codeLoading = true; try { const { createCodeEditor } = await import('./code-editor'); code = createCodeEditor(element('code-editor'), schemas, playerScriptDefinition.properties, scriptFiles, files => { scriptFiles = { ...files }; refreshScriptFiles(); scheduleSave(); }, inputActions); refreshScriptFiles(); syncSelectedCodeFile(); log('TypeScript editor ready. API types are generated from component schemas, script properties and project input actions.'); } catch (error) { log(`Code editor failed: ${String(error)}`, true); } finally { codeLoading = false; } };
function refreshScriptFiles() {
  const select = element<HTMLSelectElement>('script-file'); const selected = select.value;
  select.replaceChildren(...(code?.listFiles() ?? Object.keys(scriptFiles)).map(path => { const option = document.createElement('option'); option.value = path; option.textContent = path; return option; }));
  if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
}
element<HTMLSelectElement>('script-file').onchange = event => { code?.selectFile((event.currentTarget as HTMLSelectElement).value); };
element<HTMLButtonElement>('script-new-file').onclick = () => {
  const path = window.prompt('New script path (for example scripts/enemy.ts)', 'scripts/new-script.ts')?.trim();
  if (!path || !code) return;
  if (!code.createFile(path)) { log('Use a unique scripts/*.ts or scripts/*.js path.', true); return; }
  refreshScriptFiles(); element<HTMLSelectElement>('script-file').value = path; scheduleSave();
};
element<HTMLButtonElement>('script-search-button').onclick = () => {
  const results = element('script-search-results'); results.replaceChildren();
  for (const hit of findInProjectScripts(scriptFiles, element<HTMLInputElement>('script-search').value)) {
    const button = document.createElement('button'); button.setAttribute('role', 'listitem'); button.textContent = `${hit.path}:${hit.line}  ${hit.snippet}`;
    button.onclick = () => { code?.selectFile(hit.path); code?.revealLine(hit.line); }; results.append(button);
  }
};
function bottomPanel(panel: string) {
  activeBottomPanel = panel;
  for (const name of ['assets', 'console', 'animation', 'audio', 'tilemap']) { element(`${name}-panel`).hidden = name !== panel; element(`${name}-tab`).setAttribute('aria-pressed', String(name === panel)); }
  for (const [id, entry] of pluginPanels) { entry.host.hidden = id !== panel; entry.tab.setAttribute('aria-pressed', String(id === panel)); }
}
element('assets-tab').onclick = () => bottomPanel('assets'); element('console-tab').onclick = () => bottomPanel('console'); element('animation-tab').onclick = () => { updateAnimationPanel(); bottomPanel('animation'); }; element('tilemap-tab').onclick = () => { updateTileTools(); bottomPanel('tilemap'); }; element('audio-tab').onclick = () => bottomPanel('audio'); element('clear-console').onclick = () => element('console').replaceChildren();
element<HTMLButtonElement>('getting-started-open').onclick = () => bottomPanel('editor.getting-started');
window.addEventListener(GETTING_STARTED_EVENT, event => {
  const action = (event as CustomEvent<GettingStartedAction>).detail;
  const buttonActions: Partial<Record<GettingStartedAction, string>> = { 'load-showcase': 'project-showcase', 'load-pong': 'project-pong', play: 'play' };
  const buttonId = buttonActions[action];
  if (buttonId) { element<HTMLButtonElement>(buttonId).click(); return; }
  if (action === 'view-scene') activateView('scene');
  else if (action === 'view-code') element<HTMLButtonElement>('code-tab').click();
  else if (action === 'view-nodes') activateView('nodes');
});
for (const [group, id] of [['master', 'audio-master-volume'], ['music', 'audio-music-volume'], ['effects', 'audio-effects-volume']] as const) {
  element<HTMLInputElement>(id).oninput = event => {
    const value = Number((event.currentTarget as HTMLInputElement).value); audioVolumes[group] = value;
    element(`audio-${group}-value`).textContent = `${Math.round(value * 100)}%`;
    if (group === 'master') audioMixer?.setMasterVolume(value);
    else audioMixer?.setGroupVolume(group as AudioGroup, value);
  };
}
element<HTMLSelectElement>('animation-clip').onchange = () => { const entity = entities.get(selectedId); if (!entity || !world.hasComponent(entity, SpriteAnimation2D) || playing) return; const data = world.getComponent(entity, SpriteAnimation2D)!; performEdit('Select Animation Clip', () => world.setComponent(entity, SpriteAnimation2D, { ...data, clipId: element<HTMLSelectElement>('animation-clip').value })); };
element<HTMLButtonElement>('animation-clip-add').onclick = () => { const entity = entities.get(selectedId); if (!entity || !world.hasComponent(entity, SpriteAnimation2D) || playing) return; const data = world.getComponent(entity, SpriteAnimation2D)!; const clips = parseAnimationClips(data.clipsJson); const id = `clip:${crypto.randomUUID()}`; const clip: SpriteAnimationClip = { id, name: `Clip ${clips.length + 1}`, duration: 1, loop: true, frames: [], tracks: [] }; performEdit('Add Animation Clip', () => world.setComponent(entity, SpriteAnimation2D, { ...data, clipsJson: JSON.stringify([...clips, clip]), clipId: id })); };
element<HTMLButtonElement>('animation-clip-remove').onclick = () => editSelectedAnimation('Remove Animation Clip', (_data, clip) => null);
element<HTMLInputElement>('animation-clip-name').onchange = event => editSelectedAnimation('Rename Animation Clip', (_data, clip) => ({ ...clip, name: (event.currentTarget as HTMLInputElement).value.trim() || clip.name }));
element<HTMLInputElement>('animation-duration').onchange = event => { const duration = Number((event.currentTarget as HTMLInputElement).value); if (!(duration > 0)) return; editSelectedAnimation('Change Animation Duration', (_data, clip) => ({ ...clip, duration, tracks: clip.tracks.map(track => ({ ...track, keys: track.keys.map(key => ({ ...key, time: Math.min(duration, key.time) })) })) })); };
element<HTMLInputElement>('animation-loop').onchange = event => editSelectedAnimation('Set Animation Loop', (_data, clip) => ({ ...clip, loop: (event.currentTarget as HTMLInputElement).checked }));
element<HTMLInputElement>('animation-autoplay').onchange = event => { const entity = entities.get(selectedId); if (!entity || !world.hasComponent(entity, SpriteAnimation2D) || playing) return; const data = world.getComponent(entity, SpriteAnimation2D)!; performEdit('Set Animation Autoplay', () => world.setComponent(entity, SpriteAnimation2D, { ...data, playOnStart: (event.currentTarget as HTMLInputElement).checked })); };
element<HTMLButtonElement>('animation-frame-add').onclick = () => { const source = parseSpriteSourceValue(element<HTMLSelectElement>('animation-frame-asset').value); const frameDuration = Number(element<HTMLInputElement>('animation-frame-duration').value); if (!source || !(frameDuration > 0)) return; editSelectedAnimation('Add Sprite Frame', (_data, clip) => ({ ...clip, duration: Math.max(clip.duration, clip.frames.reduce((sum, frame) => sum + frame.duration, 0) + frameDuration), frames: [...clip.frames, { ...source, duration: frameDuration }] })); };
element<HTMLSelectElement>('animation-property').onchange = () => { animationSelectedProperty = element<HTMLSelectElement>('animation-property').value; updateAnimationPanel(); };
element<HTMLButtonElement>('animation-key-add').onclick = () => {
  const propertyKey = element<HTMLSelectElement>('animation-property').value; const separator = propertyKey.lastIndexOf('.'); const componentTypeId = propertyKey.slice(0, separator); const field = propertyKey.slice(separator + 1); if (!componentTypeId || !field) return;
  const schema = schemas.get(componentTypeId); const definition = schema?.fields[field]; if (!definition) return;
  const input = element<HTMLInputElement>('animation-key-value'); const option = element<HTMLSelectElement>('animation-key-value-select'); let value: number | string | boolean = option.hidden ? input.value : option.value;
  if (definition.type === 'number') value = Number(input.value); else if (definition.type === 'boolean') value = option.value === 'true';
  const time = Number(element<HTMLInputElement>('animation-key-time').value); if (!Number.isFinite(time) || time < 0) return;
  editSelectedAnimation('Add Animation Keyframe', (_data, clip) => {
    const duration = Math.max(clip.duration, time, 0.01); const tracks = [...clip.tracks]; let track = tracks.find(item => item.componentTypeId === componentTypeId && item.field === field);
    const keys = [...(track?.keys ?? []).filter(key => key.time !== time), { time, value }].sort((a, b) => a.time - b.time);
    if (track) { const index = tracks.indexOf(track); tracks[index] = { ...track, keys }; } else { track = { componentTypeId, field, keys }; tracks.push(track); }
    return { ...clip, duration, tracks };
  });
};
function attachWorkspaceSplitter(handleId: string, variable: '--hierarchy-width' | '--inspector-width' | '--bottom-height', mode: 'hierarchy' | 'inspector' | 'bottom') {
  const workspace = element('workspace'); const handle = element<HTMLDivElement>(handleId);
  const limits = () => {
    const bounds = workspace.getBoundingClientRect();
    if (mode === 'bottom') return { min: 120, max: Math.max(120, bounds.height - 180) };
    const other = mode === 'hierarchy' ? parseFloat(getComputedStyle(workspace).getPropertyValue('--inspector-width')) || 270 : parseFloat(getComputedStyle(workspace).getPropertyValue('--hierarchy-width')) || 220;
    return { min: mode === 'hierarchy' ? 180 : 220, max: Math.max(mode === 'hierarchy' ? 180 : 220, bounds.width - other - 340) };
  };
  const value = () => parseFloat(getComputedStyle(workspace).getPropertyValue(variable)) || (mode === 'hierarchy' ? 220 : mode === 'inspector' ? 270 : 310);
  const setValue = (next: number) => { const { min, max } = limits(); const size = Math.round(Math.max(min, Math.min(max, next))); workspace.style.setProperty(variable, `${size}px`); handle.setAttribute('aria-valuenow', String(size)); };
  handle.setAttribute('aria-valuemin', String(limits().min)); handle.setAttribute('aria-valuemax', String(limits().max)); handle.setAttribute('aria-valuenow', String(value()));
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return; event.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const move = (next: PointerEvent) => setValue(mode === 'bottom' ? rect.bottom - next.clientY : mode === 'hierarchy' ? next.clientX - rect.left : rect.right - next.clientX);
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
  });
  handle.addEventListener('keydown', event => {
    let delta = 0;
    if (mode === 'bottom') delta = event.key === 'ArrowUp' ? 16 : event.key === 'ArrowDown' ? -16 : 0;
    else if (mode === 'hierarchy') delta = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
    else delta = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
    if (delta) { event.preventDefault(); setValue(value() + delta); }
  });
}
attachWorkspaceSplitter('hierarchy-resize-handle', '--hierarchy-width', 'hierarchy');
attachWorkspaceSplitter('inspector-resize-handle', '--inspector-width', 'inspector');
attachWorkspaceSplitter('bottom-resize-handle', '--bottom-height', 'bottom');
for (const panel of document.querySelectorAll<HTMLElement>('.hierarchy, .inspector, .bottom')) {
  const handle = panel.querySelector<HTMLElement>('h2, .bottom-tabs'); if (!handle) continue;
  handle.title = 'Drag to move panel'; handle.classList.add('panel-drag-handle');
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target !== handle) return;
    const rect = panel.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY;
    panel.classList.add('is-floating'); panel.style.left = `${rect.left}px`; panel.style.top = `${rect.top}px`; panel.style.width = `${rect.width}px`; panel.style.height = `${rect.height}px`;
    const move = (moveEvent: PointerEvent) => { panel.style.left = `${rect.left + moveEvent.clientX - startX}px`; panel.style.top = `${rect.top + moveEvent.clientY - startY}px`; };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
  });
}
element('reset-layout').onclick = () => { for (const panel of document.querySelectorAll<HTMLElement>('.hierarchy, .inspector, .bottom')) { panel.classList.remove('is-floating'); panel.style.left = ''; panel.style.top = ''; panel.style.width = ''; panel.style.height = ''; } const workspace = element('workspace'); workspace.style.removeProperty('--hierarchy-width'); workspace.style.removeProperty('--inspector-width'); workspace.style.removeProperty('--bottom-height'); for (const [id, size] of [['hierarchy-resize-handle', 220], ['inspector-resize-handle', 270], ['bottom-resize-handle', 310]] as const) element(id).setAttribute('aria-valuenow', String(size)); resetSceneCamera(); activateView('scene'); bottomPanel('assets'); };
for (const [id, source] of [['script-success', 'return 6 * 7;'], ['script-error', 'throw new Error("Intentional script error");'], ['script-loop', 'while (true) {}']]) element<HTMLButtonElement>(id).onclick = async () => { const button = element<HTMLButtonElement>(id); button.disabled = true; log(`Running ${button.textContent}…`); try { log(`Worker returned: ${String(await runSandboxed(source, { timeoutMs: 1000 }))}`); } catch (error) { log(String(error), true); } finally { button.disabled = false; } };
element<HTMLButtonElement>('script-probe').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const probe = `let storage = 'available'; try { indexedDB.open('sandbox-probe'); } catch (error) { storage = error.name; } const result = networkBlocked => ({ origin: self.location.origin, document: typeof document, storage, networkBlocked }); return fetch('data:text/plain,sandbox-probe').then(() => result(false), () => result(true));`;
  try { log(`Sandbox boundary: ${JSON.stringify(await runSandboxed(probe, { timeoutMs: 1500 }))}`); }
  catch (error) { log(`Sandbox probe failed: ${String(error)}`, true); }
  finally { button.disabled = false; }
};
element<HTMLButtonElement>('script-clone-error').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  try { await runSandboxed('return () => 42;', { timeoutMs: 1000 }); log('Sandbox unexpectedly accepted an uncloneable result.', true); }
  catch (error) { log(`Sandbox result rejected: ${String(error)}`, true); }
  finally { button.disabled = false; }
};
element<HTMLButtonElement>('script-data').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const input = { score: 3 };
  try { const result = await runSandboxed('input.score = 9; return input.score;', { input }); log(`Sandbox data copy: ${JSON.stringify({ result, originalScore: input.score })}`); }
  catch (error) { log(`Sandbox data transfer failed: ${String(error)}`, true); }
  finally { button.disabled = false; }
};
element<HTMLButtonElement>('script-data-limit').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  let inputLimited = false; let resultLimited = false;
  try { await runSandboxed('return input.length;', { input: 'x'.repeat(300_000) }); }
  catch (error) { inputLimited = String(error).includes('Script input exceeds'); }
  try { await runSandboxed(`return 'x'.repeat(300000);`); }
  catch (error) { resultLimited = String(error).includes('Script result exceeds'); }
  log(`Sandbox payload limits: ${JSON.stringify({ inputLimited, resultLimited })}`);
  button.disabled = false;
};
element<HTMLButtonElement>('script-cancel').onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const controller = new AbortController(); window.setTimeout(() => controller.abort(), 50);
  try { await runSandboxed('while (true) {}', { timeoutMs: 5000, signal: controller.signal }); log('Sandbox cancellation failed.', true); }
  catch (error) { log(String(error), true); }
  finally { button.disabled = false; }
};
selectObject(selectedId); bottomPanel('assets'); void boot().catch(error => { element('mode').textContent = 'Viewport unavailable'; log(`Editor initialization failed: ${String(error)}`, true); });
