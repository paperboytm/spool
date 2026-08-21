import { basename, dirname, join } from 'node:path'

import type Database from 'better-sqlite3'

import { openDatabase } from '../db/native-binding.js'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

export const ZCODE_INDEX_VERSION = 'zcode-v1-session-model'
export const ZCODE_DB_NAME = 'db.sqlite'
const ZCODE_SESSION_SEPARATOR = '#session='
const ZCODE_SUBAGENT_PARENT_PREFIX = 'zcode-subagent:'
const ZCODE_SUBAGENT_HEADER_PREFIX = 'ZCode subagent:'
// WAL/SHM/journal sidecars share the DB's basename + a suffix; watcher events on
// them must map back to the main file so commits appended to -wal (whose writes
// the main file's mtime does not reflect until checkpoint) still trigger a
// re-index.
const ZCODE_DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal']
// Guards the recursive subagent walks against pathological/corrupt parent
// chains. Real ZCode trees are shallow (root → subagent → subagent); a cycle is
// unreachable from a root, but this bounds the walk regardless.
const ZCODE_MAX_SESSION_DEPTH = 64
// ZCode stores every session in one table and distinguishes them by
// task_type: 'interactive' rows are primary conversations, 'subagent_child'
// rows belong to a parent conversation and are folded into it, and
// 'fork'/'selection_side_chat' rows own a copied message history that deserves
// its own index entry. Older rows may carry no task_type at all; treat those
// as primary conversations.
const ZCODE_SUBAGENT_TASK_TYPE = 'subagent_child'
const sessionMtimeCache = new Map<string, Map<string, number>>()

interface ZCodeSessionRow {
  id: string
  parent_id: string | null
  directory: string
  title: string
  task_type: string | null
  time_created: number
  time_updated: number
}

interface ZCodeMessageRow {
  id: string
  time_created: number
  data: string
}

interface ZCodePartRow {
  id: string
  message_id: string
  time_created: number
  data: string
}

interface ZCodeMessageData {
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

interface ZCodePartData {
  type?: string
  text?: string
  tool?: string
}

export function makeZCodeSessionFilePath(dbPath: string, sessionId: string): string {
  return `${dbPath}${ZCODE_SESSION_SEPARATOR}${encodeURIComponent(sessionId)}`
}

export function parseZCodeSessionFilePath(
  filePath: string,
): { dbPath: string; sessionId: string } | null {
  const idx = filePath.lastIndexOf(ZCODE_SESSION_SEPARATOR)
  if (idx === -1) return null
  const dbPath = filePath.slice(0, idx)
  const encodedSessionId = filePath.slice(idx + ZCODE_SESSION_SEPARATOR.length)
  if (!dbPath || !encodedSessionId) return null
  return { dbPath, sessionId: decodeURIComponent(encodedSessionId) }
}

export function isZCodeDatabaseFile(filePath: string): boolean {
  return basename(filePath) === ZCODE_DB_NAME
}

/**
 * Map a ZCode DB sidecar path (`db.sqlite-wal` / `-shm` / `-journal`) back to
 * the main `db.sqlite`. Non-sidecar paths are returned unchanged. The watcher
 * uses this so WAL-mode writes — which land in `-wal` and leave the main
 * file's mtime stale until checkpoint — still schedule a re-index of the
 * database.
 */
export function normalizeZCodeWatchPath(filePath: string): string {
  const base = basename(filePath)
  for (const suffix of ZCODE_DB_SIDECAR_SUFFIXES) {
    if (base === ZCODE_DB_NAME + suffix) {
      return join(dirname(filePath), ZCODE_DB_NAME)
    }
  }
  return filePath
}

export function listZCodeSessionFilePaths(dbPath: string): string[] {
  const db = openZCodeDb(dbPath)
  try {
    const rows = db
      .prepare(`
      WITH RECURSIVE active_sessions(id, root_id, time_updated, depth) AS (
        SELECT id, id AS root_id, time_updated, 0 AS depth
        FROM session
        WHERE COALESCE(task_type, '') <> '${ZCODE_SUBAGENT_TASK_TYPE}'
          AND time_archived IS NULL

        UNION ALL

        SELECT child.id, active_sessions.root_id, child.time_updated, active_sessions.depth + 1
        FROM session child
        JOIN active_sessions ON child.parent_id = active_sessions.id
        WHERE child.task_type = '${ZCODE_SUBAGENT_TASK_TYPE}'
          AND child.time_archived IS NULL
          AND active_sessions.depth < ${ZCODE_MAX_SESSION_DEPTH}
      )
      SELECT root_id AS id, MAX(time_updated) AS time_updated
      FROM active_sessions
      GROUP BY root_id
      ORDER BY time_updated DESC, root_id DESC
    `)
      .all() as Array<{ id: string; time_updated: number }>
    sessionMtimeCache.set(dbPath, new Map(rows.map((row) => [row.id, row.time_updated])))
    return rows.map((row) => makeZCodeSessionFilePath(dbPath, row.id))
  } finally {
    db.close()
  }
}

export function getZCodeSessionIndexedMtime(filePath: string): string {
  const parsed = parseZCodeSessionFilePath(filePath)
  if (!parsed) {
    throw new Error(`ZCode session path is missing ${ZCODE_SESSION_SEPARATOR}: ${filePath}`)
  }

  const cached = sessionMtimeCache.get(parsed.dbPath)?.get(parsed.sessionId)
  if (cached !== undefined) return `${cached}::${ZCODE_INDEX_VERSION}`

  const db = openZCodeDb(parsed.dbPath)
  try {
    const row = db
      .prepare(`
      WITH RECURSIVE descendants(id, time_updated, depth) AS (
        SELECT id, time_updated, 0 AS depth
        FROM session
        WHERE id = ?
          AND COALESCE(task_type, '') <> '${ZCODE_SUBAGENT_TASK_TYPE}'
          AND time_archived IS NULL

        UNION ALL

        SELECT child.id, child.time_updated, descendants.depth + 1
        FROM session child
        JOIN descendants ON child.parent_id = descendants.id
        WHERE child.task_type = '${ZCODE_SUBAGENT_TASK_TYPE}'
          AND child.time_archived IS NULL
          AND descendants.depth < ${ZCODE_MAX_SESSION_DEPTH}
      )
      SELECT MAX(time_updated) AS time_updated
      FROM descendants
    `)
      .get(parsed.sessionId) as { time_updated: number } | undefined
    if (!row?.time_updated) throw new Error(`ZCode root session not found: ${parsed.sessionId}`)
    return `${row.time_updated}::${ZCODE_INDEX_VERSION}`
  } finally {
    db.close()
  }
}

function stripHtmlTags(value: string): string {
  let result = ''
  let insideTag = false
  for (const char of value) {
    if (char === '<') {
      insideTag = true
    } else if (char === '>') {
      insideTag = false
    } else if (!insideTag) {
      result += char
    }
  }
  return result
}

export function loadZCodeSession(filePath: string): ParseSessionResult {
  const parsedPath = parseZCodeSessionFilePath(filePath)
  if (!parsedPath) return { kind: 'skipped' }

  const db = openZCodeDb(parsedPath.dbPath)
  try {
    const session = db
      .prepare(`
      SELECT id, parent_id, directory, title, task_type, time_created, time_updated
      FROM session
      WHERE id = ? AND time_archived IS NULL
    `)
      .get(parsedPath.sessionId) as ZCodeSessionRow | undefined

    if (!session) return { kind: 'filtered' }
    // Subagent rows are folded into their root conversation, never indexed
    // standalone — surfacing them here would duplicate work already shown
    // under the parent. listZCodeSessionFilePaths only ever yields root ids,
    // so this guards the direct-load path (e.g. a stale indexed child path).
    if (session.task_type === ZCODE_SUBAGENT_TASK_TYPE) return { kind: 'filtered' }

    const cwd = session.directory || ''
    let model = ''
    const messages = loadMessagesForZCodeSession(db, session, {
      sidechain: false,
      onModel: (value) => {
        if (!model) model = value
      },
    })

    const childSessions = listZCodeSubagentSessions(db, session.id)
    let endedAtMs = Math.max(
      session.time_updated,
      ...childSessions.map((child) => child.time_updated),
    )

    for (const child of childSessions) {
      const groupKey = `${ZCODE_SUBAGENT_PARENT_PREFIX}${child.id}`
      const childMessages = loadMessagesForZCodeSession(db, child, {
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
    messages.forEach((message, index) => {
      message.seq = index
    })

    const firstUserMessage = messages.find(
      (message) =>
        !message.isSidechain && message.role === 'user' && message.contentText.trim().length > 0,
    )
    const derivedTitle = firstUserMessage
      ? stripHtmlTags(firstUserMessage.contentText).trim().slice(0, 120)
      : ''
    const title = session.title?.trim() || derivedTitle || '(no title)'

    return {
      kind: 'parsed',
      session: {
        source: 'zcode',
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

export function parseZCodeSession(filePath: string): ParsedSession | null {
  try {
    const result = loadZCodeSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

function openZCodeDb(dbPath: string): Database.Database {
  const db = openDatabase(dbPath, { readonly: true, fileMustExist: true })
  // ZCode may hold a write lock while checkpointing the WAL; wait briefly
  // instead of throwing SQLITE_BUSY and churning the sync error log.
  db.pragma('busy_timeout = 5000')
  return db
}

function groupPartsByMessage(partRows: ZCodePartRow[]): Map<string, ZCodePartRow[]> {
  const byMessage = new Map<string, ZCodePartRow[]>()
  for (const row of partRows) {
    const list = byMessage.get(row.message_id) ?? []
    list.push(row)
    byMessage.set(row.message_id, list)
  }
  return byMessage
}

function listZCodeSubagentSessions(db: Database.Database, sessionId: string): ZCodeSessionRow[] {
  return db
    .prepare(`
    WITH RECURSIVE child_sessions(
      id, parent_id, directory, title, task_type, time_created, time_updated, depth
    ) AS (
      SELECT id, parent_id, directory, title, task_type, time_created, time_updated, 1 AS depth
      FROM session
      WHERE parent_id = ?
        AND task_type = '${ZCODE_SUBAGENT_TASK_TYPE}'
        AND time_archived IS NULL

      UNION ALL

      SELECT child.id, child.parent_id, child.directory, child.title, child.task_type,
             child.time_created, child.time_updated, child_sessions.depth + 1
      FROM session child
      JOIN child_sessions ON child.parent_id = child_sessions.id
      WHERE child.task_type = '${ZCODE_SUBAGENT_TASK_TYPE}'
        AND child.time_archived IS NULL
        AND child_sessions.depth < ${ZCODE_MAX_SESSION_DEPTH}
    )
    SELECT id, parent_id, directory, title, task_type, time_created, time_updated
    FROM child_sessions
    ORDER BY time_created ASC, depth ASC, id ASC
  `)
    .all(sessionId) as ZCodeSessionRow[]
}

function loadMessagesForZCodeSession(
  db: Database.Database,
  session: ZCodeSessionRow,
  opts: {
    sidechain: boolean
    uuidPrefix?: string
    parentUuid?: string
    onModel?: (value: string) => void
  },
): ParsedMessage[] {
  const messageRows = db
    .prepare(`
    SELECT id, time_created, data
    FROM message
    WHERE session_id = ?
    ORDER BY time_created ASC, id ASC
  `)
    .all(session.id) as ZCodeMessageRow[]

  if (messageRows.length === 0) return []

  const partRows = db
    .prepare(`
    SELECT id, message_id, time_created, data
    FROM part
    WHERE session_id = ?
    ORDER BY message_id ASC, time_created ASC, id ASC
  `)
    .all(session.id) as ZCodePartRow[]
  const partsByMessage = groupPartsByMessage(partRows)
  const messages: ParsedMessage[] = []

  for (const messageRow of messageRows) {
    const messageData = parseJson<ZCodeMessageData>(messageRow.data)
    if (!messageData) continue

    const role = messageData.role
    if (role !== 'user' && role !== 'assistant') continue

    const model = modelFromMessage(messageData)
    if (model) opts.onModel?.(model)

    const parts = (partsByMessage.get(messageRow.id) ?? [])
      .map((part) => parseJson<ZCodePartData>(part.data))
      .filter((part): part is ZCodePartData => Boolean(part))

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

function makeSubagentHeaderMessage(session: ZCodeSessionRow, groupKey: string): ParsedMessage {
  const title = session.title?.trim() || session.id
  return {
    uuid: `${session.id}:header`,
    parentUuid: groupKey,
    role: 'system',
    contentText: `${ZCODE_SUBAGENT_HEADER_PREFIX} ${title}`,
    timestamp: toIso(session.time_created),
    isSidechain: true,
    toolNames: [],
    seq: 0,
  }
}

function compareParsedMessages(a: ParsedMessage, b: ParsedMessage): number {
  const byTimestamp = a.timestamp.localeCompare(b.timestamp)
  if (byTimestamp !== 0) return byTimestamp
  if (a.isSidechain !== b.isSidechain) return a.isSidechain ? 1 : -1
  return a.uuid.localeCompare(b.uuid)
}

function extractText(parts: ZCodePartData[]): string {
  return stripSpoolSystemPrelude(
    parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('\n'),
  ).trim()
}

function extractToolNames(parts: ZCodePartData[]): string[] {
  return Array.from(
    new Set(
      parts
        .filter(
          (part) =>
            part.type === 'tool' && typeof part.tool === 'string' && part.tool.trim().length > 0,
        )
        .map((part) => part.tool!),
    ),
  )
}

function modelFromMessage(message: ZCodeMessageData): string {
  const providerId = message.model?.providerID ?? message.providerID
  const modelId = message.model?.modelID ?? message.modelID
  if (providerId && modelId) return `${providerId}/${modelId}`
  return modelId ?? ''
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
