import { expect, test } from '@playwright/test';

test('editor restores a project from IndexedDB after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 45_000 });

  await page.locator('#add-object').click();
  const name = page.locator('#component-inspector').getByLabel('Name', { exact: true });
  await name.fill('Browser Matrix Save');
  await name.press('Tab');
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('#project-state')).toHaveText('Saved', { timeout: 45_000 });
  await expect(page.getByRole('treeitem', { name: '◇  Browser Matrix Save' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('WebGL2 viewport and Play simulation work', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'The Linux headless Firefox build in this container does not expose WebGL2, even with software rendering forced. Validate Firefox WebGL on a GPU-backed desktop runner.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 45_000 });
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate(element => Boolean((element as HTMLCanvasElement).getContext('webgl2')))).toBe(true);
  await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#game-view').getAttribute('data-simulation-tick'))).toBeGreaterThan(1);
  await page.locator('#stop').click();
  expect(errors).toEqual([]);
});
