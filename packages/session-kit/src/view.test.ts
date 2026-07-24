import { describe, expect, it } from 'vite-plus/test'

import { serializePortableSession } from './messages.js'
import { splitRecords } from './records.js'
import { deriveView } from './view.js'

const line = (value: unknown): string => JSON.stringify(value)
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength

describe('deriveView', () => {
  it('derives conversation evidence for portable Pi records without fabricating edit evidence', () => {
    const records = splitRecords(
      serializePortableSession({
        source: 'pi',
        sessionUuid: 'pi-session',
        filePath: '/sessions/pi.jsonl',
        title: 'Pi share',
        cwd: '/workspace',
        model: 'pi-model',
        startedAt: '2026-07-19T01:00:00.000Z',
        endedAt: '2026-07-19T01:00:05.000Z',
        messages: [
          {
            uuid: 'u1',
            parentUuid: null,
            role: 'user',
            contentText: 'Please share this',
            timestamp: '2026-07-19T01:00:00.000Z',
            isSidechain: false,
            toolNames: [],
            seq: 0,
          },
          {
            uuid: 'a1',
            parentUuid: 'u1',
            role: 'assistant',
            contentText: 'Done',
            timestamp: '2026-07-19T01:00:05.000Z',
            isSidechain: false,
            toolNames: ['write'],
            seq: 1,
          },
        ],
      }),
    )

    const view = deriveView(records, { provider: 'pi' })

    expect(view.firstPrompt).toBe('Please share this')
    expect(view.lastReply).toBe('Done')
    expect(view.outline).toEqual([{ i: 0, excerpt: 'Please share this' }])
    expect(view.diffstat).toEqual({ files: 0, adds: 0, dels: 0 })
  })

  it('derives the v1 view, diffstat, outline, and byte-capped excerpts', () => {
    const firstPrompt = `start:${'x'.repeat(5_000)}`
    const lastReply = `done:${'界'.repeat(2_000)}`
    const records = [
      line({
        type: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        message: { role: 'user', content: firstPrompt },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'edit-1',
              name: 'Edit',
              input: { file_path: '$SPOOL_WS/src/a.ts', old_string: 'old', new_string: 'new' },
            },
          ],
        },
      }),
      line({
        type: 'user',
        timestamp: '2026-01-01T00:00:02Z',
        toolUseResult: { originalFile: 'old\n' },
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'updated' }],
        },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:03Z',
        message: { role: 'assistant', content: [{ type: 'text', text: lastReply }] },
      }),
    ]

    const view = deriveView(records, { provider: 'claude' })

    expect(view.v).toBe(1)
    expect(view.index.map((entry) => entry.kind)).toEqual(['user', 'edit', 'tool', 'assistant'])
    expect(view.files).toEqual([{ path: 'src/a.ts', events: [1, 2], adds: 1, dels: 1 }])
    expect(view.diffstat).toEqual({ files: 1, adds: 1, dels: 1 })
    expect(view.outline[0]?.i).toBe(0)
    expect(view.firstPrompt.startsWith('start:')).toBe(true)
    expect(view.lastReply.startsWith('done:')).toBe(true)
    expect(byteLength(view.firstPrompt)).toBeLessThanOrEqual(4_096)
    expect(byteLength(view.lastReply)).toBeLessThanOrEqual(4_096)
    expect(byteLength(view.index[0]?.excerpt ?? '')).toBeLessThanOrEqual(4_096)
    expect(byteLength(view.index[3]?.excerpt ?? '')).toBeLessThanOrEqual(4_096)
  })

  it('uses assistant prose co-located with an edit call as the last reply', () => {
    const records = [
      line({ type: 'user', message: { role: 'user', content: 'please edit' } }),
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I made the requested change.' },
            {
              type: 'tool_use',
              id: 'edit-1',
              name: 'Edit',
              input: { file_path: '$SPOOL_WS/src/a.ts', old_string: 'old', new_string: 'new' },
            },
          ],
        },
      }),
      line({
        type: 'user',
        toolUseResult: { originalFile: 'old\n' },
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'updated' }],
        },
      }),
    ]

    const view = deriveView('claude', records)

    expect(view.index[1]).toMatchObject({ kind: 'edit', excerpt: 'I made the requested change.' })
    expect(view.lastReply).toBe('I made the requested change.')
  })

  it('accumulates per-model Claude usage, deduping streamed chunks by message id', () => {
    const records = [
      line({ type: 'user', message: { role: 'user', content: 'do the thing' } }),
      line({
        type: 'assistant',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'chunk one' }],
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      // Streamed continuation of the same message id: cumulative totals win.
      line({
        type: 'assistant',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'chunk two' }],
          usage: {
            input_tokens: 100,
            output_tokens: 25,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      line({
        type: 'assistant',
        message: {
          id: 'msg_2',
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: 'fast reply' }],
          usage: {
            input_tokens: 7,
            output_tokens: 3,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ]

    const view = deriveView('claude', records)

    expect(view.usage).toEqual({
      models: {
        'claude-sonnet-4-5-20250929': { input: 100, output: 25, cacheRead: 40, cacheWrite: 10 },
        'claude-haiku-4-5-20251001': { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      records: 2,
    })
  })

  it('treats prototype-like model names as data without polluting Object.prototype', () => {
    const records = [
      line({
        type: 'assistant',
        message: {
          id: 'msg_proto_1',
          role: 'assistant',
          model: '__proto__',
          content: [{ type: 'text', text: 'first' }],
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      }),
      line({
        type: 'assistant',
        message: {
          id: 'msg_proto_2',
          role: 'assistant',
          model: '__proto__',
          content: [{ type: 'text', text: 'second' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      }),
    ]

    const view = deriveView('claude', records)

    expect(Object.prototype.hasOwnProperty.call(view.usage?.models, '__proto__')).toBe(true)
    expect(view.usage?.models['__proto__']).toEqual({
      input: 15,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(({} as { input?: number }).input).toBeUndefined()
  })

  it('leaves usage undefined when no record carries usage data', () => {
    const records = [
      line({ type: 'user', message: { role: 'user', content: 'hello' } }),
      line({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      }),
    ]

    const view = deriveView('claude', records)

    expect(view.usage).toBeUndefined()
    expect('usage' in view).toBe(false)
  })

  it('skips malformed usage values without throwing', () => {
    const records = [
      // All fields malformed: record does not count as carrying usage.
      line({
        type: 'assistant',
        message: {
          id: 'msg_bad',
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'bad usage' }],
          usage: {
            input_tokens: 'many',
            output_tokens: -3,
            cache_read_input_tokens: Number.NaN,
          },
        },
      }),
      // usage present but model missing: skipped.
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'no model' }],
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      }),
      // usage is not an object: skipped.
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'string usage' }],
          usage: 'lots',
        },
      }),
      // Partially malformed: bad fields count as 0, good fields survive.
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'partial' }],
          usage: { input_tokens: 12, output_tokens: 'oops', cache_read_input_tokens: -1 },
        },
      }),
    ]

    const view = deriveView('claude', records)

    expect(view.usage).toEqual({
      models: {
        'claude-sonnet-4-5-20250929': { input: 12, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      records: 1,
    })
  })

  it('accumulates Codex token_count events against the active turn_context model', () => {
    const records = [
      line({
        timestamp: '2026-04-05T12:00:01Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', cwd: '/tmp/project' },
      }),
      line({
        timestamp: '2026-04-05T12:00:02Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Count some tokens.' },
      }),
      line({
        timestamp: '2026-04-05T12:00:03Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 900, output_tokens: 90, cached_input_tokens: 800 },
            last_token_usage: { input_tokens: 500, output_tokens: 40, cached_input_tokens: 450 },
          },
        },
      }),
      line({
        timestamp: '2026-04-05T12:00:04Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4-mini', cwd: '/tmp/project' },
      }),
      line({
        timestamp: '2026-04-05T12:00:05Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 60 },
          },
        },
      }),
      // token_count with null info (e.g. context compaction): skipped.
      line({
        timestamp: '2026-04-05T12:00:06Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: null },
      }),
    ]

    const view = deriveView('codex', records)

    expect(view.usage).toEqual({
      models: {
        'gpt-5.4': { input: 50, output: 40, cacheRead: 450, cacheWrite: 0 },
        'gpt-5.4-mini': { input: 40, output: 10, cacheRead: 60, cacheWrite: 0 },
      },
      records: 2,
    })
  })

  it('leaves usage undefined for Codex sessions without token_count events', () => {
    const records = [
      line({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'No usage here.' },
      }),
      line({
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Indeed.' },
      }),
      // token_count before any turn_context: no model to attribute, skipped.
      line({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } },
        },
      }),
    ]

    const view = deriveView('codex', records)

    expect(view.usage).toBeUndefined()
  })
})
