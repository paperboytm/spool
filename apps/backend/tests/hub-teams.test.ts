import { describe, expect, it, vi } from 'vite-plus/test'

import { onRequestGet as hubTeamsGet } from '../functions/api/hub/v1/teams'
import { sha256Hex } from '../src/hub/auth'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2 } from './_helpers/fakes'

// `GET /api/hub/v1/teams` exists so the CLI's long-lived API token can list
// the caller's Teams (e.g. for `spool subscribe --team`). The cookie-only
// `GET /api/teams` cannot serve that path.

vi.mock('../src/teams/store', () => ({
  listTeamsForUser: vi.fn(async (_db: unknown, userId: string) => [
    {
      id: 'team_0001',
      name: `Team of ${userId}`,
      role: 'member',
      permissions: [],
      member_count: 3,
      archived_at: null,
    },
  ]),
}))

function envFor() {
  const { db, state } = makeDb(emptyState())
  return { DB: db, SESSIONS: makeKv(), RATE: makeKv(), HUB: makeR2().bucket, state }
}

function seedUser(state: ReturnType<typeof envFor>['state'], id: string): void {
  const now = Date.now()
  state.users.push({
    id,
    email: `${id}@example.com`,
    name: id,
    avatar_url: null,
    created_at: now,
    last_signin_at: now,
    deletion_pending_until: null,
    deleted_at: null,
  })
}

describe('GET /api/hub/v1/teams', () => {
  it('lists the caller teams for a CLI API token', async () => {
    const env = envFor()
    seedUser(env.state, 'user-a')
    const apiToken = 'cli-token-for-hub-team-listing'
    env.state.api_tokens.push({
      id: 'token-1',
      user_id: 'user-a',
      token_hash: await sha256Hex(apiToken),
      label: 'cli',
      created_at: Date.now(),
      last_used_at: null,
    })

    const response = await invoke(
      hubTeamsGet,
      new Request('https://spool.new/api/hub/v1/teams', {
        headers: { authorization: `Bearer ${apiToken}` },
      }),
      env,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { teams: Array<{ id: string; name: string }> }
    expect(body.teams).toEqual([
      expect.objectContaining({ id: 'team_0001', name: 'Team of user-a', role: 'member' }),
    ])
  })

  it('rejects unauthenticated callers', async () => {
    const env = envFor()
    const response = await invoke(
      hubTeamsGet,
      new Request('https://spool.new/api/hub/v1/teams'),
      env,
    )
    expect(response.status).toBe(401)
  })
})
