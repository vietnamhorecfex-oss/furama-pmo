import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config (docs/07 §4). Tests run against a locally running stack:
 *  - Backend:  http://localhost:3000  (pnpm -F backend start)
 *  - Frontend: http://localhost:4173  (pnpm -F web preview)
 *
 * In CI: BASE_URL is set by the workflow. Locally: set it manually or start
 * the servers and run `pnpm test:e2e`.
 *
 * Skip E2E when BASE_URL is absent so `pnpm test` (unit only) stays fast.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173';
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Auth: all login/register go directly to the API (bypassing the proxy)
    extraHTTPHeaders: { 'x-playwright-test': '1' },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // In CI the servers are started by the workflow before running Playwright.
  // Locally uncomment webServer blocks to let Playwright start them automatically.
  //
  // webServer: [
  //   { command: 'pnpm -F backend start', url: `${API_URL}/health`, reuseExistingServer: true },
  //   { command: 'pnpm -F web preview', url: BASE_URL, reuseExistingServer: true },
  // ],
});

export { BASE_URL, API_URL };
