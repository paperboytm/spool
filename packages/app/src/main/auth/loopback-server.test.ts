import { describe, expect, it } from 'vitest'
import { startLoopback } from './loopback-server.js'

async function fetchPath(port: number, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`)
}

describe('startLoopback', () => {
  it('resolves with code+state when callback matches expected state', async () => {
    const loop = await startLoopback('abc123', 5_000)
    const res = await fetchPath(loop.port, '/callback?code=XYZ&state=abc123')
    expect(res.status).toBe(200)
    expect(await loop.awaitCallback()).toEqual({ code: 'XYZ', state: 'abc123' })
  })

  it('listens on a randomly assigned port (>0)', async () => {
    const loop = await startLoopback('s', 5_000)
    expect(loop.port).toBeGreaterThan(0)
    expect(loop.redirectUri).toBe(`http://127.0.0.1:${loop.port}/callback`)
    await fetchPath(loop.port, '/callback?code=c&state=s')
    await loop.awaitCallback()
  })

  it('rejects on state mismatch', async () => {
    const loop = await startLoopback('expected', 5_000)
    await fetchPath(loop.port, '/callback?code=C&state=wrong')
    await expect(loop.awaitCallback()).rejects.toThrow(/state mismatch/)
  })

  it('rejects when code or state missing', async () => {
    const loop = await startLoopback('expected', 5_000)
    await fetchPath(loop.port, '/callback?state=expected')
    await expect(loop.awaitCallback()).rejects.toThrow(/missing params/)
  })

  it('returns 404 for non-/callback paths and does not resolve', async () => {
    const loop = await startLoopback('s', 5_000)
    const res = await fetchPath(loop.port, '/something-else')
    expect(res.status).toBe(404)
    // Then a real callback still resolves
    await fetchPath(loop.port, '/callback?code=c&state=s')
    await expect(loop.awaitCallback()).resolves.toEqual({ code: 'c', state: 's' })
  })

  it('rejects after configurable timeout', async () => {
    const loop = await startLoopback('s', 50)
    await expect(loop.awaitCallback()).rejects.toThrow(/timeout/)
  })

  it('settles once: state-mismatch then valid callback keeps the first rejection', async () => {
    const loop = await startLoopback('expected', 5_000)
    await fetchPath(loop.port, '/callback?code=C&state=wrong')
    await fetchPath(loop.port, '/callback?code=C&state=expected').catch(() => undefined)
    await expect(loop.awaitCallback()).rejects.toThrow(/state mismatch/)
  })

  describe('success landing page', () => {
    it('is served as text/html with the post-redirect content', async () => {
      const loop = await startLoopback('s', 5_000)
      const res = await fetchPath(loop.port, '/callback?code=c&state=s')
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      const html = await res.text()
      // Sanity: it's the new branded page, not the old bare body.
      expect(html).toMatch(/Signed in to Spool/)
      expect(html).toMatch(/You're signed in/)
      // No window.close() — the tab was opened by the OS browser when
      // Electron called shell.openExternal, and only scripts that
      // themselves opened a window can close it. Promising auto-close
      // in the copy or code would be a lie.
      expect(html).not.toMatch(/window\.close\(\)/)
      // The copy must tell the user to close manually.
      expect(html).toMatch(/close this tab/i)
      await loop.awaitCallback()
    })

    it('uses no external resources (sits on 127.0.0.1, would race the auto-close)', async () => {
      const loop = await startLoopback('s', 5_000)
      const res = await fetchPath(loop.port, '/callback?code=c&state=s')
      const html = await res.text()
      // No <link rel> to a CDN, no fonts.gstatic, no img src outside data:
      expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/)
      expect(html).not.toMatch(/fonts\.gstatic\.com|fonts\.googleapis\.com/)
      expect(html).not.toMatch(/<img\s+src=["'](?!data:)/)
      await loop.awaitCallback()
    })
  })
})
