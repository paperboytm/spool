import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useResolvedRedactList, type RedactReplacement } from './redact'
import type { EditorOpts, Turn } from '@/lib/types'

// Built at runtime so the source literal doesn't trip secret scanners.
const STRIPE_FIXTURE = 'sk_' + 'live_' + 'aH1xK9pQrSt7VwYzA3bC5dF8gJ'

const turns: Turn[] = [
  { role: 'assistant', body: `here is a key: ${STRIPE_FIXTURE}` } as Turn,
]

// Render a probe component so the hook runs inside a real React render
// (useMemo executes during server render; effects don't, which is fine
// here — the hook's value is memo-derived, not effect-derived).
function resolve(
  opts: Pick<EditorOpts, 'redact' | 'redactExclude'>,
  injected: RedactReplacement[] | undefined,
): RedactReplacement[] {
  let captured: RedactReplacement[] = []
  function Probe(): null {
    captured = useResolvedRedactList(turns, opts, injected)
    return null
  }
  renderToStaticMarkup(<Probe />)
  return captured
}

describe('useResolvedRedactList', () => {
  it('skips detection and returns empty when redaction is off', () => {
    const result = resolve({ redact: false, redactExclude: undefined }, undefined)
    expect(result).toEqual([])
  })

  it('runs detection when redaction is on and no list is injected', () => {
    const result = resolve({ redact: true, redactExclude: undefined }, undefined)
    expect(result.map((r) => r.value)).toContain(STRIPE_FIXTURE)
  })

  it('returns the injected list verbatim, bypassing detection', () => {
    const injected: RedactReplacement[] = [{ value: 'x', replacement: '[redacted]' }]
    // Even with redaction on, an injected list wins (and its identity is
    // preserved so downstream memoized Body components stay stable).
    expect(resolve({ redact: true, redactExclude: undefined }, injected)).toBe(injected)
    expect(resolve({ redact: false, redactExclude: undefined }, injected)).toBe(injected)
  })
})
