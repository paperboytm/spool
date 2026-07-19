import { serializePortableSession } from '@spool-lab/session-kit'

import type { Message, Session } from './types.js'

type ShareableIndexedSession = Pick<
  Session,
  'source' | 'sessionUuid' | 'filePath' | 'title' | 'cwd' | 'model' | 'startedAt' | 'endedAt'
>

/**
 * Convert the provider-neutral records already held in the local index into
 * the portable Hub JSONL format. This is the sharing source for agents
 * whose native records cannot currently be materialized by `spool resume`.
 */
export function serializeIndexedSession(
  session: ShareableIndexedSession,
  messages: readonly Message[],
): string {
  return serializePortableSession({
    source: session.source,
    sessionUuid: session.sessionUuid,
    filePath: session.filePath,
    title: session.title ?? '(no title)',
    cwd: session.cwd ?? '',
    model: session.model ?? '',
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messages: messages.map((message) => ({
      uuid: message.msgUuid ?? `${session.source}-${session.sessionUuid}-${message.seq}`,
      parentUuid: message.parentUuid,
      role: message.role,
      contentText: message.contentText,
      timestamp: message.timestamp,
      isSidechain: message.isSidechain,
      toolNames: message.toolNames,
      seq: message.seq,
    })),
  })
}
