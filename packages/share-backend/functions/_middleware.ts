import type { PagesFunction } from '@cloudflare/workers-types'

import { API_CSP } from '../src/security/csp'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next()
  const headers = new Headers(res.headers)
  headers.set('X-Robots-Tag', 'noindex')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  const url = new URL(ctx.request.url)
  if (url.pathname.startsWith('/api/')) {
    headers.set('Content-Security-Policy', API_CSP)
    if (
      MUTATION_METHODS.has(ctx.request.method.toUpperCase()) &&
      !headers.has('cache-control')
    ) {
      headers.set('Cache-Control', 'no-store')
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
