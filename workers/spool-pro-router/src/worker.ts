// spool-pro-router — single Worker bound to spool.pro/* that forwards
// each path to the right pages.dev origin so users only ever see one
// domain. Internal Cloudflare resource names (spool-share-web,
// spool-share-backend, spool-landing) are unchanged.
//
// Every response carries `x-spool-route: landing|web|backend` so
// misrouting is visible from `curl -I` alone (the launch runbook's §5
// URL probes assert on it).

type Env = {
  ORIGIN_BACKEND: string // e.g. "spool-share-backend.pages.dev"
  ORIGIN_WEB: string // e.g. "spool-share-web.pages.dev"
  ORIGIN_LANDING: string // e.g. "spool-landing.pages.dev"
}

export function routeFor(pathname: string): 'backend' | 'web' | 'landing' {
  if (pathname.startsWith('/api/')) return 'backend'
  if (
    pathname.startsWith('/s/') ||
    pathname.startsWith('/@') ||
    pathname === '/me' ||
    pathname === '/sign-in' ||
    pathname === '/terms' || // legal pages (#389)
    pathname === '/privacy'
  ) {
    return 'web'
  }
  return 'landing'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const route = routeFor(url.pathname)
    const origin =
      route === 'backend'
        ? env.ORIGIN_BACKEND
        : route === 'web'
          ? env.ORIGIN_WEB
          : env.ORIGIN_LANDING

    const upstream = new URL(request.url)
    upstream.host = origin
    upstream.protocol = 'https:'

    // Preserve method + body + most headers; forward the original Host
    // so the Pages project can log accurately.
    const fwd = new Request(upstream.toString(), request)
    fwd.headers.set('X-Forwarded-Host', url.host)
    fwd.headers.set('X-Forwarded-Proto', 'https')

    const res = await fetch(fwd)
    const out = new Response(res.body, res)
    out.headers.set('x-spool-route', route)
    return out
  },
}
