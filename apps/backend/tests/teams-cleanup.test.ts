import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { drainWorkosCleanupOutbox, enqueueWorkosCleanup } from '../src/teams/cleanup'
import { emptyState, makeDb } from './_helpers/fakes'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('durable WorkOS cleanup outbox', () => {
  it('deletes a membership idempotently and removes the completed row', async () => {
    const { db, state } = makeDb(emptyState())
    await enqueueWorkosCleanup(db, {
      operation: 'membership.delete',
      resourceId: 'om_1',
      teamId: 'team_1',
      userId: 'user_1',
      now: 1_000,
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      drainWorkosCleanupOutbox(
        db,
        { WORKOS_API_KEY: 'sk_test', DEV_WORKOS_API_URL: 'https://workos.test' },
        1_000,
      ),
    ).resolves.toEqual({ attempted: 1, completed: 1, failed: 0 })
    expect(state.workos_cleanup_outbox).toEqual([])
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      'https://workos.test/user_management/organization_memberships/om_1',
    )
  })

  it('retains failures with bounded exponential backoff', async () => {
    const { db, state } = makeDb(emptyState())
    await enqueueWorkosCleanup(db, {
      operation: 'organization.delete',
      resourceId: 'org_1',
      now: 2_000,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'temporary' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      drainWorkosCleanupOutbox(
        db,
        { WORKOS_API_KEY: 'sk_test', DEV_WORKOS_API_URL: 'https://workos.test' },
        2_000,
      ),
    ).resolves.toEqual({ attempted: 1, completed: 0, failed: 1 })
    expect(state.workos_cleanup_outbox[0]).toMatchObject({
      attempts: 1,
      next_attempt_at: 4_000,
      last_error: expect.stringContaining('temporary'),
    })
  })

  it('coalesces repeated compensation requests by operation and resource', async () => {
    const { db, state } = makeDb(emptyState())
    await enqueueWorkosCleanup(db, {
      operation: 'invitation.revoke',
      resourceId: 'inv_1',
      now: 10_000,
    })
    await enqueueWorkosCleanup(db, {
      operation: 'invitation.revoke',
      resourceId: 'inv_1',
      now: 9_000,
    })
    expect(state.workos_cleanup_outbox).toHaveLength(1)
    expect(state.workos_cleanup_outbox[0]?.next_attempt_at).toBe(9_000)
  })

  it('deletes the exact Organization membership when an orphan invite was already accepted', async () => {
    const batches: string[][] = []
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement
          },
          async all() {
            return {
              results: sql.includes('/* workos-cleanup:due */')
                ? [
                    {
                      id: 'cleanup_accepted',
                      operation: 'invitation.revoke',
                      resource_id: 'inv_accepted',
                      attempts: 0,
                    },
                  ]
                : [],
            }
          },
          async first() {
            return null
          },
          async run() {
            return { meta: { changes: 1 } }
          },
          sql,
        }
        return statement
      },
      async batch(statements: D1PreparedStatement[]) {
        const rows = statements as unknown as Array<{ sql: string }>
        batches.push(rows.map((row) => row.sql))
        return rows.map(() => ({ meta: { changes: 1 } }))
      },
    } as unknown as D1Database
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'inv_accepted',
            email: 'member@example.com',
            state: 'accepted',
            organization_id: 'org_1',
            accepted_user_id: 'workos_user_1',
            created_at: '2026-07-22T00:00:00.000Z',
            updated_at: '2026-07-22T00:01:00.000Z',
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'om_accepted',
                user_id: 'workos_user_1',
                organization_id: 'org_1',
                status: 'active',
                updated_at: '2026-07-22T00:01:00.000Z',
              },
            ],
            list_metadata: {},
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      drainWorkosCleanupOutbox(
        db,
        { WORKOS_API_KEY: 'sk_test', DEV_WORKOS_API_URL: 'https://workos.test' },
        5_000,
      ),
    ).resolves.toEqual({ attempted: 1, completed: 1, failed: 0 })
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'https://workos.test/user_management/invitations/inv_accepted',
      expect.stringContaining(
        'https://workos.test/user_management/organization_memberships?user_id=workos_user_1',
      ),
      'https://workos.test/user_management/organization_memberships/om_accepted',
    ])
    expect(
      batches.flat().some((sql) => sql.includes('/* workos-webhook:delete-membership */')),
    ).toBe(true)
    expect(batches.flat().some((sql) => sql.includes('/* workos-webhook:deny-membership */'))).toBe(
      true,
    )
  })
})
