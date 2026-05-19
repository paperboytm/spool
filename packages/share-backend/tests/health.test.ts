import { describe, expect, it } from 'vitest'

import { onRequest as middleware } from '../functions/_middleware'
import { onRequestGet as healthGet } from '../functions/api/health'

// We exercise the handler + middleware directly with constructed Request
// objects. This keeps the test hermetic (no wrangler/miniflare boot) and
// still verifies the end-to-end contract for GET /api/health:
//   - 200 + { ok: true }
//   - X-Robots-Tag: noindex set by the global middleware
//
// Live wrangler smoke (`pnpm --filter @spool/share-backend dev`) is deferred
// to manual testing; the wiring is captured by these two units composed the
// same way the Pages runtime composes them.
async function runWithMiddleware(req: Request): Promise<Response> {
  const ctx = {
    request: req,
    next: async () => healthGet(),
    // Pages PagesFunction context has many more fields at runtime; the
    // middleware only touches `next()`, so a minimal stub is enough.
  } as unknown as Parameters<typeof middleware>[0]
  const res = await middleware(ctx)
  if (!(res instanceof Response)) {
    throw new Error('middleware did not return a Response')
  }
  return res
}

describe('GET /api/health', () => {
  it('returns 200 + { ok: true } and noindex header', async () => {
    const r = await runWithMiddleware(
      new Request('https://spool.share/api/health'),
    )
    expect(r.status).toBe(200)
    expect(r.headers.get('x-robots-tag')).toBe('noindex')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(await r.json()).toEqual({ ok: true })
  })
})
