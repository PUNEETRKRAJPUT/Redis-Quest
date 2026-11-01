import { defineConfig } from '@playwright/test';

// The check (scripts/check/P0-10.sh) starts the isolated quest-p10 stack and points this at its proxy.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: 'e2e/test-results',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.P10_BASE_URL ?? 'http://127.0.0.1:3300',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    trace: 'off',
  },
});
