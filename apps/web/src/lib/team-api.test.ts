import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  createTeam,
  createTeamInvitation,
  fetchTeamSessions,
  fetchTeams,
  hasTeamPermission,
  updateTeamMember,
} from './team-api'

afterEach(() => vi.restoreAllMocks())

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('team API client', () => {
  it('loads teams with same-origin credentials', async () => {
    respond(200, { teams: [{ id: 'team-1', name: 'Paperboy', permissions: [] }] })

    const result = await fetchTeams()

    expect(result.kind).toBe('ok')
    expect(fetch).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('creates teams using the documented body', async () => {
    respond(201, { team: { id: 'team-1', name: 'Paperboy', permissions: [] } })

    await createTeam('Paperboy', 'team-create-intent-0001')

    expect(fetch).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Paperboy' }),
      }),
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('team-create-intent-0001')
  })

  it('encodes team and member identifiers and never infers permissions from role', async () => {
    respond(200, { member: { user_id: 'user/1', role: 'admin' } })

    await updateTeamMember('team/a', 'user/1', 'admin')

    expect(fetch).toHaveBeenCalledWith(
      '/api/teams/team%2Fa/members/user%2F1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }),
    )
    expect(
      hasTeamPermission(
        { id: 'team-1', name: 'Paperboy', role: 'owner', permissions: [] },
        'members:manage',
      ),
    ).toBe(false)
  })

  it('sends invitation email and role', async () => {
    respond(201, { invitation: { id: 'invite-1', email: 'dev@example.com', role: 'member' } })

    await createTeamInvitation('team-1', 'dev@example.com', 'member', 'team-invite-intent-0001')

    expect(fetch).toHaveBeenCalledWith(
      '/api/teams/team-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'dev@example.com', role: 'member' }),
      }),
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('team-invite-intent-0001')
  })

  it('maps authorization and conflict responses to typed failures', async () => {
    respond(401, { error: 'UNAUTHENTICATED' })
    expect(await fetchTeams()).toEqual({ kind: 'unauthenticated' })

    respond(403, { error: 'FORBIDDEN' })
    expect(await fetchTeams()).toEqual({ kind: 'forbidden' })

    respond(409, { detail: 'already invited' })
    expect(await createTeam('Paperboy', 'team-create-intent-0002')).toEqual({
      kind: 'conflict',
      detail: 'already invited',
    })
  })

  it('does not expose upstream diagnostics from server failures', async () => {
    respond(502, { detail: 'WorkOS: internal upstream response' })

    expect(await fetchTeams()).toEqual({ kind: 'error' })
  })

  it('does not turn a malformed success payload into a crashing false success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    expect(await fetchTeams()).toEqual({ kind: 'error' })
  })

  it('supports the server-authorized ownership transfer role', async () => {
    respond(200, { member: { user_id: 'user-2', role: 'owner', permissions: [] } })

    await updateTeamMember('team-1', 'user-2', 'owner')

    expect(fetch).toHaveBeenCalledWith(
      '/api/teams/team-1/members/user-2',
      expect.objectContaining({ body: JSON.stringify({ role: 'owner' }) }),
    )
  })

  it('loads the team-scoped Session feed', async () => {
    respond(200, { sessions: [], next_cursor: 'opaque/next+cursor' })

    await fetchTeamSessions('team-1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/teams/team-1/sessions',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, { sessions: [], next_cursor: null })
    await fetchTeamSessions('team/a', 'opaque/next+cursor')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/teams/team%2Fa/sessions?cursor=opaque%2Fnext%2Bcursor',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})
