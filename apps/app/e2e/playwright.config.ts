import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  // Suite-wide wall clock. 51 spec files each cold-launch Electron in
  // beforeAll, and CI Linux runs workers=1 — 300s was only ever enough
  // for ~2/3 of the suite. Keep headroom under the workflow job's
  // timeout-minutes instead of racing it.
  globalTimeout: 900_000,
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
