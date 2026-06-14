import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

interface GeminiToolCall {
  name?: string
  displayName?: string
}

interface GeminiMessageRecord {
  id?: string
  timestamp?: string
  type?: string
  content?: unknown
  model?: string
  toolCalls?: GeminiToolCall[]
}

interface GeminiSessionRecord {
  sessionId?: string
  startTime?: string
  lastUpdated?: string
  kind?: string
  summary?: string
  messages?: GeminiMessageRecord[]
}

const GEMINI_INDEXABLE_TYPES = new Set(['user', 'gemini', 'info', 'warning', 'error'])

export function loadGeminiSession(filePath: string): ParseSessionResult {
  const raw = readFileSync(filePath, 'utf8')
  let record: GeminiSessionRecord

  if (filePath.endsWith('.jsonl')) {
    record = { messages: [] }
    const lines = raw.split('\n').filter(l => l.trim().length > 0)
    for (const line of lines) {
      let obj: any
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }

      if (!obj || typeof obj !== 'object') continue

      // Handle standard metadata
      if ('sessionId' in obj) {
        if (obj.sessionId) record.sessionId = obj.sessionId
        if (obj.startTime) record.startTime = obj.startTime
        if (obj.lastUpdated) record.lastUpdated = obj.lastUpdated
        if (obj.kind) record.kind = obj.kind
        if (obj.summary) record.summary = obj.summary
      }

      // Helper to merge messages array
      const mergeMessages = (msgsList: any[]) => {
        for (const msg of msgsList) {
          if (!msg || typeof msg !== 'object' || !msg.id) continue
          const existingIdx = record.messages!.findIndex(m => m.id === msg.id)
          if (existingIdx >= 0) {
            record.messages![existingIdx] = { ...record.messages![existingIdx], ...msg }
          } else {
            record.messages!.push(msg)
          }
        }
      }

      // Handle $set operator
      if ('$set' in obj && obj.$set && typeof obj.$set === 'object') {
        const set = obj.$set
        if (set.lastUpdated) record.lastUpdated = set.lastUpdated
        if (set.summary) record.summary = set.summary
        if (Array.isArray(set.messages)) {
          mergeMessages(set.messages)
        }
      }

      // Handle direct message entry
      if ('id' in obj && 'type' in obj && obj.id) {
        const existingIdx = record.messages!.findIndex(m => m.id === obj.id)
        if (existingIdx >= 0) {
          record.messages![existingIdx] = { ...record.messages![existingIdx], ...obj }
        } else {
          record.messages!.push(obj)
        }
      }
    }
  } else {
    record = JSON.parse(raw) as GeminiSessionRecord
  }

  if (record.kind === 'subagent') return { kind: 'filtered' }
  if (!Array.isArray(record.messages) || record.messages.length === 0) return { kind: 'skipped' }

  const messages: ParsedMessage[] = []
  let model = ''

  for (const message of record.messages) {
    const type = message.type
    if (!type || !GEMINI_INDEXABLE_TYPES.has(type)) continue

    const contentText = stripSessionContext(extractText(message.content))
    const toolNames = extractToolNames(message.toolCalls)
    if (!contentText && toolNames.length === 0) continue

    if (type === 'gemini' && message.model) model = message.model

    messages.push({
      uuid: message.id ?? `gemini-${record.sessionId ?? 'session'}-${messages.length}`,
      parentUuid: null,
      role: toParsedRole(type),
      contentText,
      timestamp: message.timestamp ?? record.lastUpdated ?? record.startTime ?? new Date().toISOString(),
      isSidechain: false,
      toolNames,
      seq: messages.length,
    })
  }

  if (!messages.some(message => message.role === 'user' || message.role === 'assistant')) {
    return { kind: 'skipped' }
  }

  const firstUserMessage = messages.find(message => message.role === 'user' && message.contentText.trim().length > 0)
  const title = record.summary?.trim()
    || firstUserMessage?.contentText.slice(0, 120)
    || '(no title)'

  const timestamps = messages.map(message => message.timestamp).filter(Boolean).sort()
  const cwd = resolveGeminiProjectRoot(filePath)

  return {
    kind: 'parsed',
    session: {
      source: 'gemini',
      sessionUuid: record.sessionId || filePath,
      filePath,
      title,
      cwd,
      model,
      startedAt: record.startTime ?? timestamps[0] ?? new Date().toISOString(),
      endedAt: record.lastUpdated ?? timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      messages,
    },
  }
}

export function parseGeminiSession(filePath: string): ParsedSession | null {
  try {
    const result = loadGeminiSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

function toParsedRole(type: string): ParsedMessage['role'] {
  if (type === 'user') return 'user'
  if (type === 'gemini') return 'assistant'
  return 'system'
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return stripSpoolSystemPrelude(content)
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const text = (content as Record<string, unknown>)['text']
    return typeof text === 'string' ? stripSpoolSystemPrelude(text) : ''
  }
  if (!Array.isArray(content)) return ''

  return stripSpoolSystemPrelude(content
    .map(item => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const text = (item as Record<string, unknown>)['text']
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n'))
}

function stripSessionContext(text: string): string {
  let result = text
  let open = result.indexOf('<session_context>')
  while (open !== -1) {
    const close = result.indexOf('</session_context>', open + '<session_context>'.length)
    if (close === -1) break
    result = result.slice(0, open) + result.slice(close + '</session_context>'.length)
    open = result.indexOf('<session_context>')
  }
  return result.trim()
}

function extractToolNames(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return []

  return toolCalls
    .map(toolCall => {
      if (!toolCall || typeof toolCall !== 'object') return undefined
      const record = toolCall as GeminiToolCall
      return record.displayName ?? record.name
    })
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
}

function resolveGeminiProjectRoot(filePath: string): string {
  const identifier = dirname(filePath).split('/').at(-2)
  if (!identifier) return ''

  const geminiDir = getGeminiDir()
  const markerPath = join(geminiDir, 'history', identifier, '.project_root')
  if (existsSync(markerPath)) {
    try {
      return readFileSync(markerPath, 'utf8').trim()
    } catch {
      // fall through to registry lookup
    }
  }

  const projectsPath = join(geminiDir, 'projects.json')
  if (!existsSync(projectsPath)) return ''

  try {
    const rawProjects = JSON.parse(readFileSync(projectsPath, 'utf8')) as {
      projects?: Record<string, string>
    }
    const entry = Object.entries(rawProjects.projects ?? {})
      .find(([, shortId]) => shortId === identifier)
    return entry?.[0] ?? ''
  } catch {
    return ''
  }
}

function getGeminiDir(): string {
  const configuredHome = process.env['GEMINI_CLI_HOME']?.trim()
  if (configuredHome) return join(expandHome(configuredHome), '.gemini')
  return join(homedir(), '.gemini')
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}


