import { describe, expect, it } from 'vitest'
import type { Message } from '../types.js'
import { buildReplayEvents } from './events.js'

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    sessionId: 10,
    msgUuid: null,
    parentUuid: null,
    role: 'user',
    contentText: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    isSidechain: false,
    toolNames: [],
    seq: 0,
    ...overrides,
  }
}

describe('buildReplayEvents', () => {
  it('normalizes user, assistant, and system messages into replay events', () => {
    const events = buildReplayEvents([
      message({ id: 1, msgUuid: 'u1', role: 'user', contentText: 'Fix login', seq: 0 }),
      message({ id: 2, msgUuid: 'a1', role: 'assistant', contentText: 'I will inspect it.', seq: 1 }),
      message({ id: 3, msgUuid: 's1', role: 'system', contentText: 'Summary', seq: 2 }),
    ])

    expect(events.map(event => event.kind)).toEqual([
      'user_prompt',
      'assistant_response',
      'system_note',
    ])
    expect(events[0]).toMatchObject({
      id: 'message:u1',
      role: 'user',
      contentText: 'Fix login',
      sourceMessageId: 1,
    })
  })

  it('preserves Claude parent links as parent event ids when possible', () => {
    const events = buildReplayEvents([
      message({ id: 1, msgUuid: 'u1', role: 'user', contentText: 'Start', seq: 0 }),
      message({ id: 2, msgUuid: 'a1', parentUuid: 'u1', role: 'assistant', contentText: 'Done', seq: 1 }),
    ])

    expect(events[1]).toMatchObject({
      id: 'message:a1',
      parentMsgUuid: 'u1',
      parentEventId: 'message:u1',
    })
  })

  it('expands tool names into child tool_call events', () => {
    const events = buildReplayEvents([
      message({
        id: 4,
        msgUuid: 'a-tool',
        role: 'assistant',
        contentText: 'I need to inspect files.',
        toolNames: ['Read', 'Grep'],
        seq: 0,
      }),
    ])

    expect(events.map(event => event.kind)).toEqual([
      'assistant_response',
      'tool_call',
      'tool_call',
    ])
    expect(events[1]).toMatchObject({
      id: 'message:a-tool:tool:0',
      parentEventId: 'message:a-tool',
      toolName: 'Read',
    })
    expect(events[2]).toMatchObject({
      id: 'message:a-tool:tool:1',
      parentEventId: 'message:a-tool',
      toolName: 'Grep',
    })
  })

  it('uses a stable fallback id for messages without UUIDs', () => {
    const events = buildReplayEvents([
      message({ id: 8, sessionId: 44, msgUuid: null, role: 'assistant', contentText: 'Hello', seq: 3 }),
    ])

    expect(events[0]?.id).toBe('message:44:3')
  })

  it('keeps tool-only assistant messages visible as tool calls', () => {
    const events = buildReplayEvents([
      message({ id: 9, msgUuid: 'tool-only', role: 'assistant', contentText: '', toolNames: ['Bash'], seq: 0 }),
    ])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'assistant_response',
      id: 'message:tool-only',
      contentText: '',
    })
    expect(events[1]).toMatchObject({
      kind: 'tool_call',
      id: 'message:tool-only:tool:0',
      toolName: 'Bash',
      parentEventId: 'message:tool-only',
    })
  })
})
