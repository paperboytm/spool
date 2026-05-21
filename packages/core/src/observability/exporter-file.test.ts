import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { RotatingFileSpanExporter, listLogFiles } from './exporter-file.js'
import { observabilityLayer } from './layer.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'spool-otel-'))
  tempDirs.push(d)
  return d
}

async function emitSpan(name: string, attrs: Record<string, unknown>, exporter: RotatingFileSpanExporter): Promise<void> {
  await Effect.runPromise(
    Effect.succeed(undefined).pipe(
      Effect.withSpan(name, { attributes: attrs }),
      Effect.provide(observabilityLayer({
        serviceName: 'test',
        env: 'test',
        testExporter: exporter,
      })),
    ),
  )
}

describe('RotatingFileSpanExporter', () => {
  it('writes one JSON line per span to spool-YYYY-MM-DD.jsonl', async () => {
    const dir = makeTempDir()
    const exporter = new RotatingFileSpanExporter({
      dir,
      now: () => new Date('2026-05-21T12:00:00Z'),
    })
    await emitSpan('test.work', { sessionId: 7 }, exporter)
    const files = listLogFiles(dir)
    expect(files).toEqual(['spool-2026-05-21.jsonl'])
    const content = readFileSync(join(dir, files[0]!), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    const rec = JSON.parse(lines[0]!)
    expect(rec.name).toBe('test.work')
    expect(rec.attributes).toMatchObject({ sessionId: 7 })
    expect(rec.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(rec.spanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('appends additional spans to the same daily file', async () => {
    const dir = makeTempDir()
    const exporter = new RotatingFileSpanExporter({
      dir,
      now: () => new Date('2026-05-21T12:00:00Z'),
    })
    await emitSpan('a', {}, exporter)
    await emitSpan('b', {}, exporter)
    await emitSpan('c', {}, exporter)
    const content = readFileSync(join(dir, 'spool-2026-05-21.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines.map(l => JSON.parse(l).name)).toEqual(['a', 'b', 'c'])
  })

  it('drops oldest files when total size exceeds the cap', async () => {
    const dir = makeTempDir()
    // Seed three pre-existing files (different days, varying ages).
    const old1 = join(dir, 'spool-2026-05-01.jsonl')
    const old2 = join(dir, 'spool-2026-05-02.jsonl')
    const recent = join(dir, 'spool-2026-05-20.jsonl')
    writeFileSync(old1, 'a'.repeat(800))
    writeFileSync(old2, 'b'.repeat(800))
    writeFileSync(recent, 'c'.repeat(800))
    const t = Date.now() / 1000
    utimesSync(old1, t - 20 * 86400, t - 20 * 86400)
    utimesSync(old2, t - 19 * 86400, t - 19 * 86400)
    utimesSync(recent, t - 1 * 86400, t - 1 * 86400)
    const exporter = new RotatingFileSpanExporter({
      dir,
      maxTotalBytes: 2000,
      now: () => new Date('2026-05-21T12:00:00Z'),
    })
    await emitSpan('new', {}, exporter)
    const remaining = readdirSync(dir).sort()
    // Total before: 2400 + today's tiny addition. Cap 2000 → must drop the oldest one or two.
    expect(remaining).toContain('spool-2026-05-21.jsonl')
    expect(remaining).toContain('spool-2026-05-20.jsonl')
    expect(remaining).not.toContain('spool-2026-05-01.jsonl')
  })

  it('ignores non-Spool files in the directory', async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'unrelated.txt'), 'keep')
    writeFileSync(join(dir, 'README.md'), 'keep')
    const exporter = new RotatingFileSpanExporter({
      dir,
      now: () => new Date('2026-05-21T12:00:00Z'),
    })
    await emitSpan('x', {}, exporter)
    const files = readdirSync(dir).sort()
    expect(files).toContain('unrelated.txt')
    expect(files).toContain('README.md')
    expect(files).toContain('spool-2026-05-21.jsonl')
  })
})
