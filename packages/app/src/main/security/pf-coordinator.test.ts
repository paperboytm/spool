import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { makePfCoordinator, type PfDownloadState } from './pf-coordinator.js'
import { MODEL_MANIFEST } from './model-manifest.js'

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

/** Replace MODEL_MANIFEST file shas with the hashes of a fixture body
 *  so the downloader is happy with what our fake server serves. */
function patchManifest(body: Buffer) {
  const original = JSON.parse(JSON.stringify(MODEL_MANIFEST))
  const hash = sha256(body)
  for (const f of MODEL_MANIFEST.files) {
    ;(f as { sha256: string }).sha256 = hash
    ;(f as { sizeBytes: number }).sizeBytes = body.length
  }
  return () => {
    for (let i = 0; i < MODEL_MANIFEST.files.length; i++) {
      const f = MODEL_MANIFEST.files[i] as { sha256: string; sizeBytes: number }
      f.sha256 = original.files[i].sha256
      f.sizeBytes = original.files[i].sizeBytes
    }
  }
}

let tmp: string
let restore: () => void
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'spool-pf-coord-')) })
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  restore?.()
})

describe('PfCoordinator', () => {
  it('starts in not-installed when the model dir is empty', () => {
    const c = makePfCoordinator({ modelDir: tmp })
    expect(c.getState().phase).toBe('not-installed')
    expect(c.getState().bytesDownloaded).toBe(0)
  })

  it('publishes progress + lands in installed on a successful download', async () => {
    const body = Buffer.from('x'.repeat(32))
    restore = patchManifest(body)
    const events: PfDownloadState[] = []
    const c = makePfCoordinator({
      modelDir: tmp,
      fetch: (async () => new Response(body, { status: 200 })) as typeof globalThis.fetch,
    })
    c.subscribe((s) => events.push({ ...s }))
    await c.startDownload()
    expect(c.getState().phase).toBe('installed')
    expect(events.some(e => e.phase === 'downloading')).toBe(true)
    expect(events.at(-1)?.phase).toBe('installed')
  })

  it('lands in failed with an error message on HTTP error', async () => {
    const body = Buffer.from('expected')
    restore = patchManifest(body)
    const c = makePfCoordinator({
      modelDir: tmp,
      fetch: (async () => new Response('nope', { status: 404 })) as typeof globalThis.fetch,
    })
    await c.startDownload()
    const s = c.getState()
    expect(s.phase).toBe('failed')
    expect(s.error).toMatch(/HTTP 404/)
  })

  it('returns to not-installed on cancel — no failed state', async () => {
    const body = Buffer.from('y'.repeat(32))
    restore = patchManifest(body)
    const c = makePfCoordinator({
      modelDir: tmp,
      fetch: ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })) as typeof globalThis.fetch,
    })
    const pending = c.startDownload()
    // Let the start phase publish first.
    await new Promise(r => setTimeout(r, 5))
    c.cancelDownload()
    await pending
    expect(c.getState().phase).toBe('not-installed')
  })

  it('ignores cancel when not downloading', () => {
    const c = makePfCoordinator({ modelDir: tmp })
    c.cancelDownload()
    expect(c.getState().phase).toBe('not-installed')
  })

  it('no-ops a second startDownload while one is in flight', async () => {
    const body = Buffer.from('z'.repeat(16))
    restore = patchManifest(body)
    let calls = 0
    const c = makePfCoordinator({
      modelDir: tmp,
      fetch: (async () => {
        calls++
        await new Promise(r => setTimeout(r, 20))
        return new Response(body, { status: 200 })
      }) as typeof globalThis.fetch,
    })
    const p1 = c.startDownload()
    const p2 = c.startDownload()  // should be a no-op
    await Promise.all([p1, p2])
    expect(c.getState().phase).toBe('installed')
    // Only the first download hit fetch once per manifest file.
    expect(calls).toBe(MODEL_MANIFEST.files.length)
  })

  it('subscribe returns an unsubscribe + dispose clears subscribers', async () => {
    const c = makePfCoordinator({ modelDir: tmp })
    const seen: PfDownloadState[] = []
    const off = c.subscribe((s) => seen.push(s))
    off()
    c.dispose()
    expect(seen).toEqual([])
  })

  it('reports the model as installed when the bundle already sits on disk', () => {
    const body = Buffer.from('preinstalled')
    restore = patchManifest(body)
    for (const file of MODEL_MANIFEST.files) {
      const full = join(tmp, file.path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body)
    }
    const c = makePfCoordinator({ modelDir: tmp })
    expect(c.getState().phase).toBe('installed')
  })
})
