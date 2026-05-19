// Minimal in-memory stand-ins for KVNamespace and D1Database — only the
// surface area used by the auth code path. Kept hand-rolled rather than
// pulling in miniflare to keep the test boot time low.

import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

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
  google_sub: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: number
  last_signin_at: number
  deletion_pending_until: number | null
  deleted_at: number | null
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

export type FakeDbState = {
  users: UserRow[]
  audit: AuditRow[]
}

export function makeDb(state: FakeDbState = { users: [], audit: [] }): {
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
        if (/^SELECT \* FROM users WHERE google_sub = \?/i.test(sql)) {
          const [sub] = params
          return (state.users.find((u) => u.google_sub === sub) as T) ?? null
        }
        if (/^SELECT \* FROM users WHERE id=\? AND deleted_at IS NULL/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          return (u as T) ?? null
        }
        throw new Error(`unmocked first() SQL: ${sql}`)
      },
      async run(): Promise<{ success: boolean }> {
        if (/^INSERT INTO users/i.test(sql)) {
          const [id, sub, email, name, avatar, created, last] = params as [
            string,
            string,
            string,
            string | null,
            string | null,
            number,
            number,
          ]
          state.users.push({
            id,
            google_sub: sub,
            email,
            name,
            avatar_url: avatar,
            created_at: created,
            last_signin_at: last,
            deletion_pending_until: null,
            deleted_at: null,
          })
          return { success: true }
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
          return { success: true }
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
          return { success: true }
        }
        throw new Error(`unmocked run() SQL: ${sql}`)
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        throw new Error(`unmocked all() SQL: ${sql}`)
      },
    }
    return stmt
  }
  const db = { prepare } as unknown as D1Database
  return { db, state }
}
