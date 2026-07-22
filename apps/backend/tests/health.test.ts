import { describe, expect, it } from 'vite-plus/test'

import { onRequest as middleware } from '../functions/_middleware'
import { onRequestGet as healthGet } from '../functions/api/health'

// Hermetic — composes middleware + handler the way Pages does at runtime.
// Live `wrangler pages dev` smoke is deferred to manual.
async function runWithMiddleware(
  req: Request,
  env: { BUILD_VERSION?: string; CF_PAGES_COMMIT_SHA?: string } = {},
): Promise<Response> {
  const ctx = {
    request: req,
    env,
    next: async () => healthGet({ env } as Parameters<typeof healthGet>[0]),
  } as unknown as Parameters<typeof middleware>[0]
  const res = await middleware(ctx)
  if (!(res instanceof Response)) {
    throw new Error('middleware did not return a Response')
  }
  return res
}

describe('GET /api/health', () => {
  it('returns 200 + ok + version + time and the global security headers', async () => {
    const r = await runWithMiddleware(new Request('https://spool.new/api/health'))
    expect(r.status).toBe(200)
    expect(r.headers.get('x-robots-tag')).toBe('noindex')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const body = (await r.json()) as { ok: boolean; version: string; time: string }
    expect(body.ok).toBe(true)
    expect(body.version).toBe('dev')
    // ISO 8601 with milliseconds and trailing Z
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
  })

  it('surfaces BUILD_VERSION when set by the deploy', async () => {
    const r = await runWithMiddleware(new Request('https://spool.new/api/health'), {
      BUILD_VERSION: 'abc1234',
    })
    const body = (await r.json()) as { version: string }
    expect(body.version).toBe('abc1234')
  })

  it('surfaces the Pages commit SHA when no explicit version is set', async () => {
    const r = await runWithMiddleware(new Request('https://spool.new/api/health'), {
      CF_PAGES_COMMIT_SHA: '717422e012345678901234567890123456789012',
    })
    const body = (await r.json()) as { version: string }
    expect(body.version).toBe('717422e012345678901234567890123456789012')
  })
})
