import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vite-plus/test'

import { runMigrations } from './db.js'
import {
  getOrCreateProject,
  getOrCreateAskProject,
  insertSpoolAuthoredSession,
  upsertSession,
  getStatus,
} from './queries.js'

describe('getOrCreateProject (with identity)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    // sources are seeded by runMigrations; do not re-insert
  })

  it('persists identity_kind and identity_key', () => {
    getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote',
      identityKey: 'github.com/spool-lab/spool',
    })
    const row = db
      .prepare(`SELECT identity_kind, identity_key FROM projects WHERE slug = ?`)
      .get('spool-c') as { identity_kind: string; identity_key: string }
    expect(row.identity_kind).toBe('git_remote')
    expect(row.identity_key).toBe('github.com/spool-lab/spool')
  })

  it('does not duplicate on second call (same source_id, slug)', () => {
    const id1 = getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote',
      identityKey: 'github.com/spool-lab/spool',
    })
    const id2 = getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote',
      identityKey: 'github.com/spool-lab/spool',
    })
    expect(id1).toBe(id2)
  })

  it('upgrades an existing path fallback when the worktree becomes resolvable', () => {
    const id = getOrCreateProject(db, 1, 'paperboy-wt', '/dead/paperboy-wt', 'paperboy-wt', {
      identityKind: 'path',
      identityKey: '/dead/paperboy-wt',
    })

    expect(
      getOrCreateProject(db, 1, 'paperboy-wt', '/live/paperboy-wt', 'paperboy', {
        identityKind: 'git_remote',
        identityKey: 'github.com/paperboytm/paperboy',
      }),
    ).toBe(id)

    const row = db
      .prepare(`
      SELECT display_path, display_name, identity_kind, identity_key
      FROM projects WHERE id = ?
    `)
      .get(id) as Record<string, unknown>
    expect(row).toMatchObject({
      display_path: '/live/paperboy-wt',
      display_name: 'paperboy',
      identity_kind: 'git_remote',
      identity_key: 'github.com/paperboytm/paperboy',
    })
  })

  it('does not downgrade a stable git identity when a checkout is temporarily missing', () => {
    const id = getOrCreateProject(db, 1, 'paperboy-wt', '/live/paperboy-wt', 'paperboy', {
      identityKind: 'git_remote',
      identityKey: 'github.com/paperboytm/paperboy',
    })
    getOrCreateProject(db, 1, 'paperboy-wt', '/dead/paperboy-wt', 'paperboy-wt', {
      identityKind: 'path',
      identityKey: '/dead/paperboy-wt',
    })

    const row = db.prepare(`SELECT identity_kind, identity_key FROM projects WHERE id = ?`).get(id)
    expect(row).toEqual({
      identity_kind: 'git_remote',
      identity_key: 'github.com/paperboytm/paperboy',
    })
  })
})

describe('upsertSession (title_source authority)', () => {
  let db: Database.Database
  let projectId: number

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    projectId = getOrCreateProject(db, 1, 'p', '/p', 'p', {
      identityKind: 'path',
      identityKey: '/p',
    })
  })

  function baseOpts(overrides: Partial<Parameters<typeof upsertSession>[1]> = {}) {
    return {
      projectId,
      sourceId: 1,
      sessionUuid: 'sess-1',
      filePath: '/fake.jsonl',
      title: 'derived title',
      startedAt: '2026-05-09',
      endedAt: '2026-05-09',
      messageCount: 1,
      hasToolUse: false,
      cwd: '/',
      model: 'claude',
      rawFileMtime: '2026-05-09',
      ...overrides,
    }
  }

  it('updates title on re-upsert when title_source is derived (default)', () => {
    upsertSession(db, baseOpts({ title: 'first' }))
    upsertSession(db, baseOpts({ title: 'second' }))
    const row = db
      .prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('second')
    expect(row.title_source).toBe('derived')
  })

  it('preserves title on re-upsert when title_source is "spool"', () => {
    upsertSession(db, baseOpts({ title: 'spool-set' }))
    db.prepare(`UPDATE sessions SET title_source = 'spool' WHERE session_uuid = 'sess-1'`).run()

    upsertSession(db, baseOpts({ title: 'derived from sync' }))

    const row = db
      .prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('spool-set')
    expect(row.title_source).toBe('spool')
  })

  it('preserves title on re-upsert when title_source is "user"', () => {
    upsertSession(db, baseOpts({ title: 'placeholder' }))
    db.prepare(
      `UPDATE sessions SET title = 'user-renamed', title_source = 'user' WHERE session_uuid = 'sess-1'`,
    ).run()

    upsertSession(db, baseOpts({ title: 'derived overwrite' }))

    const row = db
      .prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('user-renamed')
    expect(row.title_source).toBe('user')
  })

  it('rebinds file_path on re-upsert (sentinel → real path)', () => {
    upsertSession(db, baseOpts({ filePath: 'spool:pending:sess-1' }))
    upsertSession(db, baseOpts({ filePath: '/real/path.jsonl' }))

    const row = db
      .prepare('SELECT file_path FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { file_path: string }
    expect(row.file_path).toBe('/real/path.jsonl')
  })

  it('persists and updates the parent session relationship', () => {
    upsertSession(db, baseOpts({ parentSessionUuid: 'parent-1' }))
    let row = db
      .prepare('SELECT parent_session_uuid FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { parent_session_uuid: string | null }
    expect(row.parent_session_uuid).toBe('parent-1')

    upsertSession(db, baseOpts({ parentSessionUuid: 'parent-2' }))
    row = db
      .prepare('SELECT parent_session_uuid FROM sessions WHERE session_uuid = ?')
      .get('sess-1') as { parent_session_uuid: string | null }
    expect(row.parent_session_uuid).toBe('parent-2')
  })
})

describe('getOrCreateAskProject', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  it('creates an Ask project per source on first call', () => {
    const id = getOrCreateAskProject(db, 'claude')
    const row = db
      .prepare(`SELECT slug, display_name, identity_kind, identity_key FROM projects WHERE id = ?`)
      .get(id) as {
      slug: string
      display_name: string
      identity_kind: string
      identity_key: string
    }
    expect(row.slug).toBe('__spool_ask__')
    expect(row.display_name).toBe('Asks')
    expect(row.identity_kind).toBe('spool_internal')
    expect(row.identity_key).toBe('ask')
  })

  it('is idempotent across calls for the same source', () => {
    const a = getOrCreateAskProject(db, 'claude')
    const b = getOrCreateAskProject(db, 'claude')
    expect(a).toBe(b)
  })

  it('creates separate projects per source (one Ask per agent)', () => {
    const claudeAsk = getOrCreateAskProject(db, 'claude')
    const codexAsk = getOrCreateAskProject(db, 'codex')
    expect(claudeAsk).not.toBe(codexAsk)
  })

  it('groups all per-source Ask projects under one identity in project_groups_v', () => {
    getOrCreateAskProject(db, 'claude')
    getOrCreateAskProject(db, 'codex')
    const groups = db
      .prepare(
        `SELECT identity_kind, identity_key, sources_csv FROM project_groups_v WHERE identity_kind = 'spool_internal'`,
      )
      .all() as Array<{ identity_kind: string; identity_key: string; sources_csv: string | null }>
    expect(groups).toHaveLength(1)
    expect(groups[0]?.identity_key).toBe('ask')
    const sources = (groups[0]?.sources_csv ?? '').split(',').sort()
    expect(sources).toEqual(['claude', 'codex'])
  })
})

describe('insertSpoolAuthoredSession', () => {
  let db: Database.Database
  let projectId: number
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    projectId = getOrCreateAskProject(db, 'claude')
  })

  it('inserts a row with title_source="spool" and a sentinel file_path', () => {
    const id = insertSpoolAuthoredSession(db, {
      projectId,
      sourceId: 1,
      sessionUuid: 'ask-uuid-1',
      title: 'what did I do yesterday?',
      cwd: '/Users/x/.spool/agent-search-sessions',
    })
    const row = db
      .prepare(`SELECT title, title_source, file_path, message_count FROM sessions WHERE id = ?`)
      .get(id) as {
      title: string
      title_source: string
      file_path: string
      message_count: number
    }
    expect(row.title).toBe('what did I do yesterday?')
    expect(row.title_source).toBe('spool')
    expect(row.file_path).toBe('spool:pending:ask-uuid-1')
    expect(row.message_count).toBe(0)
  })

  it('is idempotent: returns existing id without modifying the row', () => {
    const a = insertSpoolAuthoredSession(db, {
      projectId,
      sourceId: 1,
      sessionUuid: 'ask-uuid-2',
      title: 'first',
      cwd: '/x',
    })
    const b = insertSpoolAuthoredSession(db, {
      projectId,
      sourceId: 1,
      sessionUuid: 'ask-uuid-2',
      title: 'second',
      cwd: '/y',
    })
    expect(a).toBe(b)
    const row = db.prepare(`SELECT title, cwd FROM sessions WHERE id = ?`).get(a) as {
      title: string
      cwd: string
    }
    expect(row.title).toBe('first')
    expect(row.cwd).toBe('/x')
  })

  it('survives a subsequent sync-style upsertSession call: title locked, file_path rebound', () => {
    const id = insertSpoolAuthoredSession(db, {
      projectId,
      sourceId: 1,
      sessionUuid: 'ask-uuid-3',
      title: 'real query',
      cwd: '/x',
    })
    upsertSession(db, {
      projectId,
      sourceId: 1,
      sessionUuid: 'ask-uuid-3',
      filePath: '/Users/x/.claude/projects/-Users-x--spool-agent-search-sessions/ask-uuid-3.jsonl',
      title: 'Caveat: The messages below were generated by the user…',
      startedAt: '2026-05-09',
      endedAt: '2026-05-09',
      messageCount: 5,
      hasToolUse: false,
      cwd: '/x',
      model: 'claude',
      rawFileMtime: '2026-05-09',
    })
    const row = db
      .prepare(`SELECT title, title_source, file_path, message_count FROM sessions WHERE id = ?`)
      .get(id) as {
      title: string
      title_source: string
      file_path: string
      message_count: number
    }
    expect(row.title).toBe('real query')
    expect(row.title_source).toBe('spool')
    expect(row.file_path).toBe(
      '/Users/x/.claude/projects/-Users-x--spool-agent-search-sessions/ask-uuid-3.jsonl',
    )
    // upsertSession deliberately no longer touches message_count —
    // the syncer recomputes it from the actual DB row count after
    // insertMessages so the count tracks INSERT-OR-IGNORE-deduped
    // truth (claude tool-use shadows would otherwise re-inflate it
    // back to pre-v14 levels on every sync).
    // insertSpoolAuthoredSession seeded message_count = 0; the
    // upsertSession opts above pass 5, but the row should still
    // read 0 since the count is now owned by recomputeMessageCount.
    expect(row.message_count).toBe(0)
  })
})

describe('getStatus', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES (1, 'p', '/p', 'p', 'path', '/p');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime)
      VALUES
        (1, 1, 'a', '/a', 'a', '2026-05-01', '2026-05-01', 5, 0, '2026-05-01'),
        (1, 1, 'b', '/b', 'b', '2026-05-02', '2026-05-02', 0, 0, '2026-05-02'),
        (1, 2, 'c', '/c', 'c', '2026-05-03', '2026-05-03', 3, 0, '2026-05-03'),
        (1, 2, 'd', '/d', 'd', '2026-05-04', '2026-05-04', 0, 0, '2026-05-04');
    `)
  })

  it('counts only sessions with message_count > 0 — matches what user-visible lists show', () => {
    const status = getStatus(db)
    expect(status.totalSessions).toBe(2)
    expect(status.claudeSessions).toBe(1)
    expect(status.codexSessions).toBe(1)
    expect(status.geminiSessions).toBe(0)
    expect(status.opencodeSessions).toBe(0)
    expect(status.piSessions).toBe(0)
  })
})
