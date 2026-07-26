import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import { runMigrations } from '../db/db.js'
import { resolveSessionProjectIdentity } from './local-identity.js'

describe('resolveSessionProjectIdentity', () => {
  it('uses the Project joined to the explicit Session instead of caller cwd', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      db.exec(`
        INSERT INTO projects
          (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES
          (1, 'alpha', '/repos/alpha', 'alpha', 'git_remote', 'github.com/acme/alpha'),
          (1, 'beta', '/repos/beta', 'beta', 'git_remote', 'github.com/acme/beta');
        INSERT INTO sessions
          (project_id, source_id, session_uuid, file_path, started_at, ended_at)
        VALUES
          (1, 1, 'session-alpha', '/tmp/alpha.jsonl', '2026-07-26', '2026-07-26'),
          (2, 1, 'session-beta', '/tmp/beta.jsonl', '2026-07-26', '2026-07-26');
      `)

      expect(resolveSessionProjectIdentity(db, 'session-alpha')).toEqual({
        kind: 'git_remote',
        key: 'github.com/acme/alpha',
        displayName: 'alpha',
      })
      expect(resolveSessionProjectIdentity(db, 'session-beta')).toEqual({
        kind: 'git_remote',
        key: 'github.com/acme/beta',
        displayName: 'beta',
      })
    } finally {
      db.close()
    }
  })
})
