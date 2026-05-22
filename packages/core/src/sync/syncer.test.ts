import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'

const tempDirs: string[] = []
const openDbs: Array<{ close: () => void }> = []

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close()
  }
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Syncer', () => {
  it('keeps an existing Gemini session indexed when the session file becomes unreadable', async () => {
    const baseDir = makeTempDir('spool-syncer-gemini-')
    const geminiCliHome = join(baseDir, 'gemini-home')
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    const historyDir = join(geminiCliHome, '.gemini', 'history', 'workspace')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, '.project_root'), '/tmp/gemini-project')

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-deadbeef.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'deadbeef-1234-5678-90ab-cdef12345678',
      startTime: '2026-04-08T00:00:00Z',
      lastUpdated: '2026-04-08T00:01:00Z',
      kind: 'main',
      summary: 'Debug the OAuth callback bug',
      messages: [
        {
          id: 'u1',
          timestamp: '2026-04-08T00:00:00Z',
          type: 'user',
          content: [{ text: 'Help me debug the OAuth callback bug' }],
        },
        {
          id: 'a1',
          timestamp: '2026-04-08T00:00:30Z',
          type: 'gemini',
          content: 'I will inspect the auth flow and callback handlers.',
          model: 'gemini-2.5-pro',
        },
      ],
    }))

    const { getDB, Syncer, getStatus, searchFragments } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncFile(filePath, 'gemini')).toBe('added')
    expect(getStatus(db).totalSessions).toBe(1)

    writeFileSync(filePath, '{"sessionId":')
    touchFile(filePath)

    expect(syncer.syncFile(filePath, 'gemini')).toBe('error')
    expect(getStatus(db).totalSessions).toBe(1)
    expect(searchFragments(db, 'OAuth callback', { limit: 5 })).toHaveLength(1)
  })

  it('indexes long session text without truncating the tail of the transcript', async () => {
    const baseDir = makeTempDir('spool-syncer-claude-')
    const claudeDir = join(baseDir, 'claude', 'projects')
    const spoolDataDir = join(baseDir, 'spool-data')
    const sessionDir = join(claudeDir, 'test-project')
    mkdirSync(sessionDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const tailKeyword = 'UNIQUE_NEEDLE_987654'
    const filePath = join(sessionDir, 'session.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-session-1',
        cwd: '/tmp/test-project',
        uuid: 'u1',
        timestamp: '2026-04-08T00:00:00Z',
        message: {
          role: 'user',
          content: `${'a'.repeat(70000)} ${tailKeyword}`,
        },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-08T00:00:05Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4',
          content: 'Acknowledged.',
        },
      }),
    ].join('\n'))

    const { getDB, Syncer, searchFragments } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncFile(filePath, 'claude')).toBe('added')

    const results = searchFragments(db, tailKeyword, { limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.snippet).toContain(tailKeyword)
  })

  it('collapses multiple Codex scratch chats into a single project row', async () => {
    const baseDir = makeTempDir('spool-syncer-codex-')
    const codexHome = join(baseDir, 'codex-home')
    const sessionsDir = join(codexHome, '.codex', 'sessions', '2026', '05', '11')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(sessionsDir, { recursive: true })

    const scratchA = join(baseDir, 'Documents', 'Codex', '2026-05-11', 'codex-project')
    const scratchB = join(baseDir, 'Documents', 'Codex', '2026-05-11', 'new-chat')
    mkdirSync(scratchA, { recursive: true })
    mkdirSync(scratchB, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('HOME', baseDir)
    vi.stubEnv('CODEX_HOME', join(codexHome, '.codex'))

    function writeCodexSession(name: string, sessionId: string, cwd: string): string {
      const fp = join(sessionsDir, name)
      writeFileSync(fp, [
        JSON.stringify({
          timestamp: '2026-05-11T12:00:00Z',
          type: 'session_meta',
          payload: { id: sessionId, cwd },
        }),
        JSON.stringify({
          timestamp: '2026-05-11T12:00:01Z',
          type: 'turn_context',
          payload: { model: 'gpt-5.4', cwd },
        }),
        JSON.stringify({
          timestamp: '2026-05-11T12:00:02Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello' },
        }),
        JSON.stringify({
          timestamp: '2026-05-11T12:00:03Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'hi' },
        }),
      ].join('\n'))
      return fp
    }

    const fileA = writeCodexSession(
      'rollout-2026-05-11T12-00-00-019e1559-3c84-7f53-9e3c-850bbb705720.jsonl',
      '019e1559-3c84-7f53-9e3c-850bbb705720',
      scratchA,
    )
    const fileB = writeCodexSession(
      'rollout-2026-05-11T12-05-00-019e155c-4a84-7713-9ea4-b83f03f50589.jsonl',
      '019e155c-4a84-7713-9ea4-b83f03f50589',
      scratchB,
    )

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncFile(fileA, 'codex')).toBe('added')
    expect(syncer.syncFile(fileB, 'codex')).toBe('added')

    const rows = db.prepare(
      `SELECT id, slug, display_path, display_name, identity_kind, identity_key
       FROM projects WHERE identity_kind = 'synthetic'`,
    ).all() as Array<{
      id: number
      slug: string
      display_path: string
      display_name: string
      identity_kind: string
      identity_key: string
    }>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      slug: 'codex:scratch',
      display_path: join(baseDir, 'Documents', 'Codex'),
      display_name: 'Codex Chats',
      identity_key: 'codex:scratch',
    })

    const sessionCount = db.prepare(
      `SELECT COUNT(*) AS n FROM sessions WHERE project_id = ?`,
    ).get(rows[0]!.id) as { n: number }
    expect(sessionCount.n).toBe(2)
  })

  it('Security Scan cascade: a message-mutating sync clears scan_profile and fires onSessionChanged', async () => {
    const baseDir = makeTempDir('spool-syncer-scan-cascade-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'cascade.jsonl')
    const writeJsonl = (suffix: string) =>
      writeFileSync(filePath, [
        JSON.stringify({
          type: 'user',
          sessionId: 'cascade-session-1',
          cwd: '/tmp/test-project',
          uuid: 'u1',
          timestamp: '2026-05-01T00:00:00Z',
          message: { role: 'user', content: `hello ${suffix}` },
        }),
      ].join('\n'))
    writeJsonl('first')

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)

    // First sync — session inserted with default scan_profile = NULL.
    let firstSyncer = new Syncer(db)
    expect(firstSyncer.syncFile(filePath, 'claude')).toBe('added')

    // Pretend the scan worker has finished a scan, so scan_profile is set.
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3' WHERE session_uuid = ?")
      .run('cascade-session-1')

    // Mutate the source file's mtime so syncFile re-processes.
    touchFile(filePath)
    writeJsonl('second-with-new-content')
    touchFile(filePath)

    const changed: number[] = []
    const cascadingSyncer = new Syncer(db, undefined, (id) => { changed.push(id) })
    expect(cascadingSyncer.syncFile(filePath, 'claude')).toBe('updated')

    const row = db.prepare(
      'SELECT id, scan_profile, scan_completed_at FROM sessions WHERE session_uuid = ?',
    ).get('cascade-session-1') as { id: number; scan_profile: string | null; scan_completed_at: string | null }
    expect(row.scan_profile).toBeNull()
    expect(row.scan_completed_at).toBeNull()
    expect(changed).toEqual([row.id])
  })

  it('indexes OpenCode sessions from the SQLite database', async () => {
    const baseDir = makeTempDir('spool-syncer-opencode-')
    const opencodeDir = join(baseDir, 'opencode')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(opencodeDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('SPOOL_CLAUDE_DIR', join(baseDir, 'missing-claude'))
    vi.stubEnv('SPOOL_CODEX_DIR', join(baseDir, 'missing-codex'))
    vi.stubEnv('SPOOL_GEMINI_DIR', join(baseDir, 'missing-gemini'))
    vi.stubEnv('SPOOL_OPENCODE_DIR', opencodeDir)

    const dbPath = join(opencodeDir, 'opencode.db')
    const openCodeDb = new Database(dbPath)
    openDbs.push(openCodeDb)
    createOpenCodeSchema(openCodeDb)
    seedOpenCodeSession(openCodeDb, {
      id: 'ses_opencode_1',
      directory: '/tmp/opencode-project',
      title: 'Investigate OpenCode persistence',
      userText: 'Find the OpenCode persistence layer',
      assistantText: 'The session data is stored in SQLite.',
    })

    const { getDB, Syncer, searchFragments } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncAll()).toMatchObject({ added: 1, updated: 0, errors: 0 })
    expect(searchFragments(db, 'OpenCode persistence', { limit: 5 })).toEqual([
      expect.objectContaining({
        source: 'opencode',
        sessionUuid: 'ses_opencode_1',
        project: '/tmp/opencode-project',
      }),
    ])

    seedOpenCodeSession(openCodeDb, {
      id: 'ses_opencode_2',
      directory: '/tmp/opencode-project',
      title: 'Inspect permissions',
      userText: 'Review permission prompts',
      assistantText: 'Permissions are stored per session.',
    })

    expect(syncer.syncFile(dbPath, 'opencode')).toBe('updated')
    expect(searchFragments(db, 'permission prompts', { limit: 5 })).toEqual([
      expect.objectContaining({
        source: 'opencode',
        sessionUuid: 'ses_opencode_2',
      }),
    ])
  })

  it('folds OpenCode subagent sessions into the parent and removes stale standalone child rows', async () => {
    const baseDir = makeTempDir('spool-syncer-opencode-subagents-')
    const opencodeDir = join(baseDir, 'opencode')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(opencodeDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('SPOOL_CLAUDE_DIR', join(baseDir, 'missing-claude'))
    vi.stubEnv('SPOOL_CODEX_DIR', join(baseDir, 'missing-codex'))
    vi.stubEnv('SPOOL_GEMINI_DIR', join(baseDir, 'missing-gemini'))
    vi.stubEnv('SPOOL_OPENCODE_DIR', opencodeDir)

    const dbPath = join(opencodeDir, 'opencode.db')
    const openCodeDb = new Database(dbPath)
    openDbs.push(openCodeDb)
    createOpenCodeSchema(openCodeDb)
    seedOpenCodeSession(openCodeDb, {
      id: 'ses_parent_1',
      directory: '/tmp/opencode-project',
      title: 'Parent session',
      userText: 'Parent visible prompt',
      assistantText: 'Parent visible response',
    })
    seedOpenCodeSession(openCodeDb, {
      id: 'ses_child_1',
      parentId: 'ses_parent_1',
      directory: '/tmp/opencode-project',
      title: 'Explore parent implementation',
      userText: 'CHILD_ONLY_SUBAGENT_NEEDLE',
      assistantText: 'Child-only subagent answer',
      agent: 'explore',
    })

    const { getDB, Syncer, searchFragments, getSessionWithMessages, makeOpenCodeSessionFilePath } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncAll()).toMatchObject({ added: 1, updated: 0, errors: 0 })
    expect(searchFragments(db, 'Parent visible prompt', { limit: 5 })).toHaveLength(1)
    expect(searchFragments(db, 'CHILD_ONLY_SUBAGENT_NEEDLE', { limit: 5 })).toEqual([])

    const parent = getSessionWithMessages(db, 'ses_parent_1')
    expect(parent?.session.messageCount).toBe(2)
    expect(parent?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentText: 'CHILD_ONLY_SUBAGENT_NEEDLE',
        isSidechain: true,
      }),
    ]))
    expect(db.prepare('SELECT session_uuid FROM sessions ORDER BY session_uuid').all())
      .toEqual([{ session_uuid: 'ses_parent_1' }])

    const parentRow = db.prepare(
      'SELECT project_id AS projectId, source_id AS sourceId FROM sessions WHERE session_uuid = ?',
    ).get('ses_parent_1') as { projectId: number; sourceId: number }
    const staleChildPath = makeOpenCodeSessionFilePath(dbPath, 'ses_child_1')
    db.prepare(`
      INSERT INTO sessions
        (project_id, source_id, session_uuid, file_path, title,
         started_at, ended_at, message_count, has_tool_use, cwd, model, raw_file_mtime)
      VALUES (?, ?, 'ses_child_1', ?, 'Stale child row',
              '2026-05-19T01:00:00.000Z', '2026-05-19T01:00:01.000Z',
              1, 0, '/tmp/opencode-project', 'opencode/gpt-5.4', 'old')
    `).run(parentRow.projectId, parentRow.sourceId, staleChildPath)

    expect(db.prepare('SELECT 1 FROM sessions WHERE file_path = ?').get(staleChildPath)).toBeTruthy()
    expect(syncer.syncFile(dbPath, 'opencode')).toBe('updated')
    expect(db.prepare('SELECT 1 FROM sessions WHERE file_path = ?').get(staleChildPath)).toBeUndefined()
  })
})

async function loadCoreModules() {
  vi.resetModules()
  const dbModule = await import('../db/db.js')
  const syncerModule = await import('./syncer.js')
  const queryModule = await import('../db/queries.js')
  const openCodeModule = await import('../parsers/opencode.js')
  return {
    getDB: dbModule.getDB,
    Syncer: syncerModule.Syncer,
    getStatus: queryModule.getStatus,
    getSessionWithMessages: queryModule.getSessionWithMessages,
    searchFragments: queryModule.searchFragments,
    makeOpenCodeSessionFilePath: openCodeModule.makeOpenCodeSessionFilePath,
  }
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function touchFile(filePath: string): void {
  const nextTime = new Date(Date.now() + 1000)
  utimesSync(filePath, nextTime, nextTime)
}

function createOpenCodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      slug text NOT NULL,
      directory text NOT NULL,
      title text NOT NULL,
      version text NOT NULL,
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
}

function seedOpenCodeSession(
  db: Database.Database,
  input: {
    id: string
    directory: string
    title: string
    userText: string
    assistantText: string
    parentId?: string | null
    agent?: string
  },
): void {
  const created = Date.UTC(2026, 4, 19, 1, 0, 0) + Number(input.id.replace(/\D/g, '') || 0) * 1000
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, model, agent)
    VALUES (?, 'proj_1', ?, ?, ?, ?, '1.0.0', ?, ?, 'opencode/gpt-5.4', ?)
  `).run(input.id, input.parentId ?? null, input.id, input.directory, input.title, created, created + 3000, input.agent ?? 'build')

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(`${input.id}_user`, input.id, created + 1000, created + 1000, JSON.stringify({ role: 'user' }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`${input.id}_user_text`, `${input.id}_user`, input.id, created + 1000, created + 1000, JSON.stringify({ type: 'text', text: input.userText }))

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(`${input.id}_assistant`, input.id, created + 2000, created + 2000, JSON.stringify({ role: 'assistant' }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`${input.id}_assistant_text`, `${input.id}_assistant`, input.id, created + 2000, created + 2000, JSON.stringify({ type: 'text', text: input.assistantText }))
}
