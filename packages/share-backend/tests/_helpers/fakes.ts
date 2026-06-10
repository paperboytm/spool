// Minimal in-memory stand-ins for KVNamespace, D1Database, and R2Bucket
// — only the surface area used by tests. Kept hand-rolled rather than
// pulling in miniflare to keep test boot time low.

import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'

type KvVal = { value: string; expiresAt: number | null }

export function makeKv(): KVNamespace {
  const store = new Map<string, KvVal>()
  const now = () => Date.now()
  const kv = {
    async get(key: string): Promise<string | null> {
      const v = store.get(key)
      if (!v) return null
      if (v.expiresAt !== null && v.expiresAt <= now()) {
        store.delete(key)
        return null
      }
      return v.value
    },
    async put(
      key: string,
      value: string,
      opts?: { expirationTtl?: number },
    ): Promise<void> {
      const expiresAt = opts?.expirationTtl ? now() + opts.expirationTtl * 1000 : null
      store.set(key, { value, expiresAt })
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
  return kv as unknown as KVNamespace
}

type UserRow = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: number
  last_signin_at: number
  deletion_pending_until: number | null
  deleted_at: number | null
  // v0.6+ profile customization. Optional in the fake so existing
  // test fixtures (which push rows without these fields) stay valid;
  // SQL matchers coerce missing values to NULL / 1 (the column
  // defaults).
  display_name?: string | null
  custom_avatar_id?: string | null
  avatar_visible?: number
}

type AuditRow = {
  user_id: string | null
  ip_hash: string
  ua_hash: string
  action: string
  target_id: string | null
  details_json: string | null
  ts: number
}

type UserIdentityRow = {
  provider: string
  provider_sub: string
  user_id: string
  email: string | null
  linked_at: number
}

type HandleRow = {
  handle: string
  user_id: string
  claimed_at: number
  released_at: number | null
}

type PublishedShareRow = {
  id: string
  user_id: string
  title: string
  visibility: string
  expires_at: number | null
  version: number
  published_at: number
  republished_at: number | null
  revoked_at: number | null
  // Optional so existing test fixtures pushing literal rows without a
  // draft_id stay valid; reads coerce missing to null.
  draft_id?: string | null
  client_request_id?: string | null
}

type DeletionQueueRow = {
  user_id: string
  scheduled_at: number
  cancelled: number
}

export type FakeDbState = {
  users: UserRow[]
  audit: AuditRow[]
  user_identities: UserIdentityRow[]
  handles: HandleRow[]
  published_shares: PublishedShareRow[]
  deletion_queue: DeletionQueueRow[]
}

export function emptyState(): FakeDbState {
  return {
    users: [],
    audit: [],
    user_identities: [],
    handles: [],
    published_shares: [],
    deletion_queue: [],
  }
}

export function makeDb(state: FakeDbState = emptyState()): {
  db: D1Database
  state: FakeDbState
} {
  function prepare(sql: string) {
    const params: unknown[] = []
    const stmt = {
      bind(...args: unknown[]) {
        params.push(...args)
        return stmt
      },
      async first<T = unknown>(): Promise<T | null> {
        if (/^SELECT u\.\* FROM users u JOIN user_identities i ON i\.user_id = u\.id WHERE i\.provider = \? AND i\.provider_sub = \?/i.test(sql)) {
          const [provider, sub] = params as [string, string]
          const link = state.user_identities.find(
            (i) => i.provider === provider && i.provider_sub === sub,
          )
          if (!link) return null
          const u = state.users.find((x) => x.id === link.user_id)
          return (u as T) ?? null
        }
        if (/^SELECT \* FROM users WHERE id=\? AND deleted_at IS NULL/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          return (u as T) ?? null
        }
        if (/^SELECT custom_avatar_id, avatar_visible FROM users WHERE id=\? AND deleted_at IS NULL/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          if (!u) return null
          return ({
            custom_avatar_id: u.custom_avatar_id ?? null,
            avatar_visible: u.avatar_visible ?? 1,
          } as T)
        }
        if (/^SELECT custom_avatar_id FROM users WHERE id=\?/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id)
          if (!u) return null
          return ({ custom_avatar_id: u.custom_avatar_id ?? null } as T)
        }
        if (/^SELECT 1 FROM handles WHERE handle=\? AND released_at IS NULL/i.test(sql)) {
          const [h] = params
          const row = state.handles.find((x) => x.handle === h && x.released_at === null)
          return (row ? ({ '1': 1 } as T) : null)
        }
        if (/^SELECT user_id FROM handles WHERE handle=\? AND released_at IS NULL/i.test(sql)) {
          const [h] = params
          const row = state.handles.find((x) => x.handle === h && x.released_at === null)
          return (row ? ({ user_id: row.user_id } as T) : null)
        }
        if (/^SELECT handle FROM handles WHERE user_id=\? AND released_at IS NULL/i.test(sql)) {
          const [uid] = params
          const row = state.handles.find((x) => x.user_id === uid && x.released_at === null)
          return (row ? ({ handle: row.handle } as T) : null)
        }
        if (/^SELECT version FROM published_shares WHERE id=\? AND user_id=\? AND revoked_at IS NULL/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find(
            (s) => s.id === id && s.user_id === uid && s.revoked_at === null,
          )
          return (row ? ({ version: row.version } as T) : null)
        }
        if (/^SELECT version, draft_id FROM published_shares WHERE id=\? AND user_id=\? AND revoked_at IS NULL/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find(
            (s) => s.id === id && s.user_id === uid && s.revoked_at === null,
          )
          return (row ? ({ version: row.version, draft_id: row.draft_id ?? null } as T) : null)
        }
        if (/^SELECT id, version FROM published_shares WHERE user_id=\? AND client_request_id=\? AND revoked_at IS NULL/i.test(sql)) {
          const [uid, key] = params
          const row = state.published_shares.find(
            (s) => s.user_id === uid && s.client_request_id === key && s.revoked_at === null,
          )
          return (row ? ({ id: row.id, version: row.version } as T) : null)
        }
        if (/^SELECT revoked_at FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return (row ? ({ revoked_at: row.revoked_at } as T) : null)
        }
        if (/^SELECT visibility, revoked_at FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return (row ? ({ visibility: row.visibility, revoked_at: row.revoked_at } as T) : null)
        }
        if (/^SELECT 1 FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return (row ? ({ '1': 1 } as T) : null)
        }
        if (/^SELECT 1 FROM published_shares WHERE id=\?/i.test(sql)) {
          const [id] = params
          const row = state.published_shares.find((s) => s.id === id)
          return (row ? ({ '1': 1 } as T) : null)
        }
        if (/^SELECT 1 FROM deletion_queue WHERE user_id=\? AND cancelled=0 AND scheduled_at <= \?/i.test(sql)) {
          const [user_id, cutoff] = params as [string, number]
          const r = state.deletion_queue.find(
            (x) => x.user_id === user_id && x.cancelled === 0 && x.scheduled_at <= cutoff,
          )
          return (r ? ({ '1': 1 } as T) : null)
        }
        if (/^SELECT u\.id AS user_id, u\.email AS email, u\.name AS name, u\.avatar_url AS avatar_url, u\.display_name AS display_name, u\.custom_avatar_id AS custom_avatar_id, u\.avatar_visible AS avatar_visible FROM handles h JOIN users u ON u\.id = h\.user_id WHERE h\.handle = \? AND h\.released_at IS NULL AND u\.deleted_at IS NULL/i.test(sql)) {
          const [handle] = params as [string]
          const h = state.handles.find((x) => x.handle === handle && x.released_at === null)
          if (!h) return null
          const u = state.users.find((x) => x.id === h.user_id && x.deleted_at === null)
          if (!u) return null
          return ({
            user_id: u.id,
            email: u.email,
            name: u.name,
            avatar_url: u.avatar_url,
            display_name: u.display_name ?? null,
            custom_avatar_id: u.custom_avatar_id ?? null,
            avatar_visible: u.avatar_visible ?? 1,
          } as T)
        }
        throw new Error(`unmocked first() SQL: ${sql}`)
      },
      // Returns `{ success, meta: { changes } }` to mirror the real D1
      // contract — branches set `changes: 0` when their WHERE clause
      // matched nothing so optimistic-concurrency callers can detect
      // races (mirrored real D1 surfaces the same value).
      async run(): Promise<{ success: boolean; meta: { changes: number } }> {

        if (/^INSERT INTO users/i.test(sql)) {
          const [id, email, name, avatar, created, last] = params as [
            string,
            string,
            string | null,
            string | null,
            number,
            number,
          ]
          state.users.push({
            id,
            email,
            name,
            avatar_url: avatar,
            created_at: created,
            last_signin_at: last,
            deletion_pending_until: null,
            deleted_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE users SET email=\?, name=\?, avatar_url=\?, last_signin_at=\? WHERE id=\?/i.test(sql)) {
          const [email, name, avatar, last, id] = params as [
            string,
            string | null,
            string | null,
            number,
            string,
          ]
          const u = state.users.find((u) => u.id === id)
          if (u) {
            u.email = email
            u.name = name
            u.avatar_url = avatar
            u.last_signin_at = last
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT INTO user_identities \(provider, provider_sub, user_id, email, linked_at\) VALUES/i.test(sql)) {
          const [provider, provider_sub, user_id, email, linked_at] = params as [
            string,
            string,
            string,
            string | null,
            number,
          ]
          state.user_identities.push({ provider, provider_sub, user_id, email, linked_at })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM user_identities WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const before = state.user_identities.length
          state.user_identities = state.user_identities.filter((i) => i.user_id !== user_id)
          return { success: true, meta: { changes: before - state.user_identities.length } }
        }
        if (/^UPDATE users SET deletion_pending_until=\? WHERE id=\? AND deleted_at IS NULL/i.test(sql)) {
          const [until, id] = params as [number, string]
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          if (u) u.deletion_pending_until = until
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE users SET deletion_pending_until=NULL WHERE id=\?/i.test(sql)) {
          const [id] = params as [string]
          const u = state.users.find((u) => u.id === id)
          if (u) u.deletion_pending_until = null
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT INTO audit_log/i.test(sql)) {
          const [user_id, ip_hash, ua_hash, action, target_id, details_json, ts] = params as [
            string | null,
            string,
            string,
            string,
            string | null,
            string | null,
            number,
          ]
          state.audit.push({ user_id, ip_hash, ua_hash, action, target_id, details_json, ts })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT INTO handles \(handle, user_id, claimed_at\) VALUES/i.test(sql)) {
          const [handle, user_id, claimed_at] = params as [string, string, number]
          // Mirror the real D1 PK constraint so race-condition coverage works.
          if (state.handles.some((h) => h.handle === handle)) {
            throw new Error(`UNIQUE constraint failed: handles.handle`)
          }
          state.handles.push({ handle, user_id, claimed_at, released_at: null })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT OR REPLACE INTO deletion_queue/i.test(sql)) {
          const [user_id, scheduled_at] = params as [string, number]
          const idx = state.deletion_queue.findIndex((r) => r.user_id === user_id)
          const row = { user_id, scheduled_at, cancelled: 0 }
          if (idx >= 0) state.deletion_queue[idx] = row
          else state.deletion_queue.push(row)
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE deletion_queue SET cancelled=1 WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const r = state.deletion_queue.find((x) => x.user_id === user_id)
          if (r) r.cancelled = 1
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT INTO published_shares \(id, user_id, title, visibility, version, published_at, draft_id, client_request_id\)/i.test(sql)) {
          const [id, user_id, title, visibility, version, published_at, draft_id, client_request_id] = params as [
            string, string, string, string, number, number, string | null, string | null,
          ]
          // Mirror the UNIQUE(user_id, client_request_id) partial index
          // so the publish handler's catch-and-resolve path is exercised
          // by tests, not just live D1. The predicate matches the live
          // schema: NULL tokens AND revoked rows are not constrained,
          // so a publish-after-revoke with the same content can recycle
          // the token onto a fresh row.
          if (
            client_request_id !== null &&
            state.published_shares.some(
              (s) =>
                s.user_id === user_id &&
                s.client_request_id === client_request_id &&
                s.revoked_at === null,
            )
          ) {
            throw new Error('UNIQUE constraint failed: published_shares.user_id, published_shares.client_request_id')
          }
          state.published_shares.push({
            id,
            user_id,
            title,
            visibility,
            expires_at: null,
            version,
            published_at,
            republished_at: null,
            revoked_at: null,
            draft_id,
            client_request_id,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET title=\?, visibility=\?, version=\?, republished_at=\?, draft_id=\?, client_request_id=\? WHERE id=\? AND user_id=\? AND version=\?/i.test(sql)) {
          const [title, visibility, version, republished_at, draft_id, client_request_id, id, user_id, expectedVersion] = params as [
            string, string, number, number, string | null, string | null, string, string, number,
          ]
          // Honour the optimistic-concurrency clause: only the row whose
          // current version still matches the SELECTed-then-bound value
          // gets touched. A racing republish bumps the version out from
          // under us → 0 rows changed → caller surfaces 409.
          const s = state.published_shares.find(
            (x) => x.id === id && x.user_id === user_id && x.version === expectedVersion,
          )
          if (!s) return { success: true, meta: { changes: 0 } }
          // Mirror the partial UNIQUE(user_id, client_request_id) index
          // on the republish path too. If another LIVE row for the same
          // user already holds this token (rare: two drafts whose
          // snapshot+visibility hash to the same content), the
          // index fires. Without this branch, tests would silently
          // accept a state real D1 rejects, hiding bugs in the handler.
          if (
            client_request_id !== null &&
            state.published_shares.some(
              (x) =>
                x.user_id === user_id &&
                x.client_request_id === client_request_id &&
                x.revoked_at === null &&
                x.id !== id,
            )
          ) {
            throw new Error('UNIQUE constraint failed: published_shares.user_id, published_shares.client_request_id')
          }
          s.title = title
          s.visibility = visibility
          s.version = version
          s.republished_at = republished_at
          s.draft_id = draft_id
          s.client_request_id = client_request_id
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET revoked_at=\? WHERE id=\?/i.test(sql)) {
          const [revoked_at, id] = params as [number, string]
          const s = state.published_shares.find((x) => x.id === id)
          if (s) s.revoked_at = revoked_at
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET visibility=\? WHERE id=\?/i.test(sql)) {
          const [visibility, id] = params as [string, string]
          const s = state.published_shares.find((x) => x.id === id)
          if (s) s.visibility = visibility
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET revoked_at=\? WHERE user_id=\? AND revoked_at IS NULL/i.test(sql)) {
          const [revoked_at, user_id] = params as [number, string]
          for (const s of state.published_shares) {
            if (s.user_id === user_id && s.revoked_at === null) s.revoked_at = revoked_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE handles SET released_at=\? WHERE user_id=\? AND released_at IS NULL/i.test(sql)) {
          const [released_at, user_id] = params as [number, string]
          for (const h of state.handles) {
            if (h.user_id === user_id && h.released_at === null) h.released_at = released_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE users SET email='\[deleted\]', name=NULL, avatar_url=NULL, display_name=NULL, custom_avatar_id=NULL, deleted_at=\? WHERE id=\?/i.test(sql)) {
          const [deleted_at, id] = params as [number, string]
          const u = state.users.find((u) => u.id === id)
          if (u) {
            u.email = '[deleted]'
            u.name = null
            u.avatar_url = null
            u.deleted_at = deleted_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM deletion_queue WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const idx = state.deletion_queue.findIndex((r) => r.user_id === user_id)
          if (idx >= 0) state.deletion_queue.splice(idx, 1)
          return { success: true, meta: { changes: 1 } }
        }
        throw new Error(`unmocked run() SQL: ${sql}`)
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        if (/^SELECT user_id FROM deletion_queue WHERE scheduled_at <= \? AND cancelled = 0/i.test(sql)) {
          const [cutoff] = params as [number]
          const items = state.deletion_queue
            .filter((r) => r.scheduled_at <= cutoff && r.cancelled === 0)
            .map((r) => ({ user_id: r.user_id }))
          return { results: items as T[] }
        }
        if (/^SELECT id FROM published_shares WHERE user_id=\?/i.test(sql)) {
          const [uid] = params as [string]
          const items = state.published_shares
            .filter((s) => s.user_id === uid)
            .map((s) => ({ id: s.id }))
          return { results: items as T[] }
        }
        if (/^SELECT id FROM published_shares\s+WHERE revoked_at IS NOT NULL AND revoked_at > \?\s+LIMIT \?/i.test(sql)) {
          const [revokedCutoff, limit] = params as [number, number]
          const items = state.published_shares
            .filter((s) => s.revoked_at !== null && s.revoked_at > revokedCutoff)
            .slice(0, limit)
            .map((s) => ({ id: s.id }))
          return { results: items as T[] }
        }
        if (/^SELECT id, title, published_at, version FROM published_shares WHERE user_id = \? AND visibility = \? AND revoked_at IS NULL ORDER BY published_at DESC LIMIT \?/i.test(sql)) {
          const [uid, vis, limit] = params as [string, string, number]
          const items = state.published_shares
            .filter(
              (s) =>
                s.user_id === uid &&
                s.visibility === vis &&
                s.revoked_at === null,
            )
            .slice()
            .sort((a, b) => b.published_at - a.published_at)
            .slice(0, limit)
            .map((s) => ({
              id: s.id,
              title: s.title,
              published_at: s.published_at,
              version: s.version,
            }))
          return { results: items as T[] }
        }
        if (/^SELECT user_id, ip_hash, ua_hash, action, target_id, details_json, ts FROM audit_log ORDER BY ts DESC LIMIT \?/i.test(sql)) {
          const [limit] = params as [number]
          const items = state.audit
            .slice()
            .sort((a, b) => b.ts - a.ts)
            .slice(0, limit)
            .map((r) => ({
              user_id: r.user_id,
              ip_hash: r.ip_hash,
              ua_hash: r.ua_hash,
              action: r.action,
              target_id: r.target_id,
              details_json: r.details_json,
              ts: r.ts,
            }))
          return { results: items as T[] }
        }
        if (/^SELECT id, title, visibility, version, published_at, republished_at, revoked_at, draft_id, client_request_id FROM published_shares WHERE user_id=\? ORDER BY published_at DESC/i.test(sql)) {
          const [uid] = params as [string]
          const items = state.published_shares
            .filter((s) => s.user_id === uid)
            .slice()
            .sort((a, b) => b.published_at - a.published_at)
            .map((s) => ({
              id: s.id,
              title: s.title,
              visibility: s.visibility,
              version: s.version,
              published_at: s.published_at,
              republished_at: s.republished_at,
              revoked_at: s.revoked_at,
              draft_id: s.draft_id ?? null,
              client_request_id: s.client_request_id ?? null,
            }))
          return { results: items as T[] }
        }
        throw new Error(`unmocked all() SQL: ${sql}`)
      },
    }
    return stmt
  }
  const db = { prepare } as unknown as D1Database
  return { db, state }
}

type R2Object = {
  body: ReadableStream<Uint8Array>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

export function makeR2(): { bucket: R2Bucket; store: Map<string, { bytes: Uint8Array; contentType?: string }> } {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const enc = new TextEncoder()

  function toBytes(body: unknown): Uint8Array {
    if (typeof body === 'string') return enc.encode(body)
    if (body instanceof Uint8Array) return body
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (ArrayBuffer.isView(body)) return new Uint8Array((body as ArrayBufferView).buffer)
    throw new Error('FakeR2: unsupported body type')
  }

  const bucket = {
    async put(key: string, body: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const entry: { bytes: Uint8Array; contentType?: string } = { bytes: toBytes(body) }
      const ct = opts?.httpMetadata?.contentType
      if (ct !== undefined) entry.contentType = ct
      store.set(key, entry)
      return { key }
    },
    async get(key: string): Promise<R2Object | null> {
      const v = store.get(key)
      if (!v) return null
      const bytes = v.bytes
      return {
        get body() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          })
        },
        async text() {
          return new TextDecoder().decode(bytes)
        },
        async arrayBuffer() {
          const copy = new Uint8Array(bytes.byteLength)
          copy.set(bytes)
          return copy.buffer as ArrayBuffer
        },
        ...(v.contentType ? { httpMetadata: { contentType: v.contentType } } : {}),
      }
    },
    async delete(key: string) {
      store.delete(key)
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      // Mirrors the R2 list shape: page through `prefix`-matching keys
      // honoring `limit`, return `truncated: true` + a `cursor` when
      // more pages remain. The deletion-worker's avatar sweep relies on
      // this paging contract; if the fake silently returned
      // `truncated: false` the test would never exercise the cursor
      // loop and a regression there would slip through.
      //
      // R2 cursors are opaque tokens that work even when objects are
      // deleted between pages. We model that by encoding the cursor as
      // the last-returned key — the next page filters strictly greater
      // than that key, which stays correct even after the prior page
      // has been wiped from `store`.
      const prefix = opts?.prefix ?? ''
      const limit = opts?.limit ?? 1000
      const after = opts?.cursor ?? ''
      const matched: string[] = []
      for (const key of store.keys()) {
        if (key.startsWith(prefix) && key > after) matched.push(key)
      }
      matched.sort()
      const slice = matched.slice(0, limit)
      const objects = slice.map((key) => ({ key }))
      if (slice.length < matched.length) {
        return { objects, truncated: true as const, cursor: slice[slice.length - 1] }
      }
      return { objects, truncated: false as const }
    },
  }
  return { bucket: bucket as unknown as R2Bucket, store }
}
