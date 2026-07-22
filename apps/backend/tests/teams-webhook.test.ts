import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vite-plus/test'

import { ApiError } from '../src/errors'
import { processWorkosWebhookEvent, verifyWorkosWebhook } from '../src/teams/workos-webhook'

const SECRET = 'whsec_test_secret'
const NOW = Date.parse('2026-07-22T10:00:00.000Z')

async function signedRequest(body: string, timestamp = NOW, secret = SECRET): Promise<Request> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)),
  )
  const signature = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Request('https://spool.new/api/webhooks/workos', {
    method: 'POST',
    body,
    headers: { 'workos-signature': `t=${timestamp},v1=${signature}` },
  })
}

function membershipEvent(
  id = 'event_1',
  type = 'organization_membership.deleted',
  status = 'inactive',
) {
  return {
    id,
    event: type,
    created_at: '2026-07-22T10:00:00.000Z',
    data: {
      id: 'om_1',
      user_id: 'workos_user_1',
      organization_id: 'org_1',
      status,
      updated_at: '2026-07-22T09:59:00.000Z',
    },
  }
}

describe('WorkOS webhook signature verification', () => {
  it('verifies the exact raw UTF-8 body without reserializing JSON', async () => {
    const body = ` {\n  "id":"event_1", "event":"organization_membership.deleted",\n  "created_at":"2026-07-22T10:00:00.000Z", "data":{}\n}`
    const event = await verifyWorkosWebhook(await signedRequest(body), SECRET, NOW)
    expect(event.id).toBe('event_1')
  })

  it('rejects tampering and timestamps outside the replay window', async () => {
    const body = JSON.stringify(membershipEvent())
    const signed = await signedRequest(body)
    const tampered = new Request(signed.url, {
      method: 'POST',
      body: `${body} `,
      headers: signed.headers,
    })
    await expect(verifyWorkosWebhook(tampered, SECRET, NOW)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    } satisfies Partial<ApiError>)
    await expect(
      verifyWorkosWebhook(await signedRequest(body, NOW - 5 * 60 * 1000 - 1), SECRET, NOW),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<ApiError>)
  })

  it('rejects ambiguous duplicate timestamp components', async () => {
    const body = JSON.stringify(membershipEvent())
    const request = await signedRequest(body)
    request.headers.set('workos-signature', `${request.headers.get('workos-signature')},t=${NOW}`)
    await expect(verifyWorkosWebhook(request, SECRET, NOW)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    } satisfies Partial<ApiError>)
  })
})

type Recorded = { sql: string; params: unknown[] }

function webhookDb(
  userMemberships: Array<{
    workos_membership_id: string
    workos_organization_id: string
  }> = [],
) {
  const receipts = new Map<string, number | null>()
  const batches: Recorded[][] = []
  const db = {
    prepare(sql: string) {
      const statement: Recorded & {
        bind: (...params: unknown[]) => D1PreparedStatement
        run: () => Promise<{ meta: { changes: number } }>
        first: <T>() => Promise<T | null>
        all: <T>() => Promise<{ results: T[] }>
      } = {
        sql,
        params: [],
        bind(...params: unknown[]) {
          statement.params = params
          return statement as unknown as D1PreparedStatement
        },
        async run() {
          if (sql.includes('/* workos-webhook:receive */')) {
            const [eventId] = statement.params as [string]
            if (receipts.has(eventId)) return { meta: { changes: 0 } }
            receipts.set(eventId, null)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('/* workos-webhook:complete */')) {
            const [processedAt, eventId] = statement.params as [number, string]
            receipts.set(eventId, processedAt)
          }
          return { meta: { changes: 1 } }
        },
        async first<T>() {
          const [eventId] = statement.params as [string]
          return { processed_at: receipts.get(eventId) ?? null } as T
        },
        async all<T>() {
          return { results: userMemberships as T[] }
        },
      }
      return statement as unknown as D1PreparedStatement
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(statements as unknown as Recorded[])
      return statements.map(() => ({ meta: { changes: 1 } }))
    },
  } as unknown as D1Database
  return { db, batches }
}

describe('WorkOS webhook authorization projection', () => {
  it('deduplicates event ids and plans monotonic membership deprovisioning atomically', async () => {
    const { db, batches } = webhookDb()
    const event = membershipEvent()
    await processWorkosWebhookEvent(db, event, NOW)
    await processWorkosWebhookEvent(db, event, NOW + 1)

    expect(batches).toHaveLength(1)
    const sql = batches[0]!.map((statement) => statement.sql).join('\n')
    expect(sql).toContain('/* workos-webhook:deny-membership */')
    expect(sql).toContain('/* workos-webhook:archive-last-owner */')
    expect(sql).toContain('workos_updated_at<=?')
    expect(sql).toContain('/* workos-webhook:audit-membership-deprovision */')
    expect(sql).toContain('/* workos-webhook:block-membership */')
    expect(sql).toContain('/* workos-webhook:delete-membership */')
  })

  it('restores only a strictly newer inactive membership version without a permanent block', async () => {
    const { db, batches } = webhookDb()
    await processWorkosWebhookEvent(
      db,
      membershipEvent('event_inactive', 'organization_membership.updated', 'inactive'),
      NOW,
    )
    const active = membershipEvent('event_active', 'organization_membership.updated', 'active')
    active.data.updated_at = '2026-07-22T10:01:00.000Z'
    await processWorkosWebhookEvent(db, active, NOW + 60_000)

    expect(batches).toHaveLength(2)
    const inactiveStatements = batches[0]!
    const denial = inactiveStatements.find((statement) =>
      statement.sql.includes('/* workos-webhook:deny-membership */'),
    )
    expect(denial?.params).toContain('inactive')
    const permanentBlock = inactiveStatements.find((statement) =>
      statement.sql.includes('/* workos-webhook:block-membership */'),
    )
    expect(permanentBlock?.sql).toContain('WHERE ?=0')
    expect(permanentBlock?.params).toContain(1)
    const archive = inactiveStatements.find((statement) =>
      statement.sql.includes('/* workos-webhook:archive-last-owner */'),
    )
    expect(archive?.sql).toContain('AND ?=0')
    expect(archive?.params).toContain(1)

    const activeSql = batches[1]!.map((statement) => statement.sql).join('\n')
    expect(activeSql).toContain('/* workos-webhook:restore-inactive-membership */')
    expect(activeSql).toContain('denied.workos_updated_at<?')
    expect(activeSql).toContain('/* workos-webhook:clear-inactive-denial */')
  })

  it('guards a late stale inactive event with the upstream version, not receipt time', async () => {
    const { db, batches } = webhookDb()
    const stale = membershipEvent(
      'event_stale_inactive',
      'organization_membership.updated',
      'inactive',
    )
    stale.data.updated_at = '2026-07-22T09:00:00.000Z'
    await processWorkosWebhookEvent(db, stale, NOW + 60 * 60 * 1000)

    const denial = batches[0]!.find((statement) =>
      statement.sql.includes('/* workos-webhook:deny-membership */'),
    )
    const upstreamVersion = Date.parse('2026-07-22T09:00:00.000Z')
    expect(denial?.params.at(-1)).toBe(upstreamVersion)
    expect(denial?.sql).toContain('current.workos_updated_at>?')
    expect(denial?.sql).toContain(
      'excluded.workos_updated_at>=workos_membership_denials.workos_updated_at',
    )
  })

  it('archives an inactive last-owner Team when the exact membership is later deleted', async () => {
    const { db, batches } = webhookDb()
    await processWorkosWebhookEvent(
      db,
      membershipEvent('event_owner_inactive', 'organization_membership.updated', 'inactive'),
      NOW,
    )
    const deleted = membershipEvent(
      'event_owner_deleted',
      'organization_membership.deleted',
      'inactive',
    )
    deleted.data.updated_at = '2026-07-22T10:01:00.000Z'
    await processWorkosWebhookEvent(db, deleted, NOW + 60_000)

    const archive = batches[1]!.find((statement) =>
      statement.sql.includes('/* workos-webhook:archive-last-owner */'),
    )
    expect(archive?.sql).toContain('workos_membership_denials denied')
    expect(archive?.sql).toContain("denied.previous_role='owner'")
    expect(archive?.sql).toContain("denied.reason='deleted'")
    expect(archive?.sql).toContain("other_denied.reason='inactive'")
  })

  it('uses an inactive owner denial when a later user deletion archives and privatizes', async () => {
    const { db, batches } = webhookDb()
    await processWorkosWebhookEvent(
      db,
      membershipEvent('event_user_owner_inactive', 'organization_membership.updated', 'inactive'),
      NOW,
    )
    await processWorkosWebhookEvent(
      db,
      {
        id: 'event_inactive_user_deleted',
        event: 'user.deleted',
        created_at: '2026-07-22T10:01:00.000Z',
        data: { id: 'workos_user_1' },
      },
      NOW + 60_000,
    )

    const sql = batches[1]!.map((statement) => statement.sql).join('\n')
    expect(sql).toContain('/* workos-webhook:user-archive-last-owner */')
    expect(sql).toContain("denied.previous_role='owner'")
    expect(sql).toContain('/* workos-webhook:user-private-sessions */')
    expect(sql).toContain('/* workos-webhook:user-delete-discovery */')
    expect(sql).toContain('denied.workos_user_id=?')
  })

  it('deprovisions every Team for a deleted WorkOS user in one set-based batch', async () => {
    const { db, batches } = webhookDb([
      { workos_membership_id: 'om_1', workos_organization_id: 'org_1' },
      { workos_membership_id: 'om_2', workos_organization_id: 'org_2' },
    ])
    await processWorkosWebhookEvent(
      db,
      {
        id: 'event_user_deleted',
        event: 'user.deleted',
        created_at: '2026-07-22T10:00:00.000Z',
        data: { id: 'workos_user_1' },
      },
      NOW,
    )
    expect(batches).toHaveLength(1)
    const sql = batches[0]!.map((statement) => statement.sql).join('\n')
    expect(sql).toContain('/* workos-webhook:deny-user */')
    expect(sql).toContain('user-archive-last-owner')
    expect(sql).toContain('user-delete-memberships')
    expect(sql).not.toContain('LIMIT 500')
  })

  it('uses the WorkOS event timestamp when an older membership payload omits updated_at', async () => {
    const { db, batches } = webhookDb()
    const event = membershipEvent('event_without_object_timestamp')
    delete (event.data as { updated_at?: string }).updated_at
    await processWorkosWebhookEvent(db, event, NOW)
    const archive = batches[0]![0]!
    expect(archive.params).toContain(NOW)
  })

  it('archives an externally deleted organization and removes discovery atomically', async () => {
    const { db, batches } = webhookDb()
    await processWorkosWebhookEvent(
      db,
      {
        id: 'event_org_deleted',
        event: 'organization.deleted',
        created_at: '2026-07-22T10:00:00.000Z',
        data: { id: 'org_1' },
      },
      NOW,
    )
    const sql = batches[0]!.map((statement) => statement.sql).join('\n')
    expect(sql).toContain('archive-organization')
    expect(sql).toContain('audit-organization-archive')
    expect(sql).toContain('hub_session_discovery')
  })
})
