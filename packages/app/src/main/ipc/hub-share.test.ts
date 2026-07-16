import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sequenceRoot } from '@spool-lab/session-kit'

import type { HubSharePrepareResult, HubSharePublishResult } from '../../shared/hub-share.js'

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

// In-memory hub speaking the same wire contract as share-backend — the
// share pipeline runs for real; only fs resolution + network are injected.

interface StoredHead {
  root: string
  count: number
  manifest: string[]
  viewOid: string
  noteMd: string | null
}

function makeHub() {
  const objects = new Map<string, string>()
  const sessions = new Map<string, StoredHead>()
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (method === 'POST' && url.pathname === '/api/hub/v1/objects/batch') {
      for (const line of String(init?.body ?? '').split('\n')) {
        if (line.trim() === '') continue
        const { oid, data } = JSON.parse(line) as { oid: string; data: string }
        objects.set(oid, data)
      }
      return json({ stored: 1 })
    }
    const match = url.pathname.match(/^\/api\/hub\/v1\/sessions\/([^/]+)\/(push|head)$/)
    if (match && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as StoredHead
      const wanted = [...new Set([...body.manifest, body.viewOid])]
      const missing = wanted.filter((oid) => !objects.has(oid))
      if (match[2] === 'push') return json({ missing })
      if (missing.length > 0) return json({ error: 'CONFLICT' }, 409)
      sessions.set(decodeURIComponent(match[1] as string), body)
      return json({ url: `https://hub.test/session/${match[1]}` })
    }
    return json({ error: 'NOT_FOUND' }, 404)
  }
  return { fetchImpl, sessions, objects }
}

const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'

function writeFixture(dir: string): string {
  const line = (r: Record<string, unknown>) => JSON.stringify(r)
  const jsonl = [
    line({
      type: 'user', uuid: 'u-1', sessionId: 'orig', cwd: dir, timestamp: '2026-07-16T10:00:00.000Z',
      message: { role: 'user', content: 'hello, ship the demo. token AKIAABCDEFGHIJKLMNOP' },
    }),
    line({
      type: 'assistant', uuid: 'u-2', parentUuid: 'u-1', sessionId: 'orig', timestamp: '2026-07-16T10:00:05.000Z',
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

async function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return (await handler({}, args)) as T
}

describe('hub-share IPC', () => {
  beforeEach(() => {
    loadToken.mockReturnValue('session-token')
  })

  it('prepare computes counts, diffstat, redact findings, and a note prefill locally', async () => {
    setup()
    const result = await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    if (!result.ok) throw new Error(result.error)
    expect(result.prepared.sid).toBe(`claude_${SESSION_UUID}`)
    expect(result.prepared.count).toBe(2)
    expect(result.prepared.secrets.total).toBeGreaterThan(0)
    expect(result.prepared.notePrefill).toContain('Records shared: 2')
  })

  it('publish runs the 3-step handshake with the app session bearer', async () => {
    const { hub } = setup()
    await invoke<HubSharePrepareResult>('hub-share:prepare', { sessionUuid: SESSION_UUID })
    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      note: 'take a look',
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.url).toBe(`https://hub.test/session/claude_${SESSION_UUID}`)

    const head = hub.sessions.get(`claude_${SESSION_UUID}`)
    expect(head?.noteMd).toBe('take a look')
    expect(head?.root).toBe(await sequenceRoot(head?.manifest ?? []))
    expect(hub.objects.has(head?.viewOid ?? '')).toBe(true)
  })

  it('publish without a signed-in session reports UNAUTHENTICATED', async () => {
    setup()
    loadToken.mockReturnValue(null)
    const result = await invoke<HubSharePublishResult>('hub-share:publish', {
      sessionUuid: SESSION_UUID,
      note: '',
    })
    expect(result).toEqual({ ok: false, error: 'UNAUTHENTICATED' })
  })
})
