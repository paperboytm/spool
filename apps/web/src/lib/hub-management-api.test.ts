import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  appendUniqueManagedSessions,
  fetchMySessions,
  type ManagedSession,
  updateManagedSessionVisibility,
  withdrawManagedSession,
} from './hub-management-api'

afterEach(() => vi.restoreAllMocks())

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('Hub Session management API', () => {
  it('loads the signed-in author Session list', async () => {
    respond(200, { sessions: [], next_cursor: null })

    expect(await fetchMySessions()).toEqual({
      kind: 'ok',
      data: { sessions: [], next_cursor: null },
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/me/sessions',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('keeps the opaque cursor intact when loading another page', async () => {
    respond(200, { sessions: [], next_cursor: null })

    await fetchMySessions('opaque/next+cursor')

    expect(fetch).toHaveBeenCalledWith(
      '/api/me/sessions?cursor=opaque%2Fnext%2Bcursor',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('appends new pages without duplicating a Session already loaded', () => {
    const session = (sid: string, title: string): ManagedSession => ({
      sid,
      title,
      titles: null,
      summary: null,
      summaries: null,
      cost: null,
      star_count: 0,
      provider: 'claude',
      created_at: 1,
      updated_at: 1,
      visibility: 'link-only',
      team_id: null,
      team_name: null,
      can_manage_visibility: true,
      author: { handle: null, display_name: null, avatar_url: null },
    })
    const current = [session('claude_1', 'Current')]

    expect(
      appendUniqueManagedSessions(current, [
        session('claude_1', 'Stale duplicate'),
        session('claude_2', 'Next'),
        session('claude_2', 'Duplicate within page'),
      ]),
    ).toEqual([current[0], expect.objectContaining({ sid: 'claude_2', title: 'Next' })])
  })

  it('sends an explicit Team ownership target', async () => {
    respond(200, { session: { sid: 'codex_1', visibility: 'team' } })

    await updateManagedSessionVisibility('codex/a', 'team', 'team_1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/me/sessions/codex%2Fa',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'team', team_id: 'team_1' }),
      }),
    )
  })

  it('does not send stale team_id when selecting a public scope', async () => {
    respond(200, { session: { sid: 'codex_1', visibility: 'public' } })

    await updateManagedSessionVisibility('codex_1', 'public', 'team_1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/me/sessions/codex_1',
      expect.objectContaining({ body: JSON.stringify({ visibility: 'public' }) }),
    )
  })

  it('keeps ownership conflicts distinct from validation failures', async () => {
    respond(409, { detail: 'a Team-owned Session cannot move to another Team' })
    expect(await updateManagedSessionVisibility('codex_1', 'team', 'team_2')).toEqual({
      kind: 'conflict',
      detail: 'a Team-owned Session cannot move to another Team',
    })

    respond(422, { detail: 'this provider cannot be published to Explore yet' })
    expect(await updateManagedSessionVisibility('other_1', 'public')).toEqual({
      kind: 'invalid',
      detail: 'this provider cannot be published to Explore yet',
    })

    respond(403, { error: 'FORBIDDEN' })
    expect(await updateManagedSessionVisibility('codex_1', 'link-only')).toEqual({
      kind: 'forbidden',
    })
  })

  it('does not expose internal diagnostics from server failures', async () => {
    respond(500, { detail: 'internal D1 diagnostic' })

    expect(await fetchMySessions()).toEqual({ kind: 'error' })
  })

  it('withdraws through the Hub tombstone endpoint', async () => {
    respond(200, { withdrawn: true })

    await expect(withdrawManagedSession('codex/a')).resolves.toEqual({
      kind: 'ok',
      data: { withdrawn: true },
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/hub/v1/sessions/codex%2Fa/withdraw',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it.each([
    [401, { error: 'UNAUTHENTICATED' }, { kind: 'unauthenticated' }],
    [403, { detail: 'admin required' }, { kind: 'forbidden', detail: 'admin required' }],
    [404, { error: 'NOT_FOUND' }, { kind: 'not-found' }],
    [410, { detail: 'already withdrawn' }, { kind: 'gone', detail: 'already withdrawn' }],
    [429, { error: 'RATE_LIMITED' }, { kind: 'rate-limited' }],
  ] as const)(
    'maps withdraw HTTP %s without collapsing its meaning',
    async (status, body, expected) => {
      respond(status, body)

      await expect(withdrawManagedSession('codex_1')).resolves.toEqual(expected)
    },
  )
})
