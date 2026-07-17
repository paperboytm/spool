// Hub records → the exact message list the desktop renders. The parsing
// brain is @spool-lab/session-kit's provider parsers (the same code the
// desktop indexer wraps), so what you read on spool.pro is what you'd see
// opening the session in the app.

import {
  parseClaudeSessionText,
  parseCodexSessionLines,
  type ParsedMessage,
} from '@spool-lab/session-kit'
import type { ConversationMessage } from '@spool-lab/session-view'

import type { HubRecordLine } from './hub-api'

export interface ParsedConversation {
  messages: ConversationMessage[]
  title: string
  /** Sequence index of every record → the message to scroll to for it. */
  recordToMessageId: Map<number, number>
}

export function parseHubConversation(
  provider: 'claude' | 'codex',
  records: readonly HubRecordLine[],
): ParsedConversation {
  const lines = records.map((record) => record.data)
  const result = provider === 'claude'
    ? parseClaudeSessionText(lines.join('\n'), 'hub')
    : parseCodexSessionLines(lines, 'hub')

  if (result.kind !== 'parsed') {
    return { messages: [], title: '', recordToMessageId: new Map() }
  }

  const messages: ConversationMessage[] = result.session.messages.map((message) => ({
    id: message.seq,
    parentUuid: message.parentUuid,
    role: message.role,
    contentText: message.contentText,
    timestamp: message.timestamp,
    isSidechain: message.isSidechain,
    toolNames: message.toolNames,
  }))

  return {
    messages,
    title: result.session.title,
    recordToMessageId: mapRecordsToMessages(records, result.session.messages),
  }
}

/**
 * Deep links and diff hunks address RECORD indices; the conversation
 * renders MESSAGES (a filtered projection — tool plumbing collapses,
 * some records vanish). Claude records carry the same uuid as their
 * message; codex messages are matched by timestamp. Records with no
 * message of their own resolve to the nearest preceding message, which
 * is where their effect is visible in the conversation.
 */
function mapRecordsToMessages(
  records: readonly HubRecordLine[],
  messages: readonly ParsedMessage[],
): Map<number, number> {
  const byUuid = new Map<string, number>()
  const byTimestamp = new Map<string, number>()
  for (const message of messages) {
    byUuid.set(message.uuid, message.seq)
    if (!message.isSidechain && !byTimestamp.has(message.timestamp)) {
      byTimestamp.set(message.timestamp, message.seq)
    }
  }

  const map = new Map<number, number>()
  let last = messages[0]?.seq ?? 0
  for (const record of records) {
    let target: number | undefined
    try {
      const parsed = JSON.parse(record.data) as { uuid?: unknown; timestamp?: unknown }
      if (typeof parsed.uuid === 'string') target = byUuid.get(parsed.uuid)
      if (target === undefined && typeof parsed.timestamp === 'string') {
        target = byTimestamp.get(parsed.timestamp)
      }
    } catch {
      // Unparseable record: stick with the last resolved message.
    }
    if (target !== undefined) last = target
    map.set(record.i, target ?? last)
  }
  return map
}
