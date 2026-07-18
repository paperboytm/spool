import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'pnpm run clean && tsc && chmod +x bin/spool.js',
        input: [{ auto: true }, '!dist/**', '!node_modules/**'],
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
