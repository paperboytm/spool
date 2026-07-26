import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { KVNamespace } from '@cloudflare/workers-types'
import type { SessionViewV1 } from '@spool-lab/session-kit'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { onRequestGet as sessionsGet } from '../functions/api/discovery/v1/sessions'
import { onRequestPost as engagementPost } from '../functions/api/discovery/v1/sessions/[sid]/engagement'
import {
  onRequestDelete as socialDelete,
  onRequestGet as socialGet,
  onRequestPut as socialPut,
} from '../functions/api/discovery/v1/sessions/[sid]/social'
import type { SessionRecord } from '../src/auth/session'
import { buildDiscoveryProjection } from '../src/discovery/projection'
import { incrementQualifiedReadIfLive, isDiscoverySessionLive } from '../src/discovery/store'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

const NOW = Date.parse('2026-07-19T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const CLAUDE_SID = 'claude_11111111-2222-4333-8444-555555555555'
const CODEX_SID = 'codex_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TEAM_ID = 'team_discovery_0001'
const VIEWER_TOKEN = 'v'.repeat(40)

function indexedSid(index: number, agent: 'claude' | 'codex' = 'claude'): string {
  return `${agent}_00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function makeEnv() {
  const { db, state } = makeDb(emptyState())
  return { DB: db, RATE: makeKv(), SESSIONS: makeKv(), state }
}

async function seedViewerSession(kv: KVNamespace, userId: string): Promise<void> {
  const record: SessionRecord = {
    user_id: userId,
    created: NOW,
    exp: NOW + 30 * DAY_MS,
    last_seen: NOW,
  }
  await kv.put(`session/${VIEWER_TOKEN}`, JSON.stringify(record), {
    expirationTtl: 30 * 24 * 60 * 60,
  })
}

function socialRequest(sid: string, method = 'GET', authenticated = false): Request {
  return new Request(`https://spool.new/api/discovery/v1/sessions/${sid}/social`, {
    method,
    ...(authenticated ? { headers: { authorization: `Bearer ${VIEWER_TOKEN}` } } : {}),
  })
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
    summaryZh?: string | null
    search?: string
    agent?: 'claude' | 'codex'
    publishedAt?: number
    quality?: number
    visibility?: string
    withdrawnAt?: number | null
    teamId?: string | null
    titleJson?: string | null
    costUsd?: number | null
    totalTokens?: number | null
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
    cost_usd: options.costUsd ?? null,
    total_tokens: options.totalTokens ?? null,
    visibility: options.visibility ?? 'unlisted',
    team_id: options.teamId ?? null,
    withdrawn_at: options.withdrawnAt ?? null,
    created_at: publishedAt,
    updated_at: publishedAt,
  })
  const title = options.title ?? `${agent} session`
  state.hub_session_discovery.push({
    sid: options.sid,
    agent,
    title,
    title_json: options.titleJson ?? null,
    cost_usd: options.costUsd ?? null,
    total_tokens: options.totalTokens ?? null,
    summary_text: summary,
    summary_text_zh: options.summaryZh ?? null,
    search_text: (
      options.search ?? `${title} ${summary ?? ''} ${options.summaryZh ?? ''} ${agent}`
    ).toLowerCase(),
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
  return new Request(`https://spool.new/api/discovery/v1/sessions/${sid}/engagement`, {
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
    // Legacy shares (no front-matter, no usage) keep null projections.
    expect(projection.titleJson).toBeNull()
    expect(projection.costUsd).toBeNull()
    expect(projection.totalTokens).toBeNull()
  })

  it('prefers front-matter task titles and prices recorded usage', () => {
    const view: SessionViewV1 = {
      v: 1,
      index: [
        { i: 0, kind: 'user', size: 10 },
        { i: 1, kind: 'assistant', size: 10 },
      ],
      files: [],
      outline: [],
      firstPrompt: 'please look at this bug',
      lastReply: 'Fixed.',
      diffstat: { files: 0, adds: 0, dels: 0 },
      usage: {
        models: {
          // 1M input on sonnet-4 pricing = $3
          'claude-sonnet-4-5-20250929': {
            input: 1_000_000,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
        records: 1,
      },
    }
    const projection = buildDiscoveryProjection({
      sid: CLAUDE_SID,
      summaryMd:
        '---\ntitle: Fix refresh-token race across tabs\ntitle_zh: 修复跨标签页刷新令牌竞态\n---\n\n# Fix refresh-token race across tabs\n\n## Goal\nStop double refresh.',
      lineageJson: null,
      recordCount: 4,
      publishedAt: NOW - DAY_MS,
      updatedAt: NOW,
      view,
    })

    // The agent-authored task title beats the first-prompt echo.
    expect(projection.title).toBe('Fix refresh-token race across tabs')
    expect(JSON.parse(projection.titleJson ?? '{}')).toEqual({
      en: 'Fix refresh-token race across tabs',
      zh: '修复跨标签页刷新令牌竞态',
    })
    expect(projection.costUsd).toBeCloseTo(3, 4)
    expect(projection.totalTokens).toBe(1_000_000)
    // Front-matter never leaks into excerpts or search.
    expect(projection.summaryText).not.toContain('title_zh')
    expect(projection.summaryText).toContain('Stop double refresh.')
    // The Chinese title is findable in search.
    expect(projection.searchText).toContain('修复跨标签页刷新令牌竞态')
  })

  it('ships the titles/cost columns migration', () => {
    const migration = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../migrations/0011_titles_cost.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE hub_session_discovery ADD COLUMN title_json TEXT;')
    expect(migration).toContain('ALTER TABLE hub_sessions ADD COLUMN cost_usd REAL;')
    expect(migration).toContain('ALTER TABLE hub_sessions ADD COLUMN total_tokens INTEGER;')
    expect(migration).toContain('ALTER TABLE hub_session_discovery ADD COLUMN cost_usd REAL;')
    expect(migration).toContain(
      'ALTER TABLE hub_session_discovery ADD COLUMN total_tokens INTEGER;',
    )
  })

  it('ships the idempotent Public star schema and direct-lineage index', () => {
    const migration = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../migrations/0012_session_social.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE hub_session_stars')
    expect(migration).toContain('PRIMARY KEY (sid, user_id)')
    expect(migration).toContain('REFERENCES hub_sessions(sid) ON DELETE CASCADE')
    expect(migration).toContain('REFERENCES users(id) ON DELETE CASCADE')
    expect(migration).toContain('CREATE INDEX hub_session_stars_user_created')
    expect(migration).toContain('CREATE INDEX hub_discovery_lineage_source_sid')
    expect(migration).toContain('WHERE lineage_source_sid IS NOT NULL')
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

    const linkOnlyMigration = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../migrations/0006_enforce_link_only_share.sql',
      ),
      'utf8',
    )
    expect(linkOnlyMigration).toContain('DELETE FROM hub_session_engagement_daily')
    expect(linkOnlyMigration).toContain('DELETE FROM hub_session_discovery')
  })
})

describe('GET /api/discovery/v1/sessions', () => {
  it('emits bilingual titles and cost only for rows that carry them', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'starrer')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'Fix refresh-token race across tabs',
      titleJson: JSON.stringify({
        en: 'Fix refresh-token race across tabs',
        zh: '修复跨标签页刷新令牌竞态',
      }),
      costUsd: 3.0125,
      totalTokens: 1_200_000,
      summary: 'Explains why refresh-token races break signed-in browser tabs.',
      summaryZh: '解释刷新令牌竞态为什么会破坏已登录的浏览器标签页。',
      publishedAt: NOW,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Legacy row',
      publishedAt: NOW - 1,
    })
    env.state.hub_session_stars.push({
      sid: CLAUDE_SID,
      user_id: 'starrer',
      created_at: NOW,
    })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(body.items[0]).toMatchObject({
      sid: CLAUDE_SID,
      titles: {
        en: 'Fix refresh-token race across tabs',
        zh: '修复跨标签页刷新令牌竞态',
      },
      cost: { usd: 3.0125, totalTokens: 1_200_000 },
      summaryExcerpts: {
        en: 'Explains why refresh-token races break signed-in browser tabs.',
        zh: '解释刷新令牌竞态为什么会破坏已登录的浏览器标签页。',
      },
      starCount: 1,
    })
    expect(body.items[1]).not.toHaveProperty('titles')
    expect(body.items[1]).not.toHaveProperty('summaryExcerpts')
    expect(body.items[1]).not.toHaveProperty('cost')
    expect(body.items[1]).toMatchObject({ starCount: 0 })
  })

  it('bounds both localized Summary excerpts by Unicode characters', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      summary: 'a'.repeat(400),
      summaryZh: '中'.repeat(400),
    })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      items: Array<{
        summaryExcerpt: string
        summaryExcerpts: { en: string; zh: string }
      }>
    }

    expect(Array.from(body.items[0]!.summaryExcerpt)).toHaveLength(360)
    expect(Array.from(body.items[0]!.summaryExcerpts.en)).toHaveLength(360)
    expect(Array.from(body.items[0]!.summaryExcerpts.zh)).toHaveLength(360)
  })

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
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      version: number
      items: Array<{ sid: string; author: Record<string, unknown> }>
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
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
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const hiddenAvatarBody = (await hiddenAvatarResponse.json()) as {
      items: Array<{ author: { avatarUrl: string | null } }>
    }
    expect(hiddenAvatarBody.items[0]?.author.avatarUrl).toBeNull()
  })

  it('keeps Team-owned Public content after author deletion but removes identity fields', async () => {
    const env = makeEnv()
    seedUser(env.state, 'deleted-team-author', {
      deleted_at: NOW,
      display_name: 'Former Author',
      custom_avatar_id: 'old-avatar',
    })
    env.state.teams.push({
      id: TEAM_ID,
      workos_organization_id: 'org_discovery',
      name: 'Discovery Team',
      deletion_pending_until: null,
      archived_at: null,
    })
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      owner: 'deleted-team-author',
      title: 'Team knowledge survives',
      teamId: TEAM_ID,
    })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      items: Array<{
        sid: string
        author: { handle: string | null; displayName: string | null; avatarUrl: string | null }
        project: { id: string; slug: string; name: string } | null
      }>
    }
    expect(body.items).toEqual([
      expect.objectContaining({
        sid: CLAUDE_SID,
        author: { handle: null, displayName: null, avatarUrl: null },
        project: null,
      }),
    ])

    env.state.teams[0]!.archived_at = NOW
    const archived = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    await expect(archived.json()).resolves.toMatchObject({ items: [] })
  })

  it('hides stale lineage as soon as its source is no longer currently Public', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID, title: 'Source' })
    seedDiscovery(env.state, { sid: CODEX_SID, title: 'Child', publishedAt: NOW + 1 })
    env.state.hub_session_discovery.find((row) => row.sid === CODEX_SID)!.lineage_source_sid =
      CLAUDE_SID

    const list = async () => {
      const response = await invoke(
        sessionsGet,
        new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
        env,
      )
      return (await response.json()) as {
        items: Array<{ sid: string; lineage: { sourceSid: string } | null }>
      }
    }

    expect((await list()).items.find((item) => item.sid === CODEX_SID)?.lineage).toEqual({
      sourceSid: CLAUDE_SID,
    })

    // Deliberately leave the stale source projection behind: the read path
    // must use the current Session disclosure rather than cached lineage.
    env.state.hub_sessions.find((row) => row.sid === CLAUDE_SID)!.visibility = 'private'
    expect((await list()).items.find((item) => item.sid === CODEX_SID)?.lineage).toBeNull()

    env.state.hub_sessions.find((row) => row.sid === CLAUDE_SID)!.visibility = 'unlisted'
    env.state.hub_sessions.find((row) => row.sid === CLAUDE_SID)!.withdrawn_at = NOW
    expect((await list()).items.find((item) => item.sid === CODEX_SID)?.lineage).toBeNull()

    env.state.hub_sessions.find((row) => row.sid === CLAUDE_SID)!.withdrawn_at = null
    env.state.hub_session_discovery = env.state.hub_session_discovery.filter(
      (row) => row.sid !== CLAUDE_SID,
    )
    expect((await list()).items.find((item) => item.sid === CODEX_SID)?.lineage).toBeNull()
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
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recommended'),
      env,
    )
    const recommendedItems = (await recommended.json()) as { items: Array<{ sid: string }> }
    expect(recommendedItems.items[0]?.sid).toBe(CODEX_SID)

    const search = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?q=refresh%20tokens&sort=trending'),
      env,
    )
    const searchItems = (await search.json()) as { items: Array<{ sid: string }> }
    expect(searchItems.items.map((item) => item.sid)).toEqual([CLAUDE_SID, CODEX_SID])
  })

  it('gives Chinese titles and summaries the same high-weight search ranking', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'Prevent refresh-token races',
      titleJson: JSON.stringify({
        en: 'Prevent refresh-token races',
        zh: '修复刷新令牌竞态',
      }),
      summary: 'Keeps browser tabs signed in.',
      summaryZh: '避免多个标签页同时刷新凭据。',
      search: 'Prevent refresh-token races 修复刷新令牌竞态 避免多个标签页同时刷新凭据',
      quality: 1,
      publishedAt: NOW - 20 * DAY_MS,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Popular browser concurrency',
      summary: 'Refresh-token guidance.',
      summaryZh: '包含修复刷新令牌竞态的背景资料。',
      quality: 20,
      publishedAt: NOW - DAY_MS,
    })
    env.state.hub_session_engagement_daily.push({
      sid: CODEX_SID,
      day: '2026-07-19',
      qualified_reads: 10_000,
    })

    const response = await invoke(
      sessionsGet,
      new Request(
        'https://spool.new/api/discovery/v1/sessions?q=%E4%BF%AE%E5%A4%8D%E5%88%B7%E6%96%B0%E4%BB%A4%E7%89%8C%E7%AB%9E%E6%80%81&sort=trending',
      ),
      env,
    )
    const body = (await response.json()) as { items: Array<{ sid: string }> }

    expect(body.items.map((item) => item.sid)).toEqual([CLAUDE_SID, CODEX_SID])
  })

  it('paginates with an opaque filter-bound cursor and validates every query parameter', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID, publishedAt: NOW })
    seedDiscovery(env.state, { sid: CODEX_SID, publishedAt: NOW - 1, agent: 'codex' })

    const first = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent&limit=1'),
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
        `https://spool.new/api/discovery/v1/sessions?sort=recent&limit=1&cursor=${firstBody.nextCursor}`,
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
      'https://spool.new/api/discovery/v1/sessions?q=',
      'https://spool.new/api/discovery/v1/sessions?sort=popular',
      'https://spool.new/api/discovery/v1/sessions?agent=gemini',
      'https://spool.new/api/discovery/v1/sessions?limit=0',
      'https://spool.new/api/discovery/v1/sessions?cursor=not.valid',
      `https://spool.new/api/discovery/v1/sessions?sort=trending&cursor=${firstBody.nextCursor}`,
    ]
    for (const url of invalidUrls) {
      const response = await invoke(sessionsGet, new Request(url), env)
      expect(response.status, url).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'BAD_REQUEST' })
    }
  })

  it('walks every Recent Session past the former 200-row boundary without duplicates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    const expected: string[] = []
    for (let index = 0; index < 251; index += 1) {
      const sid = indexedSid(index)
      expected.push(sid)
      // Equal timestamps exercise the stable SID tie-break across pages.
      seedDiscovery(env.state, { sid, publishedAt: NOW })
    }
    expected.sort()

    const seen: string[] = []
    let cursor: string | null = null
    let pageCount = 0
    do {
      const suffix = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      const response = await invoke(
        sessionsGet,
        new Request(`https://spool.new/api/discovery/v1/sessions?sort=recent&limit=50${suffix}`),
        env,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        items: Array<{ sid: string }>
        nextCursor: string | null
      }
      seen.push(...body.items.map((item) => item.sid))
      cursor = body.nextCursor
      pageCount += 1
      expect(pageCount).toBeLessThanOrEqual(6)
    } while (cursor !== null)

    expect(pageCount).toBe(6)
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(251)
  })

  it('keeps a projection rewrite from moving an already-seen row behind the cursor', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'First page',
      quality: 20,
      publishedAt: NOW - DAY_MS,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Second page',
      quality: 1,
      publishedAt: NOW - 2 * DAY_MS,
    })

    const first = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recommended&limit=1'),
      env,
    )
    const firstBody = (await first.json()) as {
      items: Array<{ sid: string }>
      nextCursor: string
    }
    expect(firstBody.items.map((item) => item.sid)).toEqual([CLAUDE_SID])

    const rewritten = env.state.hub_session_discovery.find((row) => row.sid === CLAUDE_SID)!
    rewritten.quality_score = 0
    rewritten.updated_at = NOW + 1

    const second = await invoke(
      sessionsGet,
      new Request(
        'https://spool.new/api/discovery/v1/sessions?sort=recommended&limit=1' +
          `&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      ),
      env,
    )
    const secondBody = (await second.json()) as {
      items: Array<{ sid: string }>
      nextCursor: string | null
    }
    expect(secondBody.items.map((item) => item.sid)).toEqual([CODEX_SID])
    expect(secondBody.nextCursor).toBeNull()
  })

  it('ranks and paginates Top globally instead of preselecting the newest 200', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    for (let index = 0; index < 205; index += 1) {
      seedDiscovery(env.state, {
        sid: indexedSid(1_000 + index),
        title: `Recent low-signal ${index}`,
        quality: 0,
        publishedAt: NOW - index,
      })
    }
    const olderTopSid = indexedSid(9_999, 'codex')
    seedDiscovery(env.state, {
      sid: olderTopSid,
      title: 'Older durable result',
      quality: 20,
      publishedAt: NOW - 30 * DAY_MS,
      agent: 'codex',
    })
    env.state.hub_session_engagement_daily.push({
      sid: olderTopSid,
      day: '2026-07-18',
      qualified_reads: 10_000,
    })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const suffix = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      const response = await invoke(
        sessionsGet,
        new Request(
          `https://spool.new/api/discovery/v1/sessions?sort=recommended&limit=50${suffix}`,
        ),
        env,
      )
      const body = (await response.json()) as {
        items: Array<{ sid: string }>
        nextCursor: string | null
      }
      seen.push(...body.items.map((item) => item.sid))
      cursor = body.nextCursor
    } while (cursor !== null)

    expect(seen[0]).toBe(olderTopSid)
    expect(seen).toHaveLength(206)
    expect(new Set(seen).size).toBe(206)
  })

  it('searches and paginates the full matching set with exact-title relevance first in Top', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    for (let index = 0; index < 205; index += 1) {
      seedDiscovery(env.state, {
        sid: indexedSid(2_000 + index),
        title: `Refresh tokens result ${index}`,
        publishedAt: NOW - index,
      })
    }
    const exactSid = indexedSid(8_888, 'codex')
    seedDiscovery(env.state, {
      sid: exactSid,
      title: 'Refresh tokens',
      publishedAt: NOW - 60 * DAY_MS,
      agent: 'codex',
    })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const suffix = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      const response = await invoke(
        sessionsGet,
        new Request(
          'https://spool.new/api/discovery/v1/sessions' +
            `?q=refresh%20tokens&sort=recommended&limit=50${suffix}`,
        ),
        env,
      )
      const body = (await response.json()) as {
        items: Array<{ sid: string }>
        nextCursor: string | null
      }
      seen.push(...body.items.map((item) => item.sid))
      cursor = body.nextCursor
    } while (cursor !== null)

    expect(seen[0]).toBe(exactSid)
    expect(seen).toHaveLength(206)
    expect(new Set(seen).size).toBe(206)
  })

  it('keeps Recent strictly chronological while search is active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      title: 'Refresh tokens in a recent workflow',
      publishedAt: NOW - DAY_MS,
    })
    seedDiscovery(env.state, {
      sid: CODEX_SID,
      title: 'Refresh tokens',
      publishedAt: NOW - 30 * DAY_MS,
    })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?q=refresh%20tokens&sort=recent'),
      env,
    )
    const body = (await response.json()) as { items: Array<{ sid: string }> }

    expect(body.items.map((item) => item.sid)).toEqual([CLAUDE_SID, CODEX_SID])
  })

  it('collapses multiple active handles to one deterministic author row', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    env.state.handles.push(
      { handle: 'zeta', user_id: 'user-1', claimed_at: NOW, released_at: null },
      { handle: 'alpha', user_id: 'user-1', claimed_at: NOW + 1, released_at: null },
    )
    seedDiscovery(env.state, { sid: CLAUDE_SID })

    const response = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?sort=recent'),
      env,
    )
    const body = (await response.json()) as {
      items: Array<{ sid: string; author: { handle: string | null } }>
    }

    expect(body.items).toEqual([
      expect.objectContaining({
        sid: CLAUDE_SID,
        author: expect.objectContaining({ handle: 'alpha' }),
      }),
    ])
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
      new Request('https://spool.new/api/discovery/v1/sessions?q=maya&agent=claude'),
      env,
    )
    const body = (await response.json()) as { items: Array<{ sid: string }> }
    expect(body.items.map((item) => item.sid)).toEqual([CLAUDE_SID])

    const none = await invoke(
      sessionsGet,
      new Request('https://spool.new/api/discovery/v1/sessions?q=does-not-match'),
      env,
    )
    await expect(none.json()).resolves.toMatchObject({ items: [] })
  })
})

describe('/api/discovery/v1/sessions/:sid/social', () => {
  it('returns anonymous counts and derives only verified live Public direct forks', async () => {
    const env = makeEnv()
    seedUser(env.state, 'author')
    seedUser(env.state, 'starrer-1')
    seedUser(env.state, 'starrer-2')
    seedDiscovery(env.state, { sid: CLAUDE_SID, owner: 'author' })
    env.state.hub_session_stars.push(
      { sid: CLAUDE_SID, user_id: 'starrer-1', created_at: NOW - 2 },
      { sid: CLAUDE_SID, user_id: 'starrer-2', created_at: NOW - 1 },
    )

    const liveChild = indexedSid(101)
    seedDiscovery(env.state, { sid: liveChild, owner: 'author' })
    env.state.hub_session_discovery.find((row) => row.sid === liveChild)!.lineage_source_sid =
      CLAUDE_SID
    env.state.hub_session_verified_forks.push({
      child_sid: liveChild,
      source_sid: CLAUDE_SID,
      source_root: 'a'.repeat(64),
      source_position: 1,
      child_root: 'b'.repeat(64),
      grant_token_hash: '1'.repeat(64),
      verified_at: NOW,
    })

    const withdrawnChild = indexedSid(102)
    seedDiscovery(env.state, { sid: withdrawnChild, owner: 'author', withdrawnAt: NOW })
    env.state.hub_session_discovery.find((row) => row.sid === withdrawnChild)!.lineage_source_sid =
      CLAUDE_SID
    env.state.hub_session_verified_forks.push({
      child_sid: withdrawnChild,
      source_sid: CLAUDE_SID,
      source_root: 'a'.repeat(64),
      source_position: 1,
      child_root: 'c'.repeat(64),
      grant_token_hash: '2'.repeat(64),
      verified_at: NOW,
    })

    const teamOnlyChild = indexedSid(103)
    env.state.teams.push({ id: TEAM_ID, name: 'Private Team', archived_at: null })
    seedDiscovery(env.state, {
      sid: teamOnlyChild,
      owner: 'author',
      teamId: TEAM_ID,
      visibility: 'private',
    })
    env.state.hub_session_discovery.find((row) => row.sid === teamOnlyChild)!.lineage_source_sid =
      CLAUDE_SID
    env.state.hub_session_verified_forks.push({
      child_sid: teamOnlyChild,
      source_sid: CLAUDE_SID,
      source_root: 'a'.repeat(64),
      source_position: 1,
      child_root: 'd'.repeat(64),
      grant_token_hash: '3'.repeat(64),
      verified_at: NOW,
    })

    const archivedTeamChild = indexedSid(104)
    const archivedTeamId = `${TEAM_ID}_archived`
    env.state.teams.push({
      id: archivedTeamId,
      name: 'Archived Team',
      archived_at: NOW,
    })
    seedDiscovery(env.state, {
      sid: archivedTeamChild,
      owner: 'author',
      teamId: archivedTeamId,
    })
    env.state.hub_session_discovery.find(
      (row) => row.sid === archivedTeamChild,
    )!.lineage_source_sid = CLAUDE_SID
    env.state.hub_session_verified_forks.push({
      child_sid: archivedTeamChild,
      source_sid: CLAUDE_SID,
      source_root: 'a'.repeat(64),
      source_position: 1,
      child_root: 'e'.repeat(64),
      grant_token_hash: '4'.repeat(64),
      verified_at: NOW,
    })

    // Legacy/client-asserted lineage is still displayed, but is not a fork
    // count until a server-issued grant has been claimed by its child head.
    const unverifiedChild = indexedSid(105)
    seedDiscovery(env.state, { sid: unverifiedChild, owner: 'author' })
    env.state.hub_session_discovery.find((row) => row.sid === unverifiedChild)!.lineage_source_sid =
      CLAUDE_SID

    // A malformed self-reference is not a fork.
    env.state.hub_session_discovery.find((row) => row.sid === CLAUDE_SID)!.lineage_source_sid =
      CLAUDE_SID

    const response = await invoke(socialGet, socialRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    await expect(response.json()).resolves.toEqual({
      version: 1,
      starCount: 2,
      forkCount: 1,
      viewerStarred: false,
      canStar: false,
    })
  })

  it('stars and unstars idempotently for a signed-in viewer', async () => {
    const env = makeEnv()
    seedUser(env.state, 'author')
    seedUser(env.state, 'viewer')
    await seedViewerSession(env.SESSIONS, 'viewer')
    seedDiscovery(env.state, { sid: CLAUDE_SID, owner: 'author' })

    const initial = await invoke(socialGet, socialRequest(CLAUDE_SID, 'GET', true), env, {
      sid: CLAUDE_SID,
    })
    await expect(initial.json()).resolves.toMatchObject({
      starCount: 0,
      viewerStarred: false,
      canStar: true,
    })

    const first = await invoke(socialPut, socialRequest(CLAUDE_SID, 'PUT', true), env, {
      sid: CLAUDE_SID,
    })
    const duplicate = await invoke(socialPut, socialRequest(CLAUDE_SID, 'PUT', true), env, {
      sid: CLAUDE_SID,
    })

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({
      starCount: 1,
      viewerStarred: true,
      canStar: true,
    })
    await expect(duplicate.json()).resolves.toMatchObject({
      starCount: 1,
      viewerStarred: true,
    })
    expect(env.state.hub_session_stars).toEqual([
      expect.objectContaining({ sid: CLAUDE_SID, user_id: 'viewer' }),
    ])

    const removed = await invoke(socialDelete, socialRequest(CLAUDE_SID, 'DELETE', true), env, {
      sid: CLAUDE_SID,
    })
    const duplicateDelete = await invoke(
      socialDelete,
      socialRequest(CLAUDE_SID, 'DELETE', true),
      env,
      { sid: CLAUDE_SID },
    )
    await expect(removed.json()).resolves.toMatchObject({
      starCount: 0,
      viewerStarred: false,
    })
    await expect(duplicateDelete.json()).resolves.toMatchObject({
      starCount: 0,
      viewerStarred: false,
    })
    expect(env.state.hub_session_stars).toEqual([])
  })

  it('rate-limits repeated Star mutations per viewer and target', async () => {
    const env = makeEnv()
    seedUser(env.state, 'author')
    seedUser(env.state, 'viewer')
    await seedViewerSession(env.SESSIONS, 'viewer')
    seedDiscovery(env.state, { sid: CLAUDE_SID, owner: 'author' })

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await invoke(socialPut, socialRequest(CLAUDE_SID, 'PUT', true), env, {
        sid: CLAUDE_SID,
      })
      expect(response.status, `attempt ${attempt + 1}`).toBe(200)
    }

    const limited = await invoke(socialDelete, socialRequest(CLAUDE_SID, 'DELETE', true), env, {
      sid: CLAUDE_SID,
    })

    expect(limited.status).toBe(429)
    expect(limited.headers.get('cache-control')).toBe('no-store')
    expect(limited.headers.get('vary')).toBe('Cookie, Authorization')
    expect(env.state.hub_session_stars).toEqual([
      expect.objectContaining({ sid: CLAUDE_SID, user_id: 'viewer' }),
    ])
  })

  it('fails closed for non-Public targets and requires login for mutations', async () => {
    const env = makeEnv()
    seedUser(env.state, 'author')
    seedUser(env.state, 'viewer')
    await seedViewerSession(env.SESSIONS, 'viewer')
    seedDiscovery(env.state, {
      sid: CLAUDE_SID,
      owner: 'author',
      visibility: 'private',
      teamId: TEAM_ID,
    })
    env.state.teams.push({ id: TEAM_ID, name: 'Private Team', archived_at: null })

    const hiddenGet = await invoke(socialGet, socialRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })
    const hiddenPut = await invoke(socialPut, socialRequest(CLAUDE_SID, 'PUT', true), env, {
      sid: CLAUDE_SID,
    })
    const anonymousPut = await invoke(socialPut, socialRequest(CLAUDE_SID, 'PUT'), env, {
      sid: CLAUDE_SID,
    })

    expect(hiddenGet.status).toBe(404)
    expect(hiddenPut.status).toBe(404)
    expect(anonymousPut.status).toBe(401)
    expect(anonymousPut.headers.get('cache-control')).toBe('no-store')
    expect(anonymousPut.headers.get('vary')).toBe('Cookie, Authorization')
    expect(env.state.hub_session_stars).toEqual([])
  })

  it('treats stale and deletion-pending sessions as anonymous on GET', async () => {
    const env = makeEnv()
    seedUser(env.state, 'author')
    seedUser(env.state, 'viewer', { deletion_pending_until: NOW + DAY_MS })
    await seedViewerSession(env.SESSIONS, 'viewer')
    seedDiscovery(env.state, { sid: CLAUDE_SID, owner: 'author' })
    env.state.hub_session_stars.push({
      sid: CLAUDE_SID,
      user_id: 'viewer',
      created_at: NOW,
    })

    const pending = await invoke(socialGet, socialRequest(CLAUDE_SID, 'GET', true), env, {
      sid: CLAUDE_SID,
    })
    const stale = await invoke(
      socialGet,
      new Request(`https://spool.new/api/discovery/v1/sessions/${CLAUDE_SID}/social`, {
        headers: { authorization: `Bearer ${'x'.repeat(40)}` },
      }),
      env,
      { sid: CLAUDE_SID },
    )

    await expect(pending.json()).resolves.toMatchObject({
      viewerStarred: false,
      canStar: false,
    })
    await expect(stale.json()).resolves.toMatchObject({
      viewerStarred: false,
      canStar: false,
    })
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

  it('rejects Link-only Sessions without a Public projection', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID })
    env.state.hub_session_discovery = []

    const response = await invoke(engagementPost, engagementRequest(CLAUDE_SID), env, {
      sid: CLAUDE_SID,
    })

    expect(response.status).toBe(404)
    expect(env.state.hub_session_engagement_daily).toEqual([])
  })

  it('closes the Public-to-Team race inside the conditional engagement write', async () => {
    const env = makeEnv()
    seedUser(env.state, 'user-1')
    seedDiscovery(env.state, { sid: CLAUDE_SID })

    await expect(isDiscoverySessionLive(env.DB, CLAUDE_SID)).resolves.toBe(true)
    env.state.hub_session_discovery = []

    await expect(incrementQualifiedReadIfLive(env.DB, CLAUDE_SID, '2026-07-19')).resolves.toBe(
      false,
    )
    expect(env.state.hub_session_engagement_daily).toEqual([])
  })
})
