import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { searchSessionPreview } from '../dist/index.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const sessionCount = readPositiveArg('--sessions', 500)
const messagesPerSession = readPositiveArg('--messages', 340)
const iterations = readPositiveArg('--iterations', 30)
const p95BudgetMs = readPositiveArg('--p95-budget-ms', 50)
const blockingBudgetMs = readPositiveArg('--blocking-budget-ms', 100)
const db = new Database(':memory:')
const breaches = []

createSchema(db)
seed(db, sessionCount, messagesPerSession)

console.log(`Fixture: ${sessionCount} sessions, ${sessionCount * messagesPerSession} messages`)
for (const query of ['a', 'search', 'search latency']) {
  searchSessionPreview(db, query, { limit: 5 })
  const durations = Array.from({ length: iterations }, () => {
    const startedAt = performance.now()
    searchSessionPreview(db, query, { limit: 5 })
    return performance.now() - startedAt
  }).sort((a, b) => a - b)

  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length
  const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0
  const max = durations.at(-1) ?? 0
  console.log(`${JSON.stringify(query)} mean=${mean.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`)
  if (p95 >= p95BudgetMs || max >= blockingBudgetMs) breaches.push({ query, p95, max })
}

db.close()
if (breaches.length > 0) {
  console.error(`Search latency budget exceeded: ${JSON.stringify(breaches)}`)
  process.exitCode = 1
}

function readPositiveArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  const value = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      display_path TEXT NOT NULL,
      display_name TEXT NOT NULL
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
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content_text,
      content='messages', content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );
    CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(
      content_text,
      content='messages', content_rowid='id', tokenize='trigram'
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
    CREATE TRIGGER session_search_fts_insert AFTER INSERT ON session_search BEGIN
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;
    CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
      INSERT INTO messages_fts_trigram(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;
  `)
  database.prepare('INSERT INTO sources (id, name) VALUES (1, ?)').run('codex')
  database.prepare(`
    INSERT INTO projects (id, source_id, slug, display_path, display_name)
    VALUES (1, 1, 'benchmark', '/tmp/benchmark', 'benchmark')
  `).run()
}

function seed(database, sessions, messagesPerSession) {
  const insertSession = database.prepare(`
    INSERT INTO sessions (
      id, project_id, source_id, session_uuid, file_path, title,
      started_at, ended_at, message_count, cwd, model
    ) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, '/tmp/benchmark', 'benchmark')
  `)
  const insertMessage = database.prepare(`
    INSERT INTO messages (
      session_id, source_id, msg_uuid, role, content_text, timestamp, seq
    ) VALUES (?, 1, ?, ?, ?, ?, ?)
  `)
  const insertSearch = database.prepare(`
    INSERT INTO session_search (session_id, title, user_text, assistant_text)
    VALUES (?, ?, ?, ?)
  `)
  const fixture = database.transaction(() => {
    for (let sessionId = 1; sessionId <= sessions; sessionId += 1) {
      const startedAt = new Date(Date.UTC(2026, 0, 1) + sessionId * 60_000).toISOString()
      const title = sessionId % 25 === 0
        ? `Search latency investigation ${sessionId}`
        : `Engineering session ${sessionId}`
      const userText = []
      const assistantText = []

      insertSession.run(
        sessionId,
        `benchmark-${sessionId}`,
        `/tmp/benchmark/${sessionId}.jsonl`,
        title,
        startedAt,
        startedAt,
        messagesPerSession,
      )

      for (let seq = 1; seq <= messagesPerSession; seq += 1) {
        const role = seq % 2 === 0 ? 'assistant' : 'user'
        const marker = sessionId % 25 === 0 && seq === 17
          ? 'search latency preview benchmark target'
          : 'routine implementation discussion with deterministic fixture text'
        const content = `${marker} session=${sessionId} message=${seq}`
        insertMessage.run(
          sessionId,
          `${sessionId}-${seq}`,
          role,
          content,
          startedAt,
          seq,
        )
        ;(role === 'user' ? userText : assistantText).push(content)
      }

      insertSearch.run(sessionId, title, userText.join('\n'), assistantText.join('\n'))
    }
  })
  fixture()
}
