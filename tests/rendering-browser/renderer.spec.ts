import { expect, test } from '@playwright/test';

test('real WebGL 2 renderer batches sprites and survives context loss', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  const status = page.locator('#render-status');
  await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(status).toHaveAttribute('data-draw-calls', '1');
  await expect(status).toHaveAttribute('data-sprites', '2');
  await expect(status).toHaveAttribute('data-webgl', 'orthographic');
  await expect.poll(() => status.getAttribute('data-center-red')).toBe('255');

  const extensionAvailable = await page.evaluate(() => Boolean(
    (window as typeof window & { rendererSmoke?: { loseContext?: WEBGL_lose_context } }).rendererSmoke?.loseContext,
  ));
  test.skip(!extensionAvailable, 'Chromium does not expose WEBGL_lose_context in this environment.');

  await page.evaluate(() => {
    (window as typeof window & { rendererSmoke: { loseContext: WEBGL_lose_context } }).rendererSmoke.loseContext.loseContext();
  });
  await expect(status).toHaveAttribute('data-context', 'lost', { timeout: 10_000 });

  await page.evaluate(() => {
    (window as typeof window & { rendererSmoke: { loseContext: WEBGL_lose_context } }).rendererSmoke.loseContext.restoreContext();
  });
  await expect(status).toHaveAttribute('data-context', 'restored', { timeout: 10_000 });
});

test('renderer stress profile batches 1000 visible sprite submissions', async ({ page }) => {
  await page.goto('/renderer-smoke.html?sprites=1000');
  const status = page.locator('#render-status');
  await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(status).toHaveAttribute('data-benchmark-count', '1000');
  await expect(status).toHaveAttribute('data-sprites', '1000');
  await expect(status).toHaveAttribute('data-draw-calls', '1');
  await expect(status).toHaveAttribute('data-render-median-ms', /^\d+\.\d{3}$/);
  await expect(status).toHaveAttribute('data-render-p95-ms', /^\d+\.\d{3}$/);
});

test('PNG alpha is preserved for full sprites and atlas regions', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  await expect(page.locator('#render-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const samples = await page.evaluate(async () => {
    const source = document.createElement('canvas'); source.width = 32; source.height = 16;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(8, 0, 8, 16);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(16, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), 'image/png'));
    const bytes = [...new Uint8Array(await blob.arrayBuffer())];
    const path = '/src/renderer-alpha-probe.ts'; const { probeSpriteAlpha } = await import(path);
    return { full: await probeSpriteAlpha(bytes), atlas: await probeSpriteAlpha(bytes, { x: 0, y: 0, width: .5, height: 1 }) };
  });
  for (let row = 0; row < 4; row++) {
    expect(samples.full[row * 4]).toEqual([32, 35, 44, 255]);
    expect(samples.full[row * 4 + 2]).toEqual([0, 255, 0, 255]);
    expect(samples.atlas[row * 4]).toEqual([32, 35, 44, 255]);
    expect(samples.atlas[row * 4 + 2]).toEqual(samples.full[row * 4 + 1]);
    const semi = samples.full[row * 4 + 1]!;
    expect(semi[0]).toBeGreaterThan(130);
    expect(semi[0]).toBeLessThan(160);
  }
});

test('Game preview blends atlas alpha and keeps other entities stable across animation texture changes', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  await expect(page.locator('#render-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const frames: number[][][] = await page.evaluate(async () => {
    const source = document.createElement('canvas'); source.width = 32; source.height = 16;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(8, 0, 8, 16);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(16, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), 'image/png'));
    const path = '/src/renderer-alpha-probe.ts'; const { probeGameAlpha } = await import(path);
    return probeGameAlpha([...new Uint8Array(await blob.arrayBuffer())]);
  });
  const visibleFrames = new Set<string>();
  for (const [transparent, semi, other, backdrop] of frames) {
    expect(other).toEqual([0, 0, 255, 255]);
    expect(backdrop).toEqual([255, 0, 0, 255]);
    if (transparent![0] === 255) {
      expect(transparent).toEqual([255, 0, 0, 255]);
      expect(semi![0]).toBe(255); expect(semi![1]).toBeGreaterThan(120); expect(semi![1]).toBeLessThan(135);
      visibleFrames.add('a');
    } else {
      expect(transparent).toEqual([0, 255, 0, 255]);
      expect(semi).toEqual([0, 255, 0, 255]);
      visibleFrames.add('b');
    }
  }
  expect([...visibleFrames].sort()).toEqual(['a', 'b']);
});

test('Scene and Game parallax agree for atlas repeats and camera movement without changing source transforms', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  await expect(page.locator('#render-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const results = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(8, 0, 8, 16);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(16, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const path = '/src/renderer-parallax-probe.ts'; const { probeParallax } = await import(path);
    const bytes = [...new Uint8Array(await blob.arrayBuffer())];
    return Promise.all([0, .5, 1].map(factor => probeParallax(bytes, factor)));
  });
  for (const result of results) {
    expect(result.original).toMatchObject({ x: 0, y: 0, width: 80, height: 80 });
    for (const frame of result.frames) {
      expect(frame.game).toEqual(frame.scene);
      expect(frame.copies).toBeGreaterThan(1); expect(frame.copies).toBeLessThan(50);
      for (const pixel of frame.scene) {
        expect(pixel[2]).toBe(0); expect(pixel[3]).toBe(255);
        expect(pixel[0] + pixel[1]).toBeGreaterThan(240);
      }
    }
  }
  expect(results[0].frames[0].scene).toEqual(results[0].frames[1].scene);
  expect(results[1].frames[0].scene).not.toEqual(results[1].frames[1].scene);
  expect(results[2].frames[0].scene).not.toEqual(results[2].frames[1].scene);
});

test('editor zoom outside viewport center preserves the parallax composition at the gameplay camera', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  await expect(page.locator('#render-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const results = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(8, 0, 8, 16);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(16, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const path = '/src/renderer-parallax-probe.ts'; const { probeEditorParallaxZoom } = await import(path);
    const bytes = [...new Uint8Array(await blob.arrayBuffer())];
    return Promise.all([0, .15, .5].map(factor => probeEditorParallaxZoom(bytes, factor)));
  });
  for (const frames of results) for (const frame of frames) {
    expect(frame).toEqual(frames[0]);
    expect(frame[3]).toEqual([0, 0, 255, 255]);
  }
});

test('Game camera follows targets at a fixed world scale and letterboxes UI on resize', async ({ page }) => {
  await page.goto('/renderer-smoke.html');
  const samples = await page.evaluate(async () => { const path = '/src/renderer-camera-probe.ts'; const { probeGameCamera } = await import(path); return probeGameCamera(); });
  for (const sample of samples) {
    expect(sample.center).toEqual([255, 0, 0, 255]); expect(sample.size).toEqual([640, 360]);
    expect(sample.display[0] / sample.display[1]).toBeCloseTo(16 / 9, 2); expect(sample.ui).toEqual(sample.display);
  }
  expect(samples[2].display[0]).toBeGreaterThan(samples[0].display[0]);
});
