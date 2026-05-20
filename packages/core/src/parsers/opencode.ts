import Database from 'better-sqlite3'
import { basename, dirname } from 'node:path'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

export const OPENCODE_INDEX_VERSION = 'opencode-v1-sqlite-session-search-fts'
export const OPENCODE_DB_NAME = 'opencode.db'
const OPENCODE_SESSION_SEPARATOR = '#session='
const sessionMtimeCache = new Map<string, Map<string, number>>()

interface OpenCodeSessionRow {
  id: string
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

export function listOpenCodeSessionFilePaths(dbPath: string): string[] {
  const db = openOpenCodeDb(dbPath)
  try {
    const rows = db.prepare(`
      SELECT id, time_updated
      FROM session
      WHERE time_archived IS NULL
      ORDER BY time_updated DESC, id DESC
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
      SELECT time_updated
      FROM session
      WHERE id = ? AND time_archived IS NULL
    `).get(parsed.sessionId) as { time_updated: number } | undefined
    if (!row) throw new Error(`OpenCode session not found: ${parsed.sessionId}`)
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
      SELECT id, directory, title, time_created, time_updated, model, agent
      FROM session
      WHERE id = ? AND time_archived IS NULL
    `).get(parsedPath.sessionId) as OpenCodeSessionRow | undefined

    if (!session) return { kind: 'filtered' }

    const messageRows = db.prepare(`
      SELECT id, time_created, data
      FROM message
      WHERE session_id = ?
      ORDER BY time_created ASC, id ASC
    `).all(session.id) as OpenCodeMessageRow[]

    if (messageRows.length === 0) return { kind: 'skipped' }

    const partRows = db.prepare(`
      SELECT id, message_id, time_created, data
      FROM part
      WHERE session_id = ?
      ORDER BY message_id ASC, time_created ASC, id ASC
    `).all(session.id) as OpenCodePartRow[]
    const partsByMessage = groupPartsByMessage(partRows)

    const messages: ParsedMessage[] = []
    let cwd = session.directory || ''
    let model = normalizeModel(session.model)

    for (const messageRow of messageRows) {
      const messageData = parseJson<OpenCodeMessageData>(messageRow.data)
      if (!messageData) continue

      const role = messageData.role
      if (role !== 'user' && role !== 'assistant') continue

      if (!cwd) cwd = messageData.path?.cwd ?? messageData.path?.root ?? ''
      if (!model) model = modelFromMessage(messageData)

      const parts = (partsByMessage.get(messageRow.id) ?? [])
        .map(part => parseJson<OpenCodePartData>(part.data))
        .filter((part): part is OpenCodePartData => Boolean(part))

      const contentText = extractText(parts)
      const toolNames = extractToolNames(parts)
      if (!contentText && toolNames.length === 0) continue

      messages.push({
        uuid: messageRow.id,
        parentUuid: messageData.parentID ?? null,
        role,
        contentText,
        timestamp: toIso(messageRow.time_created),
        isSidechain: false,
        toolNames,
        seq: messages.length,
      })
    }

    if (messages.length === 0) return { kind: 'skipped' }

    const firstUserMessage = messages.find(message => message.role === 'user' && message.contentText.trim().length > 0)
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
        endedAt: toIso(session.time_updated),
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
  return new Database(dbPath, { readonly: true, fileMustExist: true })
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
