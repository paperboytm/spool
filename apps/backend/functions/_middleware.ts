import type { PagesFunction } from '@cloudflare/workers-types'

import { API_CSP } from '../src/security/csp'

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next()
  const headers = new Headers(res.headers)
  headers.set('X-Robots-Tag', 'noindex')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  const url = new URL(ctx.request.url)
  if (url.pathname.startsWith('/api/')) {
    headers.set('Content-Security-Policy', API_CSP)
    // Cache-Control discipline: default ALL /api/ responses to
    // `no-store` unless the handler explicitly set a value. The
    // previous version only defaulted mutations, which left every
    // authenticated GET (/api/me, /api/me/shares, /api/admin/audit)
    // relying on its handler to remember the header. A future GET
    // endpoint that forgets to set Cache-Control would silently leak
    // private data into a shared cache.
    //
    // Public-read endpoints (/api/snapshots/<id>, /api/og/<id>.png,
    // /api/profiles/<handle>) set their own short-window cache
    // header at the handler level and override this default.
    if (!headers.has('cache-control')) {
      headers.set('Cache-Control', 'no-store')
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
