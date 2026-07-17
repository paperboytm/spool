import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // Keep the declaration tree instead of API Extractor's bundled rollup;
      // package entrypoints remain unchanged.
      bundleTypes: false,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        // Lean DOM-free entry — see src/progressive.ts.
        progressive: fileURLToPath(new URL('./src/progressive.ts', import.meta.url)),
        timeline: fileURLToPath(new URL('./src/timeline.ts', import.meta.url)),
        'spool-document': fileURLToPath(new URL('./src/spool-document.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // Runtime peers stay external so each host supplies one copy and Node
      // resolves their server-safe export conditions. Bundling react-markdown
      // under Vite's browser condition pulls in a named-entity decoder that
      // creates a DOM element at module evaluation time, defeating the lean
      // `./timeline` entry's SSR/CLI contract.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'lucide-react',
        'react-markdown',
        'remark-gfm',
      ],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
