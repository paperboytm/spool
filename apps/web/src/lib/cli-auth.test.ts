import { afterEach, describe, expect, it, vi } from 'vitest'

import { decideCliAuth, fetchCliAuthInfo } from './cli-auth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCliAuthInfo', () => {
  it('ok on 200 with the request metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ user_code: 'XKCD-2941', label: 'devbox', created: 5 }),
      ),
    )
    const r = await fetchCliAuthInfo('XKCD-2941')
    expect(r).toEqual({
      kind: 'ok',
      info: { user_code: 'XKCD-2941', label: 'devbox', created: 5 },
    })
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      '/api/cli-auth/approve?code=XKCD-2941',
    )
  })

  it('unauthenticated on 401 (page bounces to /sign-in)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'UNAUTHENTICATED' }, 401)))
    expect(await fetchCliAuthInfo('XKCD-2941')).toEqual({ kind: 'unauthenticated' })
  })

  it('gone on 404 and on 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'NOT_FOUND' }, 404)))
    expect(await fetchCliAuthInfo('XKCD-2941')).toEqual({ kind: 'gone' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'BAD_REQUEST' }, 400)))
    expect(await fetchCliAuthInfo('junk')).toEqual({ kind: 'gone' })
  })

  it('error on network failure and 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await fetchCliAuthInfo('XKCD-2941')).toEqual({ kind: 'error' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    expect(await fetchCliAuthInfo('XKCD-2941')).toEqual({ kind: 'error' })
  })
})

describe('decideCliAuth', () => {
  it('posts the decision and resolves ok', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await decideCliAuth('XKCD-2941', 'approve')).toEqual({ kind: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('/api/cli-auth/approve')
    expect(JSON.parse(String(init.body))).toEqual({
      user_code: 'XKCD-2941',
      decision: 'approve',
    })
  })

  it('gone when the request has expired underneath the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'NOT_FOUND' }, 404)))
    expect(await decideCliAuth('XKCD-2941', 'deny')).toEqual({ kind: 'gone' })
  })
})
