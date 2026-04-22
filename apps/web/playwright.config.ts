import { defineConfig, devices } from '@playwright/test';

// Playwright E2E config. Browsers must be installed separately:
//   pnpm --filter web exec playwright install --with-deps
//
// The test itself (e2e/smoke.spec.ts) doesn't run in CI for prompt 02 —
// it's scaffolded here so prompts 05+ can bolt on module-specific
// scenarios without standing up infrastructure each time.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
