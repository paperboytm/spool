import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'pnpm run clean && tsc',
        // Keep source files explicit as well as auto-tracked. A stale task
        // archive must never restore an older barrel after a new public export
        // is added: downstream production builds resolve this package through
        // dist, not the workspace source alias.
        input: [
          { auto: true },
          'src/**',
          'package.json',
          'tsconfig.json',
          'vite.config.ts',
          '!dist/**',
          '!node_modules/**',
        ],
        output: ['dist/**'],
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
