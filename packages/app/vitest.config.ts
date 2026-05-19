import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Explicit include so Playwright `*.spec.ts` files under e2e/ stay out
    // of vitest's run — they're driven by playwright.config.ts instead.
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
  },
})
