import { readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'

export const ANTIGRAVITY_INDEX_VERSION = 'antigravity-v1-jsonl-transcript'

interface AntigravityStep {
  step_index: number
  source: string
  type: string
  status: string
  created_at: string
  content?: string | null
  thinking?: string | null
  tool_calls?: Array<{ name: string; args?: Record<string, unknown> }> | null
}

function cleanUserContent(content: string): string {
  const startTag = '<USER_REQUEST>'
  const endTag = '</USER_REQUEST>'
  const startIdx = content.indexOf(startTag)
  if (startIdx >= 0) {
    const endIdx = content.indexOf(endTag)
    if (endIdx > startIdx) {
      const start = startIdx + startTag.length
      return content.slice(start, endIdx).trim()
    }
  }
  return content.trim()
}

// Check for explicit GEMINI_CLI_HOME or ANTIGRAVITY_CLI_HOME.
// This matches standard path expansion.
function getAntigravityCliRoot(): string {
  const explicit = process.env['ANTIGRAVITY_CLI_HOME']?.trim()
  if (explicit) return expandHome(explicit)

  const configuredHome = process.env['GEMINI_CLI_HOME']?.trim()
  if (configuredHome) {
    const resolved = expandHome(configuredHome)
    if (basename(resolved) === 'antigravity-cli') return resolved
    return join(resolved, '.gemini', 'antigravity-cli')
  }

  return join(homedir(), '.gemini', 'antigravity-cli')
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}

function getHistoryConversationCwds(): Map<string, string> {
  const cliRoot = getAntigravityCliRoot()
  const mappings = new Map<string, string>()

  // Load ONLY from history.jsonl
  const historyPath = join(cliRoot, 'history.jsonl')
  try {
    if (existsSync(historyPath)) {
      const raw = readFileSync(historyPath, 'utf8')
      const lines = raw.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          const cid = data.conversationId
          const ws = data.workspace
          if (cid && typeof cid === 'string') {
            mappings.set(cid, typeof ws === 'string' ? ws : '')
          }
        } catch {
          // Ignore parse errors on individual lines
        }
      }
    }
  } catch {
    // Ignore history load failure
  }

  return mappings
}

function extractConversationId(filePath: string): string {
  // .../brain/<conversation-id>/.system_generated/logs/transcript.jsonl
  const parts = filePath.split('/')
  const logsIdx = parts.lastIndexOf('logs')
  if (logsIdx >= 3) {
    return parts[logsIdx - 2]! // conversation-id is 2 levels above logs/
  }
  return ''
}

export function loadAntigravitySession(filePath: string): ParseSessionResult {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim().length > 0)
  const messages: ParsedMessage[] = []
  let model = ''

  const conversationId = extractConversationId(filePath)

  const historyCwds = getHistoryConversationCwds()
  if (!historyCwds.has(conversationId)) {
    return { kind: 'skipped' }
  }

  for (const line of lines) {
    let step: AntigravityStep
    try {
      step = JSON.parse(line) as AntigravityStep
    } catch {
      continue
    }

    const { type, content, created_at: timestamp } = step
    if (!type || !timestamp) continue

    if (type === 'CONVERSATION_HISTORY') continue

    if (type === 'USER_INPUT') {
      const text = cleanUserContent(content ?? '')
      if (text) {
        messages.push({
          uuid: `agy-${conversationId}-${step.step_index}`,
          parentUuid: null,
          role: 'user',
          contentText: text,
          timestamp,
          isSidechain: false,
          toolNames: [],
          seq: messages.length,
        })
      }
      continue
    }

    if (type === 'PLANNER_RESPONSE') {
      const text = (content ?? '').trim()
      const toolNames = (step.tool_calls ?? [])
        .map(tc => tc.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
      if (text || toolNames.length > 0) {
        messages.push({
          uuid: `agy-${conversationId}-${step.step_index}`,
          parentUuid: null,
          role: 'assistant',
          contentText: text,
          timestamp,
          isSidechain: false,
          toolNames,
          seq: messages.length,
        })
      }
      continue
    }
  }

  if (messages.length === 0) return { kind: 'skipped' }

  const cliCwds = getHistoryConversationCwds()
  const cwd = cliCwds.get(conversationId) || ''

  const firstUserMsg = messages.find(m => m.role === 'user' && m.contentText.trim().length > 0)
  const title = firstUserMsg?.contentText.slice(0, 120) ?? `Antigravity ${conversationId.slice(0, 8)}`

  const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort()

  return {
    kind: 'parsed',
    session: {
      source: 'antigravity',
      sessionUuid: conversationId || filePath,
      filePath,
      title,
      cwd,
      model: model || '',
      startedAt: timestamps[0] ?? new Date().toISOString(),
      endedAt: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      messages,
    },
  }
}

export function parseAntigravitySession(filePath: string): ParsedSession | null {
  try {
    const result = loadAntigravitySession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}
