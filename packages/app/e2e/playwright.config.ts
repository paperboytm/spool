import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  globalTimeout: 300_000,
  expect: {
    // Default 5s leaves no headroom for sidebar→session-row sync under
    // workers=2 CPU contention. Helpers use this implicitly via toBeVisible().
    timeout: 10_000,
  },
  retries: 1,
  workers: 2,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../test-results/html-report' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
