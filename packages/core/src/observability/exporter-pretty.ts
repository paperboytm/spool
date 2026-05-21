import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'

// Minimal shape of @opentelemetry/core's ExportResult — avoids pulling
// in the package just for two fields. The OTel SDK only ever calls back
// with this structure, never type-checks the argument.
interface ExportResult {
  code: number
  error?: Error
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const

export interface PrettyConsoleSpanExporterOptions {
  /** Where to write each line. Defaults to process.stdout. */
  readonly sink?: (line: string) => void
  /** Force colors off (e.g. when stdout isn't a TTY). */
  readonly noColor?: boolean
}

/** Span exporter that prints one line per finished span to the console.
 *  Format: `HH:MM:SS.mmm  [span.name]  (Nms)  k1=v1 k2=v2`.
 *  Designed for the dev loop — file-backed structured output lives in
 *  the file exporter. */
export class PrettyConsoleSpanExporter implements SpanExporter {
  private readonly sink: (line: string) => void
  private readonly color: boolean

  constructor(opts: PrettyConsoleSpanExporterOptions = {}) {
    this.sink = opts.sink ?? ((line) => process.stdout.write(line + '\n'))
    this.color = opts.noColor ? false : process.stdout.isTTY === true
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) this.sink(this.format(span))
    resultCallback({ code: 0 })
  }

  shutdown(): Promise<void> { return Promise.resolve() }
  forceFlush(): Promise<void> { return Promise.resolve() }

  private format(span: ReadableSpan): string {
    const ts = formatTimestamp(span.endTime)
    const durMs = hrTimeToMs(span.duration)
    const isError = span.status.code === SpanStatusCode.ERROR
    const name = isError ? this.tint(span.name, ANSI.red) : this.tint(span.name, ANSI.cyan)
    const dur = this.tint(`(${formatDuration(durMs)})`, ANSI.gray)
    const attrs = formatAttributes(span.attributes)
    const attrsTinted = attrs ? '  ' + this.tint(attrs, ANSI.yellow) : ''
    const statusSuffix = isError && span.status.message
      ? '  ' + this.tint(`error: ${span.status.message}`, ANSI.red)
      : ''
    return `${this.tint(ts, ANSI.dim)}  [${name}]  ${dur}${attrsTinted}${statusSuffix}`
  }

  private tint(s: string, code: string): string {
    return this.color ? `${code}${s}${ANSI.reset}` : s
  }
}

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}` }
function pad3(n: number): string { return n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}` }

function formatTimestamp(hr: [number, number]): string {
  const ms = hr[0] * 1000 + Math.floor(hr[1] / 1_000_000)
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
}

function hrTimeToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatAttributes(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs)
  if (entries.length === 0) return ''
  return entries
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ')
}

function formatValue(v: unknown): string {
  if (v == null) return String(v)
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return JSON.stringify(v).slice(0, 60)
}
