import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/rendering-browser',
  use: { baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: {
    command: 'npm run dev -- --host 0.0.0.0 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/renderer-smoke.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
