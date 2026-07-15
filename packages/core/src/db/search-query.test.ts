import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFtsQuery, buildPreviewFtsPlan, buildSearchPlan, selectFtsTableKind, shouldUseSessionFallback } from './search-query.js'
import { buildLikeSnippet, searchFragments, searchSessionPreview } from './queries.js'

const dbs: Database.Database[] = []

afterEach(() => {
  while (dbs.length > 0) {
    dbs.pop()?.close()
  }
})

describe('buildFtsQuery', () => {
  it('keeps single-token searches as exact terms', () => {
    expect(buildFtsQuery('4242')).toBe('"4242"')
  })

  it('uses the phrase step as the primary query for multi-term input', () => {
    expect(buildFtsQuery('查看一下 4242')).toBe('"查看一下 4242"')
  })

  it('preserves explicit FTS syntax', () => {
    expect(buildFtsQuery('"查看一下 4242" OR 4242*')).toBe('"查看一下 4242" OR 4242*')
  })

  it('builds phrase-first search steps for multi-term input', () => {
    expect(buildSearchPlan('查看一下 4242')).toEqual([
      { query: '"查看一下 4242"', matchType: 'phrase' },
      { query: '"查看一下" AND "4242"', matchType: 'all_terms' },
    ])
  })

  it('routes CJK queries to the trigram index', () => {
    expect(selectFtsTableKind('查看一下 4242')).toBe('trigram')
    expect(selectFtsTableKind('auth middleware')).toBe('unicode')
  })

  it('uses session fallback for short CJK multi-term queries', () => {
    expect(shouldUseSessionFallback('查看 4242')).toBe(true)
    expect(shouldUseSessionFallback('查看一下 4242')).toBe(false)
    expect(shouldUseSessionFallback('"查看 4242"')).toBe(false)
  })

  it('builds prefix plans for unicode text and trigram plans for CJK', () => {
    expect(buildPreviewFtsPlan('auth middle')).toEqual({
      tableKind: 'unicode',
      query: '"auth"* AND "middle"*',
      anyTermQuery: '"auth"* OR "middle"*',
    })
    expect(buildPreviewFtsPlan('查看一下 4242')).toEqual({
      tableKind: 'trigram',
      query: '"查看一下" AND "4242"',
      anyTermQuery: '"查看一下" OR "4242"',
    })
    expect(buildPreviewFtsPlan('查看 42')).toBeNull()
  })

  it('falls back to LIKE when a trigram plan would carry a sub-trigram term', () => {
    // Trigram phrases never match below 3 codepoints and plan terms are
    // ANDed, so one short term would zero out the whole preview.
    expect(buildPreviewFtsPlan('错误码 42')).toBeNull()
    expect(buildPreviewFtsPlan('迁移记录 v2')).toBeNull()
    expect(buildPreviewFtsPlan('错误码 日志文件')).toEqual({
      tableKind: 'trigram',
      query: '"错误码" AND "日志文件"',
      anyTermQuery: '"错误码" OR "日志文件"',
    })
  })

  it('falls back to LIKE when a term has no unicode61 tokens', () => {
    // `=>` tokenizes to nothing under unicode61; the resulting empty phrase
    // matches no rows and would AND-away every other term.
    expect(buildPreviewFtsPlan('foo =>')).toBeNull()
    expect(buildPreviewFtsPlan('null ??')).toBeNull()
  })
})

describe('buildLikeSnippet', () => {
  it('centers the window around the first hit (case-insensitive)', () => {
    const longPrefix = 'x'.repeat(200)
    const text = `${longPrefix} Dark Fantasy Realms tail`
    const snippet = buildLikeSnippet(text, ['dark', 'fantasy'])
    // Must contain the matched segment (original casing, ignoring <mark>).
    const stripped = snippet.replace(/<\/?mark>/g, '')
    expect(stripped).toContain('Dark Fantasy Realms')
    // Leading ellipsis proves the window slid off the start rather than
    // falling back to position 0 (the pre-fix behavior).
    expect(snippet.startsWith('…')).toBe(true)
  })

  it('wraps matches in <mark> preserving original casing', () => {
    const snippet = buildLikeSnippet('A quick Dark Fantasy adventure', ['dark', 'fantasy'])
    expect(snippet).toContain('<mark>Dark</mark>')
    expect(snippet).toContain('<mark>Fantasy</mark>')
  })

  it('returns empty string for empty input', () => {
    expect(buildLikeSnippet('   ', ['anything'])).toBe('')
    expect(buildLikeSnippet('', [])).toBe('')
  })

  it('escapes regex metacharacters in terms', () => {
    // A term containing regex special chars must not blow up and must still
    // match literally.
    const snippet = buildLikeSnippet('Look at v1.2.3 release', ['1.2.3'])
    expect(snippet).toContain('<mark>1.2.3</mark>')
  })
})

describe('searchFragments', () => {
  it('finds messages that contain separated keywords from one natural-language query', () => {
    const db = createSearchTestDb()
    const results = searchFragments(db, '查看一下 4242', { limit: 10 })

    expect(results).toHaveLength(2)
    expect(results[0]?.sessionTitle).toBe('exact-phrase-change-4242')
    expect(results[0]?.matchType).toBe('phrase')
    expect(results[1]?.sessionTitle).toBe('review-change-4242')
    expect(results[1]?.matchType).toBe('all_terms')
    expect(results[1]?.snippet).toContain('<mark>查看一下</mark>')
    expect(results[1]?.snippet).toContain('<mark>4242</mark>')
  })

  it('still allows broad single-term matches for shared PR numbers', () => {
    const db = createSearchTestDb()
    const results = searchFragments(db, '4242', { limit: 10 })

    expect(results).toHaveLength(4)
    expect(results.map(result => result.sessionTitle)).toEqual(
      expect.arrayContaining(['exact-phrase-change-4242', 'review-change-4242', 'mention-change-4242', 'title-and-message-change-4242']),
    )
    expect(results.find(result => result.sessionTitle === 'review-change-4242')?.matchCount).toBe(2)
    expect(results.find(result => result.sessionTitle === 'mention-change-4242')?.matchCount).toBe(1)
  })

  it('falls back to session-level matching for short CJK terms across title and messages', () => {
    const db = createSearchTestDb()
    const results = searchFragments(db, '查看 4242', { limit: 10 })

    expect(results.slice(0, 2).map(result => result.sessionTitle)).toEqual(
      expect.arrayContaining(['exact-phrase-change-4242', 'review-change-4242']),
    )
    expect(results.find(result => result.sessionTitle === 'title-and-message-change-4242')).toBeDefined()
  })

  it('preserves source, project scope, date, and pin filters', () => {
    const db = createSearchTestDb()
    db.prepare('INSERT INTO pins (session_uuid) VALUES (?)').run('session-review-4242')

    expect(searchFragments(db, '4242', { source: 'codex' })).toEqual([])
    expect(searchFragments(db, '4242', { source: 'claude' })).toHaveLength(4)
    expect(searchFragments(db, '4242', { identityKey: '/tmp/test-project' })).toHaveLength(4)
    expect(searchFragments(db, '4242', { identityKey: '/tmp/other-project' })).toEqual([])
    expect(searchFragments(db, '4242', { since: '2026-04-05T10:30:00Z' }).map(result => result.sessionUuid)).toEqual([
      'session-title-message-4242',
    ])
    expect(searchFragments(db, '4242', { onlyPinned: true }).map(result => result.sessionUuid)).toEqual([
      'session-review-4242',
    ])
  })
})

describe('searchSessionPreview', () => {
  it('does not scan for one-character ascii queries', () => {
    const db = createSearchTestDb()
    expect(searchSessionPreview(db, '4')).toEqual([])
  })

  it('serves single CJK character queries through the LIKE fallback', () => {
    // A single Han character is a meaningful query; before the FTS preview
    // landed these went through the LIKE scan and must keep working.
    const db = createSearchTestDb()
    const results = searchSessionPreview(db, '查', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
  })

  it('finds sessions when a CJK query carries a short latin or digit term', () => {
    const db = createSearchTestDb()
    insertSession(db, {
      id: 6,
      uuid: 'session-error-42',
      filePath: '/tmp/test-project/error-42.jsonl',
      title: 'error-code-42',
      startedAt: '2026-04-05T13:00:00Z',
      messages: ['错误码 42 出现在同步日志里。'],
    })

    const results = searchSessionPreview(db, '错误码 42', { limit: 5 })
    expect(results.map(result => result.sessionUuid)).toContain('session-error-42')
  })

  it('finds sessions when one term is punctuation-only', () => {
    const db = createSearchTestDb()
    insertSession(db, {
      id: 7,
      uuid: 'session-arrow-fn',
      filePath: '/tmp/test-project/arrow-fn.jsonl',
      title: 'arrow-fn-refactor',
      startedAt: '2026-04-05T14:00:00Z',
      messages: ['const pick = foo => bar'],
    })

    const results = searchSessionPreview(db, 'foo =>', { limit: 5 })
    expect(results.map(result => result.sessionUuid)).toContain('session-arrow-fn')
  })

  it('finds indexed partial tokens and preserves title weighting', () => {
    const db = createSearchTestDb()
    const results = searchSessionPreview(db, 'review chan', { limit: 5 })

    expect(results[0]?.sessionTitle).toBe('review-change-4242')
  })

  it('uses the trigram index for CJK previews', () => {
    const db = createSearchTestDb()
    const results = searchSessionPreview(db, '查看一下 4242', { limit: 5 })

    expect(results.map(result => result.sessionTitle)).toEqual([
      'exact-phrase-change-4242',
      'review-change-4242',
    ])
  })

  it('sees newly indexed sessions without a stale preview cache', () => {
    const db = createSearchTestDb()
    expect(searchSessionPreview(db, 'freshly indexed', { limit: 5 })).toEqual([])

    insertSession(db, {
      id: 5,
      uuid: 'session-fresh-index',
      filePath: '/tmp/test-project/fresh-index.jsonl',
      title: 'freshly indexed session',
      startedAt: '2026-04-05T12:00:00Z',
      messages: ['freshly indexed content is immediately searchable'],
    })

    const results = searchSessionPreview(db, 'freshly indexed', { limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.sessionUuid).toBe('session-fresh-index')
    expect(results[0]?.snippet).toContain('<mark>freshly</mark> <mark>indexed</mark>')
  })
})

function createSearchTestDb(): Database.Database {
  const db = new Database(':memory:')
  dbs.push(db)

  db.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      display_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      identity_key TEXT
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      session_uuid TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      has_tool_use INTEGER NOT NULL DEFAULT 0,
      cwd TEXT,
      model TEXT
    );

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      msg_uuid TEXT,
      parent_uuid TEXT,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      tool_names TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL
    );

    CREATE TABLE session_search (
      session_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      user_text TEXT NOT NULL DEFAULT '',
      assistant_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE pins (
      session_uuid TEXT PRIMARY KEY
    );

    CREATE VIRTUAL TABLE session_search_fts USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE session_search_fts_trigram USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='trigram'
    );

    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='trigram'
    );

    CREATE TRIGGER messages_fts_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
      INSERT INTO messages_fts_trigram(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;

    CREATE TRIGGER session_search_fts_insert
    AFTER INSERT ON session_search BEGIN
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;

    CREATE TRIGGER session_search_fts_update
    AFTER UPDATE ON session_search BEGIN
      INSERT INTO session_search_fts(session_search_fts, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(session_search_fts_trigram, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;
  `)

  db.prepare('INSERT INTO sources (id, name) VALUES (1, ?)').run('claude')
  db.prepare(`
    INSERT INTO projects (id, source_id, slug, display_path, display_name, identity_key)
    VALUES (1, 1, 'test-project', '/tmp/test-project', 'test-project', '/tmp/test-project')
  `).run()

  insertSession(db, {
    id: 1,
    uuid: 'session-review-4242',
    filePath: '/tmp/test-project/review-4242.jsonl',
    title: 'review-change-4242',
    startedAt: '2026-04-05T09:00:00Z',
    messages: [
      '可以帮我查看一下这个变更单 4242 的结论吗？',
      '我已经查看了变更单 4242 的主要反馈和阻塞项。',
    ],
  })

  insertSession(db, {
    id: 3,
    uuid: 'session-exact-phrase-4242',
    filePath: '/tmp/test-project/exact-phrase-4242.jsonl',
    title: 'exact-phrase-change-4242',
    startedAt: '2026-04-05T08:00:00Z',
    messages: [
      '请直接查看一下 4242 这个变更。',
    ],
  })

  insertSession(db, {
    id: 2,
    uuid: 'session-mention-4242',
    filePath: '/tmp/test-project/mention-4242.jsonl',
    title: 'mention-change-4242',
    startedAt: '2026-04-05T10:00:00Z',
    messages: [
      '顺手总结一下 #4242 改了什么。',
    ],
  })

  insertSession(db, {
    id: 4,
    uuid: 'session-title-message-4242',
    filePath: '/tmp/test-project/title-message-4242.jsonl',
    title: 'title-and-message-change-4242',
    startedAt: '2026-04-05T11:00:00Z',
    messages: [
      '查看这个变更的整体处理过程。',
      '目前 #4242 已经关闭，但修复思路还值得参考。',
    ],
  })

  return db
}

function insertSession(
  db: Database.Database,
  session: {
    id: number
    uuid: string
    filePath: string
    title: string
    startedAt: string
    messages: string[]
  },
): void {
  db.prepare(`
    INSERT INTO sessions (
      id, project_id, source_id, session_uuid, file_path,
      title, started_at, ended_at, message_count, has_tool_use, cwd, model
    )
    VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, 0, '/tmp/test-project', 'claude-sonnet-4-20250514')
  `).run(
    session.id,
    session.uuid,
    session.filePath,
    session.title,
    session.startedAt,
    session.startedAt,
    session.messages.length,
  )

  const stmt = db.prepare(`
    INSERT INTO messages (
      session_id, source_id, msg_uuid, parent_uuid, role,
      content_text, timestamp, is_sidechain, tool_names, seq
    )
    VALUES (?, 1, ?, NULL, 'user', ?, ?, 0, '[]', ?)
  `)

  session.messages.forEach((message, index) => {
    stmt.run(
      session.id,
      `${session.uuid}-msg-${index + 1}`,
      message,
      new Date(Date.parse(session.startedAt) + index * 60_000).toISOString(),
      index + 1,
    )
  })

  db.prepare(`
    INSERT INTO session_search (session_id, title, user_text, assistant_text, updated_at)
    VALUES (?, ?, ?, '', datetime('now'))
  `).run(session.id, session.title, session.messages.join('\n'))
}
