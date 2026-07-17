// spool-pro-router — single Worker bound to spool.pro/* that forwards
// each path to the right upstream origin so users only ever see one
// domain. Since the landing/share-web merge there are two upstreams:
// the API (spool-share-backend) and the merged web app (@spool/web in
// apps/web, deployed to the void project that kept the historical
// `spool-landing` resource name).
//
// Every response carries `x-spool-route: web|backend` so misrouting is
// visible from `curl -I` alone (the launch runbook's §5 URL probes
// assert on it).

type Env = {
  ORIGIN_BACKEND: string // e.g. "spool-share-backend.pages.dev"
  ORIGIN_WEB: string // e.g. "spool-landing.pages.dev" (merged web app)
}

export function routeFor(pathname: string): 'backend' | 'web' {
  if (pathname.startsWith('/api/')) return 'backend'
  return 'web'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const route = routeFor(url.pathname)
    const origin = route === 'backend' ? env.ORIGIN_BACKEND : env.ORIGIN_WEB

    const upstream = new URL(request.url)
    upstream.host = origin
    upstream.protocol = 'https:'

    // Preserve method + body + most headers; forward the original Host
    // so the upstream can log accurately.
    const fwd = new Request(upstream.toString(), request)
    fwd.headers.set('X-Forwarded-Host', url.host)
    fwd.headers.set('X-Forwarded-Proto', 'https')

    const res = await fetch(fwd)
    const out = new Response(res.body, res)
    out.headers.set('x-spool-route', route)
    return out
  },
}
