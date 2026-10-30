import { defineConfig } from '@playwright/test';

/*
 * End-to-end tests: the real editor in a real Chrome. They run against their own dev server
 * (port 5320) in a fresh browser profile, so they never see anyone's projects.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://[::1]:5320/',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1400, height: 860 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build:player && npm exec -w @ege/editor -- vite --port 5320 --strictPort --host ::1',
    url: 'http://[::1]:5320/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
