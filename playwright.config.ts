import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/editor.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: {
    command: 'npm run build && npm run preview -- --host 0.0.0.0 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
