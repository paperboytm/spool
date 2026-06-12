import { describe, it, expect, vi } from 'vitest'
import { decodeSnapshot } from './snapshot-to-conversation'
import type { Snapshot } from '../lib/types'

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    schema_version: 1,
    source: { kind: 'spool-session', captured_at: '2026-06-12T00:00:00.000Z' },
    conversation: {
      title: 'Hi',
      turns: [
        { id: 't0', role: 'user', content: 'hello' },
        { id: 't1', role: 'assistant', content: 'world' },
      ],
      turn_order: ['t0', 't1'],
      hidden_turns: [],
    },
    editor_opts: {
      template: 'chat',
      paper: 'snow',
      typeface: 'inter',
      colorway: 'amber',
      density: 'compact',
      masthead: true,
      colophon: true,
      avatars: true,
      show_byline: false,
    },
    ...over,
  }
}

describe('decodeSnapshot — schema_version guard', () => {
  it('decodes a version-1 snapshot without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { conversation } = decodeSnapshot(snapshot())
    expect(conversation.turns.map((t) => t.body)).toEqual(['hello', 'world'])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('best-effort decodes an unknown future version and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Simulate a snapshot written by a newer client.
    const future = snapshot({ schema_version: 2 as unknown as 1 })
    const { conversation } = decodeSnapshot(future)
    // Does not throw; still produces a usable conversation.
    expect(conversation.turns.map((t) => t.body)).toEqual(['hello', 'world'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('schema_version')
    warn.mockRestore()
  })
})
