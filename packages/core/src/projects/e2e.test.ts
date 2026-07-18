import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vite-plus/test'

import { runMigrations } from '../db/db.js'
import { getOrCreateProject } from '../db/queries.js'
import { listProjectGroups } from './groups.js'

describe('project identity e2e', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    // sources auto-seeded by runMigrations (claude=1, codex=2, gemini=3)
    // We need a 4th source for the test ('chatgpt') if it's not seeded.
    // Verify what's auto-seeded:
    //   SELECT id, name FROM sources;
    // If chatgpt isn't there, insert it.
    db.exec(`INSERT OR IGNORE INTO sources (name, base_path) VALUES ('chatgpt', '/tmp/chatgpt');`)
  })

  it('unifies same repo across multiple sources into one group', () => {
    const id = { identityKind: 'git_remote' as const, identityKey: 'github.com/spool-lab/spool' }

    // Look up source IDs by name (don't hardcode positional integers)
    const claudeId = (
      db.prepare(`SELECT id FROM sources WHERE name = 'claude'`).get() as { id: number }
    ).id
    const codexId = (
      db.prepare(`SELECT id FROM sources WHERE name = 'codex'`).get() as { id: number }
    ).id
    const chatgptId = (
      db.prepare(`SELECT id FROM sources WHERE name = 'chatgpt'`).get() as { id: number }
    ).id

    getOrCreateProject(db, claudeId, 'spool-claude', '/Users/chen/Code/spool', 'spool', id)
    getOrCreateProject(db, codexId, 'spool-codex', '/Users/chen/Code/spool', 'spool', id)
    getOrCreateProject(db, chatgptId, 'spool-chatgpt', '/Users/chen/Code/spool', 'spool', id)

    const groups = listProjectGroups(db)
    expect(groups).toHaveLength(1)
    expect(groups[0].sources.sort()).toEqual(['chatgpt', 'claude', 'codex'])
  })

  it('keeps two unrelated path-based projects separate', () => {
    const claudeId = (
      db.prepare(`SELECT id FROM sources WHERE name = 'claude'`).get() as { id: number }
    ).id
    getOrCreateProject(db, claudeId, 'a', '/Users/chen/playground/a', 'a', {
      identityKind: 'path',
      identityKey: '/Users/chen/playground/a',
    })
    getOrCreateProject(db, claudeId, 'b', '/Users/chen/playground/b', 'b', {
      identityKind: 'path',
      identityKey: '/Users/chen/playground/b',
    })
    expect(listProjectGroups(db)).toHaveLength(2)
  })
})
