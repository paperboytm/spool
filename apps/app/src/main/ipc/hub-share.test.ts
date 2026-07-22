import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sequenceRoot, serializePortableSession } from '@spool-lab/session-kit'
import { describe, it, expect, beforeEach, vi } from 'vite-plus/test'

import type {
  HubSharePrepareResult,
  HubSharePublishResult,
  HubShareTeamsResult,
  HubShareWithdrawResult,
} from '../../shared/hub-share.js'

type Handler = (e: unknown, ...args: unknown[]) => unknown

const { handlers, loadToken } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  loadToken: vi.fn<() => string | null>(() => 'session-token'),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) },
  net: { fetch: vi.fn() },
}))
vi.mock('../auth/session-store.js', () => ({ loadToken }))
vi.mock('../share/backend-url.js', () => ({ backendUrl: () => 'https://hub.test' }))

import { registerHubShareIpc } from './hub-share.js'

// In-memory hub speaking the same wire contract as the backend — the
// share pipeline runs for real; only fs resolution + network are injected.

interface StoredHead {
  root: string
  count: number
  manifest: string[]
  viewOid: string
  spoolFileOid: string | null
  summaryMd: string | null
  visibility?: 'public' | 'link-only' | 'team'
  teamId?: string
  expectedTeamId?: string | null
}

function makeHub() {
  const objects = new Map<string, string>()
  const sessions = new Map<string, StoredHead>()
  const pushes = new Map<string, StoredHead>()
  const withdrawn = new Set<string>()
  const teamAuthorizations: Array<string | null> = []
  const requestCounts = { get: 0, push: 0, head: 0, upload: 0 }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/api/teams') {
      teamAuthorizations.push(new Headers(init?.headers).get('authorization'))
      return json({
        teams: [
          {
            id: 'team_00000000000000000000000000000000',
            name: 'Platform',
            role: 'member',
            permissions: ['team:leave'],
            member_count: 3,
            archived_at: null,
          },
        ],
      })
    }
    if (method === 'POST' && url.pathname === '/api/hub/v1/objects/batch') {
      requestCounts.upload++
      for (const line of String(init?.body ?? '').split('\n')) {
        if (line.trim() === '') continue
        const { oid, data } = JSON.parse(line) as { oid: string; data: string }
        objects.set(oid, data)
      }
      return json({ stored: 1 })
    }
    const sessionMatch = url.pathname.match(/^\/api\/hub\/v1\/sessions\/([^/]+)$/)
    if (sessionMatch && method === 'GET') {
      const sid = decodeURIComponent(sessionMatch[1] as string)
      requestCounts.get++
      if (withdrawn.has(sid)) return json({ error: 'GONE' }, 410)
      const head = sessions.get(sid)
      if (!head) return json({ error: 'NOT_FOUND' }, 404)
      return json({
        sid,
        root: head.root,
        count: head.count,
        sig: null,
        cardJson: null,
        summaryMd: head.summaryMd,
        lineageJson: null,
        viewOid: head.viewOid,
        spoolFileOid: head.spoolFileOid,
        createdAt: 1,
        updatedAt: 1,
        visibility: head.visibility,
        team: head.teamId ? { id: head.teamId, name: 'Platform' } : null,
        author: { handle: null, displayName: null, avatarUrl: null },
      })
    }
    const match = url.pathname.match(/^\/api\/hub\/v1\/sessions\/([^/]+)\/(push|head)$/)
    if (match && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as StoredHead
      const sid = decodeURIComponent(match[1] as string)
      const current = sessions.get(sid)
      if (body.expectedTeamId !== undefined && (current?.teamId ?? null) !== body.expectedTeamId) {
        return json(
          {
            error: 'CONFLICT',
            detail: 'session ownership changed; review the current Team target',
          },
          409,
        )
      }
      const wanted = [
        ...new Set([
          ...body.manifest,
          body.viewOid,
          ...(body.spoolFileOid ? [body.spoolFileOid] : []),
        ]),
      ]
      const missing = wanted.filter((oid) => !objects.has(oid))
      if (match[2] === 'push') {
        requestCounts.push++
        pushes.set(sid, body)
        return json({ missing })
      }
      requestCounts.head++
      if (missing.length > 0) return json({ error: 'CONFLICT' }, 409)
      sessions.set(sid, body)
      withdrawn.delete(sid)
      return json({ url: `https://hub.test/session/${match[1]}` })
    }
    const withdrawMatch = url.pathname.match(/^\/api\/hub\/v1\/sessions\/([^/]+)\/withdraw$/)
    if (withdrawMatch && method === 'POST') {
      withdrawn.add(decodeURIComponent(withdrawMatch[1] as string))
      return json({ withdrawn: true })
    }
    return json({ error: 'NOT_FOUND' }, 404)
  }
  return {
    fetchImpl,
    sessions,
    pushes,
    objects,
    withdrawn,
    teamAuthorizations,
    requestCounts,
  }
}

const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const PI_SESSION_UUID = '7f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'

function writeFixture(dir: string): string {
  const line = (r: Record<string, unknown>) => JSON.stringify(r)
  const jsonl =
    [
      line({
        type: 'user',
        uuid: 'u-1',
        sessionId: 'orig',
        cwd: dir,
        timestamp: '2026-07-16T10:00:00.000Z',
        message: { role: 'user', content: 'hello, ship the demo. token AKIAABCDEFGHIJKLMNOP' },
      }),
      line({
        type: 'assistant',
        uuid: 'u-2',
        parentUuid: 'u-1',
        sessionId: 'orig',
        timestamp: '2026-07-16T10:00:05.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Shipped.' }] },
      }),
    ].join('\n') + '\n'
  const filePath = join(dir, 'session.jsonl')
  writeFileSync(filePath, jsonl, 'utf8')
  return filePath
}

function setup() {
  handlers.clear()
  const hub = makeHub()
  const dir = mkdtempSync(join(tmpdir(), 'hub-share-ipc-'))
  const filePath = writeFixture(dir)
  registerHubShareIpc({
    fetchFn: hub.fetchImpl,
    loadTokenFn: loadToken,
    resolveTarget: () => ({ provider: 'claude', sessionUuid: SESSION_UUID, filePath, cwd: dir }),
  })
  return { hub, dir }
}

function setupPi() {
  handlers.clear()
  const hub = makeHub()
  const dir = mkdtempSync(join(tmpdir(), 'hub-share-pi-ipc-'))
  const jsonl = serializePortableSession({
    source: 'pi',
    sessionUuid: PI_SESSION_UUID,
    filePath: join(dir, 'pi.jsonl'),
    title: 'Share a Pi session',
    cwd: dir,
    model: 'pi-model',
    startedAt: '2026-07-16T10:00:00.000Z',
    endedAt: '2026-07-16T10:00:05.000Z',
    messages: [
      {
        uuid: 'pi-u-1',
        parentUuid: null,
        role: 'user',
        contentText: 'hello from Pi',
        timestamp: '2026-07-16T10:00:00.000Z',
        isSidechain: false,
        toolNames: [],
        seq: 0,
      },
      {
        uuid: 'pi-a-1',
        parentUuid: 'pi-u-1',
        role: 'assistant',
        contentText: 'Pi shared.',
        timestamp: '2026-07-16T10:00:05.000Z',
        isSidechain: false,
        toolNames: [],
        seq: 1,
      },
    ],
  })
  registerHubShareIpc({
    fetchFn: hub.fetchImpl,
    loadTokenFn: loadToken,
    resolveTarget: () => ({
      provider: 'pi',
      sessionUuid: PI_SESSION_UUID,
      filePath: join(dir, 'pi.jsonl'),
      cwd: dir,
      jsonl,
    }),
  })
  return { hub, dir }
}

async function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return (await handler({}, args)) as T
}

describe('hub-share IPC', () => {
  beforeEach(() => {
    loadToken.mockReturnValue('session-token')
  })

  it('prepare computes counts, diffstat, redact findings, and a summary prefill locally', async () => {
    setup()
    const result = await invoke<HubSharePrepareResult>('hub-share:prepare', {
      sessionUuid: SESSION_UUID,
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.prepared.sid).toBe(`claude_${SESSION_UUID}`)
    expect(result.prepared.count).toBe(2)
    expect(result.prepared.secrets.total).toBeGreaterThan(0)
    expect(result.prepared.summaryPrefill).toContain('Records shared: 2')
  })

  it('publish runs the 3-step handshake with the app session bearer', async () => {
    const { hub } = setup()
    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: '## Outcome\n\nTake a look.',
      target: { visibility: 'default' },
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.url).toBe(`https://hub.test/session/claude_${SESSION_UUID}`)
    expect(result.visibility).toBe('public')

    const head = hub.sessions.get(`claude_${SESSION_UUID}`)
    expect(head?.summaryMd).toBe('## Outcome\n\nTake a look.')
    expect(head?.visibility).toBe('public')
    expect(head?.teamId).toBeUndefined()
    expect(head?.expectedTeamId).toBeNull()
    expect(head?.root).toBe(await sequenceRoot(head?.manifest ?? []))
    expect(hub.objects.has(head?.viewOid ?? '')).toBe(true)

    // Every desktop share auto-attaches a sanitized .spool document.
    expect(head?.spoolFileOid).toBeTruthy()
    const doc = hub.objects.get(head?.spoolFileOid ?? '') ?? ''
    expect(doc).toContain('"version":2')
    expect(doc).toContain('hello, ship the demo')
    // The fixture's AWS key must be masked in the attached document.
    expect(doc).not.toContain('AKIAABCDEFGHIJKLMNOP')
  })

  it('loads the signed-in user Teams with the app session bearer', async () => {
    const { hub } = setup()

    const result = await invoke<HubShareTeamsResult>('hub-share:teams', undefined)

    expect(result).toEqual({
      ok: true,
      teams: [{ id: 'team_00000000000000000000000000000000', name: 'Platform' }],
    })
    expect(hub.teamAuthorizations).toEqual(['Bearer session-token'])
  })

  it('publishes to an explicit Team target in both push and committed head', async () => {
    const { hub } = setup()
    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })

    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: 'Team-owned result.',
      target: {
        visibility: 'team',
        teamId: 'team_00000000000000000000000000000000',
      },
    })

    expect(result).toEqual({
      ok: true,
      url: `https://hub.test/session/claude_${SESSION_UUID}`,
      visibility: 'team',
    })
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'team',
      teamId: 'team_00000000000000000000000000000000',
    })
    expect(hub.pushes.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'team',
      teamId: 'team_00000000000000000000000000000000',
      expectedTeamId: null,
    })
  })

  it('blocks a Team-owned re-share before upload or head instead of changing disclosure', async () => {
    const { hub } = setup()
    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    const first = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: 'Team-owned result.',
      target: {
        visibility: 'team',
        teamId: 'team_00000000000000000000000000000000',
      },
    })
    expect(first.ok).toBe(true)
    const before = { ...hub.requestCounts }

    const second = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: 'Would otherwise become Public.',
      target: { visibility: 'default' },
    })

    expect(second).toEqual({ ok: false, error: 'TEAM_OWNED_SESSION' })
    expect(hub.requestCounts).toEqual(before)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'team',
      teamId: 'team_00000000000000000000000000000000',
      summaryMd: 'Team-owned result.',
    })
  })

  it('allows a withdrawn personal Session to be explicitly shared again', async () => {
    const { hub } = setup()
    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    expect(
      (
        await invoke<HubSharePublishResult>('hub-share:publish', {
          sessionUuid: SESSION_UUID,
          summary: 'First personal share.',
          target: { visibility: 'default' },
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await invoke<HubShareWithdrawResult>('hub-share:withdraw', {
          sid: `claude_${SESSION_UUID}`,
        })
      ).ok,
    ).toBe(true)
    const withdrawnResponse = await hub.fetchImpl(
      `https://hub.test/api/hub/v1/sessions/claude_${SESSION_UUID}`,
    )
    expect(withdrawnResponse.status).toBe(410)
    const readsBeforeReshare = hub.requestCounts.get

    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    const reshared = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: 'Shared again after withdrawal.',
      target: { visibility: 'default' },
    })

    expect(reshared).toMatchObject({ ok: true, visibility: 'public' })
    expect(hub.requestCounts.get).toBe(readsBeforeReshare)
    expect(hub.withdrawn).not.toContain(`claude_${SESSION_UUID}`)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(
      'Shared again after withdrawal.',
    )
  })

  it('rejects a Team id combined with a non-Team visibility at the IPC boundary', async () => {
    const { hub } = setup()

    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: '',
      target: {
        visibility: 'public',
        teamId: 'team_00000000000000000000000000000000',
      },
    })

    expect(result).toEqual({ ok: false, error: 'Invalid Share target' })
    expect(hub.pushes.size).toBe(0)
    expect(hub.sessions.size).toBe(0)
  })

  it('prepares and publishes a portable Pi session with a readable attached document', async () => {
    const { hub } = setupPi()
    const prepared = await invoke<HubSharePrepareResult>('hub-share:prepare', {
      sessionUuid: PI_SESSION_UUID,
    })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.prepared.sid).toBe(`pi_${PI_SESSION_UUID}`)
    expect(prepared.prepared.count).toBe(2)

    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: PI_SESSION_UUID,
      summary: '## Outcome\n\nPi is shareable.',
      target: { visibility: 'default' },
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.url).toBe(`https://hub.test/session/pi_${PI_SESSION_UUID}`)
    expect(result.visibility).toBe('link-only')

    const head = hub.sessions.get(`pi_${PI_SESSION_UUID}`)
    expect(head?.visibility).toBe('link-only')
    expect(head?.teamId).toBeUndefined()
    const doc = hub.objects.get(head?.spoolFileOid ?? '') ?? ''
    expect(doc).toContain('hello from Pi')
    expect(doc).toContain('"source":"pi"')
  })

  it('publish without a signed-in session reports UNAUTHENTICATED', async () => {
    setup()
    loadToken.mockReturnValue(null)
    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      summary: '',
      target: { visibility: 'default' },
    })
    expect(result).toEqual({ ok: false, error: 'UNAUTHENTICATED' })
  })

  it('withdraw tombstones a completed Hub share', async () => {
    const { hub } = setup()
    const result = await invoke<HubShareWithdrawResult>('hub-share:withdraw', {
      sid: `claude_${SESSION_UUID}`,
    })

    expect(result).toEqual({ ok: true })
    expect(hub.withdrawn).toContain(`claude_${SESSION_UUID}`)
  })
})
