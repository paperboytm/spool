import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import type { Plugin } from 'vite-plus'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { voidPlugin } from 'void'

// Dev-only relay for the backend's server-side WorkOS calls (code
// exchange + identities). workerd (wrangler pages dev) makes its
// outbound fetches with no proxy support (cloudflare/workers-sdk#4515),
// so on proxy-only dev networks the web sign-in callback hangs on the
// POST to api.workos.com. share-dev.sh points the backend at this
// middleware via the DEV_WORKOS_API_URL binding; Node's undici honours
// the proxy env (EnvHttpProxyAgent), so the calls ride the same proxy
// the rest of the shell uses. Never part of the production build —
// vite dev middleware only exists under `vite serve`.
function devWorkosRelay(): Plugin {
  return {
    name: 'dev-workos-relay',
    apply: 'serve',
    configureServer(server) {
      // Mounted middleware sees req.url with the mount prefix stripped,
      // so '/__dev/workos/user_management/authenticate' arrives as
      // '/user_management/authenticate' — exactly the api.workos.com path.
      server.middlewares.use('/__dev/workos', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          void (async () => {
            try {
              const { EnvHttpProxyAgent } = await import('undici')
              const headers: Record<string, string> = {}
              if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
              if (req.headers['authorization'])
                headers['authorization'] = req.headers['authorization']
              const body = Buffer.concat(chunks)
              const upstream = await fetch(`https://api.workos.com${req.url ?? '/'}`, {
                method: req.method ?? 'GET',
                headers,
                ...(body.length > 0 ? { body } : {}),
                // Non-standard undici option: route via http(s)_proxy env.
                dispatcher: new EnvHttpProxyAgent(),
              } as RequestInit)
              res.statusCode = upstream.status
              res.setHeader(
                'content-type',
                upstream.headers.get('content-type') ?? 'application/json',
              )
              res.end(Buffer.from(await upstream.arrayBuffer()))
            } catch (e) {
              res.statusCode = 502
              res.end(JSON.stringify({ error: 'dev workos relay failed', detail: String(e) }))
            }
          })()
        })
      })
    },
  }
}

// Marketing/docs/blog surfaces are prerendered to static HTML at build
// time (served straight from the edge, same as the old @spool/landing
// SSG output). crawlLinks discovers the docs sidebar + blog cards from
// the listed roots; /connectors is listed explicitly because nothing
// links to it (it's a moved-page redirect stub).
//
// App surfaces (/s/*, /session/*, /@*, /me, /sign-in, /cli-auth) are
// NOT prerendered — they SSR per request so loaders can inject OG meta
// and per-route security headers (see src/start.ts).
const PRERENDER_ROOTS = ['/', '/daemon', '/connectors', '/blog', '/terms', '/privacy']

export default defineConfig(({ mode }) => ({
  // Vitest used to have a standalone config with no application plugins.
  // Keep that isolation because Void's Cloudflare runner is only needed for
  // application build and development.
  plugins:
    mode === 'test'
      ? []
      : (lazyPlugins(() => [
          voidPlugin(), // must come before the framework plugin
          tailwindcss(),
          tanstackStart({
            prerender: {
              enabled: true,
              crawlLinks: true,
              filter: (page) =>
                PRERENDER_ROOTS.includes(page.path) ||
                page.path.startsWith('/docs') ||
                page.path.startsWith('/blog'),
            },
            pages: PRERENDER_ROOTS.map((path) => ({ path })),
          }),
          viteReact(),
          devWorkosRelay(),
        ]) ?? []),
  build: {
    // No sourcemaps in production. The reader is the most public
    // surface in the product — emitting .js.map exposes the entire
    // unminified source (every template, redact preprocessor, state
    // machine) via DevTools. Switch to 'hidden' if we ever wire up
    // a backend that ingests sourcemaps for crash symbolication.
    sourcemap: false,
  },
  server: {
    // 3002 is load-bearing: the WorkOS dev redirect URI is registered
    // against http://localhost:3002 (see CONTRIBUTING.md).
    port: 3002,
    proxy: {
      '/api': {
        target: process.env['SPOOL_SHARE_BACKEND'] ?? 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
}))
