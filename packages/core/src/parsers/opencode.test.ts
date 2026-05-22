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
      .toBe('1779152404000::opencode-v2-sqlite-parent-subagents')
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
      .toBe('1779152410000::opencode-v2-sqlite-parent-subagents')

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
    VALUES ('ses_abc123', 'proj_1', 'fix-auth-callback', '/work/api', 'Fix the auth callback', '1.0.0', ?, ?, 'opencode/gpt-5.4', 'build')
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
