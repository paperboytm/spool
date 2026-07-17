import { describe, expect, it } from 'vitest'

import { decideSnapshotState } from './api'

const SNAPSHOT_FIXTURE = {
  schema_version: 1,
  source: { kind: 'imported-file', captured_at: '2026-05-19T00:00:00Z' },
  conversation: { title: 'T', turns: [], turn_order: [], hidden_turns: [] },
  editor_opts: {
    template: 'forum',
    paper: 'snow',
    typeface: 'inter',
    colorway: 'amber',
    density: 'compact',
    masthead: true,
    colophon: true,
    avatars: true,
    show_byline: false,
  },
}

describe('decideSnapshotState', () => {
  it('200 → ok with snapshot', () => {
    const r = decideSnapshotState(200, SNAPSHOT_FIXTURE)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.snapshot.conversation.title).toBe('T')
  })

  it('410 revoked → gone/revoked', () => {
    const r = decideSnapshotState(410, { revoked: true, at: 1700000000000 })
    expect(r).toEqual({ kind: 'gone', reason: 'revoked', at: 1700000000000 })
  })

  it('410 with empty body → gone/revoked (revoke is the only tombstone)', () => {
    const r = decideSnapshotState(410, null)
    expect(r.kind).toBe('gone')
    if (r.kind === 'gone') expect(r.reason).toBe('revoked')
  })

  it('404 → not-found', () => {
    expect(decideSnapshotState(404, null)).toEqual({ kind: 'not-found' })
  })

  it('500 → error', () => {
    expect(decideSnapshotState(500, null)).toEqual({ kind: 'error' })
  })

  it('403 → error (does not leak as not-found)', () => {
    expect(decideSnapshotState(403, null)).toEqual({ kind: 'error' })
  })
})

