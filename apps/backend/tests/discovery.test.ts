import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SessionViewV1 } from '@spool-lab/session-kit'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { onRequestGet as sessionsGet } from '../functions/api/discovery/v1/sessions'
import { onRequestPost as engagementPost } from '../functions/api/discovery/v1/sessions/[sid]/engagement'
import { buildDiscoveryProjection } from '../src/discovery/projection'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

const NOW = Date.parse('2026-07-19T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const CLAUDE_SID = 'claude_11111111-2222-4333-8444-555555555555'
const CODEX_SID = 'codex_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function makeEnv() {
  const { db, state } = makeDb(emptyState())
  return { DB: db, RATE: makeKv(), state }
}

function seedUser(
  state: FakeDbState,
  id: string,
  overrides: Partial<FakeDbState['users'][number]> = {},
): void {
  state.users.push({
    id,
    email: `${id}@example.test`,
    name: `Provider ${id}`,
    avatar_url: null,
    created_at: NOW,
    last_signin_at: NOW,
    deletion_pending_until: null,
    deleted_at: null,
    display_name: null,
    custom_avatar_id: null,
    avatar_visible: 1,
    ...overrides,
  })
}

function seedDiscovery(
  state: FakeDbState,
  options: {
    sid: string
    owner?: string
    title?: string
    summary?: string | null
    search?: string
    agent?: 'claude' | 'codex'
    publishedAt?: number
    quality?: number
    visibility?: string
    withdrawnAt?: number | null
  },
): void {
  const owner = options.owner ?? 'user-1'
  const agent = options.agent ?? (options.sid.startsWith('claude_') ? 'claude' : 'codex')
  const summary = options.summary === undefined ? 'A useful public session.' : options.summary
  const publishedAt = options.publishedAt ?? NOW
  state.hub_sessions.push({
    sid: options.sid,
    owner_user_id: owner,
    root: 'a'.repeat(64),
    record_count: 12,
    sig: null,
    card_json: null,
    note_md: summary,
    lineage_json: null,
    view_oid: 'b'.repeat(64),
    spool_file_oid: null,
    visibility: options.visibility ?? 'unlisted',
    withdrawn_at: options.withdrawnAt ?? null,
    created_at: publishedAt,
    updated_at: publishedAt,
  })
  const title = options.title ?? `${agent} session`
  state.hub_session_discovery.push({
    sid: options.sid,
    agent,
    title,
    summary_text: summary,
    search_text: (options.search ?? `${title} ${summary ?? ''} ${agent}`).toLowerCase(),
    message_count: 4,
    tool_call_count: 2,
    file_count: 1,
    additions: 20,
    deletions: 3,
    lineage_source_sid: null,
    quality_score: options.quality ?? 10,
    published_at: publishedAt,
    updated_at: publishedAt,
  })
}

function engagementRequest(sid: string, body: unknown = { kind: 'qualified_read' }): Request {
  return new Request(`https://spool.pro/api/discovery/v1/sessions/${sid}/engagement`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'CF-Connecting-IP': '203.0.113.8',
      'User-Agent': 'discovery-test-reader',
    },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Explore projection', () => {
  it('derives bounded public text, evidence, lineage, and the v1 quality score', () => {
    const view: SessionViewV1 = {
      v: 1,
      index: [
        { i: 0, kind: 'user', size: 10 },
        { i: 1, kind: 'assistant', size: 10 },
        { i: 2, kind: 'edit', size: 10 },
      ],
      files: [{ path: 'src/auth.ts', events: [2], adds: 12, dels: 2 }],
      outline: [{ i: 0, excerpt: 'Prevent refresh races' }],
      firstPrompt: '\n  Prevent refresh-token races across tabs  \nmore detail',
      lastReply: 'Implemented the single-flight path.',
      diffstat: { files: 1, adds: 12, dels: 2 },
    }
    const projection = buildDiscoveryProjection({
      sid: CLAUDE_SID,
      summaryMd: '## Outcome\n\n**Implemented** a [single-flight](https://example.test) path.',
      lineageJson: JSON.stringify({ source: { sid: CODEX_SID, position: 3 } }),
      recordCount: 10,
      publishedAt: NOW - DAY_MS,
      updatedAt: NOW,
      view,
    })

    expect(projection).toMatchObject({
      agent: 'claude',
      title: 'Prevent refresh-token races across tabs',
      summaryText: 'Outcome Implemented a single-flight path.',
      messageCount: 2,
      toolCallCount: 1,
      fileCount: 1,
      additions: 12,
      deletions: 2,
      lineageSourceSid: CODEX_SID,
      qualityScore: 20,
      publishedAt: NOW - DAY_MS,
      updatedAt: NOW,
    })
    expect(projection.searchText).toContain('src/auth.ts')
    expect(projection.searchText).not.toContain('**')
  })

  it('ships the projection, aggregate, indexes, and live-unlisted backfill migration', () => {
    const migration = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../migrations/0005_explore.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE hub_session_discovery')
    expect(migration).toContain('CREATE TABLE hub_session_engagement_daily')
    expect(migration).toContain("WHERE visibility = 'unlisted'")
    expect(migration).toContain('withdrawn_at IS NULL')
    expect(migration).not.toContain("visibility = 'public'")
  })
})

describe('GET /api/discovery/v1/sessions', () => {
  it('returns only live Sessions with live owners and resolves author fields at read time', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1', {
      display_name: 'Maya Chen',
      custom_avatar_id: 'avatar-1',
    })
    seedUser(env.state, 'deleted-user', { deleted_at: NOW })
    env.state.handles.push({
      handle: 'maya',
      user_id: 'user-1',
      claimed_at: NOW,
      released_at: null,
    })
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'Live session',
      publishedAt: NOW,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Private session',
      visibility: 'private',
      publishedAt: NOW + 3,
    })
    seedDiscovery(env.state, {
      sid: 'claude_22222222-2222-4222-8222-222222222222',
      title: 'Withdrawn session',
      withdrawnAt: NOW,
      publishedAt: NOW + 2,
    })
    seedDiscovery(env.state, {
      sid: 'codex_33333333-3333-4333-8333-333333333333',
      owner: 'deleted-user',
      title: 'Deleted owner session',
      publishedAt: NOW + 1,
    })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      version: number
      items: Array<{ sid: string; author: Record<string, unknown> }>
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=30, stale-while-revalidate=30',
    )
    expect(body.version).toBe(1)
    expect(body.items).toEqual([
      expect.objectContaining({
        sid: CLAUDE_SID,
        author: {
          handle: 'maya',
          displayName: 'Maya Chen',
          avatarUrl: '/api/avatars/user-1?v=avatar-1',
        },
      }),
    ])
    expect(body.nextCursor).toBeNull()

    env.state.users[0]!.avatar_visible = 0
    const hiddenAvatarResponse = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const hiddenAvatarBody = (await hiddenAvatarResponse.json()) as {
      items: Array<{ author: { avatarUrl: string | null } }>
    }
    expect(hiddenAvatarBody.items[0]?.author.avatarUrl).toBeNull()
  })

  it('uses v1 ranking and keeps exact title search ahead of popularity', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'Refresh tokens',
      summary: 'Exact result.',
      quality: 1,
      publishedAt: NOW - 20 * DAY_MS,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Popular browser concurrency',
      summary: 'Notes about refresh tokens and tabs.',
      quality: 20,
      publishedAt: NOW - DAY_MS,
    })
    env.state.hub_session_engagement_daily.push({
      sid: CODEX_SID,
      day: '2026-07-19',
      qualified_reads: 10_000,
    })

    const recommended = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?sort=recommended'),
      env,
    )
    const recommendedItems = (await recommended.json()) as { items: Array<{ sid: string }> }
    expect(recommendedItems.items[0]?.sid).toBe(CODEX_SID)

    const search = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?q=refresh%20tokens&sort=trending'),
      env,
    )
    const searchItems = (await search.json()) as { items: Array<{ sid: string }> }
    expect(searchItems.items.map((item) => item.sid)).toEqual([CLAUDE_SID, CODEX_SID])
  })

  it('paginates with an opaque filter-bound cursor and validates every query parameter', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID, publishedAt: NOW })
    seedDiscovery(env.state, { sid: CODEX_SID, publishedAt: NOW - 1, agent: 'codex' })

    const first = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?sort=recent&limit=1'),
      env,
    )
    const firstBody = (await first.json()) as {
      items: Array<{ sid: string }>
      nextCursor: string | null
    }
    expect(firstBody.items[0]?.sid).toBe(CLAUDE_SID)
    expect(firstBody.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)

    const second = await invoke(
      sessionsGet,
      new Request(
        `https://spool.pro/api/discovery/v1/sessions?sort=recent&limit=1&cursor=${firstBody.nextCursor}`,
      ),
      env,
    )
    const secondBody = (await second.json()) as {
      items: Array<{ sid: string }>
      nextCursor: string | null
    }
    expect(secondBody.items[0]?.sid).toBe(CODEX_SID)
    expect(secondBody.nextCursor).toBeNull()

    const invalidUrls = [
      'https://spool.pro/api/discovery/v1/sessions?q=',
      'https://spool.pro/api/discovery/v1/sessions?sort=popular',
      'https://spool.pro/api/discovery/v1/sessions?agent=gemini',
      'https://spool.pro/api/discovery/v1/sessions?limit=0',
      'https://spool.pro/api/discovery/v1/sessions?cursor=not.valid',
      `https://spool.pro/api/discovery/v1/sessions?sort=trending&cursor=${firstBody.nextCursor}`,
    ]
    for (const url of invalidUrls) {
      const response = await invoke(sessionsGet, new Request(url), env)
      expect(response.status, url).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'BAD_REQUEST' })
    }
  })

  it('filters against agent and read-time author fields without returning nonmatches', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1', { display_name: 'Maya Chen' })
    env.state.handles.push({
      handle: 'maya',
      user_id: 'user-1',
      claimed_at: NOW,
      released_at: null,
    })
    seedDiscovery(env.state, { sid: CLAUDE_SID, title: 'Unrelated title' })
    seedDiscovery(env.state, { sid: CODEX_SID, title: 'Also unrelated', agent: 'codex' })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?q=maya&agent=claude'),
      env,
    )
    const body = (await response.json()) as { items: Array<{ sid: string }> }
    expect(body.items.map((item) => item.sid)).toEqual([CLAUDE_SID])

    const none = await invoke(
      sessionsGet,
      new Request('https://spool.pro/api/discovery/v1/sessions?q=does-not-match'),
      env,
    )
    await expect(none.json()).resolves.toMatchObject({ items: [] })
  })
})

describe('POST /api/discovery/v1/sessions/:sid/engagement', () => {
  it('deduplicates a reader per UTC day and increments D1 only once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID })

    const first = await invoke(engagementPost, engagementRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })
    const duplicate = await invoke(engagementPost, engagementRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ accepted: true })
    await expect(duplicate.json()).resolves.toEqual({ accepted: false })
    expect(env.state.hub_session_engagement_daily).toEqual([
      { sid: CLAUDE_SID, day: '2026-07-19', qualified_reads: 1 },
    ])
  })

  it('404s non-live Sessions, validates the signal, and rate-limits repeated abuse', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID })
    seedDiscovery(env.state, { sid: CODEX_SID, withdrawnAt: NOW })

    const withdrawn = await invoke(engagementPost, engagementRequest(CODEX_SID), env, {
      sid: CODEX_SID,
    })
    expect(withdrawn.status).toBe(404)

    const invalid = await invoke(
      engagementPost,
      engagementRequest(CLAUDE_SID, { kind: 'view' }),
      env,
      { sid: CLAUDE_SID },
    )
    expect(invalid.status).toBe(400)

    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) {
      const response = await invoke(engagementPost, engagementRequest(CLAUDE_SID), env, {
        sid: CLAUDE_SID,
      })
      expect(response.status).toBe(200)
    }
    const limited = await invoke(engagementPost, engagementRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ error: 'TOO_MANY_REQUESTS' })
  })
})
