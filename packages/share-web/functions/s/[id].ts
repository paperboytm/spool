// Pages Function for /s/<id>.
//
// Why this exists: the React SPA can't supply Open Graph / Twitter Card
// meta tags because social-platform scrapers don't execute JavaScript.
// Without server-side injection the OG renderer in share-backend goes
// to waste — pasting a /s/<id> URL into any social client shows a blank
// preview. This function fetches the share's title from share-backend
// once per request, injects it (plus a canonical link and the matching
// og:image pointing at /api/og/<id>.png) into the static SPA shell, and
// returns the rewritten HTML.
//
// In dev (vite) the function never runs — vite serves index.html as the
// SPA fallback and the page hydrates client-side, which is fine because
// social previews are a prod concern only.

import { buildOgTagBlock, injectMetaIntoHtml } from '../../src/lib/og-meta'

const SLUG_RE = /^[A-Za-z0-9_-]{21}$/

// share-web doesn't depend on @cloudflare/workers-types — bring in the
// thin surface we actually use as a local declaration so we don't ship
// an extra type-only dep for one file.
interface PagesFunctionContext<E, P extends string> {
  request: Request
  env: E
  params: { [K in P]: string }
}
type PagesFunction<E, P extends string = string> = (
  ctx: PagesFunctionContext<E, P>,
) => Response | Promise<Response>

interface Env {
  // Standard Pages binding that fetches static assets from the build
  // output. We use it to grab the unmodified index.html shell.
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  // Origin to call for /api/snapshots. In prod the dispatcher routes
  // spool.pro/api/* to share-backend, so the default of "same origin
  // as the incoming request" works. In `wrangler pages dev`, share-web
  // and share-backend listen on different ports — set this to the
  // share-backend origin (e.g. http://localhost:8788) via
  // `--binding API_BASE_URL=...` so the inline fetch finds it.
  API_BASE_URL?: string
}

interface SnapshotForOg {
  conversation?: { title?: string }
}

// Same cache window as /api/snapshots/[id] so a revoke takes the
// social-card preview off-air on the same timeline as the reader page.
const CACHE_HEADER =
  'public, max-age=30, s-maxage=30, must-revalidate'

export const onRequest: PagesFunction<Env, 'id'> = async (ctx) => {
  const id = ctx.params.id as string
  const reqUrl = new URL(ctx.request.url)

  const shell = await ctx.env.ASSETS.fetch(
    new Request(`${reqUrl.origin}/index.html`),
  )

  // Invalid slug — let the SPA's router decide what to show (Tombstone),
  // skip the API round-trip.
  if (!SLUG_RE.test(id)) {
    return passthroughShell(shell, 404)
  }

  const apiBase = ctx.env.API_BASE_URL ?? reqUrl.origin
  let snapStatus = 0
  let title: string | undefined
  try {
    const snapRes = await fetch(`${apiBase}/api/snapshots/${id}`)
    snapStatus = snapRes.status
    if (snapStatus === 200) {
      const snap = (await snapRes.json()) as SnapshotForOg
      title = snap.conversation?.title
    }
  } catch {
    return passthroughShell(shell, 502)
  }

  if (snapStatus === 410) return passthroughShell(shell, 410)
  if (snapStatus === 404) return passthroughShell(shell, 404)
  if (snapStatus !== 200) return passthroughShell(shell, 500)

  const tagBlock = buildOgTagBlock({
    title: title ?? '',
    ogImageUrl: `${reqUrl.origin}/api/og/${id}.png`,
    canonicalUrl: `${reqUrl.origin}/s/${id}`,
  })
  const html = injectMetaIntoHtml(await shell.text(), tagBlock)
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': CACHE_HEADER,
    },
  })
}

function passthroughShell(shell: Response, status: number): Response {
  return new Response(shell.body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
