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

  it('Security Scan cascade: appending a new message clears scan_profile and fires onSessionChanged', async () => {
    // This used to assert that ANY mtime touch + content change
    // clears scan_profile, on the assumption that the syncer always
    // does DELETE+INSERT. Under append-only sync that contract
    // changes: the cascade fires only when at least one new row is
    // actually inserted (new uuid). Re-syncing the same-uuid file
    // with edited content is now an explicit "use Refresh from
    // source" case, covered above by the no-auto-rewrite test.
    const baseDir = makeTempDir('spool-syncer-scan-cascade-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'cascade.jsonl')
    const record = (uuid: string, content: string) => JSON.stringify({
      type: 'user',
      sessionId: 'cascade-session-1',
      cwd: '/tmp/test-project',
      uuid,
      timestamp: `2026-05-01T00:0${uuid.slice(-1)}:00Z`,
      message: { role: 'user', content },
    })
    writeFileSync(filePath, record('u1', 'hello first'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)

    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    // Pretend the scan worker has finished a scan, so scan_profile is set.
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3' WHERE session_uuid = ?")
      .run('cascade-session-1')

    // Append a brand-new message — this is the path that should
    // invalidate scan_profile and notify subscribers.
    writeFileSync(filePath, [
      record('u1', 'hello first'),
      record('u2', 'hello — new turn'),
    ].join('\n'))
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

  // ─── Append-only sync (schema v14 follow-up) ────────────────────────
  //
  // The four tests below pin down the contract for the new
  // INSERT-OR-IGNORE sync path:
  //
  //   1. Re-syncing a file whose content has not changed must NOT
  //      invalidate the user-side state (Security Scan purge in
  //      particular). This is the load-bearing fix that originally
  //      motivated the redesign — issue #344's follow-up question
  //      "does purge survive re-sync?".
  //   2. Appending genuinely-new messages must take the fast path
  //      (no DELETE+INSERT) but still trigger the Security Scan
  //      cascade so the new content gets scanned.
  //   3. An in-place edit of an already-stored message must be
  //      detected and fall back to the rewrite path; otherwise
  //      INSERT OR IGNORE silently drops the new content and the
  //      DB ends up stale.
  //   4. A shrunk parse result is a strong rewrite signal — source
  //      file truncation must replay through the safe path.

  it('append-only sync keeps Security Scan masks in session_search_fts after a content-changing re-sync (no raw leak)', async () => {
    // Regression for the gap the post-PR code review surfaced:
    // upsertSessionSearch used to read from parsed.messages (the raw
    // jsonl), so on every re-sync the session-level FTS index
    // re-acquired the raw secret even though messages_fts was
    // correctly masked. The fix routes session_search through
    // messages.content_text — what's already in the DB after purge —
    // so the "search across sessions" surface no longer leaks purged
    // values for active sessions whose source files keep growing.
    const baseDir = makeTempDir('spool-syncer-session-search-mask-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'session-search-mask.jsonl')
    const userRecord = (uuid: string, ts: string, content: string) => JSON.stringify({
      type: 'user',
      sessionId: 'session-search-mask-session',
      cwd: '/tmp/test-project',
      uuid,
      timestamp: ts,
      message: { role: 'user', content },
    })
    // Two messages so the parser derives the title from the FIRST
    // user message (a benign greeting) and the secret lives in a
    // later message — this isolates the user_text/assistant_text leak
    // the PR introduces from the title-derivation leak (pre-existing
    // and out of scope here; the parser slices the first 120 chars of
    // the first user message into sessions.title and that path has
    // its own redaction story).
    const SECRET = 'AKIAIOSFODNN7EXAMPLE'
    writeFileSync(filePath, [
      userRecord('m0', '2026-05-01T00:00:00Z', 'hello, please review my repo'),
      userRecord('m1', '2026-05-01T00:01:00Z', `here is the credential: ${SECRET} thanks`),
    ].join('\n'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'session-search-mask-session'"
    ).get() as { id: number }).id
    const messageId = (db.prepare(
      "SELECT id FROM messages WHERE session_id = ? AND msg_uuid = 'm1'"
    ).get(sessionId) as { id: number }).id

    // Simulate Security Scan purge of the m1 finding: mask
    // content_text in place. The source jsonl still has the raw
    // value — that's the threat model.
    db.prepare(
      `UPDATE messages SET content_text = 'here is the credential: [redacted: AWS key] thanks' WHERE id = ?`,
    ).run(messageId)

    // A real append at the source (claude session keeps growing).
    writeFileSync(filePath, [
      userRecord('m0', '2026-05-01T00:00:00Z', 'hello, please review my repo'),
      userRecord('m1', '2026-05-01T00:01:00Z', `here is the credential: ${SECRET} thanks`),
      userRecord('m2', '2026-05-01T00:02:00Z', 'a follow-up'),
    ].join('\n'))
    touchFile(filePath)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('updated')

    // session_search.user_text must reflect what the DB holds (mask),
    // not what parsed.messages saw (raw).
    const search = db.prepare(
      'SELECT user_text FROM session_search WHERE session_id = ?'
    ).get(sessionId) as { user_text: string }
    expect(search.user_text.includes(SECRET)).toBe(false)
    expect(search.user_text.includes('[redacted: AWS key]')).toBe(true)

    // And a column-restricted FTS search against user_text must not
    // surface the raw value (assistant_text and title leaks would be
    // separate paths — title derivation is the parser's job, not
    // this PR's surface).
    const ftsHits = db.prepare(
      'SELECT COUNT(*) AS n FROM session_search_fts WHERE session_search_fts MATCH ?'
    ).get(`user_text:"${SECRET}"`) as { n: number }
    expect(ftsHits.n).toBe(0)
  })

  it('append-only sync preserves Security Scan purge state across a no-op re-sync (issue #344 follow-up)', async () => {
    const baseDir = makeTempDir('spool-syncer-purge-survives-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'purge-survives.jsonl')
    writeFileSync(filePath, JSON.stringify({
      type: 'user',
      sessionId: 'purge-survives-session',
      cwd: '/tmp/test-project',
      uuid: 'm1',
      timestamp: '2026-05-01T00:00:00Z',
      message: { role: 'user', content: 'leaked: AKIAIOSFODNN7EXAMPLE here' },
    }))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)

    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    // Simulate a Security Scan run: a finding lands in the DB and the
    // user purges it. content_text gets the mask, the finding flips
    // to state='purged', scan_profile is filled.
    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'purge-survives-session'"
    ).get() as { id: number }).id
    const messageId = (db.prepare(
      'SELECT id FROM messages WHERE session_id = ? ORDER BY id LIMIT 1'
    ).get(sessionId) as { id: number }).id
    db.prepare(
      `INSERT INTO findings (session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state, state_changed_at)
       VALUES (?, ?, 'api-key', 'h-aws', 0.95, 'regex', 8, 28, 'purged', datetime('now'))`,
    ).run(sessionId, messageId)
    db.prepare(
      `UPDATE messages SET content_text = 'leaked: [redacted: AWS key] here' WHERE id = ?`,
    ).run(messageId)
    db.prepare(
      `UPDATE sessions SET scan_profile = 'regex@3', scan_purged_count = 1 WHERE id = ?`,
    ).run(sessionId)

    // Touch the source file's mtime without changing its content —
    // this is exactly the pattern the old DELETE+INSERT path used to
    // weaponise into a purge-undo.
    touchFile(filePath)
    const changedIds: number[] = []
    const reSyncer = new Syncer(db, undefined, (id) => { changedIds.push(id) })
    reSyncer.syncFile(filePath, 'claude')

    // Purge state must still be there.
    const finding = db.prepare(
      'SELECT state FROM findings WHERE session_id = ?'
    ).get(sessionId) as { state: string } | undefined
    expect(finding?.state).toBe('purged')

    // Masked content must still be there.
    const msg = db.prepare(
      'SELECT content_text FROM messages WHERE id = ?'
    ).get(messageId) as { content_text: string } | undefined
    expect(msg?.content_text).toBe('leaked: [redacted: AWS key] here')

    // scan_profile must NOT have been cleared — nothing changed, so
    // the scan worker should not be asked to redo the session.
    const sess = db.prepare(
      'SELECT scan_profile FROM sessions WHERE id = ?'
    ).get(sessionId) as { scan_profile: string | null }
    expect(sess.scan_profile).toBe('regex@3')

    // onSessionChanged must not have fired for the no-op re-sync.
    expect(changedIds).toEqual([])
  })

  it('append-only sync inserts newly-appended messages without DELETEing the existing tail and still cascades scan_profile', async () => {
    const baseDir = makeTempDir('spool-syncer-append-grows-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'append-grows.jsonl')
    const userRecord = (uuid: string, ts: string, content: string) => JSON.stringify({
      type: 'user',
      sessionId: 'append-grows-session',
      cwd: '/tmp/test-project',
      uuid,
      timestamp: ts,
      message: { role: 'user', content },
    })
    writeFileSync(filePath, [
      userRecord('m1', '2026-05-01T00:00:00Z', 'first message'),
      userRecord('m2', '2026-05-01T00:01:00Z', 'second message'),
    ].join('\n'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)

    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')
    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'append-grows-session'"
    ).get() as { id: number }).id

    // Stand in for "scan worker has finished": set scan_profile so
    // the cascade is observable. Also park a finding row that should
    // survive (it's tied to m1 by message_id, which append-only sync
    // must not DELETE).
    const m1Id = (db.prepare(
      "SELECT id FROM messages WHERE session_id = ? AND msg_uuid = 'm1'"
    ).get(sessionId) as { id: number }).id
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3' WHERE id = ?").run(sessionId)
    db.prepare(
      `INSERT INTO findings (session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state)
       VALUES (?, ?, 'email', 'h1', 0.9, 'regex', 0, 5, 'active')`,
    ).run(sessionId, m1Id)

    // Append a third message at the source.
    writeFileSync(filePath, [
      userRecord('m1', '2026-05-01T00:00:00Z', 'first message'),
      userRecord('m2', '2026-05-01T00:01:00Z', 'second message'),
      userRecord('m3', '2026-05-01T00:02:00Z', 'third — brand new'),
    ].join('\n'))
    touchFile(filePath)

    const changedIds: number[] = []
    const reSyncer = new Syncer(db, undefined, (id) => { changedIds.push(id) })
    expect(reSyncer.syncFile(filePath, 'claude')).toBe('updated')

    // m1 row id stable → finding still pointing at the right row.
    const m1RowAfter = db.prepare(
      "SELECT id FROM messages WHERE session_id = ? AND msg_uuid = 'm1'"
    ).get(sessionId) as { id: number }
    expect(m1RowAfter.id).toBe(m1Id)

    // The pre-existing finding survives the re-sync.
    const finding = db.prepare(
      'SELECT message_id, state FROM findings WHERE session_id = ?'
    ).get(sessionId) as { message_id: number; state: string }
    expect(finding).toEqual({ message_id: m1Id, state: 'active' })

    // m3 actually landed.
    const newCount = (db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE session_id = ?'
    ).get(sessionId) as { c: number }).c
    expect(newCount).toBe(3)

    // Cascade DID fire — new content arrived.
    const sess = db.prepare(
      'SELECT scan_profile FROM sessions WHERE id = ?'
    ).get(sessionId) as { scan_profile: string | null }
    expect(sess.scan_profile).toBeNull()
    expect(changedIds).toEqual([sessionId])
  })

  it('does NOT auto-rewrite content on a same-uuid in-place source edit (deliberate; PR3 force-resync covers this)', async () => {
    // This pins the deliberate trade-off behind the append-only
    // design. Source files for every supported provider are
    // append-only event logs at the tool contract level; in-place
    // edits of an existing uuid only happen when a user manually
    // mutates the jsonl on disk. We could content-compare in
    // classifySync to catch that, but doing so would also trigger
    // rewrite whenever Security Scan has replaced the raw value with
    // its mask — undoing the purge on the next re-sync, which is the
    // exact regression that motivated this work. The explicit
    // "Refresh from source" action (PR 3) is the right UX for the
    // rare manual-edit case.
    const baseDir = makeTempDir('spool-syncer-no-auto-rewrite-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'manual-edit.jsonl')
    const record = (text: string) => JSON.stringify({
      type: 'user',
      sessionId: 'manual-edit-session',
      cwd: '/tmp/test-project',
      uuid: 'u1',
      timestamp: '2026-05-01T00:00:00Z',
      message: { role: 'user', content: text },
    })
    writeFileSync(filePath, record('original content'))
    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    // Source rewrites the same uuid with different content.
    writeFileSync(filePath, record('rewritten content'))
    touchFile(filePath)
    const changedIds: number[] = []
    const reSyncer = new Syncer(db, undefined, (id) => { changedIds.push(id) })
    reSyncer.syncFile(filePath, 'claude')

    // DB intentionally keeps the original content — INSERT OR IGNORE
    // saw the existing uuid and skipped the new row.
    const msg = db.prepare(
      "SELECT content_text FROM messages WHERE msg_uuid = 'u1'"
    ).get() as { content_text: string }
    expect(msg.content_text).toBe('original content')

    // And no cascade fired — append path with 0 inserted is a no-op.
    expect(changedIds).toEqual([])
  })

  it('forceMode rewrite bypasses both the mtime-skip and classifySync gates (Refresh from source)', async () => {
    // The "Refresh from source" user action runs against a session
    // whose source file hasn't moved (mtime unchanged) and whose
    // uuid/length signals say "no append needed". Both gates would
    // normally short-circuit. Force=rewrite must go through the
    // DELETE+INSERT path anyway — that's the whole point of the
    // escape hatch.
    const baseDir = makeTempDir('spool-syncer-force-rewrite-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'force-rewrite.jsonl')
    const record = (uuid: string, ts: string, content: string) => JSON.stringify({
      type: 'user',
      sessionId: 'force-rewrite-session',
      cwd: '/tmp/test-project',
      uuid,
      timestamp: ts,
      message: { role: 'user', content },
    })
    writeFileSync(filePath, record('m1', '2026-05-01T00:00:00Z', 'original'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'force-rewrite-session'"
    ).get() as { id: number }).id
    const m1Id = (db.prepare(
      "SELECT id FROM messages WHERE session_id = ?"
    ).get(sessionId) as { id: number }).id

    // Park scan state + a finding to verify the rewrite cascade
    // actually fires (in append mode with insertedCount=0 it would
    // be silently preserved — that's what makes Refresh meaningful).
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3' WHERE id = ?").run(sessionId)
    db.prepare(
      `INSERT INTO findings (session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state, state_changed_at)
       VALUES (?, ?, 'api-key', 'h', 0.9, 'regex', 0, 1, 'purged', datetime('now'))`,
    ).run(sessionId, m1Id)

    // Standard re-sync — mtime hasn't moved, classify would say
    // append. Confirm that's what would happen WITHOUT the force.
    const baselineChanged: number[] = []
    expect(
      new Syncer(db, undefined, (id) => { baselineChanged.push(id) })
        .syncFile(filePath, 'claude'),
    ).toBe('skipped')
    expect(baselineChanged).toEqual([])
    expect((db.prepare(
      "SELECT scan_profile FROM sessions WHERE id = ?"
    ).get(sessionId) as { scan_profile: string | null }).scan_profile).toBe('regex@3')

    // Force=rewrite must skip the mtime gate AND run the rewrite
    // path. mtime is identical, classify would say append.
    const forced: number[] = []
    const forceResult = new Syncer(db, undefined, (id) => { forced.push(id) })
      .syncFile(filePath, 'claude', undefined, undefined, { forceMode: 'rewrite' })
    expect(forceResult).toBe('updated')
    expect(forced).toEqual([sessionId])

    // Rewrite ran → previous message rows were DELETEd, so the
    // finding pointing at the old message_id was cascade-cleared.
    // (SQLite reuses INTEGER PRIMARY KEY rowids on DELETE+INSERT in
    // a single transaction, so the new message id may match the
    // old; the cascade is the meaningful proof, not the rowid.)
    const cleared = db.prepare(
      'SELECT COUNT(*) AS c FROM findings WHERE session_id = ?'
    ).get(sessionId) as { c: number }
    expect(cleared.c).toBe(0)

    // scan_profile must be NULLed so the worker re-scans.
    expect((db.prepare(
      "SELECT scan_profile FROM sessions WHERE id = ?"
    ).get(sessionId) as { scan_profile: string | null }).scan_profile).toBeNull()
  })

  it('forceMode does not silently delete a session when its source parse returns filtered', async () => {
    // Regression for the self-review finding on PR 3 (force-resync
    // UI): the non-force code path treats a `filtered` parse result
    // as "this session should be removed from the index" and calls
    // deleteSessionByFilePath. Under force, the user pressed
    // "Refresh from source" because they want their session back,
    // not because they want it deleted — so the destructive
    // branch must be skipped. Gemini is the cheapest source to
    // construct a filtered result for: a record with `kind:
    // 'subagent'` triggers the parser's `{ kind: 'filtered' }`
    // return at gemini.ts:36.
    const baseDir = makeTempDir('spool-syncer-force-filtered-')
    const geminiCliHome = join(baseDir, 'gemini-home')
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    const historyDir = join(geminiCliHome, '.gemini', 'history', 'workspace')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(historyDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('HOME', geminiCliHome)

    // First sync — a normal gemini session lands in the DB.
    const filePath = join(chatsDir, 'session-1.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'force-filtered-session',
      startTime: '2026-05-01T00:00:00Z',
      lastUpdated: '2026-05-01T00:00:00Z',
      messages: [
        { id: 'm1', type: 'user', timestamp: '2026-05-01T00:00:00Z', content: 'hi' },
      ],
    }))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'gemini')).toBe('added')
    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'force-filtered-session'"
    ).get() as { id: number }).id

    // Now mutate the source so the parser returns kind: 'filtered'
    // (gemini does this when record.kind === 'subagent'). Without
    // force, the destructive cleanup runs.
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'force-filtered-session',
      kind: 'subagent',
      startTime: '2026-05-01T00:00:00Z',
      lastUpdated: '2026-05-01T00:01:00Z',
      messages: [
        { id: 'm1', type: 'user', timestamp: '2026-05-01T00:00:00Z', content: 'hi' },
      ],
    }))
    touchFile(filePath)

    // Force=rewrite must NOT delete the session — that would be the
    // exact regression the self-review caught. The action should
    // be a no-op for unreachable sources and return 'skipped'.
    const force = new Syncer(db).syncFile(
      filePath, 'gemini', undefined, undefined, { forceMode: 'rewrite' },
    )
    expect(force).toBe('skipped')
    const stillThere = db.prepare(
      'SELECT COUNT(*) AS c FROM sessions WHERE id = ?'
    ).get(sessionId) as { c: number }
    expect(stillThere.c).toBe(1)
  })

  it('falls back to rewrite when the source file shrinks below the stored row count', async () => {
    const baseDir = makeTempDir('spool-syncer-rewrite-on-shrink-')
    const claudeDir = join(baseDir, 'claude', 'projects', 'test-project')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(claudeDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const filePath = join(claudeDir, 'rewrite-on-shrink.jsonl')
    const userRecord = (uuid: string, content: string) => JSON.stringify({
      type: 'user',
      sessionId: 'rewrite-on-shrink-session',
      cwd: '/tmp/test-project',
      uuid,
      timestamp: `2026-05-01T00:0${uuid.slice(-1)}:00Z`,
      message: { role: 'user', content },
    })
    writeFileSync(filePath, [
      userRecord('m1', 'first'),
      userRecord('m2', 'second'),
      userRecord('m3', 'third'),
    ].join('\n'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('added')

    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'rewrite-on-shrink-session'"
    ).get() as { id: number }).id
    expect((db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE session_id = ?'
    ).get(sessionId) as { c: number }).c).toBe(3)

    // Source loses its tail.
    writeFileSync(filePath, userRecord('m1', 'first'))
    touchFile(filePath)
    expect(new Syncer(db).syncFile(filePath, 'claude')).toBe('updated')

    // Stale m2/m3 are gone (rewrite path ran DELETE+INSERT) and m1
    // remains.
    const after = db.prepare(
      'SELECT msg_uuid FROM messages WHERE session_id = ? ORDER BY msg_uuid'
    ).all(sessionId) as Array<{ msg_uuid: string }>
    expect(after.map(r => r.msg_uuid)).toEqual(['m1'])
  })

  it('rewrites a Gemini session when a rewind plus new turns keeps the count from shrinking', async () => {
    // $rewindTo can drop mid-stream messages while enough new turns land in
    // the same sync that parsed.length >= stored total and the first uuid
    // still matches. Head+count classification alone would say append,
    // stranding the rewound rows next to the new ones with colliding seq
    // values — the tail-uuid check must force rewrite instead.
    const baseDir = makeTempDir('spool-syncer-gemini-rewind-')
    const geminiCliHome = join(baseDir, 'gemini-home')
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-rewind.jsonl')
    const meta = JSON.stringify({ sessionId: 'gemini-rewind-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' })
    const msg = (id: string, text: string) => JSON.stringify({
      id,
      timestamp: '2026-04-08T00:00:00Z',
      type: 'user',
      content: [{ text }],
    })
    writeFileSync(filePath, [meta, msg('m1', 'first'), msg('m2', 'second'), msg('m3', 'third')].join('\n'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'gemini')).toBe('added')

    const sessionId = (db.prepare(
      "SELECT id FROM sessions WHERE session_uuid = 'gemini-rewind-session'"
    ).get() as { id: number }).id

    // User rewinds to m2 and sends two new turns: replay is [m1, m4, m5] —
    // same length as the stored rows, same head, different tail.
    writeFileSync(filePath, [
      meta,
      msg('m1', 'first'), msg('m2', 'second'), msg('m3', 'third'),
      JSON.stringify({ $rewindTo: 'm2' }),
      msg('m4', 'new prompt'), msg('m5', 'newer prompt'),
    ].join('\n'))
    touchFile(filePath)
    expect(new Syncer(db).syncFile(filePath, 'gemini')).toBe('updated')

    const after = db.prepare(
      'SELECT msg_uuid, seq FROM messages WHERE session_id = ? ORDER BY seq, id'
    ).all(sessionId) as Array<{ msg_uuid: string; seq: number }>
    expect(after.map(r => r.msg_uuid)).toEqual(['m1', 'm4', 'm5'])
    expect(after.map(r => r.seq)).toEqual([0, 1, 2])
  })

  it('rewrites message rows when the stored index version differs from the current one', async () => {
    // An index-version bump exists to re-derive contentText. The bump makes
    // the stored mtime string mismatch so the file is re-visited, but the
    // append path (INSERT … DO NOTHING) would touch nothing — a version
    // change must force the rewrite path.
    const baseDir = makeTempDir('spool-syncer-version-bump-')
    const geminiCliHome = join(baseDir, 'gemini-home')
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-version.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'gemini-version-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' }),
      JSON.stringify({ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: 'derived from source' }] }),
    ].join('\n'))

    const { getDB, Syncer } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    expect(new Syncer(db).syncFile(filePath, 'gemini')).toBe('added')

    // Simulate rows indexed under a previous parser version: stale derived
    // content plus the old version suffix in the stored mtime.
    db.prepare(
      "UPDATE messages SET content_text = 'stale v1 derivation' WHERE msg_uuid = 'm1'"
    ).run()
    db.prepare(
      `UPDATE sessions
          SET raw_file_mtime = replace(raw_file_mtime, '::', '::old-')
        WHERE session_uuid = 'gemini-version-session'`,
    ).run()

    // File itself unchanged on disk — only the version suffix differs.
    expect(new Syncer(db).syncFile(filePath, 'gemini')).toBe('updated')
    const msg = db.prepare(
      "SELECT content_text FROM messages WHERE msg_uuid = 'm1'"
    ).get() as { content_text: string }
    expect(msg.content_text).toBe('derived from source')
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
