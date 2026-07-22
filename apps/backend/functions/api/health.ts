import type { PagesFunction } from '@cloudflare/workers-types'

type Env = {
  // BUILD_VERSION is available for non-Pages deployments. Wrangler attaches
  // the Git commit to direct-upload Pages deployments, which Pages exposes as
  // CF_PAGES_COMMIT_SHA at runtime.
  BUILD_VERSION?: string
  CF_PAGES_COMMIT_SHA?: string
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return new Response(
    JSON.stringify({
      ok: true,
      version: ctx.env.BUILD_VERSION ?? ctx.env.CF_PAGES_COMMIT_SHA ?? 'dev',
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
