import type { PagesFunction } from '@cloudflare/workers-types'

type Env = {
  // CI deploy sets this to the short git SHA (or release tag). Surfaced in
  // the health response so an operator can curl /api/health and tell
  // which deploy is currently live without reading dashboards.
  BUILD_VERSION?: string
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return new Response(
    JSON.stringify({
      ok: true,
      version: ctx.env.BUILD_VERSION ?? 'dev',
      time: new Date().toISOString(),
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )
}
