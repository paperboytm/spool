import { describe, expect, it } from 'vitest'

import { buildRows, makeDividerLabel } from './message-list.js'
import { DEFAULT_LABELS, type ConversationMessage } from './types.js'

function msg(overrides: Partial<ConversationMessage> & { id: number }): ConversationMessage {
  return {
    parentUuid: null,
    role: 'user',
    contentText: `message ${overrides.id}`,
    timestamp: '2026-07-16T10:00:00.000Z',
    isSidechain: false,
    toolNames: [],
    ...overrides,
  }
}

const label = makeDividerLabel('Today', 'Yesterday', 'en-US')

describe('buildRows', () => {
  it('suppresses the leading divider and groups avatars by role run', () => {
    const rows = buildRows([
      msg({ id: 1, role: 'user' }),
      msg({ id: 2, role: 'assistant' }),
      msg({ id: 3, role: 'assistant' }),
    ], label)
    expect(rows.map((row) => row.kind)).toEqual(['msg', 'msg', 'msg'])
    expect(rows.flatMap((row) => (row.kind === 'msg' ? [row.showAvatar] : [])))
      .toEqual([true, true, false])
  })

  it('inserts one divider per local-day transition', () => {
    const rows = buildRows([
      msg({ id: 1, timestamp: '2026-07-14T22:00:00.000Z' }),
      msg({ id: 2, timestamp: '2026-07-16T09:00:00.000Z' }),
      msg({ id: 3, timestamp: '2026-07-16T10:00:00.000Z' }),
    ], label)
    expect(rows.map((row) => row.kind)).toEqual(['msg', 'divider', 'msg', 'msg'])
  })

  it('collapses a sidechain into one expandable row and drops its header message', () => {
    const rows = buildRows([
      msg({ id: 1 }),
      msg({ id: 2, isSidechain: true, parentUuid: 'sc-1', role: 'system', contentText: 'OpenCode subagent: Research task' }),
      msg({ id: 3, isSidechain: true, parentUuid: 'sc-1', role: 'assistant', contentText: 'working…' }),
      msg({ id: 4 }),
    ], label)
    expect(rows.map((row) => row.kind)).toEqual(['msg', 'sidechain', 'msg'])
    const sidechain = rows[1]
    if (sidechain?.kind !== 'sidechain') throw new Error('expected sidechain row')
    expect(sidechain.label).toBe('Research task')
    expect(sidechain.messages.map((message) => message.id)).toEqual([3])
  })

  it('default labels pluralize in English', () => {
    expect(DEFAULT_LABELS.messagesCount(1)).toBe('1 message')
    expect(DEFAULT_LABELS.messagesCount(3)).toBe('3 messages')
  })
})
