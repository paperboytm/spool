import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'pnpm run clean && tsc',
        input: [{ auto: true }, '!dist/**', '!node_modules/**'],
        output: ['dist/**'],
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
