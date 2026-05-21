import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

// Minimal shape of @opentelemetry/core's ExportResult — avoids pulling
// in the package just for two fields.
interface ExportResult {
  code: number
  error?: Error
}

export interface RotatingFileSpanExporterOptions {
  /** Directory where `spool-YYYY-MM-DD.jsonl` files live. */
  readonly dir: string
  /** Cap total bytes across all log files; oldest dropped first. */
  readonly maxTotalBytes?: number
  /** Override "today" for tests. */
  readonly now?: () => Date
}

const FILE_PREFIX = 'spool-'
const FILE_SUFFIX = '.jsonl'
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024

export class RotatingFileSpanExporter implements SpanExporter {
  private readonly dir: string
  private readonly maxTotalBytes: number
  private readonly now: () => Date
  // Running estimate of bytes on disk across all log files. Maintained
  // incrementally on each append so the happy path doesn't pay for a
  // full readdir+stat sweep per span (SimpleSpanProcessor calls
  // export() once per finished span — so this runs in the scan hot
  // path). Seeded from disk on first export.
  private totalBytes: number | null = null

  constructor(opts: RotatingFileSpanExporterOptions) {
    this.dir = opts.dir
    this.maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
    this.now = opts.now ?? (() => new Date())
    mkdirSync(this.dir, { recursive: true })
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const path = this.todayPath()
      const payload = spans.map(spanToJsonLine).join('')
      if (payload.length > 0) appendFileSync(path, payload)
      if (this.totalBytes === null) this.totalBytes = readDirTotal(this.dir)
      else this.totalBytes += payload.length
      if (this.totalBytes > this.maxTotalBytes) this.enforceSizeCap()
      resultCallback({ code: 0 })
    } catch (err) {
      resultCallback({ code: 1, error: err instanceof Error ? err : new Error(String(err)) })
    }
  }

  shutdown(): Promise<void> { return Promise.resolve() }
  forceFlush(): Promise<void> { return Promise.resolve() }

  private todayPath(): string {
    const d = this.now()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return join(this.dir, `${FILE_PREFIX}${yyyy}-${mm}-${dd}${FILE_SUFFIX}`)
  }

  private enforceSizeCap(): void {
    const entries = listEntries(this.dir)
    let total = entries.reduce((a, e) => a + e.size, 0)
    if (total <= this.maxTotalBytes) {
      this.totalBytes = total
      return
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const e of entries) {
      if (total <= this.maxTotalBytes) break
      try { rmSync(e.path, { force: true }) } catch { continue }
      total -= e.size
    }
    this.totalBytes = total
  }
}

interface SpanRecord {
  readonly ts: string
  readonly name: string
  readonly durationMs: number
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string | null
  readonly status: 'ok' | 'error' | 'unset'
  readonly statusMessage?: string
  readonly attributes: Record<string, unknown>
}

function spanToJsonLine(span: ReadableSpan): string {
  const rec: SpanRecord = {
    ts: hrTimeToIso(span.endTime),
    name: span.name,
    durationMs: hrTimeToMs(span.duration),
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    status:
      span.status.code === SpanStatusCode.OK ? 'ok'
      : span.status.code === SpanStatusCode.ERROR ? 'error'
      : 'unset',
    ...(span.status.message ? { statusMessage: span.status.message } : {}),
    attributes: { ...span.attributes },
  }
  return JSON.stringify(rec) + '\n'
}

function hrTimeToIso(hr: [number, number]): string {
  const ms = hr[0] * 1000 + Math.floor(hr[1] / 1_000_000)
  return new Date(ms).toISOString()
}

function hrTimeToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000
}

interface FileEntry { path: string; size: number; mtimeMs: number }

function listEntries(dir: string): FileEntry[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  return names
    .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
    .map((name): FileEntry | null => {
      const path = join(dir, name)
      try {
        const st = statSync(path)
        return { path, size: st.size, mtimeMs: st.mtimeMs }
      } catch { return null }
    })
    .filter((e): e is FileEntry => e !== null)
}

function readDirTotal(dir: string): number {
  return listEntries(dir).reduce((a, e) => a + e.size, 0)
}

/** Test-only utility — exported for fixtures that need to enumerate
 *  rotated files. Not part of the public surface. */
export function listLogFiles(dir: string): string[] {
  return listEntries(dir).map((e) => e.path.split('/').pop() ?? '').sort()
}
