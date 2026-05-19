import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SPA build for spool.share's reader / tombstone / report pages.
// All API calls go to /api/* on the same origin (Cloudflare Pages
// Functions live in `packages/share-backend`).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 3002,
  },
})
