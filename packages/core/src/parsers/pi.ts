import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

// v1: initial pi support — session header + message records from
// ~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl.
export const PI_INDEX_VERSION = 'pi-v1-session-search-fts'

interface PiContentBlock {
  type?: string
  text?: string
  name?: string
}

interface PiMessagePayload {
  role?: string
  content?: unknown
  model?: string
}

interface PiRecord {
  type?: string
  id?: string
  parentId?: string | null
  timestamp?: string
  cwd?: string
  modelId?: string
  message?: PiMessagePayload
}

/** Parses a pi agent session log (JSONL, session format v3).
 *
 *  A file is one linear event log: a `session` header line (id, cwd,
 *  start timestamp), then `message` records whose payload role is
 *  `user`, `assistant`, or `toolResult`, interleaved with settings
 *  events (`model_change`, `thinking_level_change`). Only user and
 *  assistant messages are indexed — `toolResult` records carry tool
 *  output, and pi assistant messages already name their tool calls
 *  via `toolCall` content blocks. */
export function loadPiSession(filePath: string): ParseSessionResult {
  const raw = readFileSync(filePath, 'utf8')

  let sessionUuid = ''
  let cwd = ''
  let headerStartedAt = ''
  let model = ''
  const messages: ParsedMessage[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as PiRecord

    if (record.type === 'session') {
      if (typeof record.id === 'string') sessionUuid = record.id
      if (typeof record.cwd === 'string') cwd = record.cwd
      if (typeof record.timestamp === 'string') headerStartedAt = record.timestamp
      continue
    }

    if (record.type === 'model_change') {
      if (typeof record.modelId === 'string' && record.modelId) model = record.modelId
      continue
    }

    if (record.type !== 'message' || !record.message || typeof record.message !== 'object') continue

    const role = record.message.role
    if (role !== 'user' && role !== 'assistant') continue

    const contentText = extractText(record.message.content)
    const toolNames = extractToolNames(record.message.content)
    if (!contentText && toolNames.length === 0) continue

    if (role === 'assistant' && typeof record.message.model === 'string' && record.message.model) {
      model = record.message.model
    }

    messages.push({
      uuid: typeof record.id === 'string' && record.id
        ? record.id
        : `pi-${sessionUuid || basename(filePath)}-${messages.length}`,
      parentUuid: typeof record.parentId === 'string' ? record.parentId : null,
      role,
      contentText,
      timestamp: record.timestamp ?? headerStartedAt ?? new Date().toISOString(),
      isSidechain: false,
      toolNames,
      seq: messages.length,
    })
  }

  if (messages.length === 0) return { kind: 'skipped' }

  const firstUserMessage = messages.find(message => message.role === 'user' && message.contentText.trim().length > 0)
  const title = firstUserMessage?.contentText.trim().slice(0, 120) || '(no title)'

  return {
    kind: 'parsed',
    session: {
      source: 'pi',
      sessionUuid: sessionUuid || sessionUuidFromFileName(filePath),
      filePath,
      title,
      cwd,
      model,
      startedAt: headerStartedAt || messages[0]!.timestamp,
      endedAt: messages[messages.length - 1]!.timestamp,
      messages,
    },
  }
}

export function parsePiSession(filePath: string): ParsedSession | null {
  try {
    const result = loadPiSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return stripSpoolSystemPrelude(content).trim()
  if (!Array.isArray(content)) return ''

  return stripSpoolSystemPrelude(content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const { type, text } = block as PiContentBlock
      return type === 'text' && typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n'))
    .trim()
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []

  return Array.from(new Set(content
    .map(block => {
      if (!block || typeof block !== 'object') return undefined
      const { type, name } = block as PiContentBlock
      return type === 'toolCall' && typeof name === 'string' && name.trim().length > 0 ? name : undefined
    })
    .filter((name): name is string => typeof name === 'string')))
}

/** Decode a pi session directory slug to a display path.
 *  e.g. '--Users-claw-code-spool--' → '/Users/claw/code/spool'
 *  Note: lossy for paths containing hyphens — prefer cwd from the header. */
export function decodePiSessionDirSlug(slug: string): string {
  const withoutPrefix = slug.replace(/^-+/, '')
  let end = withoutPrefix.length
  while (end > 0 && withoutPrefix[end - 1] === '-') end--
  const trimmed = withoutPrefix.slice(0, end)
  if (!trimmed) return slug
  return '/' + trimmed.replace(/-/g, '/')
}

/** Session files are named `<timestamp>_<uuid>.jsonl`; recover the uuid
 *  when a truncated/rewritten file lost its `session` header line. */
function sessionUuidFromFileName(filePath: string): string {
  const name = basename(filePath, '.jsonl')
  const underscore = name.indexOf('_')
  if (underscore === -1) return filePath
  const candidate = name.slice(underscore + 1)
  return candidate.length > 0 ? candidate : filePath
}
