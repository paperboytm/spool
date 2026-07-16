import { describe, expect, it } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'
import {
  canonicalizeRecord,
  composeSessionDiff,
  deriveView,
  extractEditEvents,
  sequenceRoot,
  type CanonicalRecord,
} from '@spool-lab/session-kit'

import { onRequestPost as batchPost } from '../functions/api/hub/v1/objects/batch'
import { onRequestPost as tokensPost } from '../functions/api/hub/v1/tokens'
import { onRequestPost as headPost } from '../functions/api/hub/v1/sessions/[sid]/head'
import { onRequestGet as metaGet } from '../functions/api/hub/v1/sessions/[sid]/index'
import { onRequestPost as pushPost } from '../functions/api/hub/v1/sessions/[sid]/push'
import { onRequestGet as recordsGet } from '../functions/api/hub/v1/sessions/[sid]/records'
import { onRequestGet as viewGet } from '../functions/api/hub/v1/sessions/[sid]/view'
import { onRequestPost as withdrawPost } from '../functions/api/hub/v1/sessions/[sid]/withdraw'
import type { SessionRecord } from '../src/auth/session'

import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

const BASE_URL = 'https://share.example.test'
const SID = 'claude_12345678-abcd-4321-abcd-1234567890ab'
const USER_A_TOKEN = 'a'.repeat(40)
const USER_B_TOKEN = 'b'.repeat(40)
const DEV_TOKEN = 'local-hub-dev-token'

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
        content: [{
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: {
            file_path: '/workspace/src/greeting.ts',
            old_string: 'hello',
            new_string: 'hello, friend',
          },
        }],
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
  const records = await Promise.all(rawRecords.map((record) => canonicalizeRecord(
    JSON.stringify(record),
    { workspaceRoot: '/workspace', homeDir: '/home/tester' },
  )))
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
    noteMd: 'A synthetic shared session.',
    lineageJson: null,
    viewOid: view.oid,
  }
  return { records, view, viewValue, head, entries: [...records, view] }
}

function jsonPost(url: string, body: unknown, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
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
  return invoke(
    pushPost,
    jsonPost(`${sessionUrl(sid)}/push`, fixture.head, token),
    env,
    { sid },
  )
}

async function upload(env: TestEnv, token: string, entries: readonly CanonicalRecord[]) {
  return invoke(batchPost, batchRequest(entries, token), env)
}

async function commit(env: TestEnv, fixture: Fixture, token = USER_A_TOKEN, sid = SID) {
  return invoke(
    headPost,
    jsonPost(`${sessionUrl(sid)}/head`, fixture.head, token),
    env,
    { sid },
  )
}

async function withdraw(env: TestEnv, token = USER_A_TOKEN, sid = SID) {
  return invoke(
    withdrawPost,
    jsonPost(`${sessionUrl(sid)}/withdraw`, {}, token),
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
    const { token } = await minted.json() as { token: string }
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

  it('accepts HUB_DEV_TOKEN and provisions the synthetic dev user', async () => {
    const env = envFor({ devToken: DEV_TOKEN })
    const fixture = await makeFixture()

    const response = await push(env, fixture, DEV_TOKEN)

    expect(response.status).toBe(200)
    expect(env.state.users).toContainEqual(expect.objectContaining({ id: 'hub-dev-user' }))
  })
})

describe('hub push', () => {
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

describe('hub public reads', () => {
  it('returns 404 for unknown session metadata', async () => {
    const env = envFor()

    const response = await invoke(
      metaGet,
      readRequest(sessionUrl(SID)),
      env,
      { sid: SID },
    )

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
      author: {
        handle: 'alice',
        displayName: 'Alice Example',
        avatarUrl: '/api/avatars/avatar-a',
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

    const response = await invoke(
      viewGet,
      readRequest(`${sessionUrl(SID)}/view`),
      env,
      { sid: SID },
    )
    const etag = `"${fixture.view.oid}"`

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    await expect(response.json()).resolves.toEqual(fixture.viewValue)

    const cached = await invoke(
      viewGet,
      readRequest(`${sessionUrl(SID)}/view`, etag),
      env,
      { sid: SID },
    )
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
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
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
      batches: [
        fixture.records.slice(0, 2),
        [...fixture.records.slice(2), fixture.view],
      ],
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
    const fixture = await makeFixture(Array.from({ length: 3 }, (_, index) => ({
      type: index === 0 ? 'user' : 'assistant',
      message: {
        role: index === 0 ? 'user' : 'assistant',
        content: `${index}:${chunk}`,
      },
    })))
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

    const view = await invoke(
      viewGet,
      readRequest(`${sessionUrl(SID)}/view`),
      env,
      { sid: SID },
    )
    expect(view.status).toBe(200)
    const receivedView = await view.json() as { diffstat: unknown }

    const records = await invoke(
      recordsGet,
      readRequest(`${sessionUrl(SID)}/records?from=0&to=${fixture.records.length}`),
      env,
      { sid: SID },
    )
    expect(records.status).toBe(200)
    const receivedRecords = parseNdjson(await records.text())
    const readerDiff = composeSessionDiff(extractEditEvents(
      receivedRecords.map(({ i, data }) => ({ i, data })),
      { provider: 'claude' },
    ))

    expect(readerDiff).toEqual(authorDiff)
    expect(receivedView.diffstat).toEqual(readerDiff.diffstat)
  })
})
