import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const coreAlias = {
  '@spool-lab/core': resolve(__dirname, '../core/dist/index.js'),
  '@spool-lab/redact': resolve(__dirname, '../redact/dist/index.js'),
}

// better-sqlite3 uses 'bindings' at runtime to locate the .node native addon.
// It must NOT be bundled — it must stay as a real require() in the output.
function nativeExternalPlugin(): Plugin {
  return {
    name: 'native-external',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'better-sqlite3' || id.startsWith('better-sqlite3/')) {
        return { id, external: true }
      }
      return null
    },
  }
}

export default defineConfig({
  main: {
    // Exclude @spool-lab/core from externalization so it gets bundled (it's ESM
    // and can't be require()'d directly). Only better-sqlite3 stays external.
    plugins: [externalizeDepsPlugin({ exclude: ['@spool-lab/core', '@spool-lab/redact'] }), nativeExternalPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'sync-worker': resolve(__dirname, 'src/main/sync-worker.ts'),
          'scan-worker-thread': resolve(__dirname, 'src/main/scan-worker-thread.ts'),
        },
      },
    },
    resolve: { alias: coreAlias },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@spool-lab/core', '@spool-lab/redact'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // Hidden Privacy Filter inference window has its own preload —
          // exposes a narrow `pfBridge` (no Spool app surface) so the
          // inference renderer can't reach the main app's IPC channels.
          inference: resolve(__dirname, 'src/preload/inference.ts'),
        },
      },
    },
    resolve: { alias: coreAlias },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: {
      fs: {
        // The hidden inference window lives at src/inference/, outside
        // the main renderer's root. Without explicit allow, Vite's
        // dev server refuses to serve it AND falls back to index.html
        // (so the inference window silently runs the main app
        // instead — confusing). Whitelist the source dir so
        // `${rendererBase}/@fs/<abs-path>` resolves correctly.
        allow: [resolve(__dirname, 'src/inference'), resolve(__dirname, 'src/renderer')],
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Inference window lives under src/inference/ but emits next
          // to the main renderer so model-host.ts can `loadFile` it
          // with a fixed relative path. electron-vite will produce
          // out/renderer/pf-inference.html alongside index.html.
          'pf-inference': resolve(__dirname, 'src/inference/pf-inference.html'),
        },
      },
    },
    resolve: { alias: coreAlias },
    plugins: [react(), tailwindcss()],
  },
})
