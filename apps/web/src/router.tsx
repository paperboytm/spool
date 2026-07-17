import { createRouter } from '@tanstack/react-router'
import { getGlobalStartContext } from '@tanstack/react-start'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  // Server: the request middleware in start.ts generated a CSP nonce
  // for this request; hand it to the router so SSR inline scripts pass
  // `script-src 'self' 'nonce-…'`. Client: context is undefined and the
  // router reads the nonce from the csp-nonce meta tag on its own.
  const startContext = getGlobalStartContext() as { cspNonce?: string } | undefined
  const cspNonce = startContext?.cspNonce

  return createRouter({
    routeTree,
    scrollRestoration: true,
    ...(cspNonce ? { ssr: { nonce: cspNonce } } : {}),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
