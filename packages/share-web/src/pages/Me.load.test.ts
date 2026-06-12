import { describe, expect, it } from 'vitest'

import type {
  MeFetchResult,
  MeResponse,
  MySharesFetchResult,
} from '../lib/api'
import { resolveLoadOutcome } from './Me'

const ME: MeResponse = {
  email: 'a@b.com',
  name: 'Alice',
  display_name: 'Alice',
  avatar_url: null,
  handle: null,
  deletion_pending_until: null,
} as MeResponse

const meOk: MeFetchResult = { kind: 'ok', me: ME }

describe('resolveLoadOutcome', () => {
  it('redirects when /api/me is unauthenticated', () => {
    expect(
      resolveLoadOutcome({ kind: 'unauthenticated' }, { kind: 'ok', shares: [] }),
    ).toEqual({ kind: 'redirect' })
  })

  it('surfaces an error when /api/me fails', () => {
    expect(resolveLoadOutcome({ kind: 'error' }, { kind: 'ok', shares: [] })).toEqual({
      kind: 'error',
    })
  })

  // Regression for the bug: a 5xx / network failure on /api/me/shares was
  // swallowed into an empty list, so the page rendered "nothing
  // published" — a lie. It must surface the error/retry card instead.
  it('surfaces an error (NOT an empty list) when /api/me/shares fails', () => {
    const out = resolveLoadOutcome(meOk, { kind: 'error' })
    expect(out.kind).toBe('error')
  })

  it('surfaces an error when /api/me/shares races to unauthenticated after /api/me succeeded', () => {
    const out = resolveLoadOutcome(meOk, { kind: 'unauthenticated' })
    expect(out.kind).toBe('error')
  })

  it('renders ok with the real rows when both succeed', () => {
    const shares: MySharesFetchResult = {
      kind: 'ok',
      shares: [{ id: 'x' } as never],
    }
    const out = resolveLoadOutcome(meOk, shares)
    expect(out).toEqual({ kind: 'ok', me: ME, shares: [{ id: 'x' }] })
  })

  it('renders the genuine empty case (200 with zero rows) as ok+empty, not error', () => {
    const out = resolveLoadOutcome(meOk, { kind: 'ok', shares: [] })
    expect(out).toEqual({ kind: 'ok', me: ME, shares: [] })
  })

  // Deletion-pending: /api/me carries deletion_pending_until and the UI
  // hides the shares section, so a 403 on /api/me/shares is expected and
  // must NOT trip the error card.
  it('treats a shares 403 (deletion-pending) as ok with an empty list', () => {
    const out = resolveLoadOutcome(meOk, { kind: 'forbidden' })
    expect(out).toEqual({ kind: 'ok', me: ME, shares: [] })
  })
})
