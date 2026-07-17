import { describe, expect, it } from 'vitest'

import { DEFAULT_OPTS } from './types'
import { parseSpoolDocument } from './spool-document'

describe('parseSpoolDocument', () => {
  it('normalizes a complete document without retaining unknown fields', () => {
    const parsed = parseSpoolDocument({
      version: 2,
      exportedAt: '2026-07-17T08:00:00.000Z',
      ignored: 'drop me',
      conversation: {
        source: 'claude-code',
        sourceLabel: 'Claude Code',
        origin: { kind: 'agent-session', agent: 'claude', sessionUuid: 'session-1' },
        title: 'Shared session',
        shareUrl: null,
        createdAt: '2026-07-17T07:00:00.000Z',
        wordCount: 2,
        readMin: 1,
        turns: [{ id: 'turn-1', role: 'user', body: 'hello world', extra: true }],
      },
      opts: { ...DEFAULT_OPTS, template: 'timeline' },
    })

    expect(parsed).toEqual({
      version: 2,
      exportedAt: '2026-07-17T08:00:00.000Z',
      conversation: {
        source: 'claude-code',
        sourceLabel: 'Claude Code',
        origin: { kind: 'agent-session', agent: 'claude', sessionUuid: 'session-1' },
        title: 'Shared session',
        shareUrl: null,
        createdAt: '2026-07-17T07:00:00.000Z',
        wordCount: 2,
        readMin: 1,
        turns: [{ id: 'turn-1', role: 'user', body: 'hello world' }],
      },
      opts: { ...DEFAULT_OPTS, template: 'timeline' },
    })
  })

  it('fills safe legacy conversation and option defaults', () => {
    const parsed = parseSpoolDocument({
      version: 1,
      conversation: {
        title: 'Legacy share',
        turns: [
          { role: 'user', body: 'hello legacy' },
          { role: 'assistant', body: 'hello back' },
        ],
      },
      opts: { template: 'retired-template', selected: [1, 99, -1, 1] },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.exportedAt).toBe('')
    expect(parsed?.conversation).toMatchObject({
      source: 'spool',
      sourceLabel: 'Spool',
      origin: { kind: 'file', filename: 'shared.spool' },
      title: 'Legacy share',
      shareUrl: null,
      createdAt: '',
      wordCount: 4,
      readMin: 1,
    })
    expect(parsed?.opts).toEqual({ ...DEFAULT_OPTS, selected: [1] })
  })

  it('normalizes unsafe option values to bounded defaults', () => {
    const parsed = parseSpoolDocument({
      version: 2,
      conversation: { turns: [{ role: 'user', body: 'hello' }] },
      opts: {
        density: 'huge',
        accentHex: 'url(javascript:alert(1))',
        redact: 'yes',
        showGaps: 1,
        showMasthead: null,
        showColophon: {},
        hideEmptyTurns: [],
        selected: 'all',
      },
    })

    expect(parsed?.opts).toEqual(DEFAULT_OPTS)
  })

  it.each([
    null,
    {},
    { version: 3, conversation: { turns: [] } },
    { version: 2, conversation: null },
    { version: 2, conversation: {} },
    { version: 2, conversation: { turns: 'not-an-array' } },
    { version: 2, conversation: { turns: [null] } },
    { version: 2, conversation: { turns: [{ role: 'system', body: 'hidden' }] } },
    { version: 2, conversation: { turns: [{ role: 'user', body: 42 }] } },
    { version: 2, conversation: { turns: [{ role: 'user', body: 'ok', redact: ['x', 2] }] } },
  ])('returns null for an invalid document or turn: %j', (input) => {
    expect(parseSpoolDocument(input)).toBeNull()
  })
})
