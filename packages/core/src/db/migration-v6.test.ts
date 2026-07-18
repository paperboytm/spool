import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test'

import type { IdentityFs } from '../projects/identity.js'
import { runMigrations, backfillProjectIdentities } from './db.js'

const stubFs: IdentityFs = {
  exists: () => false,
  readText: () => null,
  spawn: () => ({ stdout: '', exitCode: 1 }),
}

describe('migration v6', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
  })
  afterEach(() => db.close())

  it('adds identity_kind / identity_key columns to projects', () => {
    runMigrations(db)
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['identity_kind', 'identity_key']),
    )
    const v = db.pragma('user_version') as Array<{ user_version: number }>
    expect(v[0].user_version).toBeGreaterThanOrEqual(6)
  })

  it('creates project_groups_v view', () => {
    runMigrations(db)
    const v = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name='project_groups_v'`)
      .get()
    expect(v).toBeDefined()
  })

  it('view groups rows with same identity across sources', () => {
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES
          (1, 'spool-c', '/Users/chen/Code/spool', 'spool', 'git_remote', 'github.com/spool-lab/spool'),
          (2, 'spool-x', '/Users/chen/Code/spool', 'spool', 'git_remote', 'github.com/spool-lab/spool');
    `)
    const groups = db.prepare(`SELECT * FROM project_groups_v`).all() as Array<{
      identity_key: string
    }>
    expect(groups).toHaveLength(1)
    expect(groups[0].identity_key).toBe('github.com/spool-lab/spool')
  })
})

describe('backfillProjectIdentities', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
  })
  afterEach(() => db.close())

  it('backfills identity for rows with NULL identity_kind', () => {
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES (1, 'old-row', '/Users/chen/scratch/notes', 'notes', NULL, NULL);
    `)
    backfillProjectIdentities(db, stubFs)
    const r = db
      .prepare(`SELECT identity_kind, identity_key FROM projects WHERE slug = ?`)
      .get('old-row') as { identity_kind: string; identity_key: string }
    expect(r.identity_kind).toBe('path')
    expect(r.identity_key).toBe('/Users/chen/scratch/notes')
  })

  it('skips rows that already have identity', () => {
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES (1, 'has-id', '/x', 'x', 'git_remote', 'github.com/foo/bar');
    `)
    backfillProjectIdentities(db, stubFs)
    const r = db
      .prepare(`SELECT identity_kind, identity_key FROM projects WHERE slug = ?`)
      .get('has-id') as { identity_kind: string; identity_key: string }
    expect(r.identity_kind).toBe('git_remote') // unchanged
    expect(r.identity_key).toBe('github.com/foo/bar') // unchanged
  })
})
