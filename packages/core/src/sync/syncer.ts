import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type Database from 'better-sqlite3'
import { loadClaudeSession, decodeProjectSlug } from '../parsers/claude.js'
import { loadCodexSession, CODEX_INDEX_VERSION } from '../parsers/codex.js'
import { loadGeminiSession } from '../parsers/gemini.js'
import type { SessionSource } from '../types.js'
import { getSessionRoots, isSessionFileForSource } from './source-paths.js'
import {
  deleteSessionByFilePath,
  getSourceId,
  getOrCreateProject,
  getSessionMtime,
  getAllSessionMtimes,
  upsertSession,
  upsertSessionSearch,
  insertMessages,
} from '../db/queries.js'
import type { ParsedMessage, SyncResult } from '../types.js'
import { computeIdentity } from '../projects/identity.js'
import { realFs } from '../projects/fs.js'

export interface SyncProgressEvent {
  phase: 'scanning' | 'syncing' | 'indexing' | 'done'
  count: number
  total: number
}

export type SyncEventCallback = (event: SyncProgressEvent) => void

/** Fired after `syncFile` commits a session's messages. Consumers
 *  (the scan worker hookup in main process) invalidate the session's
 *  scan_profile and re-enqueue it — necessary because offsets in
 *  the findings table point into the now-mutated `messages.content_text`.
 *  Receives the sessions.id, NOT the session_uuid. */
export type SessionChangedCallback = (sessionId: number) => void

export class Syncer {
  private db: Database.Database
  private onProgress: SyncEventCallback | undefined
  private onSessionChanged: SessionChangedCallback | undefined
  private codexTitleIndex: Map<string, string> = new Map()

  constructor(
    db: Database.Database,
    onProgress?: SyncEventCallback,
    onSessionChanged?: SessionChangedCallback,
  ) {
    this.db = db
    this.onProgress = onProgress
    this.onSessionChanged = onSessionChanged
  }

  syncAll(): SyncResult {
    const seenPaths = new Set<string>()
    const files: Array<{ path: string; source: SessionSource }> = []

    for (const source of ['claude', 'codex', 'gemini'] as const) {
      for (const dir of getSessionRoots(source)) {
        try { addUniqueFiles(files, seenPaths, collectSessionFiles(dir, source)) } catch { /* dir may not exist */ }
      }
    }

    const knownMtimes = getAllSessionMtimes(this.db)
    this.codexTitleIndex = loadCodexSessionIndex()

    const pendingFiles = files.flatMap(f => {
      const existing = knownMtimes.get(f.path)
      try {
        const indexedMtime = getIndexedMtime(f.path, f.source)
        if (existing === indexedMtime) return []
        return [{ ...f, indexedMtime }]
      } catch {
        return []
      }
    })
    pendingFiles.sort((a, b) => b.indexedMtime.localeCompare(a.indexedMtime))

    this.onProgress?.({ phase: 'scanning', count: 0, total: files.length })
    if (pendingFiles.length > 0) {
      this.onProgress?.({ phase: 'syncing', count: 0, total: pendingFiles.length })
    }

    const isBulk = pendingFiles.length > 100

    // For bulk syncs (e.g. first launch), drop FTS triggers and rebuild at the end.
    // FTS5 segment merges on per-row triggers cause significant write amplification;
    // a single rebuild after all inserts is ~3x faster.
    if (isBulk) {
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_insert')
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_delete')
    }

    let added = 0
    let updated = 0
    let errors = 0

    try {
      const BATCH = 20
      for (let i = 0; i < pendingFiles.length; i += BATCH) {
        const batch = pendingFiles.slice(i, i + BATCH)
        for (const file of batch) {
          const result = this.syncFile(file.path, file.source, knownMtimes, file.indexedMtime)
          if (result === 'added') added++
          else if (result === 'updated') updated++
          else if (result === 'error') errors++
        }
        this.onProgress?.({ phase: 'syncing', count: Math.min(i + BATCH, pendingFiles.length), total: pendingFiles.length })
      }

      this.applyCodexTitles()
    } finally {
      if (isBulk) {
        this.onProgress?.({ phase: 'indexing', count: 0, total: 0 })
        this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
        this.db.exec("INSERT INTO messages_fts_trigram(messages_fts_trigram) VALUES('rebuild')")
        this.db.exec(`
          CREATE TRIGGER messages_fts_insert
          AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content_text) VALUES(NEW.id, NEW.content_text);
            INSERT INTO messages_fts_trigram(rowid, content_text) VALUES(NEW.id, NEW.content_text);
          END
        `)
        this.db.exec(`
          CREATE TRIGGER messages_fts_delete
          AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content_text)
              VALUES('delete', OLD.id, OLD.content_text);
            INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text)
              VALUES('delete', OLD.id, OLD.content_text);
          END
        `)
      }
    }

    this.onProgress?.({ phase: 'done', count: pendingFiles.length, total: pendingFiles.length })
    return { added, updated, errors }
  }

  private applyCodexTitles(): void {
    if (this.codexTitleIndex.size === 0) return
    const stmt = this.db.prepare(
      `UPDATE sessions SET title = ?
         WHERE session_uuid = ? AND title != ? AND title_source = 'derived'`,
    )
    this.db.transaction(() => {
      for (const [uuid, title] of this.codexTitleIndex) {
        stmt.run(title, uuid, title)
      }
    })()
  }

  syncFile(filePath: string, source: SessionSource, knownMtimes?: Map<string, string>, precomputedMtime?: string): 'added' | 'updated' | 'skipped' | 'error' {
    try {
      const mtime = precomputedMtime ?? getIndexedMtime(filePath, source)
      const existingMtime = knownMtimes
        ? (knownMtimes.get(filePath) ?? null)
        : getSessionMtime(this.db, filePath)
      if (existingMtime === mtime) return 'skipped'

      const parseResult = source === 'claude'
        ? loadClaudeSession(filePath)
        : source === 'codex'
          ? loadCodexSession(filePath)
          : loadGeminiSession(filePath)

      if (parseResult.kind !== 'parsed') {
        if (parseResult.kind === 'filtered' && existingMtime !== null) {
          this.db.prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'ok', ?)
          `).run(getSourceId(this.db, source), filePath, 'filtered from index')
          deleteSessionByFilePath(this.db, filePath)
          return 'updated'
        }
        return 'skipped'
      }
      const parsed = parseResult.session

      if (source === 'codex') {
        const codexTitle = this.codexTitleIndex.get(parsed.sessionUuid)
        if (codexTitle) parsed.title = codexTitle
      }

      const sourceId = getSourceId(this.db, source)
      const { slug: rawSlug, displayPath, displayName } = resolveProject(filePath, source, parsed.cwd)
      const identity = computeIdentity(parsed.cwd || null, realFs)
      // Synthetic identities deduplicate by identity key, not by per-cwd slug,
      // so every matching session converges to a single project row instead
      // of accumulating one row per scratch dir.
      const slug = identity.kind === 'synthetic' ? identity.key : rawSlug
      const projectId = getOrCreateProject(
        this.db, sourceId, slug,
        identity.displayPath ?? displayPath,
        identity.displayName || displayName,
        { identityKind: identity.kind, identityKey: identity.key },
      )

      const isNew = existingMtime === null
      const hasToolUse = parsed.messages.some(m => m.toolNames.length > 0)

      let committedSessionId: number | null = null
      this.db.transaction(() => {
        const sessionId = upsertSession(this.db, {
          projectId,
          sourceId,
          sessionUuid: parsed.sessionUuid,
          filePath,
          title: parsed.title,
          startedAt: parsed.startedAt,
          endedAt: parsed.endedAt,
          messageCount: parsed.messages.filter(m => !m.isSidechain).length,
          hasToolUse,
          cwd: parsed.cwd,
          model: parsed.model,
          rawFileMtime: mtime,
        })

        insertMessages(this.db, sessionId, sourceId, parsed.messages)
        upsertSessionSearch(this.db, {
          sessionId,
          title: parsed.title,
          userText: buildSessionSearchText(parsed.messages, 'user'),
          assistantText: buildSessionSearchText(parsed.messages, 'assistant'),
        })

        // Security Scan cascade: messages.content_text changed, so any
        // existing findings now have stale offsets. Drop scan_profile
        // inside the same transaction so a crash between here and the
        // worker re-enqueue still leaves the session in "needs scan".
        this.db.prepare(
          `UPDATE sessions SET scan_profile = NULL, scan_completed_at = NULL WHERE id = ?`,
        ).run(sessionId)

        this.db.prepare(`
          INSERT INTO sync_log (source_id, file_path, status)
          VALUES (?, ?, 'ok')
        `).run(sourceId, filePath)
        committedSessionId = sessionId
      })()

      if (committedSessionId !== null && this.onSessionChanged) {
        try { this.onSessionChanged(committedSessionId) } catch { /* swallow callback errors */ }
      }
      return isNew ? 'added' : 'updated'
    } catch (err) {
      try {
        const sourceRow = this.db
          .prepare('SELECT id FROM sources WHERE name = ?')
          .get(source) as { id: number } | undefined
        if (sourceRow) {
          this.db.prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'error', ?)
          `).run(sourceRow.id, filePath, String(err))
        }
      } catch { /* ignore log errors */ }
      return 'error'
    }
  }
}

function addUniqueFiles(
  files: Array<{ path: string; source: SessionSource }>,
  seenPaths: Set<string>,
  candidates: Array<{ path: string; source: SessionSource }>,
): void {
  for (const candidate of candidates) {
    if (seenPaths.has(candidate.path)) continue
    seenPaths.add(candidate.path)
    files.push(candidate)
  }
}

function getMtime(filePath: string): string {
  return statSync(filePath).mtime.toISOString()
}

function getIndexedMtime(filePath: string, source: SessionSource): string {
  return `${getMtime(filePath)}::${getIndexVersion(source)}`
}

function getIndexVersion(source: SessionSource): string {
  if (source === 'codex') return CODEX_INDEX_VERSION
  if (source === 'gemini') return 'gemini-v1-session-search-fts'
  return 'claude-v3-session-search-fts'
}

function collectSessionFiles(
  dir: string,
  source: SessionSource,
): Array<{ path: string; source: SessionSource }> {
  const results: Array<{ path: string; source: SessionSource }> = []
  walkDir(dir, dir, results, source)
  return results
}

function walkDir(
  dir: string,
  root: string,
  results: Array<{ path: string; source: SessionSource }>,
  source: SessionSource,
): void {
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (source === 'gemini' && !shouldTraverseGeminiDir(dir, fullPath, entry.name)) continue
      // For claude, session files only live at <root>/<slug>/<uuid>.jsonl. Anything
      // deeper is subagent / future-nested scratch data that hijacks the parent
      // sessionId — see isSessionFileForSource for the matching read-side check.
      if (source === 'claude' && dirname(fullPath) !== root) continue
      walkDir(fullPath, root, results, source)
    } else if (entry.isFile() && isSessionFileForSource(source, fullPath, root)) {
      results.push({ path: fullPath, source })
    }
  }
}

function shouldTraverseGeminiDir(parentDir: string, fullPath: string, entryName: string): boolean {
  if (entryName === 'chats') return true
  if (basename(parentDir) === 'tmp') return true
  if (/(?:^|\/)chats(?:\/|$)/.test(parentDir)) return true
  return existsSync(join(fullPath, 'chats'))
}

function loadCodexSessionIndex(): Map<string, string> {
  const titles = new Map<string, string>()
  try {
    const raw = readFileSync(join(homedir(), '.codex', 'session_index.jsonl'), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { id?: string; thread_name?: string }
        if (rec.id && rec.thread_name) titles.set(rec.id, rec.thread_name)
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file may not exist */ }
  return titles
}

function buildSessionSearchText(messages: ParsedMessage[], role: 'user' | 'assistant'): string {
  return messages
    .filter(message => !message.isSidechain && message.role === role)
    .map(message => message.contentText.trim())
    .filter(Boolean)
    .join('\n')
}

function resolveProject(
  filePath: string,
  source: SessionSource,
  cwd: string,
): { slug: string; displayPath: string; displayName: string } {
  const home = homedir()

  if (source === 'claude') {
    // ~/.claude/projects/{slug}/{uuid}.jsonl
    const slug = basename(dirname(filePath))
    const displayPath = cwd || decodeProjectSlug(slug)
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? slug
    return { slug, displayPath, displayName }
  } else if (source === 'codex') {
    // ~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-...jsonl
    // Group by cwd (project working dir)
    const displayPath = cwd || home
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? 'codex'
    const slug = displayPath.replace(/^\//, '').replace(/\//g, '-') || 'default'
    return { slug, displayPath, displayName }
  }

  const projectIdentifier = dirname(filePath).split('/').at(-2) ?? 'gemini'
  const displayPath = cwd || projectIdentifier
  const parts = displayPath.split('/').filter(Boolean)
  const displayName = parts[parts.length - 1] ?? projectIdentifier
  const slug = cwd
    ? displayPath.replace(/^\//, '').replace(/\//g, '-')
    : projectIdentifier
  return { slug: slug || projectIdentifier, displayPath, displayName }
}
