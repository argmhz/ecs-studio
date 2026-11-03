import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser-matrix',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  timeout: 90_000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 0.0.0.0 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
