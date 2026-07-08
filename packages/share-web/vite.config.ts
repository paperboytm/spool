import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only relay for the backend's Google token exchange. workerd
// (wrangler pages dev) makes its outbound fetches with no proxy
// support (cloudflare/workers-sdk#4515), so on proxy-only dev networks
// the web sign-in callback hangs on the POST to oauth2.googleapis.com.
// share-dev.sh points the backend at this middleware via the
// DEV_GOOGLE_TOKEN_URL binding; Node's undici honours the proxy env
// (EnvHttpProxyAgent), so the exchange rides the same proxy the rest
// of the shell uses. Never part of the production build — vite dev
// middleware only exists under `vite serve`.
function devGoogleTokenRelay(): Plugin {
  return {
    name: 'dev-google-token-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/google-token', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          void (async () => {
            try {
              const { EnvHttpProxyAgent } = await import('undici')
              const upstream = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                  'content-type': req.headers['content-type'] ?? 'application/x-www-form-urlencoded',
                },
                body: Buffer.concat(chunks),
                // Non-standard undici option: route via http(s)_proxy env.
                dispatcher: new EnvHttpProxyAgent(),
              } as RequestInit)
              res.statusCode = upstream.status
              res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
              res.end(Buffer.from(await upstream.arrayBuffer()))
            } catch (e) {
              res.statusCode = 502
              res.end(JSON.stringify({ error: 'dev token relay failed', detail: String(e) }))
            }
          })()
        })
      })
    },
  }
}

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
  plugins: [react(), devGoogleTokenRelay()],
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
