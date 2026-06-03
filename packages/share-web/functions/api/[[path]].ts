// Dev-only /api/* proxy.
//
// In prod the single-domain worker dispatcher routes spool.pro/api/* to
// share-backend, so share-web never sees those requests. In
// `wrangler pages dev` share-web is standalone (different port than
// share-backend), so the browser-side `fetch('/api/snapshots/...')`
// inside Reader.tsx would 404 against share-web's own namespace and
// the reader page would always show Tombstone.
//
// This catch-all forwards every /api/* request to API_BASE_URL when
// it's set — same env var the OG meta function reads. In prod the var
// is unset and this proxy becomes a no-op pass-through to the next
// handler (which doesn't exist, so 404 — matching prod behaviour where
// the dispatcher has already short-circuited /api/* upstream).

interface PagesFunctionContext<E, P extends string> {
  request: Request
  env: E
  params: { [K in P]: string | string[] }
}
type PagesFunction<E, P extends string = string> = (
  ctx: PagesFunctionContext<E, P>,
) => Response | Promise<Response>

interface Env {
  API_BASE_URL?: string
}

export const onRequest: PagesFunction<Env, 'path'> = async (ctx) => {
  if (!ctx.env.API_BASE_URL) {
    return new Response('not found', { status: 404 })
  }

  const inUrl = new URL(ctx.request.url)
  const fwd = new URL(ctx.env.API_BASE_URL)
  fwd.pathname = inUrl.pathname
  fwd.search = inUrl.search

  // Forward verbatim — method, headers, body. The remote sees the
  // original cookie / Authorization, which is what Reader.tsx fetches
  // already use (cookie auth via same-origin browser request).
  const init: RequestInit = {
    method: ctx.request.method,
    headers: ctx.request.headers,
    redirect: 'manual',
  }
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    init.body = ctx.request.body
  }
  return fetch(new Request(fwd.toString(), init))
}
