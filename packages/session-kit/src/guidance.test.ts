import { describe, expect, it } from 'vite-plus/test'

import { PORTABLE_MESSAGE_TYPE, serializePortableSession } from './messages.js'
import { isSessionGuidanceV1, type IndexedRecord } from './types.js'
import { deriveView, extractGuidanceRecord, MAX_SESSION_GUIDANCE_TURNS } from './view.js'

const line = (value: unknown): string => JSON.stringify(value)
const indexed = (i: number, value: unknown): IndexedRecord => ({ i, data: line(value) })

describe('deriveView guidance', () => {
  it('groups main-chain Claude replies and counts tool_use calls without counting results', () => {
    const records = [
      indexed(100, {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Unprompted.' },
            { type: 'tool_use', name: 'Read' },
          ],
        },
      }),
      indexed(101, {
        type: 'user',
        isSidechain: true,
        message: { role: 'user', content: 'Subagent instruction' },
      }),
      indexed(102, {
        type: 'assistant',
        isSidechain: true,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Subagent response' },
            { type: 'tool_use', name: 'Grep' },
          ],
        },
      }),
      indexed(103, {
        type: 'user',
        message: { role: 'user', content: 'Please make the change.' },
      }),
      indexed(104, {
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: 'Synthetic skill instructions.' },
      }),
      indexed(105, {
        type: 'user',
        message: {
          role: 'user',
          content:
            '<task-notification><task-id>task-1</task-id><status>done</status></task-notification>',
        },
      }),
      indexed(106, {
        type: 'user',
        message: { role: 'user', content: '[Request interrupted by user for tool use]' },
      }),
      indexed(107, {
        type: 'user',
        message: {
          role: 'user',
          content:
            '<local-command-caveat>Generated while running a command.</local-command-caveat>',
        },
      }),
      indexed(108, {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '完成🙂' },
            { type: 'tool_use', name: 'Read' },
            { type: 'tool_use', name: 'Edit' },
          ],
        },
      }),
      indexed(109, {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }],
        },
      }),
      indexed(110, {
        type: 'assistant',
        message: { role: 'assistant', content: '  Done.  ' },
      }),
      indexed(111, {
        type: 'user',
        message: { role: 'user', content: 'Verify it.' },
      }),
    ]

    expect(deriveView('claude', records).guidance).toEqual({
      v: 1,
      turns: [
        {
          promptRecord: 103,
          replyRecords: [108, 110],
          replyChars: 8,
          toolCalls: 2,
        },
        {
          promptRecord: 111,
          replyRecords: [],
          replyChars: 0,
          toolCalls: 0,
        },
      ],
    })
  })

  it('uses only Codex event messages for prose and response_item call records for tools', () => {
    const records = [
      indexed(10, {
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'before_prompt' },
      }),
      indexed(11, {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Inspect the implementation.' },
      }),
      indexed(12, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Duplicate response.' }],
        },
      }),
      indexed(13, {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'commentary', message: '先检查。' },
      }),
      indexed(14, {
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec_command' },
      }),
      indexed(15, {
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', output: 'ok' },
      }),
      indexed(16, {
        type: 'response_item',
        payload: { type: 'function_call', name: 'apply_patch' },
      }),
      indexed(161, {
        type: 'response_item',
        payload: { type: 'tool_search_call', name: 'search_tools' },
      }),
      indexed(162, {
        type: 'response_item',
        payload: { type: 'tool_search_output', output: 'ok' },
      }),
      indexed(17, {
        type: 'response_item',
        payload: { type: 'function_call_output', output: 'ok' },
      }),
      indexed(18, {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'final_answer', message: '完成🙂' },
      }),
      indexed(19, {
        type: 'response_item',
        payload: { type: 'user_message', message: 'Not a primary prompt.' },
      }),
      indexed(20, {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Run the tests.' },
      }),
      indexed(21, {
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'test' },
      }),
      indexed(22, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Another duplicate.' }],
        },
      }),
    ]

    expect(deriveView('codex', records).guidance).toEqual({
      v: 1,
      turns: [
        {
          promptRecord: 11,
          replyRecords: [13, 18],
          replyChars: 7,
          toolCalls: 3,
        },
        {
          promptRecord: 20,
          replyRecords: [],
          replyChars: 0,
          toolCalls: 1,
        },
      ],
    })
  })

  it('supports portable records while excluding sidechains and blank prompts', () => {
    const raw = serializePortableSession({
      source: 'pi',
      sessionUuid: 'portable-guidance',
      filePath: '/portable.jsonl',
      title: 'Portable guidance',
      cwd: '/workspace',
      model: 'pi-model',
      startedAt: '2026-07-25T00:00:00.000Z',
      endedAt: '2026-07-25T00:00:06.000Z',
      messages: [
        {
          uuid: 'side-user',
          parentUuid: null,
          role: 'user',
          contentText: 'Sidechain prompt',
          timestamp: '2026-07-25T00:00:00.000Z',
          isSidechain: true,
          toolNames: [],
          seq: 0,
        },
        {
          uuid: 'user-1',
          parentUuid: null,
          role: 'user',
          contentText: 'Do it.',
          timestamp: '2026-07-25T00:00:01.000Z',
          isSidechain: false,
          toolNames: [],
          seq: 1,
        },
        {
          uuid: 'assistant-1',
          parentUuid: 'user-1',
          role: 'assistant',
          contentText: 'A🙂',
          timestamp: '2026-07-25T00:00:02.000Z',
          isSidechain: false,
          toolNames: ['read', 'write'],
          seq: 2,
        },
        {
          uuid: 'assistant-tools',
          parentUuid: 'user-1',
          role: 'assistant',
          contentText: '',
          timestamp: '2026-07-25T00:00:03.000Z',
          isSidechain: false,
          toolNames: ['test'],
          seq: 3,
        },
        {
          uuid: 'blank-user',
          parentUuid: null,
          role: 'user',
          contentText: '   ',
          timestamp: '2026-07-25T00:00:04.000Z',
          isSidechain: false,
          toolNames: [],
          seq: 4,
        },
        {
          uuid: 'user-2',
          parentUuid: null,
          role: 'user',
          contentText: 'Again.',
          timestamp: '2026-07-25T00:00:05.000Z',
          isSidechain: false,
          toolNames: [],
          seq: 5,
        },
        {
          uuid: 'assistant-2',
          parentUuid: 'user-2',
          role: 'assistant',
          contentText: '好',
          timestamp: '2026-07-25T00:00:06.000Z',
          isSidechain: false,
          toolNames: [],
          seq: 6,
        },
      ],
    })
    const records = raw
      .trim()
      .split('\n')
      .map((data, i): IndexedRecord => ({ i: i + 50, data }))

    expect(deriveView('pi', records).guidance).toEqual({
      v: 1,
      turns: [
        {
          promptRecord: 51,
          replyRecords: [52],
          replyChars: 2,
          toolCalls: 3,
        },
        {
          promptRecord: 55,
          replyRecords: [56],
          replyChars: 1,
          toolCalls: 0,
        },
      ],
    })
  })

  it('omits an oversized convenience projection without blocking the Session view', () => {
    const records = Array.from({ length: MAX_SESSION_GUIDANCE_TURNS + 1 }, (_, index) =>
      indexed(index, {
        type: 'event_msg',
        payload: { type: 'user_message', message: `Instruction ${index}` },
      }),
    )

    const view = deriveView('codex', records)

    expect(view.guidance).toBeUndefined()
    expect(view.outline).toHaveLength(MAX_SESSION_GUIDANCE_TURNS + 1)
  })
})

describe('isSessionGuidanceV1', () => {
  it('accepts sparse ordered projections and rejects unsafe or crossing indices', () => {
    expect(
      isSessionGuidanceV1({
        v: 1,
        turns: [
          { promptRecord: 2, replyRecords: [4, 9], replyChars: 12, toolCalls: 3 },
          { promptRecord: 12, replyRecords: [], replyChars: 0, toolCalls: 0 },
        ],
      }),
    ).toBe(true)

    expect(
      isSessionGuidanceV1({
        v: 1,
        turns: [
          { promptRecord: 2, replyRecords: [4, 12], replyChars: 12, toolCalls: 3 },
          { promptRecord: 12, replyRecords: [], replyChars: 0, toolCalls: 0 },
        ],
      }),
    ).toBe(false)
    expect(
      isSessionGuidanceV1({
        v: 1,
        turns: [{ promptRecord: 2, replyRecords: [2], replyChars: 1, toolCalls: 0 }],
      }),
    ).toBe(false)
    expect(
      isSessionGuidanceV1({
        v: 1,
        turns: [{ promptRecord: 2.5, replyRecords: [], replyChars: 0, toolCalls: 0 }],
      }),
    ).toBe(false)
    expect(isSessionGuidanceV1({ v: 2, turns: [] })).toBe(false)
  })
})

describe('extractGuidanceRecord', () => {
  it('extracts headerless portable records without a whole-Session parse', () => {
    const assistant = line({
      type: PORTABLE_MESSAGE_TYPE,
      isSidechain: false,
      message: { role: 'assistant', content: '  Portable reply 🙂  ', toolNames: ['read'] },
    })

    expect(extractGuidanceRecord('pi', assistant)).toEqual({
      role: 'assistant',
      text: 'Portable reply 🙂',
    })
  })

  it('uses the same primary-stream visibility rules as the projection', () => {
    const claudeToolResult = line({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'hidden' }],
      },
    })
    const codexDuplicate = line({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Duplicate response.' }],
      },
    })
    const codexVisible = indexed(92, {
      type: 'event_msg',
      payload: { type: 'agent_message', message: '  Visible reply.  ' },
    })

    expect(extractGuidanceRecord('claude', claudeToolResult)).toBeNull()
    expect(extractGuidanceRecord('codex', codexDuplicate)).toBeNull()
    expect(extractGuidanceRecord('codex', codexVisible)).toEqual({
      role: 'assistant',
      text: 'Visible reply.',
    })
    expect(extractGuidanceRecord('codex', '{not json')).toBeNull()
  })
})
