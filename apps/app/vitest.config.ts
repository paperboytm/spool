import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Explicit include so Playwright `*.spec.ts` files under e2e/ stay out
    // of vitest's run — they're driven by playwright.config.ts instead.
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    // Sets SPOOL_DATA_DIR to a temp dir before any test file's
    // imports evaluate, so @spool-lab/core's `SPOOL_DIR` constant
    // captures the temp path instead of the real ~/.spool/.
    // Without this, the security-prefs / IPC tests would silently
    // touch the user's production data.
    setupFiles: ['./test-setup.ts'],
  },
})
