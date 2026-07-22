import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('../components/session/workbench', () => ({ SessionWorkbench: () => null }))

import type { HubRecordLine, HubSessionMeta, RangeFetcher } from '../lib/hub-api'
import {
  loadSessionContent,
  loadSessionRouteRecords,
  MAX_ROUTE_EVIDENCE_RECORDS,
} from './session-reader'

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

  it('downloads the raw record fallback only after an attached spool document is rejected', async () => {
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
      {
        onRecordProgress: (loaded, total) => progress.push([loaded, total]),
      },
    )

    expect(calls.indexOf('spool-invalid')).toBeLessThan(calls.indexOf('records:0-2'))
    expect(result).toEqual({ view, spoolDocument: null, records: [record(0), record(1)] })
    expect(progress).toEqual([
      [0, 2],
      [2, 2],
    ])
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

  it('uses the exact raw-record view for record-addressed deep links', async () => {
    const fetchSpoolFile = vi.fn(async () => spoolDocument)
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) =>
      Array.from({ length: to - from }, (_, offset) => record(from + offset)),
    )

    const result = await loadSessionContent(
      meta.sid,
      meta,
      {
        fetchView: vi.fn(async () => view),
        fetchSpoolFile,
        makeRangeFetcher: vi.fn(() => fetchRange),
      },
      { preferRawRecords: true },
    )

    expect(fetchSpoolFile).not.toHaveBeenCalled()
    expect(result).toEqual({ view, spoolDocument: null, records: [record(0), record(1)] })
  })
})

describe('loadSessionRouteRecords', () => {
  it('does not download unbounded evidence for large curated sessions', async () => {
    const makeRangeFetcher = vi.fn((): RangeFetcher => vi.fn())

    const records = await loadSessionRouteRecords(meta.sid, MAX_ROUTE_EVIDENCE_RECORDS + 1, {
      makeRangeFetcher,
    })

    expect(records).toBeNull()
    expect(makeRangeFetcher).not.toHaveBeenCalled()
  })

  it('loads route evidence independently after the curated document has rendered', async () => {
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) =>
      Array.from({ length: to - from }, (_, offset) => record(from + offset)),
    )

    const records = await loadSessionRouteRecords(meta.sid, 501, {
      makeRangeFetcher: vi.fn(() => fetchRange),
    })

    expect(records).toHaveLength(501)
    expect(fetchRange).toHaveBeenNthCalledWith(1, 0, 500)
    expect(fetchRange).toHaveBeenNthCalledWith(2, 500, 501)
  })

  it('isolates route evidence failures from the curated reader', async () => {
    const records = await loadSessionRouteRecords(meta.sid, 2, {
      makeRangeFetcher: vi.fn(() => vi.fn(async () => Promise.reject(new Error('offline')))),
    })

    expect(records).toBeNull()
  })

  it('stops a stale route load after cancellation', async () => {
    let cancelled = false
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) => {
      cancelled = true
      return Array.from({ length: to - from }, (_, offset) => record(from + offset))
    })

    const records = await loadSessionRouteRecords(
      meta.sid,
      501,
      { makeRangeFetcher: vi.fn(() => fetchRange) },
      { isCancelled: () => cancelled },
    )

    expect(records).toBeNull()
    expect(fetchRange).toHaveBeenCalledOnce()
  })

  it('forwards an abort signal to the active range request', async () => {
    const abortController = new AbortController()
    const fetchRange = vi.fn<RangeFetcher>(async (from, to) =>
      Array.from({ length: to - from }, (_, offset) => record(from + offset)),
    )
    const makeRangeFetcher = vi.fn(() => fetchRange)

    await loadSessionRouteRecords(
      meta.sid,
      2,
      { makeRangeFetcher },
      { signal: abortController.signal },
    )

    expect(makeRangeFetcher).toHaveBeenCalledWith(meta.sid, abortController.signal)
  })
})
