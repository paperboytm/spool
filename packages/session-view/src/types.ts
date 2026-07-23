/**
 * The minimal message shape the conversation views need. Structurally a
 * subset of @spool-lab/core's `Message`, so local preparation code can pass
 * rows straight through; the Web reader assembles the same shape from Hub
 * records via @spool-lab/session-kit.
 */
export interface ConversationMessage {
  /** Stable numeric id within the rendered list (row keys, find-anchors). */
  id: number
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  contentText: string
  timestamp: string
  isSidechain: boolean
  toolNames: string[]
}

/** UI strings the list needs; consumers localize, defaults are English. */
export interface MessageListLabels {
  today: string
  yesterday: string
  /** e.g. (3) => '3 messages' */
  messagesCount: (count: number) => string
}

export const DEFAULT_LABELS: MessageListLabels = {
  today: 'Today',
  yesterday: 'Yesterday',
  messagesCount: (count) => (count === 1 ? '1 message' : `${count} messages`),
}
