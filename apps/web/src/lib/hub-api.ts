// Typed access to /api/hub/v1 — the v2 session read path. Same
// result-union conventions as api.ts. The record-fetch logic is pure
// where it matters (NDJSON parsing, continuation, range batching) so it
// tests without a DOM or a worker.

import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import { parseSpoolDocument } from '@spool/share-kit/spool-document'

export interface HubAuthor {
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface HubSessionMeta {
  sid: string
  root: string
  count: number
  sig: string | null
  summaryMd: string | null
  cardJson: string | null
  lineageJson: string | null
  viewOid: string | null
  spoolFileOid?: string | null
  createdAt: number
  updatedAt: number
  visibility: 'public' | 'link-only' | 'team'
  /** Cost snapshot persisted when this head was published. */
  cost?: { usd: number | null; totalTokens: number } | null
  team?: { id: string; name: string } | null
  author: HubAuthor
}

type HubSessionMetaWire = Omit<HubSessionMeta, 'summaryMd' | 'visibility'> & {
  summaryMd?: string | null
  visibility?: HubSessionMeta['visibility']
  /** Compatibility with Hub responses from before the Summary rename. */
  noteMd?: string | null
}

export type HubMetaResult =
  | { kind: 'ok'; meta: HubSessionMeta }
  | { kind: 'withdrawn'; at: number }
  | { kind: 'auth-required' }
  | { kind: 'not-found' }
  | { kind: 'error' }

export interface HubRecordLine {
  i: number
  oid: string
  data: string
}

export async function fetchHubMeta(sid: string): Promise<HubMetaResult> {
  try {
    const r = await fetch(`/api/hub/v1/sessions/${encodeURIComponent(sid)}`, {
      headers: { accept: 'application/json' },
    })
    if (r.status === 200) {
      const { noteMd, ...meta } = (await r.json()) as HubSessionMetaWire
      return {
        kind: 'ok',
        meta: {
          ...meta,
          summaryMd: meta.summaryMd ?? noteMd ?? null,
          visibility: meta.visibility ?? 'link-only',
        },
      }
    }
    if (r.status === 410) {
      const body = (await r.json().catch(() => ({}))) as { withdrawnAt?: number }
      return { kind: 'withdrawn', at: body.withdrawnAt ?? Date.now() }
    }
    if (r.status === 401) return { kind: 'auth-required' }
    if (r.status === 404 || r.status === 400) return { kind: 'not-found' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function fetchHubView(sid: string): Promise<SessionViewV1 | null> {
  try {
    const r = await fetch(`/api/hub/v1/sessions/${encodeURIComponent(sid)}/view`, {
      headers: { accept: 'application/json' },
    })
    if (r.status !== 200) return null
    return (await r.json()) as SessionViewV1
  } catch {
    return null
  }
}

/** The attached .spool document, when the share carries one. */
export async function fetchHubSpoolFile(sid: string): Promise<SpoolDocument | null> {
  try {
    const r = await fetch(`/api/hub/v1/sessions/${encodeURIComponent(sid)}/spool-file`, {
      headers: { accept: 'application/spool+json' },
    })
    if (r.status !== 200) return null
    return parseSpoolDocument(await r.json())
  } catch {
    return null
  }
}

/** Parse an NDJSON body into record lines; blank lines are skipped. */
export function parseNdjsonRecords(text: string): HubRecordLine[] {
  const lines: HubRecordLine[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    lines.push(JSON.parse(line) as HubRecordLine)
  }
  return lines
}

export type RangeFetcher = (from: number, to: number) => Promise<HubRecordLine[]>

export function makeRangeFetcher(sid: string, signal?: AbortSignal): RangeFetcher {
  return async (from, to) => {
    const r = await fetch(
      `/api/hub/v1/sessions/${encodeURIComponent(sid)}/records?from=${from}&to=${to}`,
      {
        headers: { accept: 'application/x-ndjson' },
        ...(signal === undefined ? {} : { signal }),
      },
    )
    if (r.status !== 200) throw new Error(`records fetch failed: HTTP ${r.status}`)
    return parseNdjsonRecords(await r.text())
  }
}

/**
 * Fetch [from, to) completely. The server may return fewer lines than
 * requested (byte cap) — continue from the last received index + 1. A
 * page that makes no progress aborts instead of looping forever.
 */
export async function fetchRecordsExact(
  fetchRange: RangeFetcher,
  from: number,
  to: number,
): Promise<HubRecordLine[]> {
  const out: HubRecordLine[] = []
  let cursor = from
  while (cursor < to) {
    const page = await fetchRange(cursor, to)
    if (page.length === 0) throw new Error(`hub returned no records for ${cursor}..${to}`)
    out.push(...page)
    cursor = (page[page.length - 1] as HubRecordLine).i + 1
  }
  return out
}

/**
 * Merge sorted record indices into fetch ranges, bridging gaps of up to
 * `maxGap` skipped records — fetching a few unneeded records in one
 * request beats issuing many small requests.
 */
export function batchEventRanges(
  indices: readonly number[],
  maxGap = 8,
): Array<{ from: number; to: number }> {
  if (indices.length === 0) return []
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const ranges: Array<{ from: number; to: number }> = []
  let start = sorted[0] as number
  let end = start + 1
  for (const index of sorted.slice(1)) {
    if (index < end + maxGap) {
      end = index + 1
    } else {
      ranges.push({ from: start, to: end })
      start = index
      end = index + 1
    }
  }
  ranges.push({ from: start, to: end })
  return ranges
}

/** Fetch exactly the records named by `indices` (plus bridged gaps). */
export async function fetchRecordsByIndices(
  fetchRange: RangeFetcher,
  indices: readonly number[],
): Promise<HubRecordLine[]> {
  const wanted = new Set(indices)
  const out: HubRecordLine[] = []
  for (const range of batchEventRanges(indices)) {
    const records = await fetchRecordsExact(fetchRange, range.from, range.to)
    for (const record of records) {
      if (wanted.has(record.i)) out.push(record)
    }
  }
  return out
}
