import type { KVNamespace } from '@cloudflare/workers-types'
import {
  canonicalizeRecord,
  composeSessionDiff,
  deriveView,
  extractEditEvents,
  sequenceRoot,
  type CanonicalRecord,
} from '@spool-lab/session-kit'
import { describe, expect, it, vi } from 'vite-plus/test'

import { onRequestGet as discoveryGet } from '../functions/api/discovery/v1/sessions'
import { onRequestPost as batchPost } from '../functions/api/hub/v1/objects/batch'
import { onRequestPost as headPost } from '../functions/api/hub/v1/sessions/[sid]/head'
import { onRequestGet as metaGet } from '../functions/api/hub/v1/sessions/[sid]/index'
import { onRequestPost as pushPost } from '../functions/api/hub/v1/sessions/[sid]/push'
import { onRequestGet as recordsGet } from '../functions/api/hub/v1/sessions/[sid]/records'
import { onRequestGet as viewGet } from '../functions/api/hub/v1/sessions/[sid]/view'
import { onRequestPost as withdrawPost } from '../functions/api/hub/v1/sessions/[sid]/withdraw'
import {
  onRequestDelete as tokensDelete,
  onRequestPost as tokensPost,
} from '../functions/api/hub/v1/tokens'
import { onRequestPatch as visibilityPatch } from '../functions/api/me/sessions/[sid]'
import type { SessionRecord } from '../src/auth/session'
import { sha256Hex } from '../src/hub/auth'
import { TEAM_QUOTA_BYTES } from '../src/hub/wire'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

const BASE_URL = 'https://share.example.test'
const SID = 'claude_12345678-abcd-4321-abcd-1234567890ab'
const USER_A_TOKEN = 'a'.repeat(40)
const USER_B_TOKEN = 'b'.repeat(40)
const USER_C_TOKEN = 'c'.repeat(40)
const DEV_TOKEN = 'local-hub-dev-token'
const TEAM_ID = `team_${'d'.repeat(32)}`

type Fixture = Awaited<ReturnType<typeof makeFixture>>
type TestEnv = ReturnType<typeof envFor>

function envFor(options: { devToken?: string } = {}) {
  const { db, state } = makeDb(emptyState())
  const hub = makeR2()
  return {
    DB: db,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    HUB: hub.bucket,
    PUBLIC_BASE_URL: BASE_URL,
    ...(options.devToken === undefined ? {} : { HUB_DEV_TOKEN: options.devToken }),
    state,
    _hub: hub.store,
  }
}

function seedUser(
  state: FakeDbState,
  id = 'user-a',
  overrides: Partial<FakeDbState['users'][number]> = {},
): void {
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
    ...overrides,
  })
}

async function seedSession(kv: KVNamespace, token: string, userId: string): Promise<void> {
  const now = Date.now()
  const record: SessionRecord = {
    user_id: userId,
    created: now,
    exp: now + 30 * 24 * 3600 * 1000,
    last_seen: now,
  }
  await kv.put(`session/${token}`, JSON.stringify(record), {
    expirationTtl: 30 * 24 * 3600,
  })
}

async function seedUsers(env: TestEnv): Promise<void> {
  seedUser(env.state, 'user-a')
  seedUser(env.state, 'user-b')
  await seedSession(env.SESSIONS, USER_A_TOKEN, 'user-a')
  await seedSession(env.SESSIONS, USER_B_TOKEN, 'user-b')
}

function syntheticRecords(): unknown[] {
  return [
    {
      type: 'user',
      timestamp: '2026-07-16T01:00:00.000Z',
      message: { role: 'user', content: 'Please make the greeting warmer.' },
    },
    {
      type: 'assistant',
      timestamp: '2026-07-16T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'edit-1',
            name: 'Edit',
            input: {
              file_path: '/workspace/src/greeting.ts',
              old_string: 'hello',
              new_string: 'hello, friend',
            },
          },
        ],
      },
    },
    {
      type: 'user',
      timestamp: '2026-07-16T01:00:02.000Z',
      toolUseResult: { originalFile: 'export const greeting = "hello"\n' },
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'updated' }],
      },
    },
    {
      type: 'assistant',
      timestamp: '2026-07-16T01:00:03.000Z',
      message: { role: 'assistant', content: 'The greeting is warmer now.' },
    },
  ]
}

async function makeFixture(rawRecords: readonly unknown[] = syntheticRecords()) {
  const records = await Promise.all(
    rawRecords.map((record) =>
      canonicalizeRecord(JSON.stringify(record), {
        workspaceRoot: '/workspace',
        homeDir: '/home/tester',
      }),
    ),
  )
  const viewValue = deriveView(records, { provider: 'claude' })
  const view = await canonicalizeRecord(JSON.stringify(viewValue))
  const manifest = records.map((record) => record.oid)
  const root = await sequenceRoot(manifest)
  const head = {
    root,
    count: manifest.length,
    manifest,
    sig: null,
    cardJson: JSON.stringify({ workspace: '$SPOOL_WS', branch: 'main' }),
    summaryMd: '## Outcome\n\nA synthetic shared session.',
    lineageJson: null,
    viewOid: view.oid,
  }
  return { records, view, viewValue, head, entries: [...records, view] }
}

function tokensDeleteRequest(token: string): Request {
  return new Request(`${BASE_URL}/api/hub/v1/tokens`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
}

function jsonPost(url: string, body: unknown, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

function jsonPatch(url: string, body: unknown, token: string): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function batchRequest(entries: readonly CanonicalRecord[], token: string): Request {
  const body = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  return new Request(`${BASE_URL}/api/hub/v1/objects/batch`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-ndjson',
    },
    body,
  })
}

function sessionUrl(sid: string, suffix = ''): string {
  return `${BASE_URL}/api/hub/v1/sessions/${sid}${suffix}`
}

async function push(env: TestEnv, fixture: Fixture, token = USER_A_TOKEN, sid = SID) {
  return invoke(pushPost, jsonPost(`${sessionUrl(sid)}/push`, fixture.head, token), env, { sid })
}

async function upload(env: TestEnv, token: string, entries: readonly CanonicalRecord[]) {
  return invoke(batchPost, batchRequest(entries, token), env)
}

async function commit(env: TestEnv, fixture: Fixture, token = USER_A_TOKEN, sid = SID) {
  return invoke(headPost, jsonPost(`${sessionUrl(sid)}/head`, fixture.head, token), env, { sid })
}

async function withdraw(env: TestEnv, token = USER_A_TOKEN, sid = SID) {
  return invoke(withdrawPost, jsonPost(`${sessionUrl(sid)}/withdraw`, {}, token), env, { sid })
}

async function changeVisibility(
  env: TestEnv,
  body: { visibility: 'public' | 'link-only' | 'team'; team_id?: string | null },
  token = USER_A_TOKEN,
  sid = SID,
) {
  return invoke(
    visibilityPatch,
    jsonPatch(`${BASE_URL}/api/me/sessions/${sid}`, body, token),
    env,
    { sid },
  )
}

async function uploadAndCommit(
  env: TestEnv,
  fixture: Fixture,
  options: { token?: string; sid?: string; batches?: CanonicalRecord[][] } = {},
): Promise<Response> {
  const token = options.token ?? USER_A_TOKEN
  const sid = options.sid ?? SID
  const batches = options.batches ?? [fixture.entries]
  for (const entries of batches) {
    const uploaded = await upload(env, token, entries)
    expect(uploaded.status).toBe(200)
  }
  return commit(env, fixture, token, sid)
}

function readRequest(url: string, etag?: string): Request {
  return new Request(url, etag ? { headers: { 'if-none-match': etag } } : undefined)
}

function authenticatedReadRequest(url: string, token: string): Request {
  return new Request(url, { headers: { cookie: `spool_session=${token}` } })
}

function parseNdjson(body: string): Array<{ i: number; oid: string; data: string }> {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { i: number; oid: string; data: string })
}

describe('hub authentication', () => {
  it('returns 401 when a write has no credentials', async () => {
    const env = envFor()
    const fixture = await makeFixture()

    const response = await invoke(
      pushPost,
      jsonPost(`${sessionUrl(SID)}/push`, fixture.head),
      env,
      { sid: SID },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHENTICATED' })
  })

  it('mints a token from a cookie session, accepts it on push, and refuses token chaining', async () => {
    const env = envFor()
    seedUser(env.state, 'user-a')
    await seedSession(env.SESSIONS, USER_A_TOKEN, 'user-a')
    const fixture = await makeFixture()

    const minted = await invoke(
      tokensPost,
      new Request(`${BASE_URL}/api/hub/v1/tokens`, {
        method: 'POST',
        headers: {
          cookie: `spool_session=${USER_A_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ label: 'test CLI' }),
      }),
      env,
    )
    expect(minted.status).toBe(200)
    const { token } = (await minted.json()) as { token: string }
    expect(token).toMatch(/^sph_[0-9a-f]{64}$/)

    const pushed = await push(env, fixture, token)
    expect(pushed.status).toBe(200)
    await expect(pushed.json()).resolves.toEqual({
      missing: [...fixture.head.manifest, fixture.head.viewOid],
    })
    expect(env.state.api_tokens[0]?.last_used_at).not.toBeNull()

    const chained = await invoke(
      tokensPost,
      jsonPost(`${BASE_URL}/api/hub/v1/tokens`, { label: 'must fail' }, token),
      env,
    )
    expect(chained.status).toBe(401)
  })

  it('revokes a token via DELETE and refuses it afterwards', async () => {
    const env = envFor()
    seedUser(env.state, 'user-a')
    await seedSession(env.SESSIONS, USER_A_TOKEN, 'user-a')
    const fixture = await makeFixture()

    const minted = await invoke(
      tokensPost,
      jsonPost(`${BASE_URL}/api/hub/v1/tokens`, { label: 'test CLI' }, USER_A_TOKEN),
      env,
    )
    expect(minted.status).toBe(200)
    const { token } = (await minted.json()) as { token: string }

    const revoked = await invoke(tokensDelete, tokensDeleteRequest(token), env)
    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toEqual({ revoked: true })
    expect(env.state.api_tokens).toHaveLength(0)
    expect(env.state.audit).toContainEqual(
      expect.objectContaining({ action: 'hub-token-revoke', user_id: 'user-a' }),
    )

    const reuse = await push(env, fixture, token)
    expect(reuse.status).toBe(401)
  })

  it('DELETE is 401 without a bearer or with an unknown token', async () => {
    const env = envFor()

    const bare = await invoke(
      tokensDelete,
      new Request(`${BASE_URL}/api/hub/v1/tokens`, { method: 'DELETE' }),
      env,
    )
    expect(bare.status).toBe(401)

    const unknown = await invoke(tokensDelete, tokensDeleteRequest('sph_never_minted'), env)
    expect(unknown.status).toBe(401)
    expect(env.state.audit).toHaveLength(0)
  })

  it('DELETE with HUB_DEV_TOKEN is an ok no-op (nothing stored to revoke)', async () => {
    const env = envFor({ devToken: DEV_TOKEN })

    const response = await invoke(tokensDelete, tokensDeleteRequest(DEV_TOKEN), env)

    expect(response.status).toBe(200)
    expect(env.state.api_tokens).toHaveLength(0)
  })

  it('accepts HUB_DEV_TOKEN and provisions the synthetic dev user', async () => {
    const env = envFor({ devToken: DEV_TOKEN })
    const fixture = await makeFixture()

    const response = await push(env, fixture, DEV_TOKEN)

    expect(response.status).toBe(200)
    expect(env.state.users).toContainEqual(expect.objectContaining({ id: 'hub-dev-user' }))
  })
})

describe('hub push', () => {
  it('accepts every supported provider session id', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    for (const sid of [
      'claude_12345678',
      'codex_12345678',
      'gemini_12345678',
      'opencode_ses_12345678',
      'pi_12345678',
    ]) {
      const response = await push(env, fixture, USER_A_TOKEN, sid)
      expect(response.status, sid).toBe(200)
    }
  })

  it('rejects a malformed sid with 400', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    const response = await push(env, fixture, USER_A_TOKEN, 'bad')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ detail: 'bad session id' })
  })

  it('rejects a manifest that does not fold to its claimed root', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    fixture.head.root = '0'.repeat(64)

    const response = await push(env, fixture)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      detail: 'manifest does not fold to root',
    })
  })

  it('rejects a manifest whose length differs from count', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    fixture.head.count += 1

    const response = await push(env, fixture)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      detail: 'manifest length must equal count',
    })
  })

  it('accepts the legacy noteMd alias while returning the canonical Summary field', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const { summaryMd, ...head } = fixture.head
    const legacyHead = { ...head, noteMd: summaryMd }

    const pushed = await invoke(
      pushPost,
      jsonPost(`${sessionUrl(SID)}/push`, legacyHead, USER_A_TOKEN),
      env,
      { sid: SID },
    )
    expect(pushed.status).toBe(200)
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    const committed = await invoke(
      headPost,
      jsonPost(`${sessionUrl(SID)}/head`, legacyHead, USER_A_TOKEN),
      env,
      { sid: SID },
    )
    expect(committed.status).toBe(200)

    const metadata = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })
    await expect(metadata.json()).resolves.toMatchObject({ summaryMd })
  })

  it('enforces single-writer ownership of a session head', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const published = await uploadAndCommit(env, fixture)
    expect(published.status).toBe(200)

    const response = await push(env, fixture, USER_B_TOKEN)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      detail: 'session head belongs to another user',
    })
  })

  it('includes the view oid in missing and keeps dedup isolated per user', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    const initial = await push(env, fixture)
    await expect(initial.json()).resolves.toEqual({
      missing: [...fixture.head.manifest, fixture.head.viewOid],
    })

    const uploaded = await upload(env, USER_A_TOKEN, fixture.entries)
    expect(uploaded.status).toBe(200)
    const ownerPush = await push(env, fixture)
    await expect(ownerPush.json()).resolves.toEqual({ missing: [] })

    const otherPush = await push(env, fixture, USER_B_TOKEN)
    expect(otherPush.status).toBe(200)
    await expect(otherPush.json()).resolves.toEqual({
      missing: [...fixture.head.manifest, fixture.head.viewOid],
    })
  })
})

describe('hub object batches', () => {
  it('rejects the whole batch when any oid does not match its data', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const invalid = { oid: '0'.repeat(64), data: '{"not":"that hash"}' }

    const response = await upload(env, USER_A_TOKEN, [fixture.records[0]!, invalid])

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ detail: 'oid does not match data' })
    expect(env.state.hub_objects).toHaveLength(0)
    expect(env._hub.size).toBe(0)
  })

  it('treats a duplicate re-upload as an idempotent success', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    const first = await upload(env, USER_A_TOKEN, fixture.entries)
    await expect(first.json()).resolves.toEqual({ stored: fixture.entries.length, duplicate: 0 })
    const second = await upload(env, USER_A_TOKEN, fixture.entries)

    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ stored: 0, duplicate: fixture.entries.length })
    expect(env.state.hub_objects).toHaveLength(fixture.entries.length)
  })

  it('rejects fresh objects when the per-user storage quota is exhausted', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    env.state.hub_objects.push({
      owner_user_id: 'user-a',
      oid: 'f'.repeat(64),
      size: 1024 * 1024 * 1024,
      pack_key: 'hub/packs/user-a/existing',
      offset: 0,
      length: 1,
      created_at: Date.now(),
    })

    const response = await upload(env, USER_A_TOKEN, [fixture.records[0]!])

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ detail: 'storage quota exceeded' })
    expect(env.state.hub_objects).toHaveLength(1)
  })
})

describe('hub head and withdrawal', () => {
  it('rejects a malformed declared SessionViewV1 before advancing the head', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const invalidView = await canonicalizeRecord('{"v":1}')
    fixture.head.viewOid = invalidView.oid
    expect((await upload(env, USER_A_TOKEN, [...fixture.records, invalidView])).status).toBe(200)

    const response = await commit(env, fixture)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ detail: 'invalid session view' })
    expect(env.state.hub_sessions).toHaveLength(0)
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('commits a portable-provider head as Link-only without a Discovery projection', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const sid = 'pi_12345678'

    const response = await uploadAndCommit(env, fixture, { sid })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ url: `${BASE_URL}/session/${sid}` })
    expect(env.state.hub_sessions[0]).toMatchObject({ sid, visibility: 'unlisted' })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('publishes a supported Session to Discovery when its head is committed', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    const committed = await uploadAndCommit(env, fixture)
    expect(committed.status).toBe(200)

    const discovery = await invoke(
      discoveryGet,
      new Request(`${BASE_URL}/api/discovery/v1/sessions?sort=recent`),
      env,
    )
    const body = (await discovery.json()) as { items: Array<{ sid: string; title: string }> }

    expect(discovery.status).toBe(200)
    expect(body.items).toEqual([
      expect.objectContaining({
        sid: SID,
        title: 'Please make the greeting warmer.',
      }),
    ])
  })

  it('conflicts while objects are missing, commits after upload, and recommit clears withdrawal', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()

    const conflict = await commit(env, fixture)
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      missing: [...fixture.head.manifest, fixture.head.viewOid],
    })

    const uploaded = await upload(env, USER_A_TOKEN, fixture.entries)
    expect(uploaded.status).toBe(200)
    const committed = await commit(env, fixture)
    expect(committed.status).toBe(200)
    await expect(committed.json()).resolves.toEqual({ url: `${BASE_URL}/session/${SID}` })
    const createdAt = env.state.hub_sessions[0]?.created_at
    const publishedAt = env.state.hub_session_discovery[0]?.published_at
    expect(env.state.hub_session_discovery).toHaveLength(1)
    env.state.hub_sessions[0]!.visibility = 'private'

    const withdrawn = await withdraw(env)
    expect(withdrawn.status).toBe(200)
    expect(env.state.hub_sessions[0]?.withdrawn_at).not.toBeNull()

    const recommitted = await commit(env, fixture)
    expect(recommitted.status).toBe(200)
    expect(env.state.hub_sessions[0]).toMatchObject({
      owner_user_id: 'user-a',
      visibility: 'private',
      created_at: createdAt,
      withdrawn_at: null,
    })
    expect(env.state.hub_session_discovery).toHaveLength(1)
    expect(env.state.hub_session_discovery[0]?.published_at).toBe(publishedAt)
  })

  it('forbids non-owners and makes a second owner withdrawal idempotent', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const foreign = await withdraw(env, USER_B_TOKEN)
    expect(foreign.status).toBe(403)

    const first = await withdraw(env)
    const auditCount = env.state.audit.length
    const second = await withdraw(env)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ withdrawn: true })
    expect(env.state.audit).toHaveLength(auditCount)
  })
})

describe('Hub management mutation limits', () => {
  it('limits visibility changes before a Public transition reads its R2 view', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await changeVisibility(env, { visibility: 'link-only' })).status).toBe(200)
    }
    env._hub.clear()

    const limited = await changeVisibility(env, { visibility: 'public' })

    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ error: 'TOO_MANY_REQUESTS' })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('limits repeated withdrawal requests without rewriting the tombstone', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    expect((await withdraw(env)).status).toBe(200)
    const withdrawnAt = env.state.hub_sessions[0]!.withdrawn_at

    for (let attempt = 1; attempt < 30; attempt += 1) {
      expect((await withdraw(env)).status).toBe(200)
    }
    const limited = await withdraw(env)

    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ error: 'TOO_MANY_REQUESTS' })
    expect(env.state.hub_sessions[0]!.withdrawn_at).toBe(withdrawnAt)
  })
})

describe('hub public reads', () => {
  it('returns 404 for unknown session metadata', async () => {
    const env = envFor()

    const response = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })

    expect(response.status).toBe(404)
  })

  it('returns the author shape and a 410 tombstone after withdrawal', async () => {
    const env = envFor()
    await seedUsers(env)
    Object.assign(env.state.users[0]!, {
      name: 'Provider Name',
      display_name: 'Alice Example',
      avatar_url: 'https://images.example.test/provider.png',
      custom_avatar_id: 'avatar-a',
      avatar_visible: 1,
    })
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-a',
      claimed_at: Date.now(),
      released_at: null,
    })
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const metadata = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })
    expect(metadata.status).toBe(200)
    await expect(metadata.json()).resolves.toMatchObject({
      sid: SID,
      root: fixture.head.root,
      count: fixture.head.count,
      summaryMd: fixture.head.summaryMd,
      visibility: 'public',
      author: {
        handle: 'alice',
        displayName: 'Alice Example',
        avatarUrl: '/api/avatars/user-a?v=avatar-a',
      },
    })

    const withdrawn = await withdraw(env)
    expect(withdrawn.status).toBe(200)
    const tombstone = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })

    expect(tombstone.status).toBe(410)
    await expect(tombstone.json()).resolves.toMatchObject({
      error: 'GONE',
      detail: 'withdrawn',
      withdrawnAt: expect.any(Number),
    })
  })

  it('does not disclose metadata for a private session', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    env.state.hub_sessions[0]!.visibility = 'private'

    const response = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'NOT_FOUND' })
  })

  it('round-trips the view body and honors its strong ETag', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const response = await invoke(viewGet, readRequest(`${sessionUrl(SID)}/view`), env, {
      sid: SID,
    })
    const etag = `"${fixture.view.oid}"`

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    await expect(response.json()).resolves.toEqual(fixture.viewValue)

    const cached = await invoke(viewGet, readRequest(`${sessionUrl(SID)}/view`, etag), env, {
      sid: SID,
    })
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe(etag)
  })

  it('returns records in order, clamps count and range, and honors its ETag', async () => {
    const env = envFor()
    await seedUsers(env)
    const raw = Array.from({ length: 502 }, (_, index) => ({
      type: index % 2 === 0 ? 'user' : 'assistant',
      message: {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `synthetic record ${index}`,
      },
    }))
    const fixture = await makeFixture(raw)
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const url = `${sessionUrl(SID)}/records?from=0&to=999`
    const response = await invoke(recordsGet, readRequest(url), env, { sid: SID })
    const lines = parseNdjson(await response.text())
    const etag = `W/"${fixture.head.root}:0-500"`

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(lines).toHaveLength(500)
    expect(lines.map((line) => line.i)).toEqual(Array.from({ length: 500 }, (_, i) => i))
    expect(lines.map((line) => line.oid)).toEqual(fixture.head.manifest.slice(0, 500))
    expect(lines.map((line) => line.data)).toEqual(
      fixture.records.slice(0, 500).map((record) => record.data),
    )

    const tailUrl = `${sessionUrl(SID)}/records?from=500&to=999`
    const tail = await invoke(recordsGet, readRequest(tailUrl), env, { sid: SID })
    expect(parseNdjson(await tail.text()).map((line) => line.i)).toEqual([500, 501])

    const cached = await invoke(recordsGet, readRequest(url, etag), env, { sid: SID })
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe(etag)
  })

  it('reads records correctly across two uploaded packs using ranged gets', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const response = await uploadAndCommit(env, fixture, {
      batches: [fixture.records.slice(0, 2), [...fixture.records.slice(2), fixture.view]],
    })
    expect(response.status).toBe(200)

    const records = await invoke(
      recordsGet,
      readRequest(`${sessionUrl(SID)}/records?from=0&to=20`),
      env,
      { sid: SID },
    )
    const lines = parseNdjson(await records.text())

    expect(lines.map((line) => line.data)).toEqual(fixture.records.map((record) => record.data))
    expect(new Set(env.state.hub_objects.map((row) => row.pack_key)).size).toBe(2)
  })

  it('truncates oversized synthetic record output at the byte cap', async () => {
    const env = envFor()
    await seedUsers(env)
    const chunk = 'x'.repeat(3 * 1024 * 1024)
    const fixture = await makeFixture(
      Array.from({ length: 3 }, (_, index) => ({
        type: index === 0 ? 'user' : 'assistant',
        message: {
          role: index === 0 ? 'user' : 'assistant',
          content: `${index}:${chunk}`,
        },
      })),
    )
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const response = await invoke(
      recordsGet,
      readRequest(`${sessionUrl(SID)}/records?from=0&to=3`),
      env,
      { sid: SID },
    )
    const lines = parseNdjson(await response.text())

    expect(response.status).toBe(200)
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.i)).toEqual([0, 1])
  })

  it('round-trips a synthetic session through every handshake and read layer', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    const authorDiff = composeSessionDiff(
      extractEditEvents(fixture.records, { provider: 'claude' }),
    )

    const declared = await push(env, fixture)
    expect(declared.status).toBe(200)
    await expect(declared.json()).resolves.toEqual({
      missing: [...fixture.records.map((record) => record.oid), fixture.view.oid],
    })
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect((await commit(env, fixture)).status).toBe(200)

    const metadata = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })
    expect(metadata.status).toBe(200)
    await expect(metadata.json()).resolves.toMatchObject({
      root: fixture.head.root,
      count: fixture.records.length,
      viewOid: fixture.view.oid,
    })

    const view = await invoke(viewGet, readRequest(`${sessionUrl(SID)}/view`), env, { sid: SID })
    expect(view.status).toBe(200)
    const receivedView = (await view.json()) as { diffstat: unknown }

    const records = await invoke(
      recordsGet,
      readRequest(`${sessionUrl(SID)}/records?from=0&to=${fixture.records.length}`),
      env,
      { sid: SID },
    )
    expect(records.status).toBe(200)
    const receivedRecords = parseNdjson(await records.text())
    const readerDiff = composeSessionDiff(
      extractEditEvents(
        receivedRecords.map(({ i, data }) => ({ i, data })),
        { provider: 'claude' },
      ),
    )

    expect(readerDiff).toEqual(authorDiff)
    expect(receivedView.diffstat).toEqual(readerDiff.diffstat)
  })
})

describe('Hub final live-user authorization gates', () => {
  it('does not create a personal head when account deletion wins after authentication', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.users.find((row) => row.id === 'user-a')!.deletion_pending_until = Date.now()
        return originalBatch(statements)
      },
    })

    const committed = await commit(env, fixture)

    expect(committed.status).toBe(404)
    expect(env.state.hub_sessions).toHaveLength(0)
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('does not republish a personal Session when deletion wins the visibility CAS', async () => {
    const env = envFor()
    await seedUsers(env)
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    expect((await changeVisibility(env, { visibility: 'link-only' })).status).toBe(200)
    expect(env.state.hub_session_discovery).toHaveLength(0)
    const original = { ...env.state.hub_sessions[0]! }
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.users.find((row) => row.id === 'user-a')!.deletion_pending_until = Date.now()
        return originalBatch(statements)
      },
    })

    const changed = await changeVisibility(env, { visibility: 'public' })

    expect(changed.status).toBe(404)
    expect(env.state.hub_sessions[0]).toMatchObject({
      visibility: original.visibility,
      updated_at: original.updated_at,
    })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('accepts the CLI API token for visibility changes', async () => {
    const env = envFor()
    await seedUsers(env)
    const apiToken = 'cli-token-for-visibility-change-tests'
    env.state.api_tokens.push({
      id: 'token-1',
      user_id: 'user-a',
      token_hash: await sha256Hex(apiToken),
      label: 'cli',
      created_at: Date.now(),
      last_used_at: null,
    })
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)

    const changed = await changeVisibility(env, { visibility: 'link-only' }, apiToken)

    expect(changed.status).toBe(200)
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })
})

describe('Team-only Hub isolation', () => {
  async function teamEnv() {
    const env = envFor()
    await seedUsers(env)
    seedUser(env.state, 'user-c')
    await seedSession(env.SESSIONS, USER_C_TOKEN, 'user-c')
    env.state.teams.push({ id: TEAM_ID, name: 'Launch Team', archived_at: null })
    env.state.team_memberships.push(
      { team_id: TEAM_ID, user_id: 'user-a', role: 'owner' },
      { team_id: TEAM_ID, user_id: 'user-b', role: 'member' },
    )
    return env
  }

  it('returns a committed head when post-commit audit delivery fails', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    const originalPrepare = env.DB.prepare.bind(env.DB)
    Object.assign(env.DB, {
      prepare: (sql: string) => {
        const statement = originalPrepare(sql) as unknown as {
          run: () => Promise<unknown>
        }
        if (sql.startsWith('INSERT INTO audit_log ')) {
          statement.run = async () => {
            throw new Error('audit unavailable')
          }
        }
        return statement
      },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const committed = await commit(env, fixture)

    expect(committed.status).toBe(200)
    expect(env.state.hub_sessions).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('post-commit audit failed'))
  })

  it('moves a personal Session into a Team and gates every content endpoint', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    const teamHead = { ...fixture.head, visibility: 'team' as const, teamId: TEAM_ID }

    const committed = await invoke(
      headPost,
      jsonPost(`${sessionUrl(SID)}/head`, teamHead, USER_A_TOKEN),
      env,
      { sid: SID },
    )
    expect(committed.status).toBe(200)
    expect(env.state.hub_sessions[0]).toMatchObject({
      sid: SID,
      owner_user_id: 'user-a',
      visibility: 'private',
      team_id: TEAM_ID,
    })
    expect(env.state.hub_team_objects).toHaveLength(fixture.entries.length)
    expect(env.state.hub_session_discovery).toHaveLength(0)

    const anonymous = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })
    expect(anonymous.status).toBe(401)

    const outsider = await invoke(
      metaGet,
      authenticatedReadRequest(sessionUrl(SID), USER_C_TOKEN),
      env,
      { sid: SID },
    )
    expect(outsider.status).toBe(404)

    const memberMeta = await invoke(
      metaGet,
      authenticatedReadRequest(sessionUrl(SID), USER_B_TOKEN),
      env,
      { sid: SID },
    )
    expect(memberMeta.status).toBe(200)
    expect(memberMeta.headers.get('cache-control')).toBe('private, no-store')
    expect(memberMeta.headers.get('vary')).toBe('Cookie, Authorization')
    await expect(memberMeta.json()).resolves.toMatchObject({
      visibility: 'team',
      team: { id: TEAM_ID, name: 'Launch Team' },
    })

    const memberView = await invoke(
      viewGet,
      authenticatedReadRequest(`${sessionUrl(SID)}/view`, USER_B_TOKEN),
      env,
      { sid: SID },
    )
    expect(memberView.status).toBe(200)
    expect(memberView.headers.get('cache-control')).toBe('private, no-store')
    await expect(memberView.json()).resolves.toEqual(fixture.viewValue)

    const memberRecords = await invoke(
      recordsGet,
      authenticatedReadRequest(`${sessionUrl(SID)}/records?from=0&to=20`, USER_B_TOKEN),
      env,
      { sid: SID },
    )
    expect(memberRecords.status).toBe(200)
    expect(memberRecords.headers.get('cache-control')).toBe('private, no-store')
    expect(parseNdjson(await memberRecords.text())).toHaveLength(fixture.records.length)

    env.state.team_memberships = env.state.team_memberships.filter(
      (row) => !(row.team_id === TEAM_ID && row.user_id === 'user-b'),
    )
    const removedMember = await invoke(
      viewGet,
      authenticatedReadRequest(`${sessionUrl(SID)}/view`, USER_B_TOKEN),
      env,
      { sid: SID },
    )
    expect(removedMember.status).toBe(404)
  })

  it('rejects stale personal/new tenant expectations in both push and head', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)

    const changed = await makeFixture([
      ...syntheticRecords(),
      {
        type: 'assistant',
        timestamp: '2026-07-16T01:00:04.000Z',
        message: { role: 'assistant', content: 'A concurrent update.' },
      },
    ])
    const stalePersonalHead = {
      ...changed.head,
      visibility: 'public' as const,
      expectedTeamId: null,
    }

    const outsiderPush = await invoke(
      pushPost,
      jsonPost(`${sessionUrl(SID)}/push`, stalePersonalHead, USER_C_TOKEN),
      env,
      { sid: SID },
    )
    const outsiderHead = await invoke(
      headPost,
      jsonPost(`${sessionUrl(SID)}/head`, stalePersonalHead, USER_C_TOKEN),
      env,
      { sid: SID },
    )

    const pushed = await invoke(
      pushPost,
      jsonPost(`${sessionUrl(SID)}/push`, stalePersonalHead, USER_A_TOKEN),
      env,
      { sid: SID },
    )
    const committed = await invoke(
      headPost,
      jsonPost(`${sessionUrl(SID)}/head`, stalePersonalHead, USER_A_TOKEN),
      env,
      { sid: SID },
    )

    expect(outsiderPush.status).toBe(404)
    expect(outsiderHead.status).toBe(404)
    expect(pushed.status).toBe(409)
    expect(committed.status).toBe(409)
    expect(env.state.hub_sessions[0]).toMatchObject({
      root: fixture.head.root,
      visibility: 'private',
      team_id: TEAM_ID,
    })
    expect(env.state.hub_session_discovery).toHaveLength(0)
    expect(env._hub.has(`hub/manifests/${changed.head.root}`)).toBe(false)
  })

  it('scrubs Explore when a Public Session becomes Team-only', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    expect(env.state.hub_session_discovery).toHaveLength(1)

    const changed = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(changed.status).toBe(200)
    expect(env.state.hub_sessions[0]).toMatchObject({
      visibility: 'private',
      team_id: TEAM_ID,
    })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('returns member-safe management permissions after a personal Session joins a Team', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture, { token: USER_B_TOKEN })).status).toBe(200)

    const changed = await changeVisibility(
      env,
      { visibility: 'team', team_id: TEAM_ID },
      USER_B_TOKEN,
    )

    expect(changed.status).toBe(200)
    await expect(changed.json()).resolves.toMatchObject({
      session: {
        team_id: TEAM_ID,
        visibility: 'team',
        can_manage_visibility: false,
      },
    })
  })

  it('charges only aliases still missing from the Team when a transfer is retried', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const wanted = fixture.entries.map((entry) => entry.oid)
    const alreadyAliased = env.state.hub_objects.find((row) => row.oid === wanted[0])!
    const missingBytes = env.state.hub_objects
      .filter((row) => wanted.slice(1).includes(row.oid))
      .reduce((total, row) => total + row.size, 0)
    env.state.hub_team_objects.push({
      team_id: TEAM_ID,
      oid: alreadyAliased.oid,
      size: TEAM_QUOTA_BYTES - missingBytes,
      pack_key: alreadyAliased.pack_key,
      offset: alreadyAliased.offset,
      length: alreadyAliased.length,
      created_at: Date.now(),
    })

    const changed = await changeVisibility(env, { visibility: 'team', team_id: TEAM_ID })

    expect(changed.status).toBe(200)
    expect(env.state.hub_team_objects.map((row) => row.oid).sort()).toEqual(wanted.sort())
    expect(env.state.hub_team_objects.reduce((total, row) => total + row.size, 0)).toBe(
      TEAM_QUOTA_BYTES,
    )
    expect(env.state.hub_sessions[0]).toMatchObject({
      visibility: 'private',
      team_id: TEAM_ID,
    })
  })

  it('maps the atomic D1 quota trigger when capacity changes after preflight', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const originalPrepare = env.DB.prepare.bind(env.DB)
    let raced = false
    Object.assign(env.DB, {
      prepare: (sql: string) => {
        if (!raced && sql.includes('/* hub:authorized-team-alias-after-commit */')) {
          raced = true
          env.state.hub_team_objects.push({
            team_id: TEAM_ID,
            oid: 'f'.repeat(64),
            size: TEAM_QUOTA_BYTES,
            pack_key: 'hub/team-packs/concurrent',
            offset: 0,
            length: TEAM_QUOTA_BYTES,
            created_at: Date.now(),
          })
        }
        return originalPrepare(sql)
      },
    })

    const changed = await changeVisibility(env, { visibility: 'team', team_id: TEAM_ID })

    expect(changed.status).toBe(422)
    await expect(changed.json()).resolves.toMatchObject({
      detail: 'Team storage quota exceeded',
    })
    expect(env.state.hub_team_objects).toHaveLength(1)
    expect(env.state.hub_sessions[0]).toMatchObject({
      visibility: 'unlisted',
      team_id: null,
    })
  })

  it('leaves zero Team aliases when membership removal wins a visibility transfer', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.team_memberships = env.state.team_memberships.filter(
          (row) => row.user_id !== 'user-a',
        )
        return originalBatch(statements)
      },
    })

    const changed = await changeVisibility(env, { visibility: 'team', team_id: TEAM_ID })

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({ team_id: null, visibility: 'unlisted' })
  })

  it('leaves zero Team aliases when account deletion wins a visibility transfer', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.users.find((row) => row.id === 'user-a')!.deletion_pending_until = Date.now()
        return originalBatch(statements)
      },
    })

    const changed = await changeVisibility(env, { visibility: 'team', team_id: TEAM_ID })

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({ team_id: null, visibility: 'unlisted' })
  })

  it('leaves zero Team aliases when a newer head wins a visibility transfer CAS', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const original = { ...env.state.hub_sessions[0]! }
    const winnerRoot = 'f'.repeat(64)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        Object.assign(env.state.hub_sessions[0]!, {
          root: winnerRoot,
          updated_at: original.updated_at + 1,
        })
        return originalBatch(statements)
      },
    })

    const changed = await changeVisibility(env, { visibility: 'team', team_id: TEAM_ID })

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({
      root: winnerRoot,
      team_id: null,
      visibility: 'unlisted',
    })
  })

  it('leaves zero Team aliases when membership removal wins a head transfer', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.team_memberships = env.state.team_memberships.filter(
          (row) => row.user_id !== 'user-a',
        )
        return originalBatch(statements)
      },
    })

    const changed = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({ team_id: null, visibility: 'unlisted' })
  })

  it('leaves zero Team aliases when account deletion wins a head transfer', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        env.state.users.find((row) => row.id === 'user-a')!.deletion_pending_until = Date.now()
        return originalBatch(statements)
      },
    })

    const changed = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({ team_id: null, visibility: 'unlisted' })
  })

  it('leaves zero Team aliases when a newer head wins the head-transfer CAS', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await uploadAndCommit(env, fixture)).status).toBe(200)
    const winnerRoot = 'e'.repeat(64)
    const originalUpdatedAt = env.state.hub_sessions[0]!.updated_at
    const originalBatch = env.DB.batch.bind(env.DB)
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        Object.assign(env.state.hub_sessions[0]!, {
          root: winnerRoot,
          updated_at: originalUpdatedAt + 1,
        })
        return originalBatch(statements)
      },
    })

    const changed = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(changed.status).toBe(404)
    expect(env.state.hub_team_objects).toHaveLength(0)
    expect(env.state.hub_sessions[0]).toMatchObject({ root: winnerRoot, team_id: null })
  })

  it('does not let a Team admin rewrite another author’s attributed Session', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)
    env.state.team_memberships.find((row) => row.user_id === 'user-b')!.role = 'admin'

    const rewrite = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_B_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(rewrite.status).toBe(404)
  })

  it('lets a member update their own active Team content but not its disclosure or withdrawal', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_B_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_B_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)

    const contentUpdate = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        {
          ...fixture.head,
          summaryMd: '## Outcome\n\nUpdated by the Team member author.',
          visibility: 'team',
          teamId: TEAM_ID,
        },
        USER_B_TOKEN,
      ),
      env,
      { sid: SID },
    )
    const headPublish = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'public', teamId: TEAM_ID },
        USER_B_TOKEN,
      ),
      env,
      { sid: SID },
    )
    const publish = await changeVisibility(
      env,
      { visibility: 'public', team_id: TEAM_ID },
      USER_B_TOKEN,
    )
    const memberWithdraw = await withdraw(env, USER_B_TOKEN)

    expect(contentUpdate.status).toBe(200)
    expect(headPublish.status).toBe(403)
    expect(publish.status).toBe(403)
    expect(memberWithdraw.status).toBe(403)
    expect(env.state.hub_sessions[0]).toMatchObject({
      note_md: '## Outcome\n\nUpdated by the Team member author.',
      visibility: 'private',
      withdrawn_at: null,
    })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('never resurrects a withdrawn Team Session through head, for either managers or authors', async () => {
    const ownerEnv = await teamEnv()
    const ownerFixture = await makeFixture()
    expect((await upload(ownerEnv, USER_A_TOKEN, ownerFixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...ownerFixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          ownerEnv,
          { sid: SID },
        )
      ).status,
    ).toBe(200)
    expect((await withdraw(ownerEnv, USER_A_TOKEN)).status).toBe(200)
    const ownerRevive = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...ownerFixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      ownerEnv,
      { sid: SID },
    )

    const memberEnv = await teamEnv()
    const memberFixture = await makeFixture()
    expect((await upload(memberEnv, USER_B_TOKEN, memberFixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...memberFixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_B_TOKEN,
          ),
          memberEnv,
          { sid: SID },
        )
      ).status,
    ).toBe(200)
    expect((await withdraw(memberEnv, USER_A_TOKEN)).status).toBe(200)
    const memberRevive = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...memberFixture.head, visibility: 'team', teamId: TEAM_ID },
        USER_B_TOKEN,
      ),
      memberEnv,
      { sid: SID },
    )

    expect(ownerRevive.status).toBe(410)
    expect(memberRevive.status).toBe(410)
    expect(ownerEnv.state.hub_sessions[0]?.withdrawn_at).not.toBeNull()
    expect(memberEnv.state.hub_sessions[0]?.withdrawn_at).not.toBeNull()
  })

  it('makes a concurrent Team archive win over an in-flight public head commit', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)

    const originalBatch = env.DB.batch.bind(env.DB)
    let raced = false
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        if (!raced) {
          raced = true
          env.state.teams[0]!.archived_at = Date.now()
        }
        return originalBatch(statements)
      },
    })
    const publish = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, visibility: 'public', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(publish.status).toBe(404)
    expect(env.state.hub_sessions[0]).toMatchObject({
      visibility: 'private',
      team_id: TEAM_ID,
    })
    expect(env.state.hub_session_discovery).toHaveLength(0)
  })

  it('makes concurrent member removal win over an in-flight Team head update', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)

    const originalBatch = env.DB.batch.bind(env.DB)
    let raced = false
    Object.assign(env.DB, {
      batch: async (statements: Parameters<typeof originalBatch>[0]) => {
        if (!raced) {
          raced = true
          env.state.team_memberships = env.state.team_memberships.filter(
            (row) => row.user_id !== 'user-a',
          )
        }
        return originalBatch(statements)
      },
    })
    const update = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        {
          ...fixture.head,
          summaryMd: '## Outcome\n\nThis update must not commit.',
          visibility: 'team',
          teamId: TEAM_ID,
        },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )

    expect(update.status).toBe(404)
    expect(env.state.hub_sessions[0]?.note_md).toBe(fixture.head.summaryMd)
  })

  it('makes concurrent member removal win over visibility and withdrawal writes', async () => {
    async function activeAdminSession() {
      const env = await teamEnv()
      const fixture = await makeFixture()
      expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
      expect(
        (
          await invoke(
            headPost,
            jsonPost(
              `${sessionUrl(SID)}/head`,
              { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
              USER_A_TOKEN,
            ),
            env,
            { sid: SID },
          )
        ).status,
      ).toBe(200)
      env.state.team_memberships.find((row) => row.user_id === 'user-a')!.role = 'admin'
      env.state.team_memberships.find((row) => row.user_id === 'user-b')!.role = 'owner'
      return env
    }

    const visibilityEnv = await activeAdminSession()
    const originalVisibilityBatch = visibilityEnv.DB.batch.bind(visibilityEnv.DB)
    let visibilityRace = false
    Object.assign(visibilityEnv.DB, {
      batch: async (statements: Parameters<typeof originalVisibilityBatch>[0]) => {
        if (!visibilityRace) {
          visibilityRace = true
          visibilityEnv.state.team_memberships = visibilityEnv.state.team_memberships.filter(
            (row) => row.user_id !== 'user-a',
          )
        }
        return originalVisibilityBatch(statements)
      },
    })
    const visibility = await changeVisibility(
      visibilityEnv,
      { visibility: 'public', team_id: TEAM_ID },
      USER_A_TOKEN,
    )

    const withdrawEnv = await activeAdminSession()
    const originalWithdrawBatch = withdrawEnv.DB.batch.bind(withdrawEnv.DB)
    let withdrawRace = false
    Object.assign(withdrawEnv.DB, {
      batch: async (statements: Parameters<typeof originalWithdrawBatch>[0]) => {
        if (!withdrawRace) {
          withdrawRace = true
          withdrawEnv.state.team_memberships = withdrawEnv.state.team_memberships.filter(
            (row) => row.user_id !== 'user-a',
          )
        }
        return originalWithdrawBatch(statements)
      },
    })
    const withdrawn = await withdraw(withdrawEnv, USER_A_TOKEN)

    expect(visibility.status).toBe(404)
    expect(visibilityEnv.state.hub_sessions[0]?.visibility).toBe('private')
    expect(visibilityEnv.state.hub_session_discovery).toHaveLength(0)
    expect(withdrawn.status).toBe(404)
    expect(withdrawEnv.state.hub_sessions[0]?.withdrawn_at).toBeNull()
  })

  it('reveals a withdrawn Team Session only to a current member', async () => {
    const env = await teamEnv()
    const fixture = await makeFixture()
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)
    expect(
      (
        await invoke(
          headPost,
          jsonPost(
            `${sessionUrl(SID)}/head`,
            { ...fixture.head, visibility: 'team', teamId: TEAM_ID },
            USER_A_TOKEN,
          ),
          env,
          { sid: SID },
        )
      ).status,
    ).toBe(200)
    env.state.hub_sessions[0]!.withdrawn_at = Date.now()

    const anonymous = await invoke(metaGet, readRequest(sessionUrl(SID)), env, { sid: SID })
    const outsider = await invoke(
      metaGet,
      authenticatedReadRequest(sessionUrl(SID), USER_C_TOKEN),
      env,
      { sid: SID },
    )
    const member = await invoke(
      metaGet,
      authenticatedReadRequest(sessionUrl(SID), USER_B_TOKEN),
      env,
      { sid: SID },
    )
    const outsiderManagement = await changeVisibility(
      env,
      { visibility: 'public', team_id: TEAM_ID },
      USER_C_TOKEN,
    )

    expect(anonymous.status).toBe(401)
    expect(outsider.status).toBe(404)
    expect(member.status).toBe(410)
    expect(outsiderManagement.status).toBe(404)
  })

  it('keeps Team lineage inside its readable audience', async () => {
    const env = await teamEnv()
    const sourceSid = 'codex_87654321-abcd-4321-abcd-1234567890ab'
    const otherTeamId = `team_${'e'.repeat(32)}`
    env.state.teams.push({ id: otherTeamId, name: 'Other Team', archived_at: null })
    env.state.hub_sessions.push({
      sid: sourceSid,
      owner_user_id: 'user-c',
      root: 'f'.repeat(64),
      record_count: 1,
      sig: null,
      card_json: null,
      note_md: null,
      lineage_json: null,
      view_oid: null,
      spool_file_oid: null,
      visibility: 'private',
      team_id: otherTeamId,
      withdrawn_at: null,
      created_at: 1,
      updated_at: 1,
    })
    const fixture = await makeFixture()
    const lineageJson = JSON.stringify({
      source: { sid: sourceSid, position: 1, url: `${BASE_URL}/session/${sourceSid}` },
    })
    expect((await upload(env, USER_A_TOKEN, fixture.entries)).status).toBe(200)

    const crossTeam = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, lineageJson, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )
    expect(crossTeam.status).toBe(200)
    expect(env.state.hub_sessions.find((row) => row.sid === SID)?.lineage_json).toBeNull()

    env.state.hub_sessions.find((row) => row.sid === sourceSid)!.team_id = TEAM_ID
    const sameTeam = await invoke(
      headPost,
      jsonPost(
        `${sessionUrl(SID)}/head`,
        { ...fixture.head, lineageJson, visibility: 'team', teamId: TEAM_ID },
        USER_A_TOKEN,
      ),
      env,
      { sid: SID },
    )
    expect(sameTeam.status).toBe(200)
    expect(env.state.hub_sessions.find((row) => row.sid === SID)?.lineage_json).toBe(lineageJson)

    // Defense in depth for rows written by an older release.
    env.state.hub_sessions.find((row) => row.sid === sourceSid)!.team_id = otherTeamId
    const metadata = await invoke(
      metaGet,
      authenticatedReadRequest(sessionUrl(SID), USER_B_TOKEN),
      env,
      { sid: SID },
    )
    await expect(metadata.json()).resolves.toMatchObject({ lineageJson: null })
  })
})
