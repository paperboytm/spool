import { serializePortableSession, type SessionProvider } from '@spool-lab/session-kit'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  batchEventRanges,
  fetchHubSpoolFile,
  fetchRecordsExact,
  parseNdjsonRecords,
  type HubRecordLine,
  type RangeFetcher,
} from './hub-api'
import { sessionOgHead } from './og-meta'
import { routeFor } from './route'
import { parseHubConversation } from './session-messages'
import {
  deepLinkHash,
  deepLinkIndex,
  parseWorkspaceCard,
  providerOf,
  repositoryUrlForRemote,
  resumeCommandFor,
} from './session-page'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('route /session/:sid', () => {
  it('matches valid sids and rejects junk', () => {
    expect(routeFor('/session/claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b')).toEqual({
      kind: 'session',
      sid: 'claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b',
    })
    expect(routeFor('/session/codex_abcd1234')).toEqual({ kind: 'session', sid: 'codex_abcd1234' })
    expect(routeFor('/session/gemini_abcd1234')).toEqual({
      kind: 'session',
      sid: 'gemini_abcd1234',
    })
    expect(routeFor('/session/opencode_abcd1234')).toEqual({
      kind: 'session',
      sid: 'opencode_abcd1234',
    })
    expect(routeFor('/session/pi_abcd1234')).toEqual({ kind: 'session', sid: 'pi_abcd1234' })
    expect(routeFor('/session/claude_x')).toEqual({ kind: 'tombstone', reason: 'not-found' })
    expect(routeFor('/session/')).toEqual({ kind: 'tombstone', reason: 'not-found' })
  })
})

describe('record fetching', () => {
  const record = (i: number): HubRecordLine => ({ i, oid: `oid-${i}`, data: `{"n":${i}}` })

  it('parses NDJSON and skips blank lines', () => {
    const text = `${JSON.stringify(record(0))}\n\n${JSON.stringify(record(1))}\n`
    expect(parseNdjsonRecords(text)).toEqual([record(0), record(1)])
  })

  it('continues after short reads until the range is complete', async () => {
    const calls: Array<[number, number]> = []
    // Server truncates at 2 records per response (byte cap simulation).
    const fetchRange: RangeFetcher = async (from, to) => {
      calls.push([from, to])
      const upper = Math.min(from + 2, to)
      return Array.from({ length: upper - from }, (_, k) => record(from + k))
    }
    const records = await fetchRecordsExact(fetchRange, 0, 5)
    expect(records.map((r) => r.i)).toEqual([0, 1, 2, 3, 4])
    expect(calls).toEqual([
      [0, 5],
      [2, 5],
      [4, 5],
    ])
  })

  it('aborts instead of looping when the server makes no progress', async () => {
    const fetchRange: RangeFetcher = async () => []
    await expect(fetchRecordsExact(fetchRange, 0, 3)).rejects.toThrow(/no records/)
  })

  it('batches event indices into ranges, bridging small gaps only', () => {
    expect(batchEventRanges([], 8)).toEqual([])
    expect(batchEventRanges([3], 8)).toEqual([{ from: 3, to: 4 }])
    expect(batchEventRanges([3, 4, 7], 8)).toEqual([{ from: 3, to: 8 }])
    expect(batchEventRanges([3, 400], 8)).toEqual([
      { from: 3, to: 4 },
      { from: 400, to: 401 },
    ])
    // Duplicates and disorder are tolerated.
    expect(batchEventRanges([7, 3, 3], 8)).toEqual([{ from: 3, to: 8 }])
  })
})

describe('hub spool document', () => {
  it('turns an invalid attached document into the raw-record fallback signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 2,
              conversation: { turns: [{ role: 'user', body: 42 }] },
            }),
            { status: 200 },
          ),
      ),
    )

    await expect(fetchHubSpoolFile('claude_12345678')).resolves.toBeNull()
  })
})

describe('workbench metadata', () => {
  it('parses workspace cards defensively', () => {
    expect(parseWorkspaceCard(null)).toBeNull()
    expect(parseWorkspaceCard('not json')).toBeNull()
    expect(
      parseWorkspaceCard(
        '{"remotes":["origin: x"],"branch":"main","head":"abc","dirty":[],"observed":"t"}',
      ),
    ).toEqual({ remotes: ['origin: x'], branch: 'main', head: 'abc', dirty: [], observed: 't' })
  })
})

describe('deep links and helpers', () => {
  it('round-trips #r/<idx>', () => {
    expect(deepLinkIndex('#r/42')).toBe(42)
    expect(deepLinkIndex(deepLinkHash(7))).toBe(7)
    expect(deepLinkIndex('#r/-1')).toBeNull()
    expect(deepLinkIndex('#other')).toBeNull()
    expect(deepLinkIndex('')).toBeNull()
  })

  it('derives provider and resume command', () => {
    expect(providerOf('codex_abc12345')).toBe('codex')
    expect(providerOf('claude_abc12345')).toBe('claude')
    expect(providerOf('gemini_abc12345')).toBe('gemini')
    expect(providerOf('opencode_abc12345')).toBe('opencode')
    expect(providerOf('pi_abc12345')).toBe('pi')
    expect(resumeCommandFor('claude_41eb99fe-e024-4fc6-9b87-4653ca6e7a69')).toBe(
      'npx @spool-lab/cli resume claude_41eb99fe-e024-4fc6-9b87-4653ca6e7a69',
    )
  })

  it('turns browser-addressable git remotes into repository links', () => {
    expect(repositoryUrlForRemote('origin: git@github.com:paperboytm/spool.git')).toBe(
      'https://github.com/paperboytm/spool',
    )
    expect(repositoryUrlForRemote('upstream: ssh://git@gitlab.com/spool-lab/spool.git')).toBe(
      'https://gitlab.com/spool-lab/spool',
    )
    expect(repositoryUrlForRemote('origin: https://github.com/paperboytm/spool.git')).toBe(
      'https://github.com/paperboytm/spool',
    )
  })

  it('does not link local or malformed git remotes', () => {
    expect(repositoryUrlForRemote('origin: ../spool.git')).toBeNull()
    expect(repositoryUrlForRemote('not a remote')).toBeNull()
  })
})

describe('hub records → desktop-identical conversation', () => {
  const record = (
    i: number,
    data: Record<string, unknown>,
  ): { i: number; oid: string; data: string } => ({
    i,
    oid: `oid-${i}`,
    data: JSON.stringify(data),
  })

  const claudeRecords = [
    record(0, {
      type: 'user',
      uuid: 'u-1',
      sessionId: 's',
      timestamp: '2026-07-16T10:00:00.000Z',
      message: { role: 'user', content: 'rename alpha to beta' },
    }),
    record(1, {
      type: 'assistant',
      uuid: 'u-2',
      parentUuid: 'u-1',
      sessionId: 's',
      timestamp: '2026-07-16T10:00:05.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }],
      },
    }),
    record(2, {
      type: 'user',
      uuid: 'u-3',
      parentUuid: 'u-2',
      sessionId: 's',
      timestamp: '2026-07-16T10:00:06.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    }),
    record(3, {
      type: 'assistant',
      uuid: 'u-4',
      parentUuid: 'u-3',
      sessionId: 's',
      timestamp: '2026-07-16T10:00:09.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    }),
  ]

  it('parses via the shared session-kit parser (tool plumbing collapses)', () => {
    const conversation = parseHubConversation('claude', claudeRecords)
    expect(conversation.title).toBe('rename alpha to beta')
    expect(conversation.messages.map((m) => [m.role, m.contentText])).toEqual([
      ['user', 'rename alpha to beta'],
      ['assistant', ''],
      ['assistant', 'Done.'],
    ])
    expect(conversation.messages[1]?.toolNames).toEqual(['Edit'])
  })

  it('maps record indices onto conversation messages, carrying gaps backward', () => {
    const { recordToMessageId } = parseHubConversation('claude', claudeRecords)
    expect(recordToMessageId.get(0)).toBe(0) // user prompt → message 0
    expect(recordToMessageId.get(1)).toBe(1) // edit call → tool message
    expect(recordToMessageId.get(2)).toBe(1) // tool result collapses → nearest previous message
    expect(recordToMessageId.get(3)).toBe(2) // reply
  })

  it('parses codex event messages by timestamp mapping', () => {
    const codexRecords = [
      record(0, {
        type: 'event_msg',
        timestamp: '2026-07-16T10:00:00.000Z',
        payload: { type: 'user_message', message: 'hello codex' },
      }),
      record(1, {
        type: 'event_msg',
        timestamp: '2026-07-16T10:00:09.000Z',
        payload: { type: 'agent_message', message: 'hi!' },
      }),
    ]
    const conversation = parseHubConversation('codex', codexRecords)
    expect(conversation.messages.map((m) => m.contentText)).toEqual(['hello codex', 'hi!'])
    expect(conversation.recordToMessageId.get(1)).toBe(1)
  })

  it.each(['gemini', 'opencode', 'pi'] as const)(
    'parses portable %s records under their real provider identity',
    (provider: SessionProvider) => {
      const lines = serializePortableSession({
        source: provider,
        sessionUuid: `${provider}-session`,
        filePath: 'hub',
        title: `${provider} title`,
        cwd: '',
        model: '',
        startedAt: '2026-07-19T00:00:00.000Z',
        endedAt: '2026-07-19T00:00:01.000Z',
        messages: [
          {
            uuid: 'portable-u',
            parentUuid: null,
            role: 'user',
            contentText: `hello ${provider}`,
            timestamp: '2026-07-19T00:00:00.000Z',
            isSidechain: false,
            toolNames: [],
            seq: 0,
          },
        ],
      })
        .trim()
        .split('\n')
      const records = lines.map((data, i) => ({ i, oid: `oid-${i}`, data }))

      const conversation = parseHubConversation(provider, records)

      expect(conversation.title).toBe(`${provider} title`)
      expect(conversation.messages[0]?.contentText).toBe(`hello ${provider}`)
      expect(conversation.recordToMessageId.get(0)).toBe(0)
    },
  )

  it('degrades to an empty conversation for unparseable sessions', () => {
    expect(parseHubConversation('claude', []).messages).toEqual([])
  })
})

describe('session OG tags', () => {
  it('titles the card from the Summary and emits a summary card without og:image', () => {
    // Escaping moved from the old string-injection path into React's
    // attribute rendering — the fragment carries raw values now.
    const fragment = sessionOgHead({
      title: 'Fix <PKCE> handling',
      description: 'A coding-agent session shared by @xy — 42 records.',
      canonicalUrl: 'https://spool.pro/session/claude_x',
    })
    expect(fragment.meta[0]).toEqual({ title: 'Fix <PKCE> handling · spool.pro' })
    expect(fragment.meta.find((m) => m['name'] === 'twitter:card')?.['content']).toBe('summary')
    expect(fragment.meta.some((m) => m['property'] === 'og:image')).toBe(false)
  })
})
