// Pages Function for /session/<sid> — server-side OG/Twitter meta tags,
// same rationale as functions/s/[id].ts (scrapers don't run JS). Fetches
// the small head-meta endpoint only; no OG image in this iteration, so
// the tag block is a summary card (see buildSessionOgTagBlock).

import { buildSessionOgTagBlock, injectMetaIntoHtml } from '../../src/lib/og-meta'

const SID_RE = /^(claude|codex)_[0-9A-Za-z-]{8,64}$/

interface PagesFunctionContext<E, P extends string> {
  request: Request
  env: E
  params: { [K in P]: string }
}
type PagesFunction<E, P extends string = string> = (
  ctx: PagesFunctionContext<E, P>,
) => Response | Promise<Response>

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  // Same dev-mode escape hatch as functions/s/[id].ts.
  API_BASE_URL?: string
}

interface HubMetaForOg {
  noteMd: string | null
  count: number
  author: { handle: string | null; displayName: string | null }
}

const CACHE_HEADER = 'public, max-age=30, s-maxage=30, must-revalidate'

export const onRequest: PagesFunction<Env, 'sid'> = async (ctx) => {
  const sid = ctx.params.sid as string
  const reqUrl = new URL(ctx.request.url)

  const shell = await ctx.env.ASSETS.fetch(new Request(`${reqUrl.origin}/index.html`))
  if (!SID_RE.test(sid)) return passthroughShell(shell, 404)

  const apiBase = ctx.env.API_BASE_URL ?? reqUrl.origin
  let status = 0
  let meta: HubMetaForOg | null = null
  try {
    const res = await fetch(`${apiBase}/api/hub/v1/sessions/${encodeURIComponent(sid)}`)
    status = res.status
    if (status === 200) meta = (await res.json()) as HubMetaForOg
  } catch {
    return passthroughShell(shell, 502)
  }

  if (status === 410) return passthroughShell(shell, 410)
  if (status === 404) return passthroughShell(shell, 404)
  if (status !== 200 || meta === null) return passthroughShell(shell, 500)

  const author = meta.author.handle ? `@${meta.author.handle}` : meta.author.displayName ?? 'someone'
  const tagBlock = buildSessionOgTagBlock({
    title: sessionOgTitle(meta),
    description: `A coding-agent session shared by ${author} — ${meta.count} records.`,
    canonicalUrl: `${reqUrl.origin}/session/${sid}`,
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

export function sessionOgTitle(meta: HubMetaForOg): string {
  const noteFirstLine = meta.noteMd?.split('\n', 1)[0]?.trim()
  return noteFirstLine || 'Shared session'
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
