// Cross-package OG contract test for the /s/<id> Pages Function.
//
// The contract: the function injects Open Graph tags only when
// /api/meta/<id> returns 200. share-backend returns 410 for a revoked
// share, and the function MUST treat that as a tombstone — no OG
// injection — so social crawlers don't cache live-looking metadata
// (og:title / og:url / og:image) for a dead URL. This pins that contract
// on the web side; the backend behavior is mocked, not changed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onRequest } from './[id]'

const VALID_ID = 'abcdefghijklmnopqrstu' // 21 chars, matches SLUG_RE
const ORIGIN = 'https://spool.pro'

const SHELL_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <meta name="robots" content="noindex" />',
  '    <title>spool.pro</title>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n')

function makeEnv() {
  return {
    ASSETS: {
      fetch: vi.fn(async () =>
        new Response(SHELL_HTML, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    },
  }
}

function makeCtx(id: string, env: ReturnType<typeof makeEnv>) {
  return {
    request: new Request(`${ORIGIN}/s/${id}`),
    env,
    params: { id },
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('/s/[id] OG injection contract', () => {
  it('a 410 from /api/meta produces a tombstone shell with NO OG injection', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('gone', { status: 410 }),
    )
    const res = await onRequest(makeCtx(VALID_ID, makeEnv()))
    const body = await res.text()

    expect(res.status).toBe(410)
    // No live-looking metadata for a dead share.
    expect(body).not.toContain('og:title')
    expect(body).not.toContain('og:url')
    expect(body).not.toContain('og:image')
    expect(body).not.toContain(`/s/${VALID_ID}`)
    // The passthrough shell keeps its noindex (so a 410 page can't be
    // crawled as if it were a live share) and never caches.
    expect(body).toMatch(/name=["']robots["']/i)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('a 200 from /api/meta injects the normal OG tags', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'My great chat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await onRequest(makeCtx(VALID_ID, makeEnv()))
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('<meta property="og:title" content="My great chat">')
    expect(body).toContain(`<meta property="og:url" content="${ORIGIN}/s/${VALID_ID}">`)
    expect(body).toContain(
      `<meta property="og:image" content="${ORIGIN}/api/og/${VALID_ID}.png">`,
    )
    // A served-with-200 share IS indexable — the noindex is stripped.
    expect(body).not.toMatch(/name=["']robots["']/i)
    expect(res.headers.get('cache-control')).toContain('max-age=30')
  })

  it('skips the API round-trip and tombstones on an invalid slug', async () => {
    const res = await onRequest(makeCtx('too-short', makeEnv()))
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
