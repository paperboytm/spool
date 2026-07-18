import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    // Keep Playwright specs out of the unit-test run.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Isolate tests from the user's production ~/.spool data.
    setupFiles: ['./test-setup.ts'],
  },
})
