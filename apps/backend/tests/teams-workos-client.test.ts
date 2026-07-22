import { describe, expect, it, vi } from 'vite-plus/test'

import { createWorkosTeamClient } from '../src/teams/workos-client'

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function invitation() {
  return {
    id: 'invitation_1',
    email: 'member@example.com',
    state: 'pending',
    organization_id: 'org_1',
    accepted_user_id: null,
    expires_at: '2026-08-01T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    created_at: '2026-07-22T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  }
}

describe('WorkOS Team client', () => {
  it('uses the dev API base, Bearer auth, and PUT for organization updates', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ id: 'org_1', name: 'Renamed' }))
    const client = createWorkosTeamClient(
      { WORKOS_API_KEY: 'sk_test', DEV_WORKOS_API_URL: 'http://127.0.0.1:9999/' },
      fetchImpl,
    )
    await client.updateOrganization('org_1', 'Renamed')

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('http://127.0.0.1:9999/organizations/org_1')
    expect(init?.method).toBe('PUT')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk_test')
  })

  it('always asks WorkOS for member while the desired role stays local', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(invitation()))
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await client.createInvitation({
      email: 'member@example.com',
      organizationId: 'org_1',
      inviterUserId: 'workos_owner',
      idempotencyKey: 'spool-test-invitation-1',
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body).toEqual({
      email: 'member@example.com',
      organization_id: 'org_1',
      inviter_user_id: 'workos_owner',
      role_slug: 'member',
    })
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('idempotency-key')).toBe(
      'spool-test-invitation-1',
    )
  })

  it('uses stable idempotency keys for organization and owner membership creation', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'org_1', name: 'Team' }))
      .mockResolvedValueOnce(
        json({
          id: 'om_1',
          user_id: 'workos_user_1',
          organization_id: 'org_1',
          status: 'active',
          updated_at: '2026-07-22T00:00:00.000Z',
        }),
      )
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await client.createOrganization('Team', 'team_stable_1')
    await client.createMembership('org_1', 'workos_user_1')
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('idempotency-key')).toBe(
      'spool-team-org-team_stable_1',
    )
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get('idempotency-key')).toBe(
      'spool-team-membership-org_1-workos_user_1',
    )
  })

  it('fetches an exact membership before treating an active-list absence as deletion', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        id: 'om_inactive',
        user_id: 'workos_user_1',
        organization_id: 'org_1',
        status: 'inactive',
        updated_at: '2026-07-22T00:00:00.000Z',
      }),
    )
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await expect(client.getMembership('om_inactive')).resolves.toMatchObject({
      id: 'om_inactive',
      status: 'inactive',
    })
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      '/user_management/organization_memberships/om_inactive',
    )
  })

  it('fails closed on structurally invalid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ id: 'bad' }] }))
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await expect(client.listActiveMemberships('user_1')).rejects.toThrow(/invalid WorkOS response/)
  })

  it('requests one hundred memberships per page and follows WorkOS cursors', async () => {
    const membership = (id: string) => ({
      id,
      user_id: 'user_1',
      organization_id: `org_${id}`,
      status: 'active',
    })
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.searchParams.get('after') === null) {
        return json({
          data: [membership('first')],
          list_metadata: { after: 'cursor_next' },
        })
      }
      return json({ data: [membership('second')], list_metadata: {} })
    })
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await expect(client.listActiveMemberships('user_1')).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const first = new URL(String(fetchImpl.mock.calls[0]![0]))
    const second = new URL(String(fetchImpl.mock.calls[1]![0]))
    expect(first.searchParams.get('limit')).toBe('100')
    expect(first.searchParams.getAll('statuses[]')).toEqual(['active'])
    expect(second.searchParams.get('after')).toBe('cursor_next')
  })

  it('fully paginates invitation history for missing-membership reconciliation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input))
      return url.searchParams.has('after')
        ? json({ data: [{ ...invitation(), id: 'invitation_2' }], list_metadata: {} })
        : json({ data: [invitation()], list_metadata: { after: 'cursor_2' } })
    })
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl)
    await expect(client.listAllInvitations('org_1')).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchImpl.mock.calls[1]![0])).searchParams.get('after')).toBe('cursor_2')
  })

  it('bounds response bodies even without a trustworthy content length', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ padding: 'x'.repeat(128) }))
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl, {
      maxResponseBytes: 32,
    })
    await expect(client.listActiveMemberships('user_1')).rejects.toThrow(
      /WorkOS response too large/,
    )
  })

  it('aborts a request that exceeds the configured timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    )
    const client = createWorkosTeamClient({ WORKOS_API_KEY: 'sk_test' }, fetchImpl, {
      timeoutMs: 5,
    })
    await expect(client.listActiveMemberships('user_1')).rejects.toThrow(/WorkOS request timed out/)
  })
})
