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
})
