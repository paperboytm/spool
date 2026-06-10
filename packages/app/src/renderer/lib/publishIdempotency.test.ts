import { describe, expect, it } from 'vitest'
import { computePublishIdempotencyKey, stableStringify } from './publishIdempotency.js'
import type { Snapshot, Visibility } from '../../shared/share-publish.js'

function snap(over?: Partial<Snapshot['conversation']>): Snapshot {
  return {
    schema_version: 1,
    source: {
      kind: 'spool-session',
      captured_at: '2026-06-01T00:00:00.000Z',
    },
    conversation: {
      title: 'Hello',
      turns: [{ id: 't1', role: 'user', content: 'hi' }],
      turn_order: ['t1'],
      hidden_turns: [],
      ...over,
    },
    editor_opts: {
      template: 'chat',
      paper: 'parchment',
      typeface: 'geist',
      colorway: 'amber',
      density: 'relaxed',
      masthead: true,
      colophon: true,
      avatars: true,
      show_byline: true,
    },
  }
}

describe('computePublishIdempotencyKey', () => {
  it('returns a 64-char lowercase hex digest', async () => {
    const key = await computePublishIdempotencyKey({
      snapshot: snap(),
      visibility: 'unlisted',
    })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same key for the same intent on repeat calls', async () => {
    const a = await computePublishIdempotencyKey({ snapshot: snap(), visibility: 'unlisted' })
    const b = await computePublishIdempotencyKey({ snapshot: snap(), visibility: 'unlisted' })
    // The dropped-response retry guarantee depends on this — every
    // behaviour test of the backend idempotency path leans on key
    // stability across re-invocations.
    expect(a).toBe(b)
  })

  it('differs when visibility changes', async () => {
    const a = await computePublishIdempotencyKey({ snapshot: snap(), visibility: 'unlisted' })
    const b = await computePublishIdempotencyKey({
      snapshot: snap(),
      visibility: 'profile-listed' as Visibility,
    })
    expect(a).not.toBe(b)
  })

  it('keeps the frozen expires_at:null in the canonical form (legacy hash compatibility)', async () => {
    // The expiry feature was removed, but every pre-removal "Never"
    // publish hashed a canonical object that contained expires_at:null.
    // The canonical form must keep that key frozen — dropping it would
    // silently re-key every existing share, breaking the republish
    // short-circuit and the editor's drift badge. This pins the exact
    // bytes that feed the hash.
    const canonical = stableStringify({
      snapshot: snap(),
      visibility: 'unlisted',
      expires_at: null,
    })
    const bytes = new TextEncoder().encode(canonical)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const expected = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const key = await computePublishIdempotencyKey({ snapshot: snap(), visibility: 'unlisted' })
    expect(key).toBe(expected)
  })

  it('differs when the snapshot body changes', async () => {
    const a = await computePublishIdempotencyKey({ snapshot: snap(), visibility: 'unlisted' })
    const edited = snap({ title: 'Hello edited' })
    const b = await computePublishIdempotencyKey({ snapshot: edited, visibility: 'unlisted' })
    expect(a).not.toBe(b)
  })
})

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    // Without recursive sort, an object built by a different code path
    // (e.g. an editor that adds opts in a different order) would hash
    // to a different idempotency key for the same logical intent.
    expect(stableStringify({ b: 1, a: { z: 1, y: 2 } })).toBe(
      '{"a":{"y":2,"z":1},"b":1}',
    )
  })

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('round-trips through arbitrary nested objects', () => {
    const value = { x: [{ b: 1, a: 2 }, { d: 3, c: 4 }] }
    expect(stableStringify(value)).toBe('{"x":[{"a":2,"b":1},{"c":4,"d":3}]}')
  })
})
