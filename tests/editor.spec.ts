import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface StoredProjectForTest { readonly scene: { readonly entities: readonly { readonly components: readonly { readonly typeId: string; readonly data: { readonly value?: string } }[] }[] }; }

async function clickTopbarAction(page: import('@playwright/test').Page, selector: string) {
  const action = page.locator(selector);
  await action.evaluate(element => { const menu = element.closest('details'); if (menu) menu.open = true; });
  await action.click();
}

test('topbar menus close each other and close when clicking outside', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const menus = page.locator('details.topbar-menu');
  const project = menus.nth(0);
  const examples = menus.nth(1);
  await project.locator('summary').click();
  await expect(project).toHaveAttribute('open', '');
  await examples.locator('summary').click();
  await expect(examples).toHaveAttribute('open', '');
  await expect(project).not.toHaveAttribute('open', '');
  await page.locator('.workspace-label').click();
  await expect(examples).not.toHaveAttribute('open', '');
});

async function selectTileImage(page: import('@playwright/test').Page, path: string) {
  await page.locator('#tile-image-picker').click();
  await page.locator('.tile-image-option').filter({ hasText: path }).click();
}

test('React inspector pilot preserves state while editing and supports dynamic components', async ({ page }) => {
  await page.goto('/framework-pilot.html');
  await expect(page.getByRole('heading', { name: 'React Inspector Pilot' })).toBeVisible();
  const transform = page.getByRole('button', { name: /Transform 2D/ });
  await transform.click();
  await page.getByLabel('Tint').fill('#ff0000');
  await expect(page.getByRole('button', { name: /Transform 2D/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.state pre')).toContainText('#ff0000');
  await page.getByLabel('Component to add').selectOption('physics');
  await expect(page.getByRole('button', { name: /Physics 2D/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).last().click();
  await expect(page.getByRole('button', { name: /Physics 2D/ })).toHaveCount(0);
});

test('Pong demo runs code and node event flow in the browser', async ({ page }) => {
  await page.goto('/pong.html');
  await expect(page.getByRole('heading', { name: 'Browser Pong' })).toBeVisible();
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('[data-score="left"]')).toHaveText('0');
  await page.keyboard.down('w');
  await expect.poll(async () => Number(await canvas.getAttribute('data-left-y'))).toBeLessThan(-0.05);
  await page.keyboard.up('w');
  await expect(page.getByText('pong.point', { exact: true })).toBeVisible();
  await expect(page.getByText('pong.scored', { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator('[data-score="left"]').textContent()), { timeout: 5_000 }).toBeGreaterThan(0);
});

test('workspace splitters resize panels and Scene view zoom follows the mouse wheel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const bottom = page.locator('.bottom');
  const initialBottomHeight = (await bottom.boundingBox())!.height;
  const bottomSplitter = page.getByRole('separator', { name: 'Resize bottom panel' });
  const initialBottomTrack = Number(await bottomSplitter.getAttribute('aria-valuenow'));
  await bottomSplitter.focus(); await page.keyboard.press('ArrowUp');
  await expect(bottomSplitter).toHaveAttribute('aria-valuenow', String(initialBottomTrack + 16));
  expect((await bottom.boundingBox())!.height).toBeGreaterThan(initialBottomHeight);
  const afterKeyboardHeight = (await bottom.boundingBox())!.height;
  const splitterBox = (await bottomSplitter.boundingBox())!;
  await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterBox.y + splitterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterBox.y - 32);
  await page.mouse.up();
  expect((await bottom.boundingBox())!.height).toBeGreaterThan(afterKeyboardHeight);
  const hierarchySplitter = page.getByRole('separator', { name: 'Resize Hierarchy panel' });
  const initialHierarchyWidth = Number(await hierarchySplitter.getAttribute('aria-valuenow'));
  await hierarchySplitter.focus(); await page.keyboard.press('ArrowRight');
  expect(Number(await hierarchySplitter.getAttribute('aria-valuenow'))).toBe(initialHierarchyWidth + 16);
  await page.locator('#scene-zoom-in').click();
  await expect(page.locator('#scene-zoom-value')).toHaveText('120%');
  const canvas = page.locator('#viewport canvas');
  await canvas.dispatchEvent('wheel', { deltaY: 120, shiftKey: true });
  await canvas.dispatchEvent('wheel', { deltaY: 120, ctrlKey: true });
  await expect(page.locator('#scene-zoom-value')).toHaveText('120%');
  await canvas.dispatchEvent('wheel', { deltaY: -180 });
  await expect.poll(async () => Number((await page.locator('#scene-zoom-value').textContent())?.replace('%', ''))).toBeGreaterThan(120);
  await page.locator('#scene-zoom-reset').click();
  await expect(page.locator('#scene-zoom-value')).toHaveText('100%');
  await clickTopbarAction(page, '#reset-layout');
});

test('Showcase project demonstrates scene components, code-node events, UI, animation and audio', async ({ page }) => {
  await page.goto('/');
  await clickTopbarAction(page, '#project-showcase');
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase', { timeout: 30_000 });
  await expect(page.locator('.asset-row img').first()).toBeVisible();
  await expect.poll(async () => page.locator('.asset-row img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(async () => page.locator('#viewport .scene-ui-overlay img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.prefab-card').filter({ hasText: 'Bouncy Crate' })).toBeVisible();
  await expect(page.locator('.atlas-card').filter({ hasText: 'Showcase Sprite Sheet' })).toContainText('4 regions');
  await expect(page.locator('#viewport .scene-ui-overlay')).toContainText('ECS STUDIO SHOWCASE');
  await expect(page.locator('#viewport .scene-ui-overlay')).toContainText('Start Adventure');
  expect(await page.locator('#viewport .scene-ui-overlay button').evaluate(button => getComputedStyle(button).pointerEvents)).toBe('none');
  const sceneUiButton = page.locator('#viewport .scene-ui-overlay [data-entity-id="start-button"]');
  const sceneUiButtonBox = await sceneUiButton.boundingBox(); if (!sceneUiButtonBox) throw new Error('Scene UI preview button is not visible.');
  await page.mouse.click(sceneUiButtonBox.x + sceneUiButtonBox.width / 2, sceneUiButtonBox.y + sceneUiButtonBox.height / 2);
  await expect(page.locator('#component-inspector legend').filter({ hasText: 'UI Button' })).toBeVisible();
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Start Button');
  const sceneCanvas = page.locator('#viewport canvas'); const sceneCanvasBox = await sceneCanvas.boundingBox();
  if (!sceneCanvasBox) throw new Error('Scene viewport canvas is not visible.');
  await page.mouse.click(sceneCanvasBox.x + sceneCanvasBox.width / 2 + 4.9 * 45, sceneCanvasBox.y + sceneCanvasBox.height / 2 - 45);
  await expect(page.locator('#component-inspector legend').filter({ hasText: 'Tilemap 2D' })).toBeVisible();
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Tilemap Wall');
  await page.locator('#tilemap-tab').click();
  await page.locator('#tile-image-picker').click();
  const imageChoices = page.getByRole('listbox', { name: 'Image assets for new tile' });
  await expect(imageChoices.locator('.tile-image-option').first().locator('img')).toBeVisible();
  await imageChoices.locator('.tile-image-option').first().click();
  await imageChoices.locator('.tile-image-option').nth(1).click();
  await expect(page.locator('#tile-image-selected-count')).toHaveText('2 selected');
  await expect(page.locator('#tile-image-name')).not.toHaveText('Choose image…');
  await page.locator('#tile-definition-add').click();
  await expect(page.locator('#tile-definition-list .tile-definition')).toHaveCount(4);
  await expect(page.locator('#tile-image-selected-count')).toHaveText('0 selected');
  await page.locator('#tile-paint').click();
  await page.mouse.click(sceneUiButtonBox.x + sceneUiButtonBox.width / 2, sceneUiButtonBox.y + sceneUiButtonBox.height / 2);
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Start Button');
  await page.locator('[data-tool="select"]').click();
  const hierarchy = page.getByRole('tree');
  await expect(hierarchy).toContainText('Player');
  await expect(hierarchy).toContainText('Physics Crate');
  await expect(hierarchy).toContainText('Tilemap Wall');

  await page.locator('#code-tab').click();
  await expect(page.locator('#script-file')).toContainText('scripts/player.ts');
  await expect(page.locator('#script-file')).toContainText('scripts/crate.ts');
  await page.getByRole('treeitem', { name: /Animated Gem$/ }).click();
  await page.locator('#nodes-tab').click();
  await expect(page.locator('#graph-editor')).toContainText('Greater Than');
  await expect(page.locator('#graph-editor')).toContainText('Branch');
  await expect(page.locator('#graph-editor')).toContainText('Set Variable');

  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const inspector = page.locator('#component-inspector');
  for (const component of ['Sprite Renderer 2D', 'Sprite Animation 2D', 'Audio Source 2D', 'Script Binding']) {
    await expect(inspector.locator('legend', { hasText: component })).toBeVisible();
  }
  await page.getByRole('treeitem', { name: '◇  Physics Crate', exact: true }).click();
  for (const component of ['Physics 2D', 'Collider 2D']) await expect(inspector.locator('legend', { hasText: component })).toBeVisible();
  await page.getByRole('treeitem', { name: /Tilemap Wall$/ }).click();
  await expect(inspector.locator('legend', { hasText: 'Tilemap 2D' })).toBeVisible();
  await page.getByRole('treeitem', { name: /UI Canvas$/ }).click();
  await expect(inspector.locator('legend', { hasText: 'UI Canvas' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Title$/ }).click();
  await expect(inspector.locator('legend', { hasText: 'UI Text' })).toBeVisible();
  await expect(inspector.locator('legend', { hasText: 'Parent' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Logo Image$/ }).click();
  await expect(inspector.locator('legend', { hasText: 'UI Image' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Start Button$/ }).click();
  await expect(inspector.locator('legend', { hasText: 'UI Button' })).toBeVisible();
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await page.locator('#nodes-tab').click();
  await expect(page.locator('.graph-node-event-subscribe')).toHaveCount(1);
  await expect(page.locator('.graph-node-event-emit')).toHaveCount(1);

  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  await expect(page.locator('#debug-systems')).toContainText('2D Physics');
  await expect(page.locator('#debug-render')).toContainText('Draw calls');
  await expect(page.locator('#debug-render')).toContainText('Triangles');
  const gameCanvas = page.locator('#game-view canvas');
  const gameCanvasBox = await gameCanvas.boundingBox(); if (!gameCanvasBox) throw new Error('Game canvas is not visible.');
  await page.mouse.click(gameCanvasBox.x + gameCanvasBox.width / 2 - 2.5 * 45, gameCanvasBox.y + gameCanvasBox.height / 2 + 0.5 * 45);
  await expect(page.locator('#debug-entity')).toContainText('Player');
  await expect(page.locator('#debug-entity')).toContainText('Script Binding');
  await page.locator('#pause').click();
  await expect(page.locator('#mode')).toHaveText('Paused');
  const pausedTick = Number(await page.locator('#game-view').getAttribute('data-simulation-tick'));
  await page.locator('#step').click();
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBe(pausedTick + 1);
  await page.locator('#pause').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  const gameButton = page.locator('#game-view .game-ui-overlay button');
  await expect(gameButton).toHaveText('Start Adventure', { timeout: 10_000 });
  await gameButton.click();
  await expect(gameButton).toHaveText('Adventure Started!', { timeout: 10_000 });

  const canvas = page.locator('#game-view canvas');
  await canvas.focus();
  await page.keyboard.down('d');
  await expect(page.locator('#game-view .game-ui-overlay')).toContainText('Player position:', { timeout: 10_000 });
  await page.keyboard.up('d');
  await expect(page.locator('#console .error')).toHaveCount(0);

  await page.locator('#stop').click();
  await expect(page.locator('#mode')).toHaveText('Editing');
  await page.reload();
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase');
  await expect(page.getByRole('tree')).toContainText('Tilemap Wall');
  await page.locator('#scene-tab').click();
  await page.getByRole('treeitem', { name: /Start Button$/ }).click();
  const sceneUiOverlay = page.locator('#viewport .scene-ui-overlay');
  const sceneUiButtonAfterReload = page.locator('#viewport .scene-ui-overlay [data-entity-id="start-button"]');
  const uiButtonBeforeZoom = await sceneUiButtonAfterReload.boundingBox(); if (!uiButtonBeforeZoom) throw new Error('Scene UI button is not visible after reload.');
  await page.locator('#scene-zoom-in').click();
  const uiButtonAfterZoom = await sceneUiButtonAfterReload.boundingBox(); if (!uiButtonAfterZoom) throw new Error('Scene UI button disappeared after zoom.');
  expect(uiButtonAfterZoom.width).toBeGreaterThan(uiButtonBeforeZoom.width);
  const selectionMarkerAfterZoom = await page.locator('#viewport .scene-selection-marker').boundingBox(); if (!selectionMarkerAfterZoom) throw new Error('UI selection marker is not visible after zoom.');
  expect(Math.abs(selectionMarkerAfterZoom.x - uiButtonAfterZoom.x)).toBeLessThan(3);
  expect(Math.abs(selectionMarkerAfterZoom.y - uiButtonAfterZoom.y)).toBeLessThan(3);
  expect(Math.abs(selectionMarkerAfterZoom.width - uiButtonAfterZoom.width)).toBeLessThan(4);
  expect(Math.abs(selectionMarkerAfterZoom.height - uiButtonAfterZoom.height)).toBeLessThan(4);
  await page.mouse.click(uiButtonAfterZoom.x + uiButtonAfterZoom.width / 2, uiButtonAfterZoom.y + uiButtonAfterZoom.height / 2);
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Start Button');
  await expect(sceneUiOverlay).toBeVisible();
});

test('Pong opens as an editable project with a script, event graph and UI score', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await clickTopbarAction(page, '#project-pong');
  await expect(page.locator('#project-name-current')).toHaveText('Pong', { timeout: 30_000 });
  await expect(page.locator('.asset-row').filter({ hasText: 'Pong-White.png' })).toBeVisible();
  await expect(page.locator('.asset-row').filter({ hasText: 'Pong-Center-Line.png' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Center Line$/ })).toHaveCount(1);
  await expect(page.locator('#viewport .scene-ui-overlay')).toContainText('PONG');
  await expect(page.locator('#viewport .scene-ui-overlay')).toContainText('0');
  await page.getByRole('treeitem', { name: /Game Controller$/ }).click();
  await page.locator('#code-tab').click();
  await expect(page.locator('#script-file')).toContainText('scripts/pong.ts');
  await page.locator('#nodes-tab').click();
  await expect(page.locator('#graph-editor .graph-node-event-onEvent')).toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('#game-view canvas')).toBeVisible();
  const leftScore = page.locator('#game-view .game-ui-overlay [data-entity-id="score-left"]');
  const rightScore = page.locator('#game-view .game-ui-overlay [data-entity-id="score-right"]');
  await page.waitForTimeout(1_600);
  await expect(leftScore).toHaveText('0'); await expect(rightScore).toHaveText('0');
  await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w');
  await expect.poll(async () => Number(await leftScore.textContent()) + Number(await rightScore.textContent()), { timeout: 6_000 }).toBeGreaterThan(0);
  await expect.poll(() => errors).toEqual([]);
  await page.locator('#stop').click();
});

test('versioned editor plugin registers and unloads components, scripts, importers and panels', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const toggle = page.locator('#example-plugin-toggle');
  await clickTopbarAction(page, '#example-plugin-toggle');
  await expect(toggle).toHaveText('Unload Example Plugin');
  const pluginTab = page.getByRole('button', { name: 'Plugin Demo' });
  await pluginTab.click();
  await expect(page.getByText('Hello from the example plugin')).toBeVisible();

  const inspector = page.locator('#component-inspector');
  const addComponent = inspector.getByLabel('Component to add');
  await expect(addComponent.locator('option[value="example.plugin-note"]')).toHaveCount(1);
  await addComponent.selectOption('example.plugin-note');
  const pluginComponent = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Plugin Note' }) });
  await expect(pluginComponent.getByLabel('Text')).toHaveValue('Hello from a plugin');

  await page.locator('#asset-import').setInputFiles({ name: 'badge.as-png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.locator('#asset-list')).toContainText('Textures/badge.png');

  await clickTopbarAction(page, '#example-plugin-toggle');
  await expect(page.locator('#console')).toContainText('Remove plugin component');
  await expect(toggle).toHaveText('Unload Example Plugin');
  await pluginComponent.getByTitle('Remove Plugin Note').click();
  await clickTopbarAction(page, '#example-plugin-toggle');
  await expect(toggle).toHaveText('Load Example Plugin');
  await expect(page.getByRole('button', { name: 'Plugin Demo' })).toHaveCount(0);
  await expect(addComponent.locator('option[value="example.plugin-note"]')).toHaveCount(0);
});

test('built-in Getting Started guide opens as an editor panel and drives editor actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#getting-started-open');
  const guide = page.locator('.plugin-panel[data-plugin-panel-id="editor.getting-started"]');
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  await guide.getByRole('button', { name: 'Open Code' }).click();
  await expect(page.locator('#code-view')).toBeVisible();
  await guide.getByRole('button', { name: 'Open Nodes' }).click();
  await expect(page.locator('#nodes-view')).toBeVisible();
  await guide.getByRole('button', { name: 'Open Scene' }).click();
  await expect(page.locator('#viewport')).toBeVisible();
  await guide.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#stop')).toBeEnabled().catch(async error => { throw new Error(`${String(error)}\nEditor console: ${await page.locator('#console').innerText()}`); });
  await page.locator('#stop').click();
  await page.locator('#assets-tab').click();
  await expect(guide).toBeHidden();
  await clickTopbarAction(page, '#getting-started-open');
  await expect(guide).toBeVisible();
});

test('Getting Started guide can load Pong when the user chooses an example', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#getting-started-open');
  const guide = page.locator('.plugin-panel[data-plugin-panel-id="editor.getting-started"]');
  await guide.getByRole('button', { name: 'Load Pong' }).click();
  await expect(page.locator('#project-name-current')).toHaveText('Pong', { timeout: 30_000 });
  await clickTopbarAction(page, '#getting-started-open');
  await expect(guide).toBeVisible();
});

test('audio assets preview and play from a scene Audio Source with mixer groups', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40); wav[44] = 128; wav[45] = 128;
  await page.locator('#asset-import').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
  const audioAsset = page.getByRole('option', { name: /tone\.wav/ });
  await expect(audioAsset).toBeEnabled();
  await audioAsset.click();
  await page.locator('#assets-tab').click();
  await page.locator('#component-inspector').getByRole('combobox', { name: 'Component to add' }).selectOption('engine.audioSource2d');
  const audioSource = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Audio Source 2D' }) });
  await audioSource.getByLabel('Audio Clip').selectOption({ label: 'Audio/tone.wav' });
  await audioSource.getByLabel('Play On Start').check();
  await page.locator('#audio-tab').click();
  await page.locator('#audio-music-volume').evaluate(element => { const input = element as HTMLInputElement; input.value = '0.4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#audio-music-value')).toHaveText('40%');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await expect(page.locator('#audio-status')).toHaveText('Audio ready');
  await page.waitForTimeout(100);
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('UI components edit in Inspector, scale in Game view and deliver button events to scripts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const inspector = page.locator('#component-inspector');
  await inspector.getByLabel('Component to add').selectOption('engine.uiCanvas');
  const canvasGroup = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'UI Canvas' }) });
  await expect(canvasGroup.getByLabel('Reference Width')).toHaveValue('800');
  await inspector.getByLabel('Component to add').selectOption('engine.uiButton');
  const buttonGroup = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'UI Button' }) });
  await buttonGroup.getByLabel('Label').fill('Start Game');
  await expect(buttonGroup.getByLabel('Anchor Min X')).toHaveValue('0');
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  await inspector.getByLabel('Component to add').selectOption('engine.uiText');
  const textGroup = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'UI Text' }) });
  await textGroup.getByLabel('Text', { exact: true }).fill('Score: 0');
  await textGroup.getByLabel('Offset Min X').fill('220');
  await textGroup.getByLabel('Offset Max X').fill('500');
  await textGroup.getByLabel('Offset Max Y').fill('64');
  await page.getByRole('treeitem', { name: '◇  Ground', exact: true }).click();
  await inspector.getByLabel('Component to add').selectOption('engine.uiImage');
  const imageGroup = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'UI Image' }) });
  await imageGroup.getByRole('combobox').first().selectOption({ index: 1 });
  await imageGroup.getByLabel('Offset Min Y').fill('110');
  await imageGroup.getByLabel('Offset Max Y').fill('220');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();

  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus(); await page.keyboard.press('Control+A');
  await page.keyboard.insertText("function update(api: engine.ScriptApi) {\n  api.subscribe('ui.button.clicked');\n  const button = api.getComponent('engine.uiButton');\n  if (!button) return;\n  for (const event of api.events) if (event.type === 'ui.button.clicked') api.setComponent('engine.uiButton', { ...button, disabled: true });\n}");
  await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Backspace');
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  const gameButton = page.locator('#game-view .game-ui-overlay button');
  await expect(gameButton).toHaveText('Start Game', { timeout: 30_000 });
  await expect(page.locator('#game-view .game-ui-overlay')).toContainText('Score: 0');
  await expect(page.locator('#game-view .game-ui-overlay img')).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
  await gameButton.click();
  await expect(gameButton).toBeDisabled({ timeout: 10_000 });
  await page.locator('#stop').click();
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'UI Button' }) }).getByLabel('Disabled')).not.toBeChecked();
});

test('Script Binding selects project code and graphs and can create a new resource', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const binding = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Script Binding' }) });
  const codePath = binding.getByLabel('Code File', { exact: true });
  const graphPath = binding.getByLabel('Node Graph', { exact: true });
  await expect(codePath).toHaveValue('scripts/player.ts');
  await expect(codePath.locator('option')).toContainText(['scripts/player.ts']);
  await expect(graphPath).toHaveValue('scripts/player.graph.json');
  page.once('dialog', dialog => dialog.accept('scripts/companion.ts'));
  await binding.getByRole('button', { name: 'Create a script file' }).click();
  await expect(codePath).toHaveValue('scripts/companion.ts');
  await expect(codePath.locator('option')).toContainText(['scripts/companion.ts']);
  page.once('dialog', dialog => dialog.accept('scripts/companion.graph.json'));
  await binding.getByRole('button', { name: 'Create a node graph' }).click();
  await expect(graphPath).toHaveValue('scripts/companion.graph.json');
  await page.locator('#nodes-tab').click();
  await expect(page.locator('.graph-node')).toHaveCount(2);
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  const crateInspector = page.locator('#component-inspector');
  await crateInspector.getByLabel('Component to add').selectOption('engine.scriptBinding');
  const crateBinding = crateInspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Script Binding' }) });
  page.once('dialog', dialog => dialog.accept('scripts/loaded.ts'));
  await crateBinding.getByRole('button', { name: 'Create a script file' }).click();
  await expect(page.locator('#script-file option')).toContainText(['scripts/loaded.ts']);
  await clickTopbarAction(page, '#project-save');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const restored = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Script Binding' }) });
  await expect(restored.getByLabel('Code File', { exact: true })).toHaveValue('scripts/companion.ts');
  await expect(restored.getByLabel('Node Graph', { exact: true })).toHaveValue('scripts/companion.graph.json');
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Script Binding' }) }).getByLabel('Code File', { exact: true })).toHaveValue('scripts/loaded.ts');
});

test('Play routes keyboard actions to the game and releases them on keyup', async ({ page }) => {
  await page.goto('/');
  await page.locator('#console-tab').click();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  const canvas = page.locator('#game-view canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate(element => document.activeElement === element)).toBe(true);
  await page.keyboard.down('d');
  await page.waitForTimeout(500);
  await page.keyboard.up('d');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas has no visible bounds.');
  await page.mouse.click(bounds.x + bounds.width * 0.53, bounds.y + bounds.height * 0.52);
  await expect(page.locator('#object-name')).toHaveText('Player');
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('Play runs a copied scene, pause and step use fixed ticks, and Stop restores editing', async ({ page }) => {
  await page.goto('/');
  await page.locator('#console-tab').click();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const y = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Y', exact: true });
  await y.fill('4');
  await y.press('Tab');
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await expect(y).toBeDisabled();
  const game = page.locator('#game-view');
  await expect.poll(async () => Number(await game.getAttribute('data-simulation-tick'))).toBeGreaterThan(1);
  await page.locator('#pause').click();
  await expect(page.locator('#mode')).toHaveText('Paused');
  const pausedTick = Number(await game.getAttribute('data-simulation-tick'));
  await page.waitForTimeout(120);
  await expect(game).toHaveAttribute('data-simulation-tick', String(pausedTick));
  await page.locator('#step').click();
  await expect(game).toHaveAttribute('data-simulation-tick', String(pausedTick + 1));
  await page.locator('#stop').click();
  await expect(page.locator('#mode')).toHaveText('Editing');
  await expect(y).toHaveValue('4');
  await expect(y).toBeEnabled();
  await expect(game).toHaveAttribute('data-simulation-tick', '0');
  await expect(game.locator('canvas')).toHaveCount(1);
  await page.locator('#play').click(); await expect(page.locator('#mode')).toHaveText('Playing');
  await page.locator('#stop').click(); await expect(game.locator('canvas')).toHaveCount(1);
});

test('a busy worker is terminated while editor selection remains responsive', async ({ page }) => {
  await page.goto('/');
  await page.locator('#console-tab').click();
  await page.locator('#script-loop').click();
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  await expect(page.locator('#object-name')).toHaveText('Crate');
  await expect(page.locator('#console')).toContainText('was terminated', { timeout: 10_000 });
  await page.locator('#script-success').click();
  await expect(page.locator('#console')).toContainText('Worker returned: 42');
  await page.locator('#script-error').click();
  await expect(page.locator('#console')).toContainText('Intentional script error');
});

test('project scripts run with an opaque origin and blocked storage and network', async ({ page }) => {
  await page.goto('/');
  await page.locator('#console-tab').click();
  await page.locator('#script-probe').click();
  await expect(page.locator('#console')).toContainText('"origin":"null"', { timeout: 10_000 });
  await expect(page.locator('#console')).toContainText('"document":"undefined"');
  await expect(page.locator('#console')).toContainText('"storage":"SecurityError"');
  await expect(page.locator('#console')).toContainText('"networkBlocked":true');
  await page.locator('#script-success').click();
  await expect(page.locator('#console')).toContainText('Worker returned: 42');
  await page.locator('#script-success').click();
  await expect(page.locator('#console').locator('.log', { hasText: 'Worker returned: 42' })).toHaveCount(2);
  await page.locator('#script-data').click();
  await expect(page.locator('#console')).toContainText('Sandbox data copy: {"result":9,"originalScore":3}');
  await page.locator('#script-clone-error').click();
  await expect(page.locator('#console')).toContainText('Script result must be JSON serializable.');
  await page.locator('#script-data-limit').click();
  await expect(page.locator('#console')).toContainText('Sandbox payload limits: {"inputLimited":true,"resultLimited":true}');
  await page.locator('#script-cancel').click();
  await expect(page.locator('#console')).toContainText('Script cancelled.', { timeout: 10_000 });
});

test('sandbox worker startup errors are relayed and the temporary frame is removed', async ({ page }) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    if (!descriptor?.set || !descriptor.get) throw new Error('srcdoc property cannot be instrumented in this browser.');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true,
      get() { return descriptor.get!.call(this); },
      set(value: string) { descriptor.set!.call(this, value.replace('worker = new Worker(workerUrl);', "throw new Error('simulated worker startup failure');")); },
    });
  });
  await page.goto('/');
  await page.locator('#console-tab').click();
  await page.locator('#script-success').click();
  await expect(page.locator('#console')).toContainText('simulated worker startup failure', { timeout: 10_000 });
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});

test('Monaco offers component-schema generated engine API completion', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type("\nconst api: engine.ScriptApi = {} as engine.ScriptApi;\napi.getComponent('");
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('engine.transform2d', { timeout: 30_000 });
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('function update(api: engine.ScriptApi) { api.input.actions.');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('moveX', { timeout: 30_000 });
});

test('Monaco resolves completion from other project script files', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  page.once('dialog', dialog => dialog.accept('scripts/helper.ts'));
  await page.locator('#script-new-file').click();
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.type('const sharedSpeed = 13;');
  await page.locator('#script-search').fill('sharedSpeed');
  await page.locator('#script-search-button').click();
  await page.locator('#script-search-results').getByRole('listitem').click();
  await expect(page.locator('#script-file')).toHaveValue('scripts/helper.ts');
  await page.locator('#script-file').selectOption('scripts/player.ts');
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nsharedSpe');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('sharedSpeed', { timeout: 30_000 });
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('function update(api: engine.ScriptApi) { api.state = { speed: sharedSpeed }; }');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  await page.locator('#stop').click();
  await page.locator('#code-tab').click();
  page.once('dialog', dialog => dialog.accept('scripts/player.js'));
  await page.locator('#script-new-file').click();
  await editor.focus();
  await page.keyboard.type('function update(api) { api.state = { speed: sharedSpeed }; }');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  await page.locator('#stop').click();
});

test('visual graph canvas previews events, adds undoable nodes and runs alongside code in Play', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nodes-tab').click();
  await expect(page.locator('#graph-editor')).toBeVisible();
  await expect(page.locator('.graph-wire-legend')).toContainText('Flow');
  await expect(page.locator('.graph-wire-legend')).toContainText('Values are type-colored');
  await expect(page.locator('.graph-node-event-subscribe .graph-node-description')).toContainText('Flow continues immediately');
  await expect(page.getByRole('combobox', { name: 'Node type' }).locator('optgroup')).toHaveCount(4);
  await expect(page.locator('.graph-link')).toHaveCount(5);
  await page.locator('#graph-run').click();
  await expect(page.locator('#console')).toContainText('Visual graph preview: {"variables":{},"commands":0,"events":0}');
  await page.getByRole('combobox', { name: 'Node type' }).selectOption('flow.branch');
  await page.getByRole('button', { name: '＋ Add Node' }).click();
  await expect(page.locator('.graph-node-flow-branch')).toHaveCount(1);
  await page.locator('.graph-toolbar').getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('.graph-node-flow-branch')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Node type' }).selectOption('input.action');
  await page.getByRole('button', { name: '＋ Add Node' }).click();
  await expect(page.locator('.graph-node-input-action')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Input action' })).toHaveValue('jump');
  await page.locator('.graph-toolbar').getByRole('button', { name: '↶ Undo' }).click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await expect(page.locator('#console')).toContainText('Play mode started with 1 scene script binding');
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(2);
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('visual graph connects from typed ports, follows dragged nodes, and removes wires by clicking', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nodes-tab').click();
  const firstWire = page.locator('.graph-link').first();
  await expect(firstWire).toHaveCount(1);
  const initialPath = await firstWire.getAttribute('d');
  const header = page.locator('.graph-node-event-onStart .graph-node-title');
  const headerBox = await header.boundingBox(); if (!headerBox) throw new Error('On Update node is not visible.');
  await page.mouse.move(headerBox.x + 45, headerBox.y + 12); await page.mouse.down(); await page.mouse.move(headerBox.x + 95, headerBox.y + 42);
  await expect.poll(() => firstWire.getAttribute('d')).not.toBe(initialPath);
  await page.mouse.up();

  await page.getByRole('combobox', { name: 'Node type' }).selectOption('flow.end');
  await page.getByRole('button', { name: '＋ Add Node' }).click();
  const addedEnd = page.locator('.graph-node-flow-end').last();
  await addedEnd.getByRole('button', { name: 'flow input exec on End' }).click();
  await expect(page.locator('.graph-status')).toContainText('Choose an output port first.');
  await page.getByRole('button', { name: 'flow output then on On Update' }).click();
  await expect(page.locator('.graph-status')).toContainText('Choose a flow input');
  await addedEnd.getByRole('button', { name: 'flow input exec on End' }).click();
  await expect(page.locator('.graph-link')).toHaveCount(6);
  const createdWire = page.locator('.graph-link').last();
  await createdWire.evaluate(path => path.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(page.locator('.graph-link')).toHaveCount(5);
  await expect(page.locator('.graph-status')).toHaveText('Connection removed.');
});

test('scene bindings run separate scripts and node graphs with explicit cross-entity component commands', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#nodes-tab').click();
  await expect(page.locator('.graph-node')).toHaveCount(8);
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  const inspector = page.locator('#component-inspector');
  await inspector.getByRole('combobox', { name: 'Component to add' }).selectOption('engine.scriptBinding');
  const binding = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Script Binding' }) });
  page.once('dialog', dialog => dialog.accept('scripts/crate.ts'));
  await binding.getByRole('button', { name: 'Create a script file' }).click();
  await expect(binding.getByLabel('Code File', { exact: true })).toHaveValue('scripts/crate.ts');

  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.type("function update(api: engine.ScriptApi) { const transform = api.getComponent('engine.transform2d'); if (transform) api.setComponent('engine.transform2d', { ...transform, y: transform.y - 0.01 }); }");
  await page.getByRole('treeitem', { name: '◇  Player' }).click();
  await editor.focus(); await page.keyboard.press('Control+A');
  await page.keyboard.type("function update(api: engine.ScriptApi) { const target = api.getEntityComponent('crate', 'engine.transform2d'); if (target) api.setEntityComponent('crate', 'engine.transform2d', { ...target, x: target.x + 0.01 }); }");
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  await expect(page.locator('#console')).toContainText('Play mode started with 2 scene script bindings');
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(2);
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('code edits are autosaved with the project and restored after reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const textarea = page.locator('.monaco-editor textarea').first();
  await textarea.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('// saved-script-check\nfunction update(api: engine.ScriptApi) {}');
  await page.locator('#script-speed').fill('7.5');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  await expect(page.locator('.monaco-editor')).toContainText('saved-script-check');
  await expect(page.locator('#script-speed')).toHaveValue('7.5');
});

test('Play stops a script that loops forever without changing the edited scene', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('function update(api: engine.ScriptApi) { while (true) {} }');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#console')).toContainText('Script exceeded 500 ms', { timeout: 30_000 });
  await expect(page.locator('#mode')).toHaveText('Editing');
  await expect(page.locator('#play')).toBeEnabled();
});

test('TypeScript compile errors identify the project file and line before Play starts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('function update(api: engine.ScriptApi) {\n  const broken: = 3;\n}');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#console')).toContainText('scripts/player.ts:2', { timeout: 30_000 });
  await expect(page.locator('#mode')).toHaveText('Editing');
});

test('runtime exceptions point back to player.ts and stop the Play copy', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('function update(api: engine.ScriptApi) { throw new Error("runtime-marker"); }');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect(page.locator('#console')).toContainText('runtime-marker', { timeout: 30_000 });
  await expect(page.locator('#console')).toContainText('scripts/player.ts:1', { timeout: 10_000 });
  await expect(page.locator('#mode')).toHaveText('Editing');
  await page.locator('#console-tab').click();
  await page.locator('.source-link[aria-label="Open scripts/player.ts:1"]').last().click();
  await expect(page.locator('#code-tab')).toHaveAttribute('aria-pressed', 'true');
});

test('scene hierarchy and schema inspector edit the same ECS-backed scene', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: '◇  Player' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  await expect(page.locator('#object-name')).toHaveText('Crate');
  const x = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('3.5');
  await x.press('Tab');
  await page.getByRole('button', { name: '◇ Scene' }).click();
  await expect(page.locator('#scene-label')).toBeVisible();
  await page.getByRole('button', { name: '▷ Game' }).click();
  await expect(page.locator('#game-view canvas')).toBeVisible();
});

test('Inspector uses a color picker and a choice list for typed schema fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const sprite = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Sprite Renderer 2D' }) });
  const tint = sprite.getByLabel('Tint');
  await expect(tint).toHaveAttribute('type', 'color');
  await tint.fill('#123456'); await tint.press('Tab');
  await expect(tint).toHaveValue('#123456');
  const nameGroup = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) });
  await nameGroup.locator('.component-toggle').click();
  await expect(nameGroup.getByLabel('Name', { exact: true })).toBeHidden();
  const physics = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Physics 2D' }) });
  const bodyType = physics.getByLabel('Body Type');
  await expect(bodyType).toHaveJSProperty('tagName', 'SELECT');
  await expect(bodyType.locator('option')).toHaveText(['Dynamic', 'Fixed']);
  await bodyType.selectOption('Fixed');
  const rerenderedNameGroup = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) });
  await expect(rerenderedNameGroup.locator('.component-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(rerenderedNameGroup.getByLabel('Name', { exact: true })).toBeHidden();
});

test('Inspector can add and remove schema-backed components', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const inspector = page.locator('#component-inspector');
  await expect(inspector.locator('button[title="Remove Name"]')).toHaveCount(0);
  await inspector.locator('button[title="Remove Collider 2D"]').click();
  await inspector.getByLabel('Component to add').selectOption('engine.collider2d');
  const collider = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Collider 2D' }) });
  await expect(collider.getByLabel('Shape')).toHaveJSProperty('tagName', 'SELECT');
  await expect(collider.getByLabel('Is Trigger')).toHaveAttribute('type', 'checkbox');
  await expect(collider.getByLabel('Friction')).toHaveValue('0.7');
  const collapse = collider.locator('.component-toggle');
  await expect(collapse).toHaveAccessibleName('Collapse Collider 2D');
  const removeMargin = await collider.locator('button[title="Remove Collider 2D"]').evaluate(button => Number.parseFloat(getComputedStyle(button).marginLeft));
  expect(removeMargin).toBeGreaterThan(0);
  await collapse.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'false');
  await expect(collider.getByLabel('Friction')).toBeHidden();
  await expect(collapse).toHaveAccessibleName('Expand Collider 2D');
  await collapse.click();
  await expect(collider.getByLabel('Friction')).toBeVisible();
  await collider.locator('button[title="Remove Collider 2D"]').click();
  await expect(inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Collider 2D' }) })).toHaveCount(0);
});

test('tilemap tools follow the selected object while general workbench panels remain available', async ({ page }) => {
  await page.goto('/');
  await clickTopbarAction(page, '#project-showcase');
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase', { timeout: 30_000 });

  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await expect(page.locator('#tilemap-tools')).toBeHidden();
  await expect(page.locator('#tilemap-tab')).toBeHidden();
  await expect(page.locator('#assets-tab')).toBeVisible();
  await expect(page.locator('#console-tab')).toBeVisible();

  await page.getByRole('treeitem', { name: /Tilemap Wall$/ }).click();
  await expect(page.locator('#tilemap-tools')).toBeVisible();
  await expect(page.locator('#tilemap-tab')).toBeVisible();
  await page.locator('#tilemap-tab').click();
  await expect(page.locator('#tilemap-panel')).toBeVisible();

  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await expect(page.locator('#tilemap-tools')).toBeHidden();
  await expect(page.locator('#tilemap-tab')).toBeHidden();
  await expect(page.locator('#tilemap-panel')).toBeHidden();
  await expect(page.locator('#assets-panel')).toBeVisible();
});

test('stopping Play preserves the rendered rotation of a tilemap cell', async ({ page }) => {
  await page.goto('/');
  await clickTopbarAction(page, '#project-showcase');
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase', { timeout: 30_000 });
  await page.getByRole('treeitem', { name: /Tilemap Wall$/ }).click();

  const transform = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) });
  await transform.getByRole('spinbutton', { name: 'Rotation (radians)' }).fill('0.6');
  await transform.getByRole('spinbutton', { name: 'Rotation (radians)' }).press('Tab');

  const asymmetricTile = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, 16, 6);
    return await new Promise<string>(resolve => canvas.toBlob(blob => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.readAsDataURL(blob!);
    }, 'image/png'));
  });
  await page.locator('#asset-import').setInputFiles({ name: 'asymmetric-tile.png', mimeType: 'image/png', buffer: Buffer.from(asymmetricTile, 'base64') });
  await page.locator('#tilemap-tab').click();
  await selectTileImage(page, 'Textures/asymmetric-tile.png');
  await page.locator('#tile-definition-add').click();
  await page.locator('#tile-paint').click();
  const sceneCanvas = await page.locator('#viewport canvas').boundingBox();
  if (!sceneCanvas) throw new Error('Scene viewport is not visible.');
  await page.mouse.click(sceneCanvas.x + sceneCanvas.width / 2 + 6.4 * 45, sceneCanvas.y + sceneCanvas.height / 2 + 45);

  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing', { timeout: 30_000 });
  await page.waitForTimeout(250);
  const gameCanvas = await page.locator('#game-view canvas').boundingBox();
  if (!gameCanvas) throw new Error('Game view is not visible.');
  const tileCrop = { x: gameCanvas.x + gameCanvas.width / 2 + 6.4 * 45 - 30, y: gameCanvas.y + gameCanvas.height / 2 + 45 - 30, width: 60, height: 60 };
  const beforeStop = await page.screenshot({ clip: tileCrop });
  const sampleTile = (base64: string) => page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return [20, 25, 30, 35, 40].flatMap(y => [20, 25, 30, 35, 40].map(x => {
      const pixel = context.getImageData(x, y, 1, 1).data;
      return pixel[1]! > pixel[0]! * 1.2;
    }));
  }, base64);
  const beforePattern = await sampleTile(beforeStop.toString('base64'));
  expect(beforePattern.some(Boolean)).toBe(true);
  expect(beforePattern.some(value => !value)).toBe(true);
  await page.locator('#stop').click();
  await page.waitForTimeout(80);
  const restoredCanvas = await page.locator('#game-view canvas').boundingBox();
  if (!restoredCanvas) throw new Error('Game viewport disappeared after Stop.');
  const afterStop = await page.screenshot({ clip: { ...tileCrop, x: tileCrop.x + restoredCanvas.x - gameCanvas.x, y: tileCrop.y + restoredCanvas.y - gameCanvas.y } });
  const afterPattern = await sampleTile(afterStop.toString('base64'));
  const mismatches = beforePattern.filter((value, index) => value !== afterPattern[index]).length;
  if (mismatches > 2) { await writeFile(test.info().outputPath('before-stop.png'), beforeStop); await writeFile(test.info().outputPath('after-stop.png'), afterStop); }
  expect(mismatches).toBeLessThanOrEqual(2);
});

test('tilemap layers paint, undo, collide in Play, and survive project reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#asset-import').setInputFiles({ name: 'ground.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') });
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Player');
  const inspector = page.locator('#component-inspector');
  await inspector.getByLabel('Component to add').selectOption('engine.tilemap2d');
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Player');
  await expect(page.locator('#viewport .tilemap-grid-overlay')).toBeVisible();
  const mapInspector = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Tilemap 2D' }) });
  await mapInspector.getByLabel('Width').fill('8'); await mapInspector.getByLabel('Width').press('Tab');
  await expect(mapInspector.getByLabel('Width')).toHaveValue('8');
  await page.locator('#tilemap-tab').click();
  await selectTileImage(page, 'Textures/ground.png');
  await page.locator('#tile-definition-add').click();
  await expect(page.locator('#tile-definition-list .tile-definition')).toHaveCount(1);
  await page.locator('#tile-neighbor-group').fill('ground'); await page.locator('#tile-neighbor-group').press('Tab');
  await page.locator('#tile-definition-add').click();
  await page.locator('#tile-neighbor-group').fill('ground'); await page.locator('#tile-neighbor-group').press('Tab');
  await page.locator('#tile-variant-mask').selectOption('1');
  await page.locator('#tile-variant-tile').selectOption({ index: 0 });
  await page.locator('#tile-variant-set').click();
  await expect(page.locator('#tile-variant-list .tile-variant-row')).toHaveCount(1);
  await page.locator('#tile-definition-list .tile-definition').nth(0).click();
  await expect(page.locator('#tile-definition-list .tile-definition')).toHaveCount(2);
  await page.locator('#tile-layer-add').click();
  await expect(page.locator('#tile-layer option')).toHaveCount(2);
  await page.locator('#tile-layer').selectOption({ index: 0 });
  await page.locator('#tile-asset').selectOption({ index: 1 });
  await page.locator('#tile-paint').click();
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('Scene viewport is not visible.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const paintedCells = page.locator('#tile-definition-help');
  await expect(paintedCells).toHaveAttribute('data-painted-cells', '1');
  await page.locator('#undo').click();
  await expect(paintedCells).toHaveAttribute('data-painted-cells', '0');
  await page.locator('#redo').click();
  await expect(paintedCells).toHaveAttribute('data-painted-cells', '1');
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await page.locator('#stop').click();
  await clickTopbarAction(page, '#project-save');
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await page.locator('#tilemap-tab').click();
  await expect(page.locator('#tile-definition-list .tile-definition')).toHaveCount(2);
  await expect(page.locator('#tile-definition-help')).toHaveAttribute('data-painted-cells', '1');
  await expect(page.locator('#tile-neighbor-group')).toHaveValue('ground');
  await page.locator('#tile-definition-list .tile-definition').nth(1).click();
  await expect(page.locator('#tile-variant-list .tile-variant-row')).toHaveCount(1);
});

test('animation editor saves clips, sprite frames, property keys, and starts playback in Play', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  const inspector = page.locator('#component-inspector');
  await inspector.getByLabel('Component to add').selectOption('engine.spriteAnimation2d');
  await page.locator('#animation-tab').click();
  await page.locator('#animation-clip-add').click();
  await page.locator('#animation-clip-name').fill('Walk'); await page.locator('#animation-clip-name').press('Tab');
  await page.locator('#animation-frame-asset').selectOption({ index: 0 });
  await page.locator('#animation-frame-add').click();
  await page.locator('#animation-frame-add').click();
  await page.locator('#animation-frames .animation-frame-row').getByRole('button', { name: 'Move frame 2 earlier' }).click();
  const firstFrameDuration = page.locator('#animation-frames .animation-frame-row').nth(0).getByLabel('Frame 1 duration');
  await firstFrameDuration.fill('0.25'); await firstFrameDuration.press('Tab');
  await page.locator('#animation-property').selectOption('engine.transform2d.x');
  await page.locator('#animation-key-time').fill('0'); await page.locator('#animation-key-value').fill('0'); await page.locator('#animation-key-add').click();
  await page.locator('#animation-key-time').fill('1'); await page.locator('#animation-key-value').fill('4'); await page.locator('#animation-key-add').click();
  await expect(page.locator('#animation-clip-list .animation-clip-card')).toContainText('Walk');
  await expect(page.locator('#animation-frames .animation-frame-row')).toHaveCount(2);
  await expect(page.locator('#animation-timeline .animation-key-row')).toHaveCount(2);
  const firstKeyValue = page.locator('#animation-timeline .animation-key-row').nth(0).getByLabel('Key 1 value');
  await firstKeyValue.fill('2'); await firstKeyValue.press('Tab');
  await clickTopbarAction(page, '#project-save');
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await page.locator('#stop').click();
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await page.locator('#animation-tab').click();
  await expect(page.locator('#animation-clip-list .animation-clip-card')).toContainText('Walk');
  await expect(page.locator('#animation-frames .animation-frame-row')).toHaveCount(2);
  await expect(page.locator('#animation-frames .animation-frame-row').nth(0).getByLabel('Frame 1 duration')).toHaveValue('0.25');
  await expect(page.locator('#animation-timeline .animation-key-row')).toHaveCount(2);
  await expect(page.locator('#animation-timeline .animation-key-row').nth(0).getByLabel('Key 1 value')).toHaveValue('2');
});

test('sprite atlas editor slices and marks regions used by sprites, animation frames and tiles', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#project-showcase');
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase', { timeout: 30_000 });
  await page.locator('#atlas-create').click();
  const picker = page.locator('#atlas-picker-dialog'); await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Create Atlas from Default\.png/ }).click();
  const dialog = page.locator('#sprite-atlas-dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Zoom in atlas' })).toBeVisible();
  await expect(dialog.locator('#atlas-zoom-value')).toHaveText('100%');
  await expect(dialog).toHaveCSS('resize', 'both');
  const regionsPanel = dialog.locator('#atlas-regions-panel');
  const resizeRegions = dialog.getByRole('separator', { name: 'Resize Atlas Regions panel' });
  const initialRegions = (await regionsPanel.boundingBox())!;
  const separator = (await resizeRegions.boundingBox())!;
  await page.mouse.move(separator.x + separator.width / 2, separator.y + 40);
  await page.mouse.down(); await page.mouse.move(separator.x + separator.width / 2 - 80, separator.y + 40); await page.mouse.up();
  expect((await regionsPanel.boundingBox())!.width).toBeCloseTo(initialRegions.width + 80, 0);
  await resizeRegions.press('ArrowRight');
  expect((await regionsPanel.boundingBox())!.width).toBeCloseTo(initialRegions.width + 60, 0);
  await resizeRegions.dblclick();
  expect((await regionsPanel.boundingBox())!.width).toBeCloseTo(initialRegions.width, 0);
  const canvasWrap = (await dialog.locator('#atlas-canvas-wrap').boundingBox())!;
  expect(canvasWrap.x + canvasWrap.width).toBeLessThanOrEqual((await regionsPanel.boundingBox())!.x);

  await dialog.getByRole('button', { name: 'Zoom in atlas' }).click();
  await expect(dialog.locator('#atlas-zoom-value')).toHaveText('125%');
  await dialog.getByRole('button', { name: 'Fit' }).click();
  const fitBox = (await dialog.locator('#atlas-canvas').boundingBox())!;
  await page.mouse.move(fitBox.x + 1, fitBox.y + 1); await page.mouse.wheel(0, -100);
  await expect(dialog.locator('#atlas-zoom-value')).toHaveText('115%');
  await dialog.getByRole('button', { name: 'Fit' }).click();
  await dialog.locator('#atlas-slice-grid').click();
  await expect(dialog.locator('.atlas-region-row')).toHaveCount(1);
  const canvas = dialog.locator('#atlas-canvas');
  await canvas.evaluate(node => { (node as HTMLCanvasElement).style.width = '128px'; (node as HTMLCanvasElement).style.height = '128px'; });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 1); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.up();
  await dialog.locator('#atlas-add-region').click();
  await expect(dialog.locator('.atlas-region-row')).toHaveCount(2);
  await dialog.locator('.atlas-region-row').nth(1).click({ position: { x: 1, y: 1 } });
  await expect(dialog.locator('.atlas-region-row').nth(1)).toHaveClass(/selected/);
  await dialog.locator('#atlas-save').click(); await expect(dialog).toBeHidden();
  await page.locator('#atlas-create').click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Edit Atlas from Default\.png/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#atlas-dialog-title')).toContainText('Edit Sprite Atlas');
  await expect(dialog.locator('.atlas-region-row')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close atlas editor' }).click();
  await page.getByRole('treeitem', { name: /Player$/ }).click();
  await page.locator('#component-inspector').getByLabel('Texture').selectOption({ label: 'Textures/Default.png' });
  const atlasRegion = page.locator('#component-inspector').getByLabel('Atlas Region');
  const spriteRegionValue = await atlasRegion.locator('option').filter({ hasText: /Sprite 1/ }).first().getAttribute('value');
  await atlasRegion.selectOption(spriteRegionValue!);
  await expect(atlasRegion).toHaveValue(/region:.*$/);
  await page.locator('#animation-tab').click();
  const frameSource = page.locator('#animation-frame-asset');
  const frameRegionValue = await frameSource.locator('option').filter({ hasText: /Sprite 1/ }).first().getAttribute('value');
  await frameSource.selectOption(frameRegionValue!); await page.locator('#animation-frame-add').click();
  await expect(page.locator('#animation-frames .animation-frame-row')).toHaveCount(3);
  await page.getByRole('treeitem', { name: /Tilemap Wall$/ }).click(); await page.locator('#tilemap-tab').click();
  await page.locator('#tile-image-picker').click();
  await page.locator('.tile-image-option').filter({ hasText: /Sprite 1/ }).click();
  await page.locator('#tile-definition-add').click();
  await expect(page.locator('#tile-definition-list .tile-definition')).toHaveCount(3);
  await clickTopbarAction(page, '#project-save'); await expect(page.locator('#project-state')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#atlas-list .atlas-card')).toHaveCount(2);
  await page.getByRole('treeitem', { name: /Player$/ }).click(); await page.locator('#animation-tab').click();
  await expect(page.locator('#animation-frames .animation-frame-row')).toHaveCount(3);
});

test('atlas grid slicing skips sheet margins and sprite spacing and saves region bounds', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 24);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('#asset-import').setInputFiles({ name: 'padded-sheet.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('#atlas-create').click();
  const picker = page.locator('#atlas-picker-dialog');
  await picker.getByRole('button', { name: /Create Atlas from padded-sheet\.png/ }).click();
  const dialog = page.locator('#sprite-atlas-dialog');
  for (const [id, value] of Object.entries({ 'cell-width': '8', 'cell-height': '6', 'margin-x': '2', 'margin-y': '3', 'spacing-x': '2', 'spacing-y': '3' })) {
    await dialog.locator(`#atlas-${id}`).fill(value);
  }
  await dialog.locator('#atlas-slice-grid').click();
  await expect(dialog.locator('.atlas-region-row')).toHaveCount(6);
  const checkBounds = async () => {
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 1 X', exact: true })).toHaveValue('2');
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 1 Y', exact: true })).toHaveValue('3');
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 2 X', exact: true })).toHaveValue('12');
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 4 Y', exact: true })).toHaveValue('12');
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 6 Width', exact: true })).toHaveValue('8');
    await expect(dialog.getByRole('spinbutton', { name: 'Sprite 6 Height', exact: true })).toHaveValue('6');
  };
  await checkBounds();
  await dialog.locator('#atlas-save').click();
  await page.locator('#atlas-create').click();
  await picker.getByRole('button', { name: /Edit Atlas from padded-sheet\.png/ }).click();
  await expect(dialog.locator('.atlas-region-row')).toHaveCount(6);
  await checkBounds();
});

test('Play reconciles runtime physics components added and removed by a script', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus(); await page.keyboard.press('Control+A');
  await page.keyboard.type("function update(api: engine.ScriptApi) { const physics = api.getComponent('engine.physics2d'); if (physics) api.removeComponent('engine.physics2d'); else api.addComponent('engine.physics2d', { bodyType: 'Dynamic', gravityScale: 1 }); const collider = api.getComponent('engine.collider2d'); if (collider) api.removeComponent('engine.collider2d'); else api.addComponent('engine.collider2d', { shape: 'Circle', friction: 0.5, restitution: 0.1, sensor: true, groups: 1, mask: 65535 }); const sprite = api.getComponent('engine.spriteRenderer2d'); if (sprite) api.removeComponent('engine.spriteRenderer2d'); else api.addComponent('engine.spriteRenderer2d', { asset: null, region: null, width: 1, height: 1, order: 0, tint: '#ffffff' }); }");
  await page.locator('#play').click();
  await page.waitForTimeout(500);
  if (await page.locator('#mode').textContent() === 'Editing') throw new Error(`Play failed: ${await page.locator('#console').innerText()}`);
  await expect(page.locator('#mode')).toHaveText('Playing');
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(5);
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('Play delivers fixed-step trigger events to subscribed scripts', async ({ page }) => {
  await page.goto('/');
  const collider = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Collider 2D' }) });
  await collider.getByLabel('Is Trigger').check();
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus(); await page.keyboard.press('Control+A');
  await page.keyboard.type("function update(api: engine.ScriptApi) { api.subscribe('physics.trigger.enter'); if (api.events.some(event => event.type === 'physics.trigger.enter')) throw new Error('trigger event received'); }");
  await page.locator('#play').click();
  await expect(page.locator('#console')).toContainText('trigger event received', { timeout: 10_000 });
  await expect(page.locator('#mode')).toHaveText('Editing');
});

test('Play scripts cannot remove a scene object Name', async ({ page }) => {
  await page.goto('/');
  await page.locator('#code-tab').click();
  await expect(page.locator('#console')).toContainText('TypeScript editor ready', { timeout: 30_000 });
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus(); await page.keyboard.press('Control+A');
  await page.keyboard.type("function update(api: engine.ScriptApi) { api.removeComponent('engine.name'); }");
  await page.locator('#play').click();
  await expect(page.locator('#console')).toContainText('Scene objects must keep their Name and Transform 2D components.', { timeout: 10_000 });
  await expect(page.locator('#mode')).toHaveText('Editing');
});

test('asset browser imports an image and assigns it through the sprite schema', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#asset-count')).toHaveText('1', { timeout: 30_000 });
  await page.locator('#asset-import').setInputFiles({
    name: 'ship.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.locator('#asset-count')).toHaveText('2');
  await page.locator('.asset-row').filter({ hasText: 'ship.png' }).click();
  await expect(page.locator('#console')).toContainText('Assigned ship.png to Player');
  const texture = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Sprite Renderer 2D' }) }).getByLabel('Texture');
  await expect(texture).toHaveValue(/asset:/);
});

test('asset browser lays out assets in a grid and only removes unused files', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const importImage = () => page.locator('#asset-import').setInputFiles({
    name: 'unused.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
  });
  await importImage();
  const card = page.locator('.asset-card').filter({ hasText: 'unused.png' });
  await expect(card.getByRole('button', { name: 'Remove' })).toBeEnabled();
  await expect(page.locator('#asset-list')).toHaveCSS('display', 'grid');
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('#asset-count')).toHaveText('1');

  await importImage();
  const usedCard = page.locator('.asset-card').filter({ hasText: 'unused.png' });
  await usedCard.locator('.asset-row').click();
  await expect(usedCard.getByRole('button', { name: 'In use' })).toBeDisabled();
  await expect(usedCard.getByRole('button', { name: 'In use' })).toHaveAttribute('title', /Player · Sprite Renderer 2D/);
});

test('editor panels can be floated and restored to the default layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const header = page.locator('.inspector h2');
  const box = await header.boundingBox();
  if (!box) throw new Error('Inspector title is not visible.');
  await page.mouse.move(box.x + 24, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 70);
  await page.mouse.up();
  await expect(page.locator('.inspector')).toHaveClass(/is-floating/);
  await clickTopbarAction(page, '#reset-layout');
  await expect(page.locator('.inspector')).not.toHaveClass(/is-floating/);
});

test('inspector changes, duplicates and deletes are undoable and redoable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  const x = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('2.75'); await x.press('Tab'); await expect(x).toHaveValue('2.75');
  await page.locator('#scene-tab').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('1.4');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('2.75');
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toBeVisible();
  await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#redo').click();
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toHaveCount(0);
});

test('context menu reparents with cycle-safe hierarchy changes and undo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Player' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Make child of Crate' }).click();
  await expect(page.getByRole('treeitem', { name: '◇  Player' })).toHaveAttribute('aria-level', '2');
  await page.locator('#undo').click();
  await expect(page.getByRole('treeitem', { name: '◇  Player' })).toHaveAttribute('aria-level', '1');
});

test('viewport move tool snaps a dragged object to the configured grid', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#snap-toggle').check();
  await page.locator('[data-tool="move"]').click();
  await page.locator('#scene-zoom-out').click(); await page.locator('#scene-zoom-out').click();
  await page.locator('#orientation').click(); await expect(page.locator('#orientation')).toHaveText('Global');
  await page.locator('#orientation').click(); await expect(page.locator('#orientation')).toHaveText('Local');
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('Scene viewport is not visible.');
  const zoom = 45 / 1.2 ** 2;
  const startX = box.x + box.width / 2 + 1.4 * zoom;
  const startY = box.y + box.height / 2 - (5 - 2) * zoom;
  await page.mouse.move(startX, startY); await page.mouse.down(); await page.mouse.move(startX + 20, startY); await page.mouse.up();
  const x = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true });
  await expect(x).toHaveValue('2');
  await page.locator('#undo').click();
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('1.4');
  const transformStartX = box.x + box.width / 2 + 1.4 * zoom; const transformStartY = box.y + box.height / 2 - 3 * zoom;
  await page.locator('#snap-toggle').uncheck(); await page.locator('[data-tool="rotate"]').click();
  await page.mouse.move(transformStartX, transformStartY); await page.mouse.down(); await page.mouse.move(transformStartX + 10, transformStartY); await page.mouse.up();
  const rotation = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Rotation (radians)' });
  await expect(rotation).toHaveValue('0.1'); await page.locator('#undo').click(); await expect(rotation).toHaveValue('0');
  await page.locator('[data-tool="scale"]').click(); await page.mouse.move(transformStartX, transformStartY); await page.mouse.down(); await page.mouse.move(transformStartX, transformStartY - 10); await page.mouse.up();
  const scaleX = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Scale X' });
  await expect.poll(async () => Number(await scaleX.inputValue())).toBeGreaterThan(1);
  await page.locator('#undo').click(); await expect(scaleX).toHaveValue('1');
});

test('free move follows the viewport after rotating an object', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  const objectGroup = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) });
  await objectGroup.getByRole('spinbutton', { name: 'Rotation (radians)' }).fill('1.57079632679');
  await objectGroup.getByRole('spinbutton', { name: 'Rotation (radians)' }).press('Tab');
  await page.locator('[data-tool="move"]').click();
  await page.locator('#scene-zoom-out').click(); await page.locator('#scene-zoom-out').click();
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('Scene viewport is not visible.');
  const zoom = 45 / 1.2 ** 2;
  const startX = box.x + box.width / 2 + 1.4 * zoom;
  const startY = box.y + box.height / 2 - 3 * zoom;
  await page.mouse.move(startX, startY); await page.mouse.down(); await page.mouse.move(startX + 20, startY); await page.mouse.up();
  await expect.poll(async () => Number(await objectGroup.getByRole('spinbutton', { name: 'X', exact: true }).inputValue())).toBeCloseTo(1.4 + 20 / zoom, 3);
  await expect(objectGroup.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('5');
});

test('selection shortcuts keep multiple entities selected for grouped duplication', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const player = page.getByRole('treeitem', { name: '◇  Player' }); const crate = page.getByRole('treeitem', { name: '◇  Crate' });
  await player.click(); await crate.click({ modifiers: ['Control'] });
  await expect(player).toHaveAttribute('aria-selected', 'true'); await expect(crate).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('treeitem', { name: '◇  Player Copy' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toBeVisible();
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('#console')).not.toContainText('Scene changed, but editor refresh failed');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem', { name: '◇  Player Copy' })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('treeitem', { name: '◇  Player Copy' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: '◇  Crate Copy' })).toBeVisible();
});

test('local autosave restores a scene after the editor reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  const x = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('6.25'); await x.press('Tab');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('6.25');
});

test('project input actions can be edited and restored after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#project-settings');
  await expect(page.locator('#project-settings-dialog')).toBeVisible();
  await expect(page.locator('.input-action-card')).toHaveCount(4);
  await page.getByRole('button', { name: '+ Add Action' }).click();
  const newAction = page.locator('.input-action-card').last();
  const name = newAction.getByRole('textbox', { name: 'Action name' });
  await name.fill('dash'); await name.press('Tab');
  await newAction.getByRole('button', { name: /Bind key for dash/ }).click();
  await page.keyboard.press('k');
  await expect(newAction.getByRole('button', { name: /Bind key for dash/ })).toHaveText('KeyK');
  await page.getByRole('button', { name: 'Close project settings' }).click();
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#project-settings');
  await expect(page.locator('.input-action-card').last().getByRole('textbox', { name: 'Action name' })).toHaveValue('dash');
  await page.getByRole('button', { name: 'Close project settings' }).click();
  await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('Playing');
  await page.keyboard.down('k'); await page.waitForTimeout(250); await page.keyboard.up('k');
  await expect(page.locator('#console .error')).toHaveCount(0);
  await page.locator('#stop').click();
});

test('project download can be imported with its scene and asset bytes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#asset-import').setInputFiles({
    name: 'ship.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.locator('#asset-count')).toHaveText('2');
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  const downloadPromise = page.waitForEvent('download');
  await clickTopbarAction(page, '#project-export');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ecsproj$/);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Project download did not provide a readable stream.');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  await page.locator('#project-import').setInputFiles({ name: 'roundtrip.ecsproj', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#asset-count')).toHaveText('2');
  await expect(page.getByRole('treeitem', { name: '◇  Crate' })).toBeVisible();
});

test('web export is editor-free and runs from a static subdirectory and file URL', async ({ page }) => {
  await page.goto('/');
  await clickTopbarAction(page, '#project-showcase');
  await expect(page.locator('#project-name-current')).toHaveText('ECS Studio Showcase', { timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await clickTopbarAction(page, '#web-game-export');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-web\.zip$/);
  const stream = await download.createReadStream(); if (!stream) throw new Error('Web export did not provide a readable ZIP.');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  expect(files['index.html']).toBeTruthy(); expect(files['game.js']).toBeTruthy();
  expect(files['game.js']!.byteLength).toBeGreaterThan(1_000_000);
  const runtimeSource = new TextDecoder().decode(files['game.js']);
  expect(runtimeSource).toContain('embedded game data');
  expect(runtimeSource).not.toContain('Could not load game.json');
  expect(Object.keys(files).some(path => path.startsWith('assets/'))).toBe(false);
  expect(Object.keys(files).some(path => path.includes('monaco') || path.includes('editor.worker'))).toBe(false);
  const exportedHtml = new TextDecoder().decode(files['index.html']);
  expect(exportedHtml).toContain('<script src="./game.js"></script>');
  expect(exportedHtml).toContain('"inputActions"');
  expect(exportedHtml).not.toContain('type="module"');
  const embeddedData = exportedHtml.match(/<script id="game-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  expect(embeddedData).toBeTruthy();
  const exportedProject = JSON.parse(embeddedData!) as { format: string; version: number; scripts: Record<string, string>; visualGraphs: Record<string, unknown>; assets: { url: string }[] };
  expect(exportedProject).toMatchObject({ format: 'ecs-web-game', version: 1 });
  expect(exportedProject.scripts['scripts/player.ts']).toContain('onStart');
  expect(exportedProject.visualGraphs['scripts/player.graph.json']).toBeTruthy();
  expect(exportedProject.assets.length).toBeGreaterThan(0);
  expect(exportedProject.assets.every(asset => asset.url.startsWith('data:'))).toBe(true);
  const mime = (path: string) => path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  const gamePage = await page.context().newPage();
  const runtimeErrors: string[] = [];
  await gamePage.route('**/*', async route => {
    const url = new URL(route.request().url()); if (!url.pathname.startsWith('/static-export/')) { await route.continue(); return; }
    const path = url.pathname.replace(/^\/static-export\//, '');
    const file = files[path];
    if (!file) { runtimeErrors.push(`Missing exported file: ${path}`); await route.fulfill({ status: 404, body: `Missing exported file: ${path}` }); return; }
    await route.fulfill({ contentType: mime(path), body: Buffer.from(file) });
  });
  gamePage.on('pageerror', error => runtimeErrors.push(`${error.name}: ${error.message}`));
  gamePage.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  await gamePage.goto('/static-export/index.html');
  await expect(gamePage).toHaveTitle('ecs-studio-showcase');
  await expect(gamePage.locator('#play')).toBeVisible();
  await gamePage.locator('#play').click();
  await expect.poll(async () => { const error = gamePage.locator('#error'); if (await error.isVisible()) throw new Error(`Export runtime reported: ${await error.innerText()} (${await error.evaluate(node => node.outerHTML)})`); return Number(await gamePage.locator('#game').getAttribute('data-simulation-tick')); }, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(gamePage.locator('#error')).toBeHidden();
  const startButton = gamePage.getByRole('button', { name: 'Start Adventure' }); await expect(startButton).toBeVisible();
  await startButton.click();
  await expect(gamePage.getByRole('button', { name: 'Adventure Started!' })).toBeVisible({ timeout: 5_000 });
  await gamePage.locator('#pause').click();
  const pausedTick = await gamePage.locator('#game').getAttribute('data-simulation-tick');
  await gamePage.waitForTimeout(100);
  await expect(gamePage.locator('#game')).toHaveAttribute('data-simulation-tick', pausedTick ?? '0');
  await gamePage.locator('#resume').click();
  await gamePage.locator('#stop').click();
  expect(runtimeErrors).toEqual([]);

  const localDirectory = await mkdtemp(join(tmpdir(), 'ecs-web-export-'));
  const filePage = await page.context().newPage();
  const localErrors: string[] = [];
  filePage.on('pageerror', error => localErrors.push(`${error.name}: ${error.message}`));
  filePage.on('console', message => { if (message.type() === 'error') localErrors.push(message.text()); });
  try {
    await writeFile(join(localDirectory, 'index.html'), files['index.html']!);
    await writeFile(join(localDirectory, 'game.js'), files['game.js']!);
    await filePage.goto(pathToFileURL(join(localDirectory, 'index.html')).href);
    await expect(filePage).toHaveTitle('ecs-studio-showcase');
    await expect(filePage.locator('#play')).toBeVisible();
    await filePage.locator('#play').click();
    await expect.poll(async () => {
      const error = filePage.locator('#error'); if (await error.isVisible()) throw new Error(`Local export reported: ${await error.innerText()}`);
      return Number(await filePage.locator('#game').getAttribute('data-simulation-tick'));
    }, { timeout: 15_000 }).toBeGreaterThan(1);
    await filePage.getByRole('button', { name: 'Start Adventure' }).click();
    await expect(filePage.getByRole('button', { name: 'Adventure Started!' })).toBeVisible({ timeout: 5_000 });
    expect(localErrors).toEqual([]);
  } finally {
    await filePage.close(); await rm(localDirectory, { recursive: true, force: true });
  }
});

test('Physics Playground can be extended, played, autosaved and reopened', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#project-name-current')).toHaveText('Physics playground');
  await page.locator('#add-object').click();
  await expect(page.getByRole('treeitem', { name: '◇  Object' })).toBeVisible();
  const name = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByLabel('Name', { exact: true });
  await name.fill('Bonus Crate'); await name.press('Tab');
  const y = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Y', exact: true });
  await y.fill('7'); await y.press('Tab');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 10_000 });
  const savedNames = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('ecs-studio-projects', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const projectId = localStorage.getItem('ecs-studio-active-project') ?? 'project:physics-playground';
    const project = await new Promise<StoredProjectForTest | undefined>((resolve, reject) => { const request = database.transaction('projects').objectStore('projects').get(projectId); request.onsuccess = () => resolve(request.result as StoredProjectForTest | undefined); request.onerror = () => reject(request.error); });
    database.close();
    return project?.scene.entities.map(entity => entity.components.find(component => component.typeId === 'engine.name')?.data.value);
  });
  expect(savedNames).toContain('Bonus Crate');
  await page.locator('#console-tab').click();
  await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(1);
  await page.locator('#stop').click();
  await expect(name).toHaveValue('Bonus Crate'); await expect(y).toHaveValue('7');
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Bonus Crate' }).click();
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByLabel('Name', { exact: true })).toHaveValue('Bonus Crate');
  await expect(page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('7');
});

test('prefabs can be created, instanced, locally overridden and updated from their source', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  page.once('dialog', dialog => dialog.accept('Test Crate Prefab'));
  await page.locator('#prefab-create').click();
  const card = page.locator('.prefab-card').filter({ hasText: 'Test Crate Prefab' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add Instance' }).click();
  const crateRows = page.getByRole('treeitem', { name: '◇  Crate', exact: true });
  await expect(crateRows).toHaveCount(2);
  await crateRows.nth(1).click();
  const transform = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Y', exact: true });
  await transform.fill('42'); await transform.press('Tab');
  await expect(page.locator('#component-inspector')).toContainText('Local overrides: Transform 2D');
  await crateRows.nth(0).click();
  const name = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByLabel('Name', { exact: true });
  await name.fill('Updated Source Crate'); await name.press('Tab');
  await card.getByRole('button', { name: 'Update Source' }).click();
  await card.getByRole('button', { name: 'Update Instances' }).click();
  await expect(page.getByRole('treeitem', { name: '◇  Updated Source Crate', exact: true })).toHaveCount(2);
  await page.getByRole('treeitem', { name: '◇  Updated Source Crate', exact: true }).nth(1).click();
  await expect(page.locator('#component-inspector')).toContainText('Local overrides: Transform 2D');
  await expect(page.locator('#component-inspector').locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) }).getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('42');
});

test('Parallax component supports editor changes, camera preview, repeat picking, undo and persistence', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  const inspector = page.locator('#component-inspector');
  await inspector.getByLabel('Component to add').selectOption('engine.parallax2d');
  const group = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Parallax 2D' }) });
  await expect(group.getByLabel('Factor X', { exact: true })).toHaveAttribute('type', 'number');
  await group.getByLabel('Factor X', { exact: true }).fill('0'); await group.getByLabel('Factor X', { exact: true }).press('Tab');
  await page.locator('#undo').click(); await expect(group.getByLabel('Factor X', { exact: true })).toHaveValue('0.5');
  await page.locator('#redo').click(); await expect(group.getByLabel('Factor X', { exact: true })).toHaveValue('0');
  await group.getByLabel('Factor Y', { exact: true }).fill('0'); await group.getByLabel('Factor Y', { exact: true }).press('Tab');
  await group.getByLabel('Origin Y', { exact: true }).fill('2'); await group.getByLabel('Origin Y', { exact: true }).press('Tab');
  const object = inspector.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Object' }) });
  const beforeX = await object.getByLabel('X', { exact: true }).inputValue(); const beforeY = await object.getByLabel('Y', { exact: true }).inputValue();
  const marker = page.locator('#viewport .scene-selection-marker'); const before = (await marker.boundingBox())!;
  const canvas = page.locator('#viewport canvas'); const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 45); await page.mouse.up({ button: 'middle' });
  const after = (await marker.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x + 90, 0); expect(after.y).toBeCloseTo(before.y + 45, 0);
  await expect(object.getByLabel('X', { exact: true })).toHaveValue(beforeX); await expect(object.getByLabel('Y', { exact: true })).toHaveValue(beforeY);
  await group.getByLabel('Repeat X', { exact: true }).check(); await group.getByLabel('Repeat Y', { exact: true }).check();
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  await expect(page.locator('#viewport .scene-selection-label')).toHaveText('Crate');
  // Zoom around an off-center pointer; keep the same repeated copy selected.
  const anchor = { x: bounds.x + 70, y: bounds.y + 45 };
  for (const deltaY of [180, -180]) {
    const previous = (await marker.boundingBox())!;
    await canvas.dispatchEvent('wheel', { deltaY, clientX: anchor.x, clientY: anchor.y });
    const ratio = Math.exp(-deltaY * .001);
    await expect.poll(async () => (await marker.boundingBox())!.width).toBeCloseTo(previous.width * ratio, 0);
    const next = (await marker.boundingBox())!;
    expect(Math.abs(next.x - (anchor.x + (previous.x - anchor.x) * ratio))).toBeLessThan(1);
    expect(Math.abs(next.y - (anchor.y + (previous.y - anchor.y) * ratio))).toBeLessThan(1);
  }
  await clickTopbarAction(page, '#project-save'); await expect(page.locator('#project-state')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: '◇  Crate' }).click();
  await expect(group.getByLabel('Repeat X', { exact: true })).toBeChecked(); await expect(group.getByLabel('Repeat Y', { exact: true })).toBeChecked();
  await expect(group.getByLabel('Factor X', { exact: true })).toHaveValue('0');
  await page.locator('#play').click(); await expect(page.locator('#mode')).toHaveText('Playing');
  await page.locator('#stop').click(); await expect(page.locator('#mode')).toHaveText('Editing');
  await expect(object.getByLabel('X', { exact: true })).toHaveValue(beforeX); await expect(object.getByLabel('Y', { exact: true })).toHaveValue(beforeY);
  await group.getByRole('button', { name: 'Remove component' }).click();
  await expect(group).toHaveCount(0); await page.locator('#undo').click(); await expect(group).toHaveCount(1);
});

test('Camera 2D settings frame the Game viewport, persist and follow an entity in Play', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await clickTopbarAction(page, '#project-settings');
  const settings = page.locator('#project-settings-dialog');
  await settings.getByLabel('Game View mode').selectOption('Fit');
  await settings.getByLabel('Game View width').fill('640'); await settings.getByLabel('Game View width').press('Tab');
  await settings.getByLabel('Game View height').fill('360'); await settings.getByLabel('Game View height').press('Tab');
  await settings.getByRole('button', { name: 'Add Camera to Scene' }).click();
  await expect(page.getByRole('treeitem', { name: /Main Camera$/ })).toBeVisible();
  const camera = page.locator('#component-inspector fieldset').filter({ has: page.locator('legend', { hasText: 'Camera 2D' }) });
  await camera.getByLabel('Visible Height', { exact: true }).fill('12'); await camera.getByLabel('Visible Height', { exact: true }).press('Tab');
  await camera.getByLabel('Follow Target', { exact: true }).selectOption('player');
  await expect(page.locator('.game-camera-frame')).toBeVisible();
  const frame = page.locator('.game-camera-frame rect');
  const width = Number(await frame.getAttribute('width')), height = Number(await frame.getAttribute('height'));
  expect(width / height).toBeCloseTo(16 / 9, 4);
  await clickTopbarAction(page, '#project-save'); await expect(page.locator('#project-state')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: /Main Camera$/ }).click();
  await expect(camera.getByLabel('Follow Target')).toHaveValue('player');
  await page.locator('#play').click(); await expect(page.locator('#mode')).toHaveText('Playing');
  const canvas = page.locator('#game-view canvas');
  await expect(canvas).toHaveAttribute('width', '640'); await expect(canvas).toHaveAttribute('height', '360');
  const rect = (await canvas.boundingBox())!; expect(rect.width / rect.height).toBeCloseTo(16 / 9, 2);
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(3);
  await page.locator('#stop').click(); await expect(page.locator('#mode')).toHaveText('Editing');
  await expect(camera.getByLabel('Visible Height')).toHaveValue('12');
});

test('scene manager creates, copies, renames, switches and persists independent scenes', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const mainId = await page.locator('#scene-select').inputValue();
  page.once('dialog', dialog => dialog.accept('Empty Level')); await page.locator('#scene-new').click();
  await expect(page.locator('#object-list [role="treeitem"]')).toHaveCount(0);
  const emptyId = await page.locator('#scene-select').inputValue(); expect(emptyId).not.toBe(mainId);
  await expect(page.locator('#undo')).toBeDisabled();
  page.once('dialog', dialog => dialog.accept('Level Two')); await page.locator('#scene-rename').click();
  await expect(page.locator('#active-scene-name')).toHaveText('/ Level Two');
  await page.locator('#scene-select').selectOption(mainId); await expect(page.locator('#object-list')).toContainText('Player');
  page.once('dialog', dialog => dialog.accept('Level Copy')); await page.locator('#scene-duplicate').click();
  await expect(page.locator('#object-list')).toContainText('Player');
  await clickTopbarAction(page, '#project-settings'); await page.getByLabel('Start scene', { exact: true }).selectOption(emptyId);
  await page.getByLabel('Close project settings').click();
  await clickTopbarAction(page, '#project-save'); await expect(page.locator('#project-state')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#scene-select option')).toHaveCount(3); await expect(page.locator('#active-scene-name')).toHaveText('/ Level Copy');
  await page.locator('#play').click(); await expect(page.locator('#mode')).toHaveText('Playing');
  await expect(page.locator('#scene-select')).toBeDisabled(); await page.locator('#stop').click();
  await expect(page.locator('#object-list')).toContainText('Player');
  await page.locator('#scene-select').selectOption(emptyId); await expect(page.locator('#object-list [role="treeitem"]')).toHaveCount(0);
  await page.locator('#scene-delete').click(); await expect(page.locator('#scene-select option')).toHaveCount(2);
});

function sceneTransitionProject() {
  const component = (typeId: string, data: unknown) => ({ typeId, version: 1, data });
  const transform = component('engine.transform2d', { x: 0, y: 2, rotation: 0, scaleX: 1, scaleY: 1 });
  const label = (text: string) => component('engine.uiText', { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, offsetMinX: 30, offsetMinY: 30, offsetMaxX: 300, offsetMaxY: 80, text, color: '#ffffff', fontSize: 24, align: 'left' });
  const make = (id: string, text: string, extra: unknown[] = []) => ({ format: 'ecs-scene', version: 1, sceneId: id, entities: [{ id: 'controller', components: [component('engine.name', { value: text }), transform, label(text), ...extra] }] });
  const binding = (codePath: string, graphPath: string) => component('engine.scriptBinding', { enabled: true, speed: 5, codePath, graphPath });
  const a = make('scene:menu', 'Menu Scene', [binding('scripts/menu.ts', '')]);
  const b = make('scene:level', 'Level Scene', [binding('', 'scripts/return.graph.json')]);
  const c = make('scene:end', 'Finished Scene');
  const graph = { version: 1, nodes: [
    { id: 'start', kind: 'event.onStart', x: 0, y: 0, data: {} },
    { id: 'emit', kind: 'event.emit', x: 200, y: 0, data: { eventType: 'scene.load' } },
    { id: 'payload', kind: 'value.json', x: 0, y: 150, data: { value: '{"sceneId":"scene:end"}' } },
  ], links: [
    { id: 'exec', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'emit', portId: 'exec' } },
    { id: 'data', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'emit', portId: 'payload' } },
  ] };
  return { format: 'ecs-project', version: 9, projectName: 'Scene Transitions', scene: c, sceneCollection: { scenes: [{ id: a.sceneId, name: 'Menu', document: a }, { id: b.sceneId, name: 'Level', document: b }, { id: c.sceneId, name: 'End', document: c }], activeSceneId: c.sceneId, startSceneId: a.sceneId }, gameView: { mode: 'Fit', width: 640, height: 360 },
    scripts: { 'scripts/menu.ts': `function onStart(api: engine.ScriptApi) { api.emit('scene.load', { sceneId: 'scene:level' }); }` }, scriptProperties: {}, visualGraphs: { 'scripts/return.graph.json': graph }, prefabs: [], atlases: [], inputActions: [], assets: [] };
}

test('code and node scene transitions work in Play and standalone export, and Stop restores the edited scene', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#project-import').setInputFiles({ name: 'scenes.ecsproj', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sceneTransitionProject())) });
  await expect(page.locator('#project-name-current')).toHaveText('Scene Transitions', { timeout: 30_000 });
  await expect(page.locator('#active-scene-name')).toHaveText('/ End');
  await page.locator('#play').click();
  await expect(page.locator('#game-view .game-ui-overlay')).toContainText('Finished Scene', { timeout: 15_000 }).catch(async error => { console.log(await page.locator('#console').textContent()); throw error; });
  await expect(page.locator('#game-view')).toHaveAttribute('data-simulation-tick', /^[1-9]\d*$/);
  await page.locator('#stop').click(); await expect(page.locator('#active-scene-name')).toHaveText('/ End');
  await expect(page.locator('#object-list')).toContainText('Finished Scene');
  const downloadPromise = page.waitForEvent('download'); await clickTopbarAction(page, '#web-game-export');
  const download = await downloadPromise; const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const files = unzipSync(Buffer.concat(chunks));
  const exported = await page.context().newPage();
  await exported.route('**/scenes-export/*', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: Buffer.from(files[route.request().url().split('/').at(-1)!]!) }));
  await exported.goto('/scenes-export/index.html'); await exported.locator('#play').click();
  await expect(exported.locator('#game .game-ui-overlay')).toContainText('Finished Scene', { timeout: 20_000 });
  await expect(exported.locator('#error')).toBeHidden();
  expect(await exported.locator('canvas').evaluate(canvas => [(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height])).toEqual([640, 360]);
  await exported.locator('#stop').click(); await exported.locator('#play').click();
  await expect(exported.locator('#game .game-ui-overlay')).toContainText('Finished Scene', { timeout: 20_000 });
  await expect(exported.locator('#error')).toBeHidden(); await exported.close();
});

test('Inspector previews input before blur, keeps its canvas and commits one undo step', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  const x = page.locator('#component-inspector').getByLabel('X', { exact: true });
  const original = await x.inputValue(); const marker = page.locator('.scene-selection-marker');
  const initialLeft = (await marker.boundingBox())!.x;
  const canvas = await page.locator('#game-view canvas').elementHandle();
  await x.fill('1.25');
  await expect(x).toBeFocused();
  await expect.poll(async () => (await marker.boundingBox())!.x).not.toBe(initialLeft);
  expect(await canvas!.evaluate(node => node === document.querySelector('#game-view canvas'))).toBe(true);
  const validLeft = (await marker.boundingBox())!.x;
  await x.fill(''); await x.press('-'); await expect(x).toBeFocused();
  expect((await marker.boundingBox())!.x).toBeCloseTo(validLeft);
  await x.press('Tab'); await expect(x).toHaveValue('1.25');
  await page.locator('#undo').click(); await expect(x).toHaveValue(original);
  await page.locator('#redo').click(); await expect(x).toHaveValue('1.25');
  await x.fill('7'); await x.press('Escape'); await expect(x).toHaveValue('1.25');
  await x.fill('3.75'); await x.press('Enter'); await expect(x).toHaveValue('3.75');
  await x.fill('4'); await x.press('Enter');
  await page.locator('#undo').click(); await expect(x).toHaveValue('3.75');
  await page.locator('#undo').click(); await expect(x).toHaveValue('1.25');
  await x.fill('2.5');
  await page.getByRole('treeitem', { name: '◇  Crate', exact: true }).click();
  await expect(page.locator('#object-name')).toHaveText('Crate');
  await page.getByRole('treeitem', { name: '◇  Player', exact: true }).click();
  await expect(x).toHaveValue('2.5'); await page.locator('#undo').click(); await expect(x).toHaveValue('1.25');
  const name = page.locator('#component-inspector').getByLabel('Name', { exact: true });
  const initialName = await name.inputValue();
  await name.fill('Pasted Name'); await name.evaluate((input: HTMLInputElement) => input.setSelectionRange(6, 6));
  await name.pressSequentially('Live');
  await expect(name).toHaveValue('PastedLive Name'); await expect(name).toBeFocused();
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(10);
  await expect(page.locator('.scene-selection-label')).toHaveText('PastedLive Name');
  await name.press('Enter'); await page.locator('#undo').click(); await expect(name).toHaveValue(initialName);
  await page.locator('#redo').click(); await expect(name).toHaveValue('PastedLive Name');
  await clickTopbarAction(page, '#project-save'); await expect(page.locator('#project-state')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('#play')).toBeEnabled({ timeout: 30_000 });
  await expect(name).toHaveValue('PastedLive Name'); await expect(x).toHaveValue('1.25');
});
