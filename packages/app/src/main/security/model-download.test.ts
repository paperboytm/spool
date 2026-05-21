import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadModel, DownloadError } from './model-download.js'
import type { ModelManifest } from './model-manifest.js'

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

function makeManifest(files: { path: string; body: Buffer }[]): ModelManifest {
  return {
    hfRepo: 'spool-lab/test-model',
    hfCommit: 'a'.repeat(40),
    files: files.map(({ path, body }) => ({
      path,
      sha256: sha256(body),
      sizeBytes: body.length,
    })),
  }
}

function makeFetch(responses: Record<string, { body: Buffer; status?: number }>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const r = responses[url]
    if (!r) throw new Error(`unexpected fetch: ${url}`)
    const range = (init?.headers as Record<string, string> | undefined)?.['Range']
    if (range) {
      const m = /bytes=(\d+)-/.exec(range)
      const start = m ? Number.parseInt(m[1]!, 10) : 0
      const slice = r.body.subarray(start)
      return new Response(slice, { status: 206 })
    }
    return new Response(r.body, { status: r.status ?? 200 })
  }) as typeof globalThis.fetch
}

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'spool-pf-dl-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('downloadModel', () => {
  it('downloads every manifest file, verifying SHA-256', async () => {
    const a = Buffer.from('aaaaaaaa')
    const b = Buffer.from('bbbbbbbbbb')
    const manifest = makeManifest([{ path: 'a.bin', body: a }, { path: 'b.bin', body: b }])
    const fetchFn = makeFetch({
      [`https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/a.bin`]: { body: a },
      [`https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/b.bin`]: { body: b },
    })
    const progress: number[] = []
    await downloadModel({
      modelDir: tmp, manifest, fetch: fetchFn,
      onProgress: (p) => progress.push(p.bytesDownloaded),
    })
    expect(readFileSync(join(tmp, 'a.bin'))).toEqual(a)
    expect(readFileSync(join(tmp, 'b.bin'))).toEqual(b)
    expect(progress.at(-1)).toBe(a.length + b.length)
  })

  it('skips a file that already matches on disk', async () => {
    const body = Buffer.from('already-here')
    const manifest = makeManifest([{ path: 'cached.bin', body }])
    writeFileSync(join(tmp, 'cached.bin'), body)
    const fetchFn = vi.fn() as unknown as typeof globalThis.fetch
    await downloadModel({ modelDir: tmp, manifest, fetch: fetchFn })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('resumes from a partial .part using Range requests', async () => {
    const body = Buffer.from('0123456789ABCDEF')
    const manifest = makeManifest([{ path: 'big.bin', body }])
    writeFileSync(join(tmp, 'big.bin.part'), body.subarray(0, 6))  // 6 of 16 bytes already fetched
    const url = `https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/big.bin`
    const rangeRequests: (string | undefined)[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString()
      expect(u).toBe(url)
      const range = (init?.headers as Record<string, string> | undefined)?.['Range']
      rangeRequests.push(range)
      const m = range && /bytes=(\d+)-/.exec(range)
      const start = m ? Number.parseInt(m[1]!, 10) : 0
      return new Response(body.subarray(start), { status: 206 })
    }) as typeof globalThis.fetch
    await downloadModel({ modelDir: tmp, manifest, fetch: fetchFn })
    expect(readFileSync(join(tmp, 'big.bin'))).toEqual(body)
    expect(rangeRequests).toEqual(['bytes=6-'])
  })

  it('throws DownloadError when the SHA-256 disagrees with the manifest', async () => {
    const declared = Buffer.from('expected')
    const served = Buffer.from('tampered')
    const manifest: ModelManifest = {
      hfRepo: 'r', hfCommit: 'c'.repeat(40),
      files: [{ path: 'x.bin', sha256: sha256(declared), sizeBytes: declared.length }],
    }
    const url = `https://huggingface.co/r/resolve/${'c'.repeat(40)}/x.bin`
    const fetchFn = makeFetch({ [url]: { body: served } })
    await expect(downloadModel({ modelDir: tmp, manifest, fetch: fetchFn }))
      .rejects.toBeInstanceOf(DownloadError)
  })

  it('throws DownloadError on a non-2xx response', async () => {
    const manifest = makeManifest([{ path: 'x.bin', body: Buffer.from('x') }])
    const fetchFn = (async () => new Response('not found', { status: 404 })) as typeof globalThis.fetch
    await expect(downloadModel({ modelDir: tmp, manifest, fetch: fetchFn }))
      .rejects.toBeInstanceOf(DownloadError)
  })

  it('cancels mid-stream when the AbortSignal fires', async () => {
    const body = Buffer.from('x'.repeat(64))
    const manifest = makeManifest([{ path: 'x.bin', body }])
    const controller = new AbortController()
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      // Trigger abort before the body is consumed.
      setTimeout(() => controller.abort(), 0)
      const sig = init?.signal
      if (sig?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Promise<Response>((_resolve, reject) => {
        sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }) as typeof globalThis.fetch
    await expect(downloadModel({
      modelDir: tmp, manifest, fetch: fetchFn, signal: controller.signal,
    })).rejects.toBeTruthy()
    // No final renamed file should appear.
    expect(existsSync(join(tmp, 'x.bin'))).toBe(false)
  })

  it('discards a corrupt resume that is larger than expected', async () => {
    const body = Buffer.from('abcd')
    const manifest = makeManifest([{ path: 'x.bin', body }])
    writeFileSync(join(tmp, 'x.bin.part'), Buffer.from('zzzzzzzzzzzzz'))  // larger than expectedSize
    const url = `https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/x.bin`
    const fetchFn = makeFetch({ [url]: { body } })
    await downloadModel({ modelDir: tmp, manifest, fetch: fetchFn })
    expect(readFileSync(join(tmp, 'x.bin'))).toEqual(body)
  })
})
