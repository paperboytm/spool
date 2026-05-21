// Privacy Filter model downloader. Streams each manifest file into
// the user's model directory, writing to `<name>.part` and renaming
// only once the full SHA-256 matches. Resumable via HTTP Range. fetch
// is injectable so tests don't touch the network.

import { createHash } from 'node:crypto'
import { createWriteStream, statSync, renameSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ManifestFile, ModelManifest } from './model-manifest.js'
import { manifestFileUrl, manifestTotalBytes } from './model-manifest.js'

export interface DownloadProgress {
  bytesDownloaded: number
  bytesTotal: number
  currentFile: string
  fileIndex: number
}

export interface DownloadOptions {
  modelDir: string
  manifest: ModelManifest
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
}

export interface DownloadErrorCause {
  file: string
  stage: 'http' | 'hash' | 'io'
}

export class DownloadError extends Error {
  readonly downloadCause: DownloadErrorCause | undefined
  constructor(message: string, downloadCause?: DownloadErrorCause) {
    super(message)
    this.name = 'DownloadError'
    this.downloadCause = downloadCause
  }
}

export async function downloadModel(opts: DownloadOptions): Promise<void> {
  const fetcher = opts.fetch ?? globalThis.fetch
  const bytesTotal = manifestTotalBytes(opts.manifest)
  let bytesDownloaded = 0

  mkdirSync(opts.modelDir, { recursive: true })

  for (let i = 0; i < opts.manifest.files.length; i++) {
    const file = opts.manifest.files[i]!
    const finalPath = join(opts.modelDir, file.path)
    const partPath = `${finalPath}.part`
    mkdirSync(dirname(finalPath), { recursive: true })

    if (existsSync(finalPath) && fileMatches(finalPath, file)) {
      bytesDownloaded += file.sizeBytes
      opts.onProgress?.({ bytesDownloaded, bytesTotal, currentFile: file.path, fileIndex: i })
      continue
    }

    let startOffset = existsSync(partPath) ? statSync(partPath).size : 0
    if (startOffset > file.sizeBytes) {
      // Corrupt resume — start over.
      unlinkSync(partPath)
      startOffset = 0
    }
    bytesDownloaded += startOffset

    await fetchAndAppend({
      url: manifestFileUrl(opts.manifest, file),
      partPath,
      startOffset,
      expectedSize: file.sizeBytes,
      fetcher,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      onChunk: (n) => {
        bytesDownloaded += n
        opts.onProgress?.({ bytesDownloaded, bytesTotal, currentFile: file.path, fileIndex: i })
      },
    })

    if (!fileMatches(partPath, file)) {
      throw new DownloadError(
        `SHA-256 mismatch for ${file.path}`,
        { file: file.path, stage: 'hash' },
      )
    }

    renameSync(partPath, finalPath)
  }
}

async function fetchAndAppend(args: {
  url: string
  partPath: string
  startOffset: number
  expectedSize: number
  fetcher: typeof globalThis.fetch
  signal?: AbortSignal
  onChunk: (bytes: number) => void
}): Promise<void> {
  if (args.startOffset >= args.expectedSize) return

  const headers: Record<string, string> = {}
  if (args.startOffset > 0) headers.Range = `bytes=${args.startOffset}-`

  const init: RequestInit = { headers }
  if (args.signal !== undefined) init.signal = args.signal
  let res: Response
  try {
    res = await args.fetcher(args.url, init)
  } catch (cause) {
    // Preserve AbortError so the coordinator's cancel branch (which
    // checks err.name === 'AbortError') still drops back to
    // not-installed instead of flipping to failed.
    if ((cause as { name?: string } | undefined)?.name === 'AbortError') throw cause
    // Network-level failure (DNS, TLS, proxy, connection reset) —
    // re-raise as DownloadError so the coordinator surfaces a
    // useful message instead of a bare "fetch failed".
    const host = safeHost(args.url)
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new DownloadError(
      `Couldn't reach ${host} (${detail}). Check network / proxy.`,
      { file: args.partPath, stage: 'http' },
    )
  }

  if (args.startOffset > 0 && res.status !== 206 && res.status !== 200) {
    throw new DownloadError(
      `Unexpected resume status ${res.status} for ${args.url}`,
      { file: args.partPath, stage: 'http' },
    )
  }
  if (args.startOffset === 0 && !res.ok) {
    throw new DownloadError(
      `HTTP ${res.status} for ${args.url}`,
      { file: args.partPath, stage: 'http' },
    )
  }
  if (!res.body) {
    throw new DownloadError('Response missing body', { file: args.partPath, stage: 'http' })
  }

  // Server may have ignored Range and returned a full stream — if so,
  // start over from offset 0 rather than appending bad bytes.
  const append = res.status === 206 && args.startOffset > 0
  const out = createWriteStream(args.partPath, { flags: append ? 'a' : 'w' })

  const nodeStream = Readable.fromWeb(res.body as never)
  nodeStream.on('data', (chunk: Buffer) => args.onChunk(chunk.length))
  await pipeline(nodeStream, out)
}

function fileMatches(path: string, file: ManifestFile): boolean {
  try {
    const stat = statSync(path)
    if (stat.size !== file.sizeBytes) return false
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    return hash === file.sha256
  } catch {
    return false
  }
}

function safeHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}
