import { describe, it, expect } from 'vitest'
import type { Session } from '@spool-lab/core'
import { insertSessionSorted } from './sessionSort.js'

function s(partial: Partial<Session> & { sessionUuid: string; startedAt: string }): Session {
  return {
    id: 0,
    projectId: 1,
    sourceId: 1,
    sessionUuid: partial.sessionUuid,
    filePath: '',
    title: partial.title ?? null,
    startedAt: partial.startedAt,
    endedAt: partial.startedAt,
    messageCount: partial.messageCount ?? 1,
    hasToolUse: false,
    cwd: null,
    model: null,
    source: 'claude',
    projectDisplayPath: '',
    projectDisplayName: '',
  }
}

describe('insertSessionSorted', () => {
  it('inserts at the correct DESC position for "recent"', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z' }),
      s({ sessionUuid: 'b', startedAt: '2026-05-08T00:00:00Z' }),
      s({ sessionUuid: 'c', startedAt: '2026-05-05T00:00:00Z' }),
    ]
    const candidate = s({ sessionUuid: 'x', startedAt: '2026-05-09T00:00:00Z' })
    const out = insertSessionSorted(list, candidate, 'recent', true)
    expect(out.map(r => r.sessionUuid)).toEqual(['a', 'x', 'b', 'c'])
  })

  it('drops candidate older than the last loaded row when not exhausted', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z' }),
      s({ sessionUuid: 'b', startedAt: '2026-05-08T00:00:00Z' }),
    ]
    const candidate = s({ sessionUuid: 'x', startedAt: '2026-05-01T00:00:00Z' })
    expect(insertSessionSorted(list, candidate, 'recent', false)).toBe(list)
  })

  it('appends candidate older than the last loaded row when exhausted', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z' }),
      s({ sessionUuid: 'b', startedAt: '2026-05-08T00:00:00Z' }),
    ]
    const candidate = s({ sessionUuid: 'x', startedAt: '2026-05-01T00:00:00Z' })
    const out = insertSessionSorted(list, candidate, 'recent', true)
    expect(out.map(r => r.sessionUuid)).toEqual(['a', 'b', 'x'])
  })

  it('sorts by message_count then started_at for "most_messages"', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z', messageCount: 100 }),
      s({ sessionUuid: 'b', startedAt: '2026-05-08T00:00:00Z', messageCount: 50 }),
      s({ sessionUuid: 'c', startedAt: '2026-05-05T00:00:00Z', messageCount: 20 }),
    ]
    const candidate = s({ sessionUuid: 'x', startedAt: '2026-05-09T00:00:00Z', messageCount: 80 })
    const out = insertSessionSorted(list, candidate, 'most_messages', true)
    expect(out.map(r => r.sessionUuid)).toEqual(['a', 'x', 'b', 'c'])
  })

  it('sorts alphabetically for "title"', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z', title: 'alpha' }),
      s({ sessionUuid: 'b', startedAt: '2026-05-08T00:00:00Z', title: 'charlie' }),
    ]
    const candidate = s({ sessionUuid: 'x', startedAt: '2026-05-09T00:00:00Z', title: 'bravo' })
    const out = insertSessionSorted(list, candidate, 'title', true)
    expect(out.map(r => r.sessionUuid)).toEqual(['a', 'x', 'b'])
  })

  it('uses uuid as a stable tiebreaker', () => {
    const list = [
      s({ sessionUuid: 'a', startedAt: '2026-05-10T00:00:00Z' }),
      s({ sessionUuid: 'c', startedAt: '2026-05-10T00:00:00Z' }),
    ]
    const candidate = s({ sessionUuid: 'b', startedAt: '2026-05-10T00:00:00Z' })
    const out = insertSessionSorted(list, candidate, 'recent', true)
    expect(out.map(r => r.sessionUuid)).toEqual(['a', 'b', 'c'])
  })
})
