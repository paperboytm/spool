import { describe, expect, it } from 'vitest'
import { parseClaudeSessionText } from './messages.js'

const line = (value: unknown): string => JSON.stringify(value)

const baseRecord = (overrides: Record<string, unknown>) => ({
  sessionId: 'test-uuid',
  cwd: '/tmp',
  timestamp: '2026-01-01T00:00:00Z',
  ...overrides,
})

function parse(records: Record<string, unknown>[]) {
  const raw = records.map(line).join('\n')
  return parseClaudeSessionText(raw, '/fake/session.jsonl')
}

describe('parseClaudeSessionText — tag stripping', () => {
  it('leaves no "<script" substring in the title or extracted text for nested-tag payloads', () => {
    // Regression for js/incomplete-multi-character-sanitization and
    // js/polynomial-redos on the old single-pass `/<[^>]+>/g` strip: nested
    // angle-bracket payloads like this are the canonical incomplete-
    // sanitization probe.
    const result = parse([
      baseRecord({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: '<<script>script>alert(1)</script>' },
      }),
      baseRecord({
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: 'ok', model: 'claude-opus-4-6' },
      }),
    ])

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.title).not.toContain('<script')
    const userText = result.session.messages.find(m => m.role === 'user')?.contentText
    expect(userText).not.toContain('<script')
  })

  it('does not hang on a long run of unterminated "<" characters (ReDoS probe)', () => {
    // The old `/<[^>]+>/g` regex backtracks polynomially on inputs where the
    // `[^>]+` run never finds a closing `>` (measured ~4.5s @ 100k chars on
    // the pre-fix regex vs. sub-millisecond here). This must resolve near-
    // instantly with the fixed-point, `<`-excluding pattern.
    const hostile = '<'.repeat(100_000)
    const start = Date.now()
    const result = parse([
      baseRecord({ type: 'user', uuid: 'u1', message: { role: 'user', content: hostile } }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'ok', model: 'claude-opus-4-6' } }),
    ])
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(1_000)
    expect(result.kind).toBe('parsed')
  })

  it('strips a well-formed <spool-system-prelude> block from user text', () => {
    const result = parse([
      baseRecord({
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: '<spool-system-prelude>\nsystem stuff\n</spool-system-prelude>\n\nwhat did I do today?',
        },
      }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'ok', model: 'claude-opus-4-6' } }),
    ])

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.messages[0]?.contentText).toBe('what did I do today?')
  })

  it('documents current behavior: an unterminated <spool-system-prelude> block is left as-is, aside from the final tag strip', () => {
    // stripBlocks is indexOf-based: when the close tag never appears, the
    // block is left untouched. The final fixed-point tag strip still
    // removes the lone, well-formed open tag (it has no embedded `<`/`>`),
    // but everything else — including what would have been the "hidden"
    // system body — survives as plain text.
    const result = parse([
      baseRecord({
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: '<spool-system-prelude>\nsystem stuff without a close tag\n\nwhat did I do today?',
        },
      }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'ok', model: 'claude-opus-4-6' } }),
    ])

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.messages[0]?.contentText).toBe('system stuff without a close tag\n\nwhat did I do today?')
  })
})
