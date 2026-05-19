import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ShareDraftListItem } from './share-drafts.js'

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

describe('share_drafts schema (v11)', () => {
  it('creates the table with expected columns and indexes', async () => {
    const { db } = await load()

    const columns = db
      .prepare('PRAGMA table_info(share_drafts)')
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>

    const byName = new Map(columns.map((c) => [c.name, c]))
    expect(byName.get('draft_id')?.pk).toBe(1)
    expect(byName.get('source_kind')?.notnull).toBe(1)
    expect(byName.get('source_origin')?.notnull).toBe(0)
    expect(byName.get('title')?.notnull).toBe(1)
    expect(byName.get('snapshot_json')?.notnull).toBe(1)
    expect(byName.get('preview_json')?.notnull).toBe(1)
    expect(byName.get('created_at')?.notnull).toBe(1)
    expect(byName.get('updated_at')?.notnull).toBe(1)

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='share_drafts'`)
      .all() as Array<{ name: string }>
    const names = indexes.map((i) => i.name)
    expect(names).toContain('idx_share_drafts_updated_at')
    expect(names).toContain('idx_share_drafts_source_origin')
  })

  it('accepts inserts with each valid source_kind', async () => {
    const { db } = await load()
    const kinds = ['spool-session', 'pasted-url', 'imported-file', 'imported-jsonl']
    for (const k of kinds) {
      db.prepare(
        `INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`,
      ).run(`d-${k}`, k, '{}')
    }
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM share_drafts').get() as { n: number }
    ).n
    expect(count).toBe(4)
  })

  it('rejects an unknown source_kind via CHECK constraint', async () => {
    const { db } = await load()
    expect(() =>
      db
        .prepare(`INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`)
        .run('bad', 'not-a-kind', '{}'),
    ).toThrow(/CHECK constraint/)
  })

  it('defaults title to empty string and stamps timestamps', async () => {
    const { db } = await load()
    db.prepare(
      `INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`,
    ).run('d1', 'spool-session', '{}')
    const row = db
      .prepare('SELECT title, created_at, updated_at FROM share_drafts WHERE draft_id=?')
      .get('d1') as { title: string; created_at: string; updated_at: string }
    expect(row.title).toBe('')
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('user_version is at least 11 after migration', async () => {
    const { db } = await load()
    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version
    expect(v).toBeGreaterThanOrEqual(11)
  })

  it('upsertShareDraft inserts a new row with timestamps', async () => {
    const { db, mod } = await load()
    mod.upsertShareDraft(db, {
      draft_id: 'd-1',
      source_kind: 'spool-session',
      source_origin: 'sess-uuid',
      title: 'first',
      snapshot_json: '{"v":1}',
      preview_json: '{"v":1}',
    })
    const row = mod.getShareDraft(db, 'd-1')
    expect(row?.title).toBe('first')
    expect(row?.snapshot_json).toBe('{"v":1}')
    expect(row?.created_at).toBeTruthy()
    expect(row?.updated_at).toBe(row?.created_at)
  })

  it('upsertShareDraft updates in place and bumps updated_at', async () => {
    const { db, mod } = await load()
    mod.upsertShareDraft(db, {
      draft_id: 'd-1',
      source_kind: 'spool-session',
      source_origin: 'sess-uuid',
      title: 'first',
      snapshot_json: '{"v":1}',
      preview_json: '{"v":1}',
    })
    const first = mod.getShareDraft(db, 'd-1')

    // SQLite datetime('now') has 1-second granularity, so we have to
    // shift the row's created_at backward to observe the timestamp
    // movement in a sub-second test.
    db.prepare(`UPDATE share_drafts SET updated_at = datetime('now', '-2 seconds') WHERE draft_id = ?`)
      .run('d-1')

    mod.upsertShareDraft(db, {
      draft_id: 'd-1',
      source_kind: 'spool-session',
      source_origin: 'sess-uuid',
      title: 'second',
      snapshot_json: '{"v":2}',
      preview_json: '{"v":2}',
    })
    const second = mod.getShareDraft(db, 'd-1')
    expect(second?.title).toBe('second')
    expect(second?.snapshot_json).toBe('{"v":2}')
    expect(second!.updated_at >= first!.updated_at).toBe(true)
  })

  it('listShareDrafts returns rows in updated_at DESC order', async () => {
    const { db, mod } = await load()
    const ids = ['a', 'b', 'c']
    for (const id of ids) {
      mod.upsertShareDraft(db, {
        draft_id: id,
        source_kind: 'pasted-url',
        source_origin: `https://example.com/${id}`,
        title: id,
        snapshot_json: '{}',
        preview_json: '{}',
      })
    }
    // Force a predictable order by stamping updated_at in reverse.
    db.prepare(`UPDATE share_drafts SET updated_at = ? WHERE draft_id = ?`).run('2026-01-01 00:00:00', 'a')
    db.prepare(`UPDATE share_drafts SET updated_at = ? WHERE draft_id = ?`).run('2026-01-02 00:00:00', 'b')
    db.prepare(`UPDATE share_drafts SET updated_at = ? WHERE draft_id = ?`).run('2026-01-03 00:00:00', 'c')

    const rows = mod.listShareDrafts(db)
    expect(rows.map((r: ShareDraftListItem) => r.draft_id)).toEqual(['c', 'b', 'a'])
    // List query must not haul snapshot_json across the IPC boundary —
    // that's the whole point of the slim SELECT.
    expect(rows[0]).not.toHaveProperty('snapshot_json')
    expect(rows[0]).toHaveProperty('preview_json')
  })

  it('listShareDrafts respects the limit option', async () => {
    const { db, mod } = await load()
    for (let i = 0; i < 5; i++) {
      mod.upsertShareDraft(db, {
        draft_id: `d-${i}`,
        source_kind: 'spool-session',
        source_origin: `sess-${i}`,
        title: '',
        snapshot_json: '{}',
        preview_json: '{}',
      })
    }
    expect(mod.listShareDrafts(db, { limit: 2 })).toHaveLength(2)
  })

  it('getShareDraft returns null for unknown id', async () => {
    const { db, mod } = await load()
    expect(mod.getShareDraft(db, 'nope')).toBeNull()
  })

  it('deleteShareDraft removes the row', async () => {
    const { db, mod } = await load()
    mod.upsertShareDraft(db, {
      draft_id: 'gone',
      source_kind: 'imported-file',
      source_origin: 'foo.spool',
      title: '',
      snapshot_json: '{}',
      preview_json: '{}',
    })
    mod.deleteShareDraft(db, 'gone')
    expect(mod.getShareDraft(db, 'gone')).toBeNull()
  })

  it('countDraftsBySession counts only spool-session drafts with matching origin', async () => {
    const { db, mod } = await load()
    mod.upsertShareDraft(db, {
      draft_id: 'a',
      source_kind: 'spool-session',
      source_origin: 'sess-X',
      title: '',
      snapshot_json: '{}',
      preview_json: '{}',
    })
    mod.upsertShareDraft(db, {
      draft_id: 'b',
      source_kind: 'spool-session',
      source_origin: 'sess-X',
      title: '',
      snapshot_json: '{}',
      preview_json: '{}',
    })
    mod.upsertShareDraft(db, {
      draft_id: 'c',
      source_kind: 'spool-session',
      source_origin: 'sess-Y',
      title: '',
      snapshot_json: '{}',
      preview_json: '{}',
    })
    // A pasted-url draft whose origin happens to match a session uuid
    // should not be counted as a spool-session.
    mod.upsertShareDraft(db, {
      draft_id: 'd',
      source_kind: 'pasted-url',
      source_origin: 'sess-X',
      title: '',
      snapshot_json: '{}',
      preview_json: '{}',
    })
    expect(mod.countDraftsBySession(db, 'sess-X')).toBe(2)
    expect(mod.countDraftsBySession(db, 'sess-Y')).toBe(1)
    expect(mod.countDraftsBySession(db, 'sess-Z')).toBe(0)
  })

  it('migration is idempotent across re-open', async () => {
    const spoolDir = makeTempDir('spool-share-drafts-reopen-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.db.prepare(
      `INSERT INTO share_drafts (draft_id, source_kind, title, snapshot_json) VALUES (?, ?, ?, ?)`,
    ).run('keep-me', 'pasted-url', 'persisted draft', '{"v":1}')
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    const row = second.db
      .prepare('SELECT title FROM share_drafts WHERE draft_id=?')
      .get('keep-me') as { title: string }
    expect(row.title).toBe('persisted draft')
  })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function load() {
  const spoolDir = makeTempDir('spool-share-drafts-')
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  return loadInto(spoolDir)
}

async function loadInto(_spoolDir: string) {
  vi.resetModules()
  const dbModule = await import('./db.js')
  const mod = await import('./share-drafts.js')
  const db = dbModule.getDB()
  openDbs.push(db)
  return { db, mod }
}
