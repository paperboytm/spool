import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SPA build for spool.pro's reader / tombstone pages.
// All API calls go to /api/* on the same origin (Cloudflare Pages
// Functions live in `packages/share-backend`).
//
// `server.proxy` forwards /api/* to the local wrangler instance so dev
// runs against the share-backend on http://localhost:8788 (the default
// `wrangler pages dev` port). In production the spool-pro-router
// Worker dispatcher routes both surfaces under the same origin, so the
// relative `/api/...` fetches just work.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: process.env['SPOOL_SHARE_BACKEND'] ?? 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
