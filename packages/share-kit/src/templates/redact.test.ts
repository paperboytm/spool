import { describe, it, expect } from 'vitest'
import {
  detectPII,
  applyRedactPolicy,
  collectRedactList,
  SYNTHETIC_KIND_AUTHOR,
  SYNTHETIC_KIND_MANUAL,
  type RedactReplacement,
} from './redact'
import { hashValueForRedactExclude } from '@spool-lab/redact'
import type { Turn } from '@/lib/types'

function turn(role: 'user' | 'assistant', body: string, opts: Partial<Turn> = {}): Turn {
  return { role, body, ...opts } as Turn
}

// Vendor prefixes built at runtime so GitHub's push-protection
// secret scanner doesn't flag the source literals. Also keeps the
// detector's vendor-doc-placeholder validator (which rejects keys
// ending in EXAMPLE / SAMPLE) and reserved-domain validator
// (rejects RFC 2606 example.com) from filtering the test fixtures.
const STRIPE_FIXTURE = 'sk_' + 'live_' + 'aH1xK9pQrSt7VwYzA3bC5dF8gJ'
const AKIA_FIXTURE = 'AKIA' + 'V3QFKW72ZDLNP4XR'
const EMAIL_FIXTURE = 'maya@hogwarts.edu'

const turns: Turn[] = [
  turn('user', `reply to ${EMAIL_FIXTURE}, also ${AKIA_FIXTURE}`, { author: '[Maya]' }),
  turn('assistant', `cat /Users/chen/.aws/credentials -> ${STRIPE_FIXTURE}`, { redact: ['custom-blob'] }),
]

const values = (list: RedactReplacement[]) => list.map((r) => r.value)
const replacementFor = (list: RedactReplacement[], v: string) =>
  list.find((r) => r.value === v)?.replacement

describe('detectPII', () => {
  it('returns matches + groups + names + manual + all', () => {
    const det = detectPII(turns)
    expect(det.matches.length).toBeGreaterThan(0)
    expect(det.groups.find((g) => g.kind === 'email')).toBeTruthy()
    expect(det.names).toContain('Maya')
    expect(det.manual).toContain('custom-blob')
    expect(det.all).toContain(EMAIL_FIXTURE)
    expect(det.all).toContain(AKIA_FIXTURE)
    expect(det.all).toContain('Maya')
    expect(det.all).toContain('custom-blob')
  })
})

describe('applyRedactPolicy', () => {
  it('returns a {value, replacement} entry for every surviving match', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, undefined)
    expect(values(out).sort()).toEqual([...det.all].sort())
    // Replacements are per-kind, not the generic [redacted]
    expect(replacementFor(out, EMAIL_FIXTURE)).toBe('m***@hogwarts.edu')
    expect(replacementFor(out, AKIA_FIXTURE)).toBe('[redacted: AWS key]')
    expect(replacementFor(out, 'Maya')).toBe('[redacted name]')
  })

  it('drops matches whose kind is excluded', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: ['email'] })
    expect(values(out)).not.toContain(EMAIL_FIXTURE)
    expect(values(out)).toContain(AKIA_FIXTURE)
  })

  it('drops matches whose value is excluded', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { values: [EMAIL_FIXTURE] })
    expect(values(out)).not.toContain(EMAIL_FIXTURE)
    expect(values(out)).toContain(AKIA_FIXTURE)
  })

  it('honours kind and value exclusions together (union)', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      kinds: ['absolute-path'],
      values: [EMAIL_FIXTURE],
    })
    expect(values(out)).not.toContain(EMAIL_FIXTURE)
    expect(values(out).find((v) => v.includes('/Users/chen'))).toBeUndefined()
    expect(values(out)).toContain(AKIA_FIXTURE)
  })

  it('honours synthetic author kind opt-out', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: [SYNTHETIC_KIND_AUTHOR] })
    expect(values(out)).not.toContain('Maya')
    expect(values(out)).toContain(EMAIL_FIXTURE)
  })

  it('honours synthetic manual kind opt-out', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: [SYNTHETIC_KIND_MANUAL] })
    expect(values(out)).not.toContain('custom-blob')
  })

  it('honours valueHashes (the persisted form of per-item opt-outs)', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      valueHashes: [hashValueForRedactExclude(EMAIL_FIXTURE)],
    })
    expect(values(out)).not.toContain(EMAIL_FIXTURE)
    expect(values(out)).toContain(AKIA_FIXTURE)
  })

  it('treats values and valueHashes as set union', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      values: ['Maya'],
      valueHashes: [hashValueForRedactExclude(AKIA_FIXTURE)],
    })
    expect(values(out)).not.toContain('Maya')
    expect(values(out)).not.toContain(AKIA_FIXTURE)
  })
})

describe('collectRedactList wires policy through', () => {
  it('without opts redacts everything detected', () => {
    expect(values(collectRedactList(turns))).toContain(EMAIL_FIXTURE)
  })

  it('with opts.redactExclude.kinds drops the named category', () => {
    expect(values(collectRedactList(turns, { redactExclude: { kinds: ['email'] } })))
      .not.toContain(EMAIL_FIXTURE)
  })

  it('with opts.redactExclude.values whitelists a specific literal', () => {
    expect(values(collectRedactList(turns, { redactExclude: { values: ['Maya'] } })))
      .not.toContain('Maya')
  })
})
