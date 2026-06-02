import { describe, it, expect } from 'vitest'
import { stripSpoolSystemPrelude, wrapSpoolSystemPrelude } from './spool-prelude.js'

describe('wrapSpoolSystemPrelude', () => {
  it('puts system body inside marker and query outside', () => {
    const out = wrapSpoolSystemPrelude('SYS', 'q')
    expect(out).toBe('<spool-system-prelude>\nSYS\n</spool-system-prelude>\n\nq')
  })

  it('round-trips through stripSpoolSystemPrelude to leave only the query', () => {
    const out = wrapSpoolSystemPrelude('a long system instruction\nwith newlines', 'what did I do today?')
    expect(stripSpoolSystemPrelude(out)).toBe('what did I do today?')
  })
})

describe('stripSpoolSystemPrelude', () => {
  it('removes the prelude block and surrounding whitespace', () => {
    const input = '<spool-system-prelude>\ninstructions here\n</spool-system-prelude>\n\nactual query'
    expect(stripSpoolSystemPrelude(input)).toBe('actual query')
  })

  it('is a no-op when no marker is present', () => {
    expect(stripSpoolSystemPrelude('just a query')).toBe('just a query')
  })

  it('handles multi-line content inside the marker', () => {
    const input = `<spool-system-prelude>
line 1
line 2
line 3
</spool-system-prelude>

q`
    expect(stripSpoolSystemPrelude(input)).toBe('q')
  })

  it('handles multiple blocks (defensive — should never happen in practice)', () => {
    const input = '<spool-system-prelude>a</spool-system-prelude>\n<spool-system-prelude>b</spool-system-prelude>\nq'
    expect(stripSpoolSystemPrelude(input)).toBe('q')
  })

  it('leaves an unterminated marker intact', () => {
    expect(stripSpoolSystemPrelude('<spool-system-prelude>no close tag')).toBe('<spool-system-prelude>no close tag')
  })

  it('stays fast on many unterminated open markers (no quadratic backtracking)', () => {
    const hostile = '<spool-system-prelude>'.repeat(100_000)
    const start = performance.now()
    expect(stripSpoolSystemPrelude(hostile)).toBe(hostile)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
