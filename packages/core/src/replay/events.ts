import type { Message } from '../types.js'

export type ReplayEventKind =
  | 'user_prompt'
  | 'assistant_response'
  | 'system_note'
  | 'tool_call'

export interface ReplayEventBase {
  id: string
  kind: ReplayEventKind
  timestamp: string
  seq: number
  sourceMessageId?: number
  msgUuid?: string
  parentMsgUuid?: string
  parentEventId?: string
  isSidechain: boolean
}

export interface ReplayMessageEvent extends ReplayEventBase {
  kind: 'user_prompt' | 'assistant_response' | 'system_note'
  role: Message['role']
  contentText: string
  toolNames: string[]
}

export interface ReplayToolCallEvent extends ReplayEventBase {
  kind: 'tool_call'
  toolName: string
}

export type ReplayEvent = ReplayMessageEvent | ReplayToolCallEvent

export function buildReplayEvents(messages: Message[]): ReplayEvent[] {
  const sorted = [...messages].sort((a, b) => a.seq - b.seq || a.id - b.id)
  const messageEventIds = new Map<string, string>()

  for (const message of sorted) {
    if (message.msgUuid) messageEventIds.set(message.msgUuid, messageEventId(message))
  }

  return sorted.flatMap(message => {
    const parentEventId = message.parentUuid
      ? messageEventIds.get(message.parentUuid)
      : undefined
    const base = makeBaseEvent(message, parentEventId)
    const events: ReplayEvent[] = []

    events.push({
      ...base,
      kind: messageKind(message.role),
      role: message.role,
      contentText: message.contentText,
      toolNames: message.toolNames,
    })

    message.toolNames.forEach((toolName, index) => {
      events.push({
        id: `${messageEventId(message)}:tool:${index}`,
        kind: 'tool_call',
        timestamp: message.timestamp,
        seq: message.seq,
        ...(message.id ? { sourceMessageId: message.id } : {}),
        ...(message.msgUuid ? { msgUuid: message.msgUuid } : {}),
        ...(message.parentUuid ? { parentMsgUuid: message.parentUuid } : {}),
        parentEventId: messageEventId(message),
        isSidechain: message.isSidechain,
        toolName,
      })
    })

    return events
  })
}

function makeBaseEvent(message: Message, parentEventId: string | undefined): ReplayEventBase {
  return {
    id: messageEventId(message),
    kind: messageKind(message.role),
    timestamp: message.timestamp,
    seq: message.seq,
    ...(message.id ? { sourceMessageId: message.id } : {}),
    ...(message.msgUuid ? { msgUuid: message.msgUuid } : {}),
    ...(message.parentUuid ? { parentMsgUuid: message.parentUuid } : {}),
    ...(parentEventId ? { parentEventId } : {}),
    isSidechain: message.isSidechain,
  }
}

function messageEventId(message: Message): string {
  if (message.msgUuid) return `message:${message.msgUuid}`
  return `message:${message.sessionId}:${message.seq}`
}

function messageKind(role: Message['role']): ReplayMessageEvent['kind'] {
  if (role === 'user') return 'user_prompt'
  if (role === 'assistant') return 'assistant_response'
  return 'system_note'
}
