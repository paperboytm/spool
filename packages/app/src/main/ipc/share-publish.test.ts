import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_PUBLISH_BODY_BYTES,
  type PublishRequestBody,
} from '../../shared/share-publish.js'

type Handler = (e: unknown, ...args: unknown[]) => unknown

const { handlers, authedFetch } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  authedFetch: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) },
}))
vi.mock('../share/api-client.js', () => ({ authedFetch }))
vi.mock('../auth/session-store.js', () => ({ clearToken: vi.fn() }))
vi.mock('@spool-lab/core', () => ({
  getDB: () => ({}),
  getByDraftId: vi.fn(),
  listAll: vi.fn(() => []),
  markRevoked: vi.fn(),
  replaceAll: vi.fn(),
  upsertMany: vi.fn(),
}))

import { registerSharePublishIpc } from './share-publish.js'

function makeBody(content: string): PublishRequestBody {
  return {
    snapshot: {
      schema_version: 1,
      source: { kind: 'spool-session', captured_at: '2026-07-01T00:00:00.000Z' },
      conversation: {
        title: 'T',
        turns: [{ id: 't0', role: 'assistant', content }],
        turn_order: ['t0'],
        hidden_turns: [],
      },
      editor_opts: {
        template: 'chat',
        paper: 'ivory',
        typeface: 'sans',
        colorway: 'amber',
        density: 'compact',
        masthead: false,
        colophon: false,
        avatars: true,
        show_byline: false,
      },
    },
    visibility: 'unlisted',
    draft_id: 'd1',
    idempotency_key: 'k1',
  }
}

function publish(body: PublishRequestBody) {
  const handler = handlers.get('share-publish:publish')
  if (!handler) throw new Error('publish handler not registered')
  return handler(null, body)
}

describe('share-publish:publish size gate', () => {
  beforeEach(() => {
    handlers.clear()
    authedFetch.mockReset()
    registerSharePublishIpc()
  })

  it('rejects an oversized payload with 413 and never hits the network', async () => {
    const body = makeBody('x'.repeat(MAX_PUBLISH_BODY_BYTES))
    // Sanity: the serialized body must actually exceed the cap.
    expect(JSON.stringify(body).length).toBeGreaterThan(MAX_PUBLISH_BODY_BYTES)

    const res = await publish(body)

    expect(res).toEqual({
      ok: false,
      status: 413,
      error: { error: 'PAYLOAD_TOO_LARGE' },
    })
    expect(authedFetch).not.toHaveBeenCalled()
  })

  it('measures UTF-8 bytes, not string length — CJK payloads are capped by wire size', async () => {
    // 800k CJK chars ≈ 800k UTF-16 code units but ~2.4MB of UTF-8 —
    // under the cap by string length, over it by actual bytes.
    const body = makeBody('汉'.repeat(800_000))
    const payload = JSON.stringify(body)
    expect(payload.length).toBeLessThan(MAX_PUBLISH_BODY_BYTES)
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(MAX_PUBLISH_BODY_BYTES)

    const res = await publish(body)

    expect(res).toMatchObject({ ok: false, status: 413 })
    expect(authedFetch).not.toHaveBeenCalled()
  })

  it('mirrors the backend cap exactly (guards against silent drift)', () => {
    // The backend constant is not importable from here (Cloudflare
    // function module), so read its source — if the server cap moves,
    // this fails and forces the shared constant to move with it.
    const src = readFileSync(
      join(__dirname, '../../../../share-backend/functions/api/publish.ts'),
      'utf8',
    )
    const m = src.match(/MAX_SNAPSHOT_BYTES\s*=\s*([0-9*\s]+)/)
    expect(m).not.toBeNull()
    const backendCap = m![1]
      .split('*')
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1)
    expect(MAX_PUBLISH_BODY_BYTES).toBe(backendCap)
  })

  it('uploads a normally-sized payload with the serialized body', async () => {
    const body = makeBody('hello world')
    authedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 's1', url: 'https://spool.pro/s/s1', version: 1 }),
    })

    const res = (await publish(body)) as { ok: boolean }

    expect(authedFetch).toHaveBeenCalledWith('/api/publish', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    expect(res.ok).toBe(true)
  })
})
