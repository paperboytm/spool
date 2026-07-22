import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { defineConfig, lazyPlugins } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'pnpm run clean && vp build',
        input: [{ auto: true }, '!dist/**', '!node_modules/**'],
        output: ['dist/**'],
      },
    },
  },
  plugins:
    lazyPlugins(() => [
      react(),
      tailwindcss(),
      dts({
        entryRoot: 'src',
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        bundleTypes: false,
      }),
    ]) ?? [],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rollupOptions: {
      // Externalize every bare import — consumers resolve deps through
      // this package's own node_modules (pnpm symlinks).
      external: (id) => !id.startsWith('.') && !id.startsWith('/'),
    },
    sourcemap: true,
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
