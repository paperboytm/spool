import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/db.js'
import { listProjectGroups } from './groups.js'

describe('listProjectGroups', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    // sources auto-seeded by runMigrations
  })

  it('returns empty array when no projects', () => {
    expect(listProjectGroups(db)).toEqual([])
  })

  it('aggregates same-identity rows across sources', () => {
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES
        (1,'spool-c','/Users/chen/Code/spool','spool','git_remote','github.com/spool-lab/spool'),
        (2,'spool-x','/Users/chen/Code/spool','spool','git_remote','github.com/spool-lab/spool');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime, cwd)
      VALUES
        (1,1,'u1','/p1','t','2026-04-28T10:00:00Z','2026-04-28T10:30:00Z',5,0,'2026-04-28T10:30:00Z','/Users/chen/Code/spool/packages/app'),
        (2,2,'u2','/p2','t','2026-04-27T10:00:00Z','2026-04-27T10:30:00Z',3,0,'2026-04-27T10:30:00Z','/Users/chen/Code/spool');
    `)
    const groups = listProjectGroups(db, { withPaths: true })
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      identityKey: 'github.com/spool-lab/spool',
      displayPaths: ['/Users/chen/Code/spool'],
      cwds: expect.arrayContaining([
        '/Users/chen/Code/spool',
        '/Users/chen/Code/spool/packages/app',
      ]),
      sources: expect.arrayContaining(['claude', 'codex']),
      sessionCount: 2,
    })
  })

  it('omits path fields unless withPaths is requested', () => {
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES (1,'spool-c','/Users/chen/Code/spool','spool','git_remote','github.com/spool-lab/spool');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime, cwd)
      VALUES (1,1,'u1','/p1','t','2026-04-28T10:00:00Z','2026-04-28T10:30:00Z',5,0,'2026-04-28T10:30:00Z','/Users/chen/Code/spool');
    `)
    const groups = listProjectGroups(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]).not.toHaveProperty('displayPaths')
    expect(groups[0]).not.toHaveProperty('cwds')
  })

  it('preserves commas in display paths and session cwds', () => {
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES
        (1,'foo-bar','/Users/me/foo,bar','foo,bar','path','/Users/me/foo,bar'),
        (2,'foo-bar-2','/Users/me/foo,bar','foo,bar','path','/Users/me/foo,bar');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime, cwd)
      VALUES
        (1,1,'comma-1','/pc1','t','2026-04-28T10:00:00Z','2026-04-28T10:30:00Z',5,0,'2026-04-28T10:30:00Z','/Users/me/foo,bar/packages/core'),
        (2,2,'comma-2','/pc2','t','2026-04-27T10:00:00Z','2026-04-27T10:30:00Z',3,0,'2026-04-27T10:30:00Z','/Users/me/foo,bar');
    `)

    const groups = listProjectGroups(db, { withPaths: true })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      identityKey: '/Users/me/foo,bar',
      displayPaths: ['/Users/me/foo,bar'],
      cwds: expect.arrayContaining([
        '/Users/me/foo,bar',
        '/Users/me/foo,bar/packages/core',
      ]),
    })
    expect(groups[0].displayPaths).not.toContain('/Users/me/foo')
    expect(groups[0].cwds).not.toContain('bar')
  })

  it('orders by lastSessionAt desc, loose last', () => {
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES
        (1,'a','/Users/chen/Code/a','a','path','/Users/chen/Code/a'),
        (1,'b','/Users/chen/Code/b','b','path','/Users/chen/Code/b'),
        (1,'l','','Loose','loose','loose');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime)
      VALUES
        (1,1,'u-a','/pa','t','2026-04-28T10:00:00Z','2026-04-28T11:00:00Z',1,0,'2026-04-28T11:00:00Z'),
        (2,1,'u-b','/pb','t','2026-04-26T10:00:00Z','2026-04-26T11:00:00Z',1,0,'2026-04-26T11:00:00Z'),
        (3,1,'u-l','/pl','t','2026-04-29T10:00:00Z','2026-04-29T11:00:00Z',1,0,'2026-04-29T11:00:00Z');
    `)
    const groups = listProjectGroups(db)
    expect(groups.map(g => g.identityKind)).toEqual(['path', 'path', 'loose'])
  })
})
