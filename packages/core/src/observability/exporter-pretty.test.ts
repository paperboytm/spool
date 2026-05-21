import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { PrettyConsoleSpanExporter } from './exporter-pretty.js'
import { observabilityLayer } from './layer.js'

function lines(): { sink: (l: string) => void; out: string[] } {
  const out: string[] = []
  return { sink: (l) => out.push(l), out }
}

describe('PrettyConsoleSpanExporter', () => {
  it('writes one line per finished span with name, duration, attributes', async () => {
    const { sink, out } = lines()
    const exporter = new PrettyConsoleSpanExporter({ sink, noColor: true })
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.succeed(undefined).pipe(
          Effect.withSpan('test.work', { attributes: { sessionId: 42, kind: 'api-key' } }),
        )
      }).pipe(Effect.provide(observabilityLayer({
        serviceName: 'test',
        env: 'test',
        testExporter: exporter,
      }))),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('[test.work]')
    expect(out[0]).toContain('sessionId=42')
    expect(out[0]).toContain('kind=api-key')
    expect(out[0]).toMatch(/\(\d+(\.\d+)?(ms|s)\)/)
  })

  it('truncates long string attributes to keep one-line output readable', async () => {
    const { sink, out } = lines()
    const exporter = new PrettyConsoleSpanExporter({ sink, noColor: true })
    const longValue = 'x'.repeat(200)
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.succeed(undefined).pipe(
          Effect.withSpan('test.work', { attributes: { blob: longValue } }),
        )
      }).pipe(Effect.provide(observabilityLayer({
        serviceName: 'test',
        env: 'test',
        testExporter: exporter,
      }))),
    )
    expect(out[0]).toContain('…')
    expect(out[0]?.length).toBeLessThan(longValue.length + 80)
  })

  it.skipIf(!process.stdout.isTTY)('emits ANSI color codes when stdout is a TTY', async () => {
    const { sink, out } = lines()
    const exporter = new PrettyConsoleSpanExporter({ sink, noColor: false })
    await Effect.runPromise(
      Effect.succeed(undefined).pipe(
        Effect.withSpan('test.work', { attributes: { k: 1 } }),
        Effect.provide(observabilityLayer({
          serviceName: 'test',
          env: 'test',
          testExporter: exporter,
        })),
      ),
    )
    // eslint-disable-next-line no-control-regex
    expect(out[0]).toMatch(/\x1b\[\d+m/)
  })
})
