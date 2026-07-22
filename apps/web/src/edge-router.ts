// Public edge dispatch for spool.new. The web Worker is the entry Worker so
// Cloudflare can serve its Vite-built static assets directly; only /api/* is
// forwarded to the existing Pages backend.

export type EdgeRoute = 'backend' | 'web'

type RequestFetcher = (request: Request) => Response | Promise<Response>

export function routeFor(pathname: string): EdgeRoute {
  if (pathname.startsWith('/api/')) return 'backend'
  return 'web'
}

export async function routeRequest(
  request: Request,
  backendOrigin: string,
  webFetch: RequestFetcher,
  upstreamFetch: RequestFetcher = fetch,
): Promise<Response> {
  const requestUrl = new URL(request.url)
  const route = routeFor(requestUrl.pathname)

  let response: Response
  if (route === 'backend') {
    const backendUrl = new URL(backendOrigin)
    const upstreamUrl = new URL(request.url)
    upstreamUrl.host = backendUrl.host
    upstreamUrl.protocol = backendUrl.protocol

    const forwarded = new Request(upstreamUrl.toString(), request)
    forwarded.headers.set('X-Forwarded-Host', requestUrl.host)
    forwarded.headers.set('X-Forwarded-Proto', 'https')
    response = await upstreamFetch(forwarded)
  } else {
    response = await webFetch(request)
  }

  const routed = new Response(response.body, response)
  routed.headers.set('x-spool-route', route)
  return routed
}
