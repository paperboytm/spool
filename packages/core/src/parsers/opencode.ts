import Database from 'better-sqlite3'
import { basename, dirname, join } from 'node:path'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

export const OPENCODE_INDEX_VERSION = 'opencode-v2-sqlite-parent-subagents'
export const OPENCODE_DB_NAME = 'opencode.db'
const OPENCODE_SESSION_SEPARATOR = '#session='
const OPENCODE_SUBAGENT_PARENT_PREFIX = 'opencode-subagent:'
const OPENCODE_SUBAGENT_HEADER_PREFIX = 'OpenCode subagent:'
// WAL/SHM/journal sidecars share the DB's basename + a suffix; watcher events on
// them must map back to the main file so commits append to -wal (whose writes the
// main file's mtime does not reflect until checkpoint) still trigger a re-index.
const OPENCODE_DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal']
// Guards the recursive session-tree walks against pathological/corrupt parent
// chains. Real OpenCode trees are shallow (root → subagent → subagent); a cycle
// is unreachable from a NULL-parent root, but this bounds the walk regardless.
const OPENCODE_MAX_SESSION_DEPTH = 64
const sessionMtimeCache = new Map<string, Map<string, number>>()

interface OpenCodeSessionRow {
  id: string
  parent_id: string | null
  directory: string
  title: string
  time_created: number
  time_updated: number
  model: string | null
  agent: string | null
}

interface OpenCodeMessageRow {
  id: string
  time_created: number
  data: string
}

interface OpenCodePartRow {
  id: string
  message_id: string
  time_created: number
  data: string
}

interface OpenCodeMessageData {
  role?: string
  parentID?: string
  modelID?: string
  providerID?: string
  model?: {
    modelID?: string
    providerID?: string
  }
  path?: {
    cwd?: string
    root?: string
  }
}

interface OpenCodePartData {
  type?: string
  text?: string
  tool?: string
  synthetic?: boolean
}

export function makeOpenCodeSessionFilePath(dbPath: string, sessionId: string): string {
  return `${dbPath}${OPENCODE_SESSION_SEPARATOR}${encodeURIComponent(sessionId)}`
}

export function parseOpenCodeSessionFilePath(filePath: string): { dbPath: string; sessionId: string } | null {
  const idx = filePath.lastIndexOf(OPENCODE_SESSION_SEPARATOR)
  if (idx === -1) return null
  const dbPath = filePath.slice(0, idx)
  const encodedSessionId = filePath.slice(idx + OPENCODE_SESSION_SEPARATOR.length)
  if (!dbPath || !encodedSessionId) return null
  return { dbPath, sessionId: decodeURIComponent(encodedSessionId) }
}

export function isOpenCodeDatabaseFile(filePath: string): boolean {
  return basename(filePath) === OPENCODE_DB_NAME
}

/**
 * Map an OpenCode DB sidecar path (`opencode.db-wal` / `-shm` / `-journal`) back
 * to the main `opencode.db`. Non-sidecar paths are returned unchanged. The watcher
 * uses this so WAL-mode writes — which land in `-wal` and leave the main file's
 * mtime stale until checkpoint — still schedule a re-index of the database.
 */
export function normalizeOpenCodeWatchPath(filePath: string): string {
  const base = basename(filePath)
  for (const suffix of OPENCODE_DB_SIDECAR_SUFFIXES) {
    if (base === OPENCODE_DB_NAME + suffix) {
      return join(dirname(filePath), OPENCODE_DB_NAME)
    }
  }
  return filePath
}

export function listOpenCodeSessionFilePaths(dbPath: string): string[] {
  const db = openOpenCodeDb(dbPath)
  try {
    const rows = db.prepare(`
      WITH RECURSIVE active_sessions(id, root_id, time_updated, depth) AS (
        SELECT id, id AS root_id, time_updated, 0 AS depth
        FROM session
        WHERE parent_id IS NULL AND time_archived IS NULL

        UNION ALL

        SELECT child.id, active_sessions.root_id, child.time_updated, active_sessions.depth + 1
        FROM session child
        JOIN active_sessions ON child.parent_id = active_sessions.id
        WHERE child.time_archived IS NULL AND active_sessions.depth < ${OPENCODE_MAX_SESSION_DEPTH}
      )
      SELECT root_id AS id, MAX(time_updated) AS time_updated
      FROM active_sessions
      GROUP BY root_id
      ORDER BY time_updated DESC, root_id DESC
    `).all() as Array<{ id: string; time_updated: number }>
    sessionMtimeCache.set(dbPath, new Map(rows.map(row => [row.id, row.time_updated])))
    return rows.map(row => makeOpenCodeSessionFilePath(dbPath, row.id))
  } finally {
    db.close()
  }
}

export function getOpenCodeSessionIndexedMtime(filePath: string): string {
  const parsed = parseOpenCodeSessionFilePath(filePath)
  if (!parsed) {
    throw new Error(`OpenCode session path is missing ${OPENCODE_SESSION_SEPARATOR}: ${filePath}`)
  }

  const cached = sessionMtimeCache.get(parsed.dbPath)?.get(parsed.sessionId)
  if (cached !== undefined) return `${cached}::${OPENCODE_INDEX_VERSION}`

  const db = openOpenCodeDb(parsed.dbPath)
  try {
    const row = db.prepare(`
      WITH RECURSIVE descendants(id, time_updated, depth) AS (
        SELECT id, time_updated, 0 AS depth
        FROM session
        WHERE id = ? AND parent_id IS NULL AND time_archived IS NULL

        UNION ALL

        SELECT child.id, child.time_updated, descendants.depth + 1
        FROM session child
        JOIN descendants ON child.parent_id = descendants.id
        WHERE child.time_archived IS NULL AND descendants.depth < ${OPENCODE_MAX_SESSION_DEPTH}
      )
      SELECT MAX(time_updated) AS time_updated
      FROM descendants
    `).get(parsed.sessionId) as { time_updated: number } | undefined
    if (!row?.time_updated) throw new Error(`OpenCode parent session not found: ${parsed.sessionId}`)
    return `${row.time_updated}::${OPENCODE_INDEX_VERSION}`
  } finally {
    db.close()
  }
}

export function loadOpenCodeSession(filePath: string): ParseSessionResult {
  const parsedPath = parseOpenCodeSessionFilePath(filePath)
  if (!parsedPath) return { kind: 'skipped' }

  const db = openOpenCodeDb(parsedPath.dbPath)
  try {
    const session = db.prepare(`
      SELECT id, parent_id, directory, title, time_created, time_updated, model, agent
      FROM session
      WHERE id = ? AND time_archived IS NULL
    `).get(parsedPath.sessionId) as OpenCodeSessionRow | undefined

    if (!session) return { kind: 'filtered' }
    // Subagent rows (parent_id set) are folded into their parent, never indexed
    // standalone — surfacing them here would duplicate work already shown under
    // the parent. listOpenCodeSessionFilePaths only ever yields root ids, so this
    // guards the direct-load path (e.g. a stale indexed child path).
    if (session.parent_id) return { kind: 'filtered' }

    let cwd = session.directory || ''
    let model = normalizeModel(session.model)
    const messages = loadMessagesForOpenCodeSession(db, session, {
      sidechain: false,
      onCwd: value => { if (!cwd) cwd = value },
      onModel: value => { if (!model) model = value },
    })

    const childSessions = listOpenCodeChildSessions(db, session.id)
    let endedAtMs = Math.max(session.time_updated, ...childSessions.map(child => child.time_updated))

    for (const child of childSessions) {
      const groupKey = `${OPENCODE_SUBAGENT_PARENT_PREFIX}${child.id}`
      const childMessages = loadMessagesForOpenCodeSession(db, child, {
        sidechain: true,
        uuidPrefix: `${child.id}:`,
        parentUuid: groupKey,
      })
      if (childMessages.length === 0) continue
      endedAtMs = Math.max(endedAtMs, child.time_updated)
      messages.push(makeSubagentHeaderMessage(child, groupKey))
      messages.push(...childMessages)
    }

    if (messages.length === 0) return { kind: 'skipped' }
    messages.sort(compareParsedMessages)
    messages.forEach((message, index) => { message.seq = index })

    const firstUserMessage = messages.find(message => !message.isSidechain && message.role === 'user' && message.contentText.trim().length > 0)
    const title = session.title?.trim()
      || firstUserMessage?.contentText.replace(/<[^>]+>/g, '').trim().slice(0, 120)
      || '(no title)'

    return {
      kind: 'parsed',
      session: {
        source: 'opencode',
        sessionUuid: session.id,
        filePath,
        title,
        cwd,
        model,
        startedAt: toIso(session.time_created),
        endedAt: toIso(endedAtMs),
        messages,
      },
    }
  } finally {
    db.close()
  }
}

export function parseOpenCodeSession(filePath: string): ParsedSession | null {
  try {
    const result = loadOpenCodeSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

function openOpenCodeDb(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  // OpenCode may hold a write lock while checkpointing the WAL; wait briefly
  // instead of throwing SQLITE_BUSY and churning the sync error log.
  db.pragma('busy_timeout = 5000')
  return db
}

function groupPartsByMessage(partRows: OpenCodePartRow[]): Map<string, OpenCodePartRow[]> {
  const byMessage = new Map<string, OpenCodePartRow[]>()
  for (const row of partRows) {
    const list = byMessage.get(row.message_id) ?? []
    list.push(row)
    byMessage.set(row.message_id, list)
  }
  return byMessage
}

function listOpenCodeChildSessions(db: Database.Database, sessionId: string): OpenCodeSessionRow[] {
  return db.prepare(`
    WITH RECURSIVE child_sessions(
      id, parent_id, directory, title, time_created, time_updated, model, agent, depth
    ) AS (
      SELECT id, parent_id, directory, title, time_created, time_updated, model, agent, 1 AS depth
      FROM session
      WHERE parent_id = ? AND time_archived IS NULL

      UNION ALL

      SELECT child.id, child.parent_id, child.directory, child.title, child.time_created,
             child.time_updated, child.model, child.agent, child_sessions.depth + 1
      FROM session child
      JOIN child_sessions ON child.parent_id = child_sessions.id
      WHERE child.time_archived IS NULL AND child_sessions.depth < ${OPENCODE_MAX_SESSION_DEPTH}
    )
    SELECT id, parent_id, directory, title, time_created, time_updated, model, agent
    FROM child_sessions
    ORDER BY time_created ASC, depth ASC, id ASC
  `).all(sessionId) as OpenCodeSessionRow[]
}

function loadMessagesForOpenCodeSession(
  db: Database.Database,
  session: OpenCodeSessionRow,
  opts: {
    sidechain: boolean
    uuidPrefix?: string
    parentUuid?: string
    onCwd?: (value: string) => void
    onModel?: (value: string) => void
  },
): ParsedMessage[] {
  const messageRows = db.prepare(`
    SELECT id, time_created, data
    FROM message
    WHERE session_id = ?
    ORDER BY time_created ASC, id ASC
  `).all(session.id) as OpenCodeMessageRow[]

  if (messageRows.length === 0) return []

  const partRows = db.prepare(`
    SELECT id, message_id, time_created, data
    FROM part
    WHERE session_id = ?
    ORDER BY message_id ASC, time_created ASC, id ASC
  `).all(session.id) as OpenCodePartRow[]
  const partsByMessage = groupPartsByMessage(partRows)
  const messages: ParsedMessage[] = []

  for (const messageRow of messageRows) {
    const messageData = parseJson<OpenCodeMessageData>(messageRow.data)
    if (!messageData) continue

    const role = messageData.role
    if (role !== 'user' && role !== 'assistant') continue

    const cwd = messageData.path?.cwd ?? messageData.path?.root
    if (cwd) opts.onCwd?.(cwd)

    const model = modelFromMessage(messageData)
    if (model) opts.onModel?.(model)

    const parts = (partsByMessage.get(messageRow.id) ?? [])
      .map(part => parseJson<OpenCodePartData>(part.data))
      .filter((part): part is OpenCodePartData => Boolean(part))

    const contentText = extractText(parts)
    const toolNames = extractToolNames(parts)
    if (!contentText && toolNames.length === 0) continue

    messages.push({
      uuid: `${opts.uuidPrefix ?? ''}${messageRow.id}`,
      parentUuid: opts.parentUuid ?? messageData.parentID ?? null,
      role,
      contentText,
      timestamp: toIso(messageRow.time_created),
      isSidechain: opts.sidechain,
      toolNames,
      seq: messages.length,
    })
  }

  return messages
}

function makeSubagentHeaderMessage(session: OpenCodeSessionRow, groupKey: string): ParsedMessage {
  const title = session.title?.trim() || session.id
  const agent = session.agent?.trim()
  const label = agent ? `@${agent} · ${title}` : title
  return {
    uuid: `${session.id}:header`,
    parentUuid: groupKey,
    role: 'system',
    contentText: `${OPENCODE_SUBAGENT_HEADER_PREFIX} ${label}`,
    timestamp: toIso(session.time_created),
    isSidechain: true,
    toolNames: agent ? [agent] : [],
    seq: 0,
  }
}

function compareParsedMessages(a: ParsedMessage, b: ParsedMessage): number {
  const byTimestamp = a.timestamp.localeCompare(b.timestamp)
  if (byTimestamp !== 0) return byTimestamp
  if (a.isSidechain !== b.isSidechain) return a.isSidechain ? 1 : -1
  return a.uuid.localeCompare(b.uuid)
}

function extractText(parts: OpenCodePartData[]): string {
  return stripSpoolSystemPrelude(parts
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text ?? '')
    .join('\n'))
    .trim()
}

function extractToolNames(parts: OpenCodePartData[]): string[] {
  return Array.from(new Set(parts
    .filter(part => part.type === 'tool' && typeof part.tool === 'string' && part.tool.trim().length > 0)
    .map(part => part.tool!)))
}

function modelFromMessage(message: OpenCodeMessageData): string {
  const providerId = message.model?.providerID ?? message.providerID
  const modelId = message.model?.modelID ?? message.modelID
  if (providerId && modelId) return `${providerId}/${modelId}`
  return modelId ?? ''
}

function normalizeModel(model: string | null): string {
  if (!model) return ''
  return model.trim()
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function toIso(ms: number): string {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function openCodeDbPathFromSessionPath(filePath: string): string {
  return parseOpenCodeSessionFilePath(filePath)?.dbPath ?? filePath
}

export function openCodeDbDisplayPath(filePath: string): string {
  return dirname(openCodeDbPathFromSessionPath(filePath))
}
