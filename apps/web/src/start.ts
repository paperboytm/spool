// Global Start configuration. The request middleware is the merged
// app's replacement for the Pages `_headers` file: every request that
// reaches the SSR worker gets the security headers + per-route CSP from
// src/lib/security-headers.ts. The CSP nonce generated here is picked
// up by getRouter() (src/router.tsx) via getGlobalStartContext(), so
// the framework stamps the same nonce onto the inline hydration
// scripts it emits.

import { createMiddleware, createStart } from '@tanstack/react-start'

import { cacheHeaderFor, generateCspNonce, securityHeadersFor } from './lib/security-headers'

const securityHeaders = createMiddleware().server(async ({ next, pathname, request }) => {
  const cspNonce = generateCspNonce()
  const result = await next({ context: { cspNonce } })
  const requestUrl = new URL(request.url)
  // `pathname` is Start's normalized/rewrite-aware path; the Request carries
  // the query string needed to distinguish public and authenticated scopes.
  requestUrl.pathname = pathname
  const headers = securityHeadersFor(requestUrl, cspNonce)
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      result.response.headers.set(name, value)
    }
  }
  const cache = cacheHeaderFor(requestUrl, result.response.status)
  if (cache) result.response.headers.set('Cache-Control', cache)
  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}))
