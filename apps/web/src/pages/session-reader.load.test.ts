import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('../components/session/workbench', () => ({ SessionWorkbench: () => null }))

import type { HubRecordLine, HubSessionMeta, RangeFetcher } from '../lib/hub-api'
import { SESSION_RECORD_PAGE_SIZE, loadSessionContent } from './session-reader'

const meta: HubSessionMeta = {
  sid: 'claude_12345678',
  root: 'root',
  count: 2,
  sig: null,
  summaryMd: null,
  cardJson: null,
  lineageJson: null,
  viewOid: null,
  spoolFileOid: 'spool-oid',
  createdAt: 1,
  updatedAt: 2,
  visibility: 'public',
  author: { handle: null, displayName: null, avatarUrl: null },
}

const view = { v: 1 } as SessionViewV1
const spoolDocument = {
  version: 2,
  conversation: { turns: [] },
  opts: {},
  exportedAt: '2026-07-17T00:00:00.000Z',
} as unknown as SpoolDocument

function record(i: number): HubRecordLine {
  return { i, oid: `oid-${i}`, data: `{"i":${i}}` }
}

describe('loadSessionContent', () => {
  it('returns as soon as view and a valid spool document arrive without downloading raw records', async () => {
    const fetchView = vi.fn(async () => view)
    const fetchSpoolFile = vi.fn(async () => spoolDocument)
    const makeRangeFetcher = vi.fn((): RangeFetcher => vi.fn())

    const result = await loadSessionContent(meta.sid, meta, {
      fetchView,
      fetchSpoolFile,
      makeRangeFetcher,
    })

    expect(result).toEqual({ view, spoolDocument, records: [] })
    expect(fetchView).toHaveBeenCalledOnce()
    expect(fetchSpoolFile).toHaveBeenCalledOnce()
    expect(makeRangeFetcher).not.toHaveBeenCalled()
  })

  it('never exposes raw records when an attached spool document is rejected', async () => {
    const calls: string[] = []
    const fetchRange: RangeFetcher = vi.fn(async (from, to) => {
      calls.push(`records:${from}-${to}`)
      return Array.from({ length: to - from }, (_, offset) => record(from + offset))
    })
    const progress: Array<[number, number]> = []

    const result = await loadSessionContent(
      meta.sid,
      meta,
      {
        fetchView: vi.fn(async () => {
          calls.push('view')
          return view
        }),
        fetchSpoolFile: vi.fn(async () => {
          calls.push('spool-invalid')
          return null
        }),
        makeRangeFetcher: vi.fn(() => fetchRange),
      },
      { onRecordProgress: (loaded, total) => progress.push([loaded, total]) },
    )

    expect(calls).toEqual(['view', 'spool-invalid'])
    expect(result).toEqual({ view, spoolDocument: null, records: [] })
    expect(progress).toEqual([])
  })

  it('skips the spool request and immediately uses raw records for legacy shares', async () => {
    const fetchSpoolFile = vi.fn(async () => spoolDocument)
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) =>
      Array.from({ length: to - from }, (_, offset) => record(from + offset)),
    )

    const result = await loadSessionContent(
      meta.sid,
      { ...meta, spoolFileOid: null },
      {
        fetchView: vi.fn(async () => view),
        fetchSpoolFile,
        makeRangeFetcher: vi.fn(() => fetchRange),
      },
    )

    expect(fetchSpoolFile).not.toHaveBeenCalled()
    expect(fetchRange).toHaveBeenCalledWith(0, 2)
    expect(result?.records).toEqual([record(0), record(1)])
  })

  it('keeps an attached publication authoritative for record-addressed links', async () => {
    const fetchSpoolFile = vi.fn(async () => spoolDocument)
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) =>
      Array.from({ length: to - from }, (_, offset) => record(from + offset)),
    )

    const result = await loadSessionContent(meta.sid, meta, {
      fetchView: vi.fn(async () => view),
      fetchSpoolFile,
      makeRangeFetcher: vi.fn(() => fetchRange),
    })

    expect(fetchSpoolFile).toHaveBeenCalledOnce()
    expect(fetchRange).not.toHaveBeenCalled()
    expect(result).toEqual({ view, spoolDocument, records: [] })
  })

  it('loads a 2,726-record legacy session in small monotonic pages', async () => {
    const calls: Array<[number, number]> = []
    const loaded: number[] = []
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) => {
      calls.push([from, to])
      return Array.from({ length: to - from }, (_, offset) => record(from + offset))
    })

    const result = await loadSessionContent(
      meta.sid,
      { ...meta, count: 2_726, spoolFileOid: null },
      {
        fetchView: vi.fn(async () => view),
        fetchSpoolFile: vi.fn(async () => null),
        makeRangeFetcher: vi.fn(() => fetchRange),
      },
      {
        onRecordProgress: (count) => loaded.push(count),
      },
    )

    expect(result?.records).toHaveLength(2_726)
    expect(calls[0]).toEqual([0, SESSION_RECORD_PAGE_SIZE])
    expect(calls.at(-1)).toEqual([2_700, 2_726])
    expect(calls).toHaveLength(28)
    expect(calls.every(([from, to]) => to - from <= SESSION_RECORD_PAGE_SIZE)).toBe(true)
    expect(loaded).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000, 1_100, 1_200, 1_300, 1_400, 1_500,
      1_600, 1_700, 1_800, 1_900, 2_000, 2_100, 2_200, 2_300, 2_400, 2_500, 2_600, 2_700, 2_726,
    ])
  })

  it('resumes a failed raw-record load from the records already rendered', async () => {
    const calls: Array<[number, number]> = []
    const initialRecords = Array.from({ length: 200 }, (_, index) => record(index))
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) => {
      calls.push([from, to])
      return Array.from({ length: to - from }, (_, offset) => record(from + offset))
    })

    const result = await loadSessionContent(
      meta.sid,
      { ...meta, count: 250, spoolFileOid: null },
      {
        fetchView: vi.fn(async () => view),
        fetchSpoolFile: vi.fn(async () => null),
        makeRangeFetcher: vi.fn(() => fetchRange),
      },
      { initialRecords },
    )

    expect(calls).toEqual([[200, 250]])
    expect(result?.records).toHaveLength(250)
  })
})
