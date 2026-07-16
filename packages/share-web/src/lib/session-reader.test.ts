import { describe, expect, it } from 'vitest'

import {
  batchEventRanges,
  fetchRecordsExact,
  parseNdjsonRecords,
  type HubRecordLine,
  type RangeFetcher,
} from './hub-api'
import { buildSessionOgTagBlock } from './og-meta'
import { renderRecordSegments } from './record-render'
import { routeFor } from './route'
import {
  deepLinkHash,
  deepLinkIndex,
  noteDisplayFor,
  parseLineage,
  parseWorkspaceCard,
  providerOf,
  resumeCommandFor,
} from './session-page'
import type { SessionViewV1 } from '@spool-lab/session-kit'

describe('route /session/:sid', () => {
  it('matches valid sids and rejects junk', () => {
    expect(routeFor('/session/claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b')).toEqual({
      kind: 'session',
      sid: 'claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b',
    })
    expect(routeFor('/session/codex_abcd1234')).toEqual({ kind: 'session', sid: 'codex_abcd1234' })
    expect(routeFor('/session/gemini_abcd1234')).toEqual({ kind: 'tombstone', reason: 'not-found' })
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
    expect(calls).toEqual([[0, 5], [2, 5], [4, 5]])
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

describe('first-screen fallback chain', () => {
  const view = (firstPrompt: string, lastReply: string): SessionViewV1 => ({
    v: 1,
    index: [],
    files: [],
    outline: [],
    firstPrompt,
    lastReply,
    diffstat: { files: 0, adds: 0, dels: 0 },
  })

  it('prefers the author note, then last reply + first prompt, then nothing', () => {
    expect(noteDisplayFor('why I share this', view('p', 'r'))).toEqual({ kind: 'note', note: 'why I share this' })
    expect(noteDisplayFor('  ', view('p', 'r'))).toEqual({
      kind: 'prompt-and-reply', firstPrompt: 'p', lastReply: 'r',
    })
    expect(noteDisplayFor(null, view('', 'r'))).toEqual({ kind: 'last-reply', lastReply: 'r' })
    expect(noteDisplayFor(null, view('p', ''))).toEqual({
      kind: 'prompt-and-reply', firstPrompt: 'p', lastReply: '',
    })
    expect(noteDisplayFor(null, null)).toEqual({ kind: 'none' })
  })

  it('parses workspace cards and lineage defensively', () => {
    expect(parseWorkspaceCard(null)).toBeNull()
    expect(parseWorkspaceCard('not json')).toBeNull()
    expect(parseWorkspaceCard('{"remotes":["origin: x"],"branch":"main","head":"abc","dirty":[],"observed":"t"}'))
      .toEqual({ remotes: ['origin: x'], branch: 'main', head: 'abc', dirty: [], observed: 't' })
    expect(parseLineage('{"source":{"sid":"claude_x","position":9,"url":null}}'))
      .toEqual({ sid: 'claude_x', position: 9, url: null })
    expect(parseLineage('{"source":{}}')).toBeNull()
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
    expect(resumeCommandFor('https://spool.pro/session/claude_x'))
      .toBe('spool resume https://spool.pro/session/claude_x')
  })
})

describe('record segments', () => {
  it('renders claude text, tool_use, and tool_result blocks', () => {
    const data = JSON.stringify({
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } },
          { type: 'tool_result', content: [{ type: 'text', text: 'done' }] },
        ],
      },
    })
    const segments = renderRecordSegments('claude', data)
    expect(segments.map((s) => s.kind)).toEqual(['text', 'tool-call', 'tool-result'])
    expect(segments[1]?.label).toBe('Edit')
    expect(segments[2]?.text).toBe('done')
  })

  it('renders codex payloads and degrades unknown shapes to raw JSON', () => {
    expect(renderRecordSegments('codex', JSON.stringify({
      payload: { type: 'user_message', message: 'hi' },
    }))).toEqual([{ kind: 'text', text: 'hi' }])
    const raw = renderRecordSegments('codex', JSON.stringify({ unknown: true }))
    expect(raw[0]?.kind).toBe('raw')
    expect(renderRecordSegments('claude', 'not json')[0]?.kind).toBe('raw')
  })
})

describe('session OG tags', () => {
  it('uses the note first line, escapes, and emits a summary card', () => {
    const block = buildSessionOgTagBlock({
      title: 'Fix <PKCE> handling',
      description: 'A coding-agent session shared by @xy — 42 records.',
      canonicalUrl: 'https://spool.pro/session/claude_x',
    })
    expect(block).toContain('Fix &lt;PKCE&gt; handling · spool.pro')
    expect(block).toContain('twitter:card" content="summary"')
    expect(block).not.toContain('og:image')
  })
})
