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
    // No sourcemaps in production. The reader is the most public
    // surface in the product — emitting .js.map exposes the entire
    // unminified source (every template, redact preprocessor, state
    // machine) via DevTools. Switch to 'hidden' if we ever wire up
    // a backend that ingests sourcemaps for crash symbolication.
    sourcemap: false,
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
