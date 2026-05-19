import type { PagesFunction } from '@cloudflare/workers-types'

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next()
  const headers = new Headers(res.headers)
  headers.set('X-Robots-Tag', 'noindex')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
