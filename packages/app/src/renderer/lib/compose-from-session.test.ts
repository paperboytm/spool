import { describe, it, expect } from 'vitest'
import type { Message, Session } from '@spool-lab/core'
import { composeFromSession } from './compose-from-session'

const baseSession: Session = {
  id: 1,
  projectId: 1,
  sourceId: 1,
  sessionUuid: 'sess-1',
  filePath: '/foo.jsonl',
  title: 'Cache race condition',
  startedAt: '2026-04-18T10:00:00Z',
  endedAt: '2026-04-18T10:30:00Z',
  messageCount: 4,
  hasToolUse: false,
  cwd: '/work',
  model: 'claude-opus',
  source: 'claude',
  projectDisplayPath: '/work',
  projectDisplayName: 'work',
}

function msg(seq: number, role: Message['role'], body: string, overrides: Partial<Message> = {}): Message {
  return {
    id: seq,
    sessionId: 1,
    msgUuid: `m-${seq}`,
    parentUuid: null,
    role,
    contentText: body,
    timestamp: '2026-04-18T10:00:00Z',
    isSidechain: false,
    toolNames: [],
    seq,
    ...overrides,
  }
}

describe('composeFromSession', () => {
  it('maps user + assistant messages to turns in order', () => {
    const convo = composeFromSession(baseSession, [
      msg(0, 'user', 'hi'),
      msg(1, 'assistant', 'hello'),
    ])
    expect(convo.turns).toEqual([
      { role: 'user', body: 'hi', timestamp: '2026-04-18T10:00:00Z' },
      { role: 'assistant', body: 'hello', timestamp: '2026-04-18T10:00:00Z' },
    ])
  })

  it('drops sidechain messages', () => {
    const convo = composeFromSession(baseSession, [
      msg(0, 'user', 'main question'),
      msg(1, 'user', 'sidechain noise', { isSidechain: true }),
      msg(2, 'assistant', 'main answer'),
    ])
    expect(convo.turns.map((t) => t.body)).toEqual(['main question', 'main answer'])
  })

  it('drops system messages (share-kit has no system role)', () => {
    const convo = composeFromSession(baseSession, [
      msg(0, 'system', 'You are a helpful assistant.'),
      msg(1, 'user', 'real question'),
    ])
    expect(convo.turns).toHaveLength(1)
    expect(convo.turns[0]?.body).toBe('real question')
  })

  it('uses session.title when present', () => {
    const convo = composeFromSession(baseSession, [msg(0, 'user', 'whatever')])
    expect(convo.title).toBe('Cache race condition')
  })

  it('derives title from first user message when session.title is null', () => {
    const convo = composeFromSession(
      { ...baseSession, title: null },
      [msg(0, 'user', 'Why is the cache stale')],
    )
    expect(convo.title).toBe('Why is the cache stale')
  })

  it('truncates a long derived title with an ellipsis', () => {
    const long = 'a '.repeat(50).trim()
    const convo = composeFromSession(
      { ...baseSession, title: null },
      [msg(0, 'user', long)],
    )
    expect(convo.title.endsWith('…')).toBe(true)
    expect(convo.title.length).toBeLessThanOrEqual(60)
  })

  it('honors titleOverride', () => {
    const convo = composeFromSession(baseSession, [msg(0, 'user', 'x')], {
      titleOverride: 'Manual title',
    })
    expect(convo.title).toBe('Manual title')
  })

  it('emits an agent-session origin tagged with source and uuid', () => {
    expect(composeFromSession(baseSession, [msg(0, 'user', 'x')]).origin)
      .toEqual({ kind: 'agent-session', agent: 'claude', sessionUuid: 'sess-1' })

    expect(composeFromSession({ ...baseSession, source: 'gemini' }, [msg(0, 'user', 'x')]).origin)
      .toEqual({ kind: 'agent-session', agent: 'gemini', sessionUuid: 'sess-1' })

    expect(composeFromSession({ ...baseSession, source: 'codex' }, [msg(0, 'user', 'x')]).origin)
      .toEqual({ kind: 'agent-session', agent: 'codex', sessionUuid: 'sess-1' })
  })

  it('computes word count and read time', () => {
    const tenWords = 'one two three four five six seven eight nine ten'
    const text = (tenWords + ' ').repeat(50).trim()
    const convo = composeFromSession(baseSession, [msg(0, 'user', text)])
    expect(convo.wordCount).toBe(500)
    expect(convo.readMin).toBe(2)
  })

  it('returns Untitled when no user message is present', () => {
    const convo = composeFromSession(
      { ...baseSession, title: null },
      [msg(0, 'assistant', 'lonely answer')],
    )
    expect(convo.title).toBe('Untitled')
  })
})
