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
  // CI ubuntu-latest is 2-core: workers=2 starves the renderer enough
  // that CSS-transitioned elements never reach Playwright's "stable" state
  // within 30s (e.g. the share delete chip's `data-confirming` transition).
  // macOS CI runners are 3-core M-series and tolerate workers=2 fine.
  // Local dev (no CI env) defaults to 2 as well.
  workers: process.env['CI'] && process.platform === 'linux' ? 1 : 2,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../test-results/html-report' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
