import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getOpenCodeSessionIndexedMtime,
  listOpenCodeSessionFilePaths,
  loadOpenCodeSession,
  makeOpenCodeSessionFilePath,
  normalizeOpenCodeWatchPath,
} from './opencode.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('OpenCode parser', () => {
  it('loads one SQLite-backed OpenCode session into Spool messages', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      seedOpenCodeSession(db)
    } finally {
      db.close()
    }

    const filePath = makeOpenCodeSessionFilePath(dbPath, 'ses_abc123')
    const result = loadOpenCodeSession(filePath)

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session).toMatchObject({
      source: 'opencode',
      sessionUuid: 'ses_abc123',
      title: 'Fix the auth callback',
      cwd: '/work/api',
      model: 'opencode/gpt-5.4',
      startedAt: '2026-05-19T01:00:00.000Z',
      endedAt: '2026-05-19T01:00:04.000Z',
    })
    expect(result.session.messages).toEqual([
      expect.objectContaining({
        uuid: 'msg_user',
        role: 'user',
        contentText: 'Please fix the auth callback',
        timestamp: '2026-05-19T01:00:01.000Z',
        toolNames: [],
      }),
      expect.objectContaining({
        uuid: 'msg_assistant',
        role: 'assistant',
        contentText: 'I will inspect the handler.',
        timestamp: '2026-05-19T01:00:02.000Z',
        toolNames: ['grep'],
      }),
    ])
  })

  it('lists active sessions as synthetic per-session file paths', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      seedOpenCodeSession(db)
      db.prepare(`
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, time_archived)
        VALUES ('ses_archived', 'proj_1', 'archived', '/work/api', 'Archived', '1.0.0', ?, ?, ?)
      `).run(Date.UTC(2026, 4, 19, 1, 0, 0), Date.UTC(2026, 4, 19, 1, 0, 5), Date.UTC(2026, 4, 19, 1, 0, 6))
    } finally {
      db.close()
    }

    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([
      makeOpenCodeSessionFilePath(dbPath, 'ses_abc123'),
    ])
    expect(getOpenCodeSessionIndexedMtime(makeOpenCodeSessionFilePath(dbPath, 'ses_abc123')))
      .toBe('1779152404000::opencode-v3-session-model-json')
  })

  it('folds OpenCode child sessions into the parent as sidechain messages', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      seedOpenCodeSession(db)
      seedOpenCodeSubagent(db)
    } finally {
      db.close()
    }

    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([
      makeOpenCodeSessionFilePath(dbPath, 'ses_abc123'),
    ])
    expect(getOpenCodeSessionIndexedMtime(makeOpenCodeSessionFilePath(dbPath, 'ses_abc123')))
      .toBe('1779152410000::opencode-v3-session-model-json')

    const childPath = makeOpenCodeSessionFilePath(dbPath, 'ses_child_explore')
    expect(loadOpenCodeSession(childPath)).toEqual({ kind: 'filtered' })

    const result = loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_abc123'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session.endedAt).toBe('2026-05-19T01:00:10.000Z')
    expect(result.session.messages).toEqual([
      expect.objectContaining({
        uuid: 'msg_user',
        role: 'user',
        isSidechain: false,
      }),
      expect.objectContaining({
        uuid: 'msg_assistant',
        role: 'assistant',
        isSidechain: false,
      }),
      expect.objectContaining({
        uuid: 'ses_child_explore:header',
        role: 'system',
        parentUuid: 'opencode-subagent:ses_child_explore',
        contentText: 'OpenCode subagent: @explore · Explore auth routes',
        isSidechain: true,
      }),
      expect.objectContaining({
        uuid: 'ses_child_explore:msg_child_user',
        role: 'user',
        parentUuid: 'opencode-subagent:ses_child_explore',
        contentText: 'Inspect route files',
        isSidechain: true,
      }),
      expect.objectContaining({
        uuid: 'ses_child_explore:msg_child_assistant',
        role: 'assistant',
        parentUuid: 'opencode-subagent:ses_child_explore',
        contentText: 'The route is in auth.ts.',
        isSidechain: true,
      }),
    ])
  })

  it('folds grandchild subagent sessions into the root parent', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      seedOpenCodeSession(db)
      seedOpenCodeSubagent(db)
      // grandchild: a subagent spawned by the explore subagent
      insertBareSession(db, { id: 'ses_grandchild', parentId: 'ses_child_explore', agent: 'review', title: 'Review findings' })
      insertTextMessage(db, { sessionId: 'ses_grandchild', messageId: 'msg_gc', role: 'assistant', text: 'Looks correct.', at: Date.UTC(2026, 4, 19, 1, 0, 12) })
    } finally {
      db.close()
    }

    // Only the root is a standalone session.
    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([
      makeOpenCodeSessionFilePath(dbPath, 'ses_abc123'),
    ])

    const result = loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_abc123'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    // Grandchild content is folded in as a sidechain under the root.
    const grandchild = result.session.messages.find(m => m.uuid === 'ses_grandchild:msg_gc')
    expect(grandchild).toMatchObject({
      role: 'assistant',
      parentUuid: 'opencode-subagent:ses_grandchild',
      contentText: 'Looks correct.',
      isSidechain: true,
    })
    expect(result.session.messages.some(m => m.uuid === 'ses_grandchild:header')).toBe(true)
    // Grandchild is never a standalone session.
    expect(loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_grandchild'))).toEqual({ kind: 'filtered' })
  })

  it('does not surface a subagent whose parent row is missing (orphan stays folded-or-hidden)', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      // Child whose parent_id points at a row that does not exist. We treat any
      // row with a parent_id as a subagent — never a standalone root — to stay
      // consistent with how the other sources handle subagent records.
      insertBareSession(db, { id: 'ses_orphan', parentId: 'ses_missing_parent', agent: 'build', title: 'Orphaned work' })
      insertTextMessage(db, { sessionId: 'ses_orphan', messageId: 'msg_orphan', role: 'user', text: 'do the thing', at: Date.UTC(2026, 4, 19, 2, 0, 0) })
    } finally {
      db.close()
    }

    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_orphan'))).toEqual({ kind: 'filtered' })
  })

  it('keeps children of an archived parent hidden', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      const start = Date.UTC(2026, 4, 19, 3, 0, 0)
      db.prepare(`
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, time_archived)
        VALUES ('ses_arch_parent', 'proj_1', 'archived-root', '/work/api', 'Archived root', '1.0.0', ?, ?, ?)
      `).run(start, start, start + 1)
      insertBareSession(db, { id: 'ses_arch_child', parentId: 'ses_arch_parent', agent: 'explore', title: 'Child of archived' })
      insertTextMessage(db, { sessionId: 'ses_arch_child', messageId: 'msg_ac', role: 'user', text: 'hidden work', at: start + 1000 })
    } finally {
      db.close()
    }

    // Archived parent exists, so its child stays hidden (respect the archive).
    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_arch_child'))).toEqual({ kind: 'filtered' })
  })

  it('does not hang and produces no roots on a self-referential / cyclic parent_id', () => {
    const { db, dbPath } = createOpenCodeDb()
    try {
      // Corrupt data: mutual cycle with no real NULL-parent root.
      insertBareSession(db, { id: 'ses_cycle_a', parentId: 'ses_cycle_b', agent: 'build', title: 'A' })
      insertBareSession(db, { id: 'ses_cycle_b', parentId: 'ses_cycle_a', agent: 'build', title: 'B' })
      insertTextMessage(db, { sessionId: 'ses_cycle_a', messageId: 'msg_a', role: 'user', text: 'a', at: Date.UTC(2026, 4, 19, 4, 0, 0) })
      insertTextMessage(db, { sessionId: 'ses_cycle_b', messageId: 'msg_b', role: 'user', text: 'b', at: Date.UTC(2026, 4, 19, 4, 0, 1) })
    } finally {
      db.close()
    }

    // Must terminate. Cyclic nodes reference existing rows, so neither is a root.
    expect(listOpenCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, 'ses_cycle_a'))).toEqual({ kind: 'filtered' })
  })

  it('returns null from parseOpenCodeSession for a missing database file', async () => {
    const { parseOpenCodeSession } = await import('./opencode.js')
    const missing = makeOpenCodeSessionFilePath('/no/such/opencode.db', 'ses_x')
    expect(parseOpenCodeSession(missing)).toBeNull()
  })

  it('derives the model from the session JSON, falling back for partial / non-JSON values', () => {
    const cases: Array<{ id: string; rawModel: string; expected: string }> = [
      { id: 'ses_model_full', rawModel: '{"id":"big-pickle","providerID":"opencode"}', expected: 'opencode/big-pickle' },
      { id: 'ses_model_no_provider', rawModel: '{"id":"big-pickle"}', expected: 'big-pickle' },
      { id: 'ses_model_malformed', rawModel: '{not json', expected: '{not json' },
      { id: 'ses_model_plain', rawModel: 'opencode/gpt-5.4', expected: 'opencode/gpt-5.4' },
    ]
    const { db, dbPath } = createOpenCodeDb()
    try {
      const start = Date.UTC(2026, 4, 19, 1, 0, 6)
      for (const c of cases) {
        db.prepare(`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, model, agent)
          VALUES (?, 'proj_1', ?, '/work/api', ?, '1.0.0', ?, ?, ?, 'build')
        `).run(c.id, c.id, c.id, start, start + 1000, c.rawModel)
        insertTextMessage(db, { sessionId: c.id, messageId: `${c.id}_m`, role: 'user', text: 'hi', at: start + 500 })
      }
    } finally {
      db.close()
    }

    for (const c of cases) {
      const result = loadOpenCodeSession(makeOpenCodeSessionFilePath(dbPath, c.id))
      expect(result.kind, c.id).toBe('parsed')
      if (result.kind !== 'parsed') continue
      expect(result.session.model, c.id).toBe(c.expected)
    }
  })

  it('maps WAL/SHM sidecar paths back to the main database file', () => {
    expect(normalizeOpenCodeWatchPath('/data/opencode/opencode.db-wal')).toBe('/data/opencode/opencode.db')
    expect(normalizeOpenCodeWatchPath('/data/opencode/opencode.db-shm')).toBe('/data/opencode/opencode.db')
    expect(normalizeOpenCodeWatchPath('/data/opencode/opencode.db-journal')).toBe('/data/opencode/opencode.db')
    expect(normalizeOpenCodeWatchPath('/data/opencode/opencode.db')).toBe('/data/opencode/opencode.db')
    expect(normalizeOpenCodeWatchPath('/data/other/file.jsonl')).toBe('/data/other/file.jsonl')
  })
})

function createOpenCodeDb(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'spool-opencode-parser-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'opencode.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE project (
      id text PRIMARY KEY,
      worktree text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      sandboxes text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      slug text NOT NULL,
      directory text NOT NULL,
      title text NOT NULL,
      version text NOT NULL,
      share_url text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_archived integer,
      model text,
      agent text
    );

    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );

    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `)
  return { db, dbPath }
}

function seedOpenCodeSession(db: Database.Database): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 0)
  db.prepare(`
    INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
    VALUES ('proj_1', '/work/api', ?, ?, '[]')
  `).run(start, start)
  db.prepare(`
    INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, model, agent)
    VALUES ('ses_abc123', 'proj_1', 'fix-auth-callback', '/work/api', 'Fix the auth callback', '1.0.0', ?, ?, '{"id":"gpt-5.4","providerID":"opencode","variant":"default"}', 'build')
  `).run(start, start + 4000)

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'ses_abc123', ?, ?, ?)
  `).run(
    'msg_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ role: 'user', path: { cwd: '/work/api' } }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'ses_abc123', ?, ?, ?)
  `).run(
    'part_user_text',
    'msg_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ type: 'text', text: 'Please fix the auth callback' }),
  )

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'ses_abc123', ?, ?, ?)
  `).run(
    'msg_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ role: 'assistant', model: { providerID: 'opencode', modelID: 'gpt-5.4' } }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'ses_abc123', ?, ?, ?)
  `).run(
    'part_assistant_text',
    'msg_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ type: 'text', text: 'I will inspect the handler.' }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'ses_abc123', ?, ?, ?)
  `).run(
    'part_assistant_tool',
    'msg_assistant',
    start + 2500,
    start + 2500,
    JSON.stringify({ type: 'tool', tool: 'grep', state: { status: 'completed' } }),
  )
}

function insertBareSession(
  db: Database.Database,
  opts: { id: string; parentId?: string | null; agent?: string; title?: string },
): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 6)
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, model, agent)
    VALUES (?, 'proj_1', ?, ?, '/work/api', ?, '1.0.0', ?, ?, 'opencode/gpt-5.4', ?)
  `).run(
    opts.id,
    opts.parentId ?? null,
    opts.id,
    opts.title ?? opts.id,
    start,
    start + 4000,
    opts.agent ?? 'build',
  )
}

function insertTextMessage(
  db: Database.Database,
  opts: { sessionId: string; messageId: string; role: string; text: string; at: number },
): void {
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(opts.messageId, opts.sessionId, opts.at, opts.at, JSON.stringify({ role: opts.role }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`${opts.messageId}_text`, opts.messageId, opts.sessionId, opts.at, opts.at, JSON.stringify({ type: 'text', text: opts.text }))
}

function seedOpenCodeSubagent(db: Database.Database): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 6)
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, model, agent)
    VALUES ('ses_child_explore', 'proj_1', 'ses_abc123', 'explore-auth-routes', '/work/api', 'Explore auth routes', '1.0.0', ?, ?, 'opencode/gpt-5.4', 'explore')
  `).run(start, start + 4000)

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'ses_child_explore', ?, ?, ?)
  `).run(
    'msg_child_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ role: 'user' }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'ses_child_explore', ?, ?, ?)
  `).run(
    'part_child_user_text',
    'msg_child_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ type: 'text', text: 'Inspect route files' }),
  )

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'ses_child_explore', ?, ?, ?)
  `).run(
    'msg_child_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ role: 'assistant' }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'ses_child_explore', ?, ?, ?)
  `).run(
    'part_child_assistant_text',
    'msg_child_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ type: 'text', text: 'The route is in auth.ts.' }),
  )
}
