import { defineConfig } from '@playwright/test';

/* Makes the training examples in a real (headless) editor: `npm run ai:examples`. */
export default defineConfig({
  testDir: '.',
  testMatch: process.env.AI_TEST ?? 'generate.e2e.ts',
  timeout: 3_600_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://[::1]:5330/', channel: 'chrome', headless: true, viewport: { width: 1400, height: 860 } },
  webServer: {
    command: 'npm run build:player && npm exec -w @ege/editor -- vite --port 5330 --strictPort --host ::1',
    cwd: '..',
    url: 'http://[::1]:5330/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
