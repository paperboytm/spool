import { resolve } from 'node:path'

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const coreAlias = {
  '@spool-lab/core': resolve(__dirname, '../../packages/core/dist/index.js'),
  '@spool-lab/redact': resolve(__dirname, '../../packages/redact/dist/index.js'),
}

function runtimeExternalPlugin(): Plugin {
  return {
    name: 'worker-runtime-external',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'better-sqlite3' || id.startsWith('better-sqlite3/')) {
        return { id, external: true }
      }
      return null
    },
  }
}

// Worker entries are built separately from the Electron main process. Keeping
// them in one Rollup graph with index.ts allowed E2E-only Electron modules to
// become shared dependencies of a worker chunk, so the worker crashed before
// it could report ready. This graph contains worker-safe modules only.
export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@spool-lab/cli',
          '@spool-lab/core',
          '@spool-lab/redact',
          '@spool-lab/session-kit',
        ],
      }),
      runtimeExternalPlugin(),
    ],
    build: {
      emptyOutDir: false,
      rollupOptions: {
        output: {
          format: 'es',
          chunkFileNames: 'worker-chunks/[name]-[hash].mjs',
        },
        input: {
          'sync-worker': resolve(__dirname, 'src/main/sync-worker.ts'),
          'scan-worker-thread': resolve(__dirname, 'src/main/scan-worker-thread.ts'),
          'mutation-worker-thread': resolve(__dirname, 'src/main/mutation-worker-thread.ts'),
        },
      },
    },
    resolve: { alias: coreAlias },
  },
})
