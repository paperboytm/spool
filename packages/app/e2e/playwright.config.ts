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
  // helpers/launch.ts passes --force-prefers-reduced-motion which removes
  // the CSS-transition class of flakes. But many specs still use hardcoded
  // `{ timeout: 5000 }` assertions that flake under workers=2 on the CI
  // 2-core ubuntu runner. macOS CI (3-core M-series) and local both have
  // CPU headroom — keep workers=2 there for the e2e macOS speedup.
  workers: process.env['CI'] && process.platform === 'linux' ? 1 : 2,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../test-results/html-report' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
