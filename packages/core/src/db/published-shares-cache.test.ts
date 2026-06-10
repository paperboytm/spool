import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PublishedShareCacheItem } from './published-shares-cache.js'

const tempDirs: string[] = []
const openDbs: Array<{ close: () => void }> = []

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close()
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/** Helper to keep the test cases focused on the field under test
 *  (visibility, draft_id, etc.) without re-typing the full row each time. */
function row(over: Partial<PublishedShareCacheItem> & { id: string }): PublishedShareCacheItem {
  return {
    title: '',
    visibility: 'unlisted',
    version: 1,
    published_at: 0,
    revoked_at: null,
    draft_id: null,
    client_request_id: null,
    updated_at: 0,
    ...over,
  }
}

describe('published_shares_cache schema (v15)', () => {
  it('creates the table with expected columns and pk', async () => {
    const { db } = await load()
    const columns = db
      .prepare('PRAGMA table_info(published_shares_cache)')
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>
    const byName = new Map(columns.map((c) => [c.name, c]))
    expect(byName.get('id')?.pk).toBe(1)
    expect(byName.get('visibility')?.notnull).toBe(1)
    expect(byName.get('published_at')?.notnull).toBe(1)
    expect(byName.get('revoked_at')?.notnull).toBe(0)
    expect(byName.get('draft_id')?.type.toUpperCase()).toBe('TEXT')
    expect(byName.get('draft_id')?.notnull).toBe(0)
  })

  it('creates the draft_id partial index', async () => {
    const { db } = await load()
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='published_shares_cache'`)
      .all() as Array<{ name: string }>
    const names = idx.map((i) => i.name)
    expect(names).toContain('idx_published_shares_cache_draft_id')
  })

  it('user_version reaches 15 after migration', async () => {
    const { db } = await load()
    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version
    expect(v).toBe(15)
  })

  it('upsertMany inserts new rows and listAll returns them by published_at desc', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'a', title: 'A', published_at: 100, updated_at: 100 }),
      row({ id: 'b', title: 'B', visibility: 'profile-listed', published_at: 200, updated_at: 200 }),
      row({ id: 'c', title: 'C', version: 2, published_at: 150, revoked_at: 175, updated_at: 200 }),
    ])
    const rows = mod.listAll(db)
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(rows[1]?.revoked_at).toBe(175)
  })

  it('upsertMany updates existing rows in place', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [row({ id: 'x', title: 'first', published_at: 100, updated_at: 100 })])
    mod.upsertMany(db, [
      row({ id: 'x', title: 'second', visibility: 'profile-listed', version: 2, published_at: 100, revoked_at: 999, updated_at: 999 }),
    ])
    const rows = mod.listAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('second')
    expect(rows[0]?.visibility).toBe('profile-listed')
    expect(rows[0]?.revoked_at).toBe(999)
  })

  it('replaceAll wipes rows not in the new list', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'a', published_at: 100, updated_at: 100 }),
      row({ id: 'b', published_at: 200, updated_at: 200 }),
    ])
    mod.replaceAll(db, [row({ id: 'b', published_at: 200, updated_at: 200 })])
    const rows = mod.listAll(db)
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('clearAll empties the table', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [row({ id: 'a', published_at: 1, updated_at: 1 })])
    mod.clearAll(db)
    expect(mod.listAll(db)).toEqual([])
  })

  // ── draft_id linkage ─────────────────────────────────────────────

  it('getByDraftId returns null for an unknown draft', async () => {
    const { db, mod } = await load()
    expect(mod.getByDraftId(db, 'no-such-draft')).toBeNull()
  })

  it('getByDraftId returns the matching row including draft_id', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'slug-1', draft_id: 'd-1', published_at: 100, updated_at: 100 }),
      row({ id: 'slug-other', draft_id: 'd-other', published_at: 200, updated_at: 200 }),
    ])
    const hit = mod.getByDraftId(db, 'd-1')
    expect(hit?.id).toBe('slug-1')
    expect(hit?.draft_id).toBe('d-1')
  })

  it('getByDraftId returns the most-recent share when a draft has multiple', async () => {
    // Real world: publish → revoke → publish-again produces two rows
    // with the same draft_id but different slugs. The editor wants the
    // live one, so we prefer the most recently published row.
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'old', draft_id: 'd-1', published_at: 100, revoked_at: 110, updated_at: 110 }),
      row({ id: 'new', draft_id: 'd-1', published_at: 200, updated_at: 200 }),
    ])
    expect(mod.getByDraftId(db, 'd-1')?.id).toBe('new')
  })

  it('round-trips client_request_id through upsert + listAll', async () => {
    // The editor's "Unpublished edits" badge compares the live
    // draft's content hash against this column on the cache row, so
    // losing it on read or upsert would silently break drift
    // detection (badge never appears, user thinks they're up to date).
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'a', client_request_id: 'abcdef0123', published_at: 100, updated_at: 100 }),
    ])
    const rows = mod.listAll(db)
    expect(rows[0]?.client_request_id).toBe('abcdef0123')
    // Update path also preserves the column.
    mod.upsertMany(db, [
      row({ id: 'a', client_request_id: 'updated-hash', published_at: 100, updated_at: 200 }),
    ])
    expect(mod.listAll(db)[0]?.client_request_id).toBe('updated-hash')
  })

  it('markRevoked flips revoked_at without touching other fields', async () => {
    const { db, mod } = await load()
    mod.upsertMany(db, [
      row({ id: 'x', title: 'keep me', draft_id: 'd-1', published_at: 100, updated_at: 100 }),
    ])
    mod.markRevoked(db, 'x', 999)
    const after = mod.listAll(db)
    expect(after[0]?.revoked_at).toBe(999)
    expect(after[0]?.updated_at).toBe(999)
    expect(after[0]?.title).toBe('keep me')
    expect(after[0]?.draft_id).toBe('d-1')
  })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function load() {
  const spoolDir = makeTempDir('spool-published-cache-')
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  vi.resetModules()
  const dbModule = await import('./db.js')
  const mod = await import('./published-shares-cache.js')
  const db = dbModule.getDB()
  openDbs.push(db)
  return { db, mod }
}
