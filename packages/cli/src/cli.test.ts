import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { existsSync, statSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const BIN = resolve(import.meta.dirname, '..', 'bin', 'spool.js')

const SESSION_UUID_1 = '00000000-aaaa-bbbb-cccc-000000000001'
const SESSION_UUID_2 = '00000000-aaaa-bbbb-cccc-000000000002'

// ── Helpers ────────────────────────────────────────────────────────────────

const ISOLATED_ENV = {
  SPOOL_CLAUDE_DIR: '/nonexistent/claude',
  SPOOL_CODEX_DIR: '/nonexistent/codex',
  SPOOL_GEMINI_DIR: '/nonexistent/gemini',
  SPOOL_OPENCODE_DIR: '/nonexistent/opencode',
}

function run(args: string[], env?: Record<string, string>): string {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ISOLATED_ENV, ...env },
    timeout: 15_000,
  })
}

function runFail(args: string[], env?: Record<string, string>): string {
  try {
    execFileSync('node', [BIN, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, ...ISOLATED_ENV, ...env },
      timeout: 15_000,
    })
    throw new Error('Expected command to fail')
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string }
    return (e.stderr ?? '') + (e.stdout ?? '')
  }
}

function createSeededDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'spool-cli-test-'))
  const db = new Database(join(dir, 'spool.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA_SQL)

  const src = 1 // claude source id
  db.prepare('INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (?, ?, ?, ?)').run(
    src, 'my-project', '/Users/test/my-project', 'my-project',
  )

  const insertSession = db.prepare(`
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, cwd, model, raw_file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertSession.run(1, src, SESSION_UUID_1, '/fake/session1.jsonl',
    'Debugging authentication flow', '2026-04-10T10:00:00Z', '2026-04-10T11:00:00Z', 3, '/Users/test/my-project', 'claude-4', '2026-04-10')
  insertSession.run(1, src, SESSION_UUID_2, '/fake/session2.jsonl',
    'Refactoring database queries', '2026-04-12T14:00:00Z', '2026-04-12T15:00:00Z', 2, '/Users/test/my-project/packages/api', 'claude-4', '2026-04-12')

  const insertMsg = db.prepare(`
    INSERT INTO messages (session_id, source_id, msg_uuid, role, content_text, timestamp, tool_names, seq)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertMsg.run(1, src, randomUUID(), 'user', 'How do I fix the authentication middleware?', '2026-04-10T10:00:00Z', '[]', 0)
  insertMsg.run(1, src, randomUUID(), 'assistant', 'The authentication middleware needs a token validation step.', '2026-04-10T10:01:00Z', '["Read","Edit"]', 1)
  insertMsg.run(1, src, randomUUID(), 'user', 'That fixed it, thanks!', '2026-04-10T10:02:00Z', '[]', 2)
  insertMsg.run(2, src, randomUUID(), 'user', 'Can you refactor the database query layer?', '2026-04-12T14:00:00Z', '[]', 0)
  insertMsg.run(2, src, randomUUID(), 'assistant', 'I will restructure the query builder pattern.', '2026-04-12T14:01:00Z', '["Read"]', 1)

  db.prepare('INSERT INTO session_search (session_id, title, user_text, assistant_text) VALUES (?, ?, ?, ?)').run(
    1, 'Debugging authentication flow',
    'How do I fix the authentication middleware? That fixed it, thanks!',
    'The authentication middleware needs a token validation step.',
  )
  db.prepare('INSERT INTO session_search (session_id, title, user_text, assistant_text) VALUES (?, ?, ?, ?)').run(
    2, 'Refactoring database queries',
    'Can you refactor the database query layer?',
    'I will restructure the query builder pattern.',
  )

  db.prepare('INSERT INTO sync_log (source_id, file_path, status) VALUES (?, ?, ?)').run(src, '/fake', 'ok')

  db.close()

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ── Schema (mirrors core's runMigrations) ──────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, base_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO sources (name, base_path) VALUES
    ('claude','~/.claude/projects'),('codex','~/.codex/sessions'),
    ('gemini','~/.gemini/tmp'),('opencode','~/.local/share/opencode/opencode.db');

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
    slug TEXT NOT NULL, display_path TEXT NOT NULL, display_name TEXT NOT NULL,
    last_synced TEXT, UNIQUE (source_id, slug)
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    session_uuid TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE,
    title TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0, has_tool_use INTEGER NOT NULL DEFAULT 0,
    cwd TEXT, model TEXT, raw_file_mtime TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sessions_project ON sessions(project_id);
  CREATE INDEX idx_sessions_started ON sessions(started_at DESC);
  CREATE INDEX idx_sessions_source  ON sessions(source_id);

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    msg_uuid TEXT, parent_uuid TEXT, role TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL,
    is_sidechain INTEGER NOT NULL DEFAULT 0, tool_names TEXT NOT NULL DEFAULT '[]',
    seq INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_session   ON messages(session_id);
  CREATE INDEX idx_messages_timestamp ON messages(timestamp);

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content_text, content='messages', content_rowid='id',
    tokenize='unicode61 remove_diacritics 1'
  );
  CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(
    content_text, content='messages', content_rowid='id', tokenize='trigram'
  );

  CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
    file_path TEXT NOT NULL, status TEXT NOT NULL, message TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE session_search (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '', user_text TEXT NOT NULL DEFAULT '',
    assistant_text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE session_search_fts USING fts5(
    title, user_text, assistant_text,
    content='session_search', content_rowid='session_id',
    tokenize='unicode61 remove_diacritics 1'
  );
  CREATE VIRTUAL TABLE session_search_fts_trigram USING fts5(
    title, user_text, assistant_text,
    content='session_search', content_rowid='session_id', tokenize='trigram'
  );

  CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content_text) VALUES(NEW.id, NEW.content_text);
    INSERT INTO messages_fts_trigram(rowid, content_text) VALUES(NEW.id, NEW.content_text);
  END;
  CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content_text) VALUES('delete', OLD.id, OLD.content_text);
    INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text) VALUES('delete', OLD.id, OLD.content_text);
  END;
  CREATE TRIGGER session_search_fts_insert AFTER INSERT ON session_search BEGIN
    INSERT INTO session_search_fts(rowid, title, user_text, assistant_text) VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text) VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
  END;
`

// ── Tests ──────────────────────────────────────────────────────────────────

describe('cli entry point', () => {
  it('bin/spool.js exists and is executable', () => {
    expect(existsSync(BIN)).toBe(true)
    const mode = statSync(BIN).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('--help prints usage', () => {
    const out = run(['--help'])
    expect(out).toContain('Usage: spool')
    expect(out).toContain('search')
    expect(out).toContain('sync')
  })

  it('--version prints version from package.json', () => {
    const out = run(['--version'])
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(out.trim()).not.toBe('0.0.1')
  })

  it('unknown command exits with error', () => {
    expect(() =>
      execFileSync('node', [BIN, 'nonexistent'], { encoding: 'utf8', stdio: 'pipe' }),
    ).toThrow()
  })
})

describe('status', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeAll(() => { seeded = createSeededDir() })
  afterAll(() => { seeded.cleanup() })

  it('prints session counts and DB path', () => {
    const out = run(['status'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Sessions:')
    expect(out).toContain('claude: 2')
    expect(out).toContain(seeded.dir)
  })

  it('shows zero counts on fresh DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-cli-empty-'))
    try {
      const out = run(['status'], { SPOOL_DATA_DIR: dir })
      expect(out).toContain('Sessions:     0 total')
      expect(out).toContain('Last synced:  never')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('list', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeAll(() => { seeded = createSeededDir() })
  afterAll(() => { seeded.cleanup() })

  it('lists sessions', () => {
    const out = run(['list'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Debugging authentication flow')
    expect(out).toContain('Refactoring database queries')
  })

  it('limits results with -n', () => {
    const out = run(['list', '-n', '1'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Refactoring database queries')
    expect(out).not.toContain('Debugging authentication flow')
  })

  it('filters by source', () => {
    const out = run(['list', '-s', 'codex'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('No sessions found')
  })

  it('outputs JSON', () => {
    const out = run(['list', '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
    expect(parsed[0].sessionUuid).toBeTruthy()
  })

  it('prints empty message when no sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-cli-empty-'))
    try {
      const out = run(['list'], { SPOOL_DATA_DIR: dir })
      expect(out).toContain('No sessions found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('show', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeAll(() => { seeded = createSeededDir() })
  afterAll(() => { seeded.cleanup() })

  it('prints session with messages', () => {
    const out = run(['show', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Debugging authentication flow')
    expect(out).toContain('authentication middleware')
    expect(out).toContain('USER')
    expect(out).toContain('ASSISTANT')
  })

  it('shows tool names', () => {
    const out = run(['show', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Read, Edit')
  })

  it('outputs JSON', () => {
    const out = run(['show', SESSION_UUID_1, '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(parsed.session.sessionUuid).toBe(SESSION_UUID_1)
    expect(parsed.messages.length).toBe(3)
  })

  it('exits with error for unknown UUID', () => {
    const out = runFail(['show', 'nonexistent-uuid'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('not found')
  })
})

describe('search', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeAll(() => { seeded = createSeededDir() })
  afterAll(() => { seeded.cleanup() })

  it('finds matching sessions', () => {
    const out = run(['search', 'authentication'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('authentication')
    expect(out).toContain('claude')
  })

  it('prints no-results message', () => {
    const out = run(['search', 'xyznonexistent'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('No results found')
  })

  it('limits results with -n', () => {
    const out = run(['search', 'the', '-n', '1'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Result 1/1')
  })

  it('outputs JSON', () => {
    const out = run(['search', 'authentication', '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0].sessionUuid).toBeTruthy()
  })

  it('exits with error when query is missing', () => {
    const out = runFail(['search'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain("missing required argument")
  })
})

describe('pin / unpin / pinned', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeEach(() => { seeded = createSeededDir() })
  afterEach(() => { seeded.cleanup() })

  it('pins a session and pinned lists it', () => {
    const pinOut = run(['pin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(pinOut).toContain('Pinned')
    expect(pinOut).toContain('Debugging authentication flow')

    const listed = run(['pinned'], { SPOOL_DATA_DIR: seeded.dir })
    expect(listed).toContain('Debugging authentication flow')
    expect(listed).not.toContain('Refactoring database queries')
  })

  it('is idempotent when already pinned', () => {
    run(['pin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    const again = run(['pin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(again).toContain('Already pinned')
  })

  it('unpin removes a session from the pinned list', () => {
    run(['pin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    const unpinOut = run(['unpin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(unpinOut).toContain('Unpinned')

    const listed = run(['pinned'], { SPOOL_DATA_DIR: seeded.dir })
    expect(listed).toContain('No pinned sessions')
  })

  it('pin exits with error for unknown UUID', () => {
    const out = runFail(['pin', 'nonexistent-uuid'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('not found')
  })

  it('unpin reports when a session was not pinned', () => {
    const out = run(['unpin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Not pinned')
  })

  it('pinned outputs JSON', () => {
    run(['pin', SESSION_UUID_1], { SPOOL_DATA_DIR: seeded.dir })
    const out = run(['pinned', '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].sessionUuid).toBe(SESSION_UUID_1)
  })

  it('pinned prints empty message when nothing pinned', () => {
    const out = run(['pinned'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('No pinned sessions')
  })
})

describe('projects', () => {
  let seeded: ReturnType<typeof createSeededDir>
  beforeAll(() => { seeded = createSeededDir() })
  afterAll(() => { seeded.cleanup() })

  it('lists project groups with session counts', () => {
    const out = run(['projects'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('my-project')
    expect(out).toContain('claude')
    expect(out).toMatch(/\b2\b/)
  })

  it('outputs JSON', () => {
    const out = run(['projects', '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].displayName).toBe('my-project')
    expect(parsed[0].sessionCount).toBe(2)
    expect(parsed[0].sources).toContain('claude')
  })

  it('prints empty message when no projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-cli-empty-'))
    try {
      const out = run(['projects'], { SPOOL_DATA_DIR: dir })
      expect(out).toContain('No projects found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists the sessions in a project when given a query', () => {
    const out = run(['projects', 'my-project'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Debugging authentication flow')
    expect(out).toContain('Refactoring database queries')
  })

  it('matches a project by display path', () => {
    const out = run(['projects', '/Users/test/my-project'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Debugging authentication flow')
    expect(out).toContain('Refactoring database queries')
  })

  it('matches a project by session cwd', () => {
    const out = run(['projects', 'packages/api'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('Debugging authentication flow')
    expect(out).toContain('Refactoring database queries')
  })

  it('outputs project sessions as JSON', () => {
    const out = run(['projects', 'my-project', '--json'], { SPOOL_DATA_DIR: seeded.dir })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
    expect(parsed[0].sessionUuid).toBeTruthy()
  })

  it('errors when no project matches the query', () => {
    const out = runFail(['projects', 'zzz-no-such-project'], { SPOOL_DATA_DIR: seeded.dir })
    expect(out).toContain('No project matching')
  })
})

describe('sync', () => {
  it('runs against empty session dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-cli-sync-'))
    try {
      const out = run(['sync'], { SPOOL_DATA_DIR: dir })
      expect(out).toContain('Syncing sessions')
      expect(out).toContain('Done')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
