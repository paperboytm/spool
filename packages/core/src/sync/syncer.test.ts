import { afterEach, describe, expect, it, vi } from 'vitest'
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
})

async function loadCoreModules() {
  vi.resetModules()
  const dbModule = await import('../db/db.js')
  const syncerModule = await import('./syncer.js')
  const queryModule = await import('../db/queries.js')
  return {
    getDB: dbModule.getDB,
    Syncer: syncerModule.Syncer,
    getStatus: queryModule.getStatus,
    searchFragments: queryModule.searchFragments,
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
