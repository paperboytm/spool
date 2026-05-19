// Thin typed wrappers over fetch. Keep the side-effect surface narrow
// so the pages can be tested by mocking these helpers (or by replacing
// `globalThis.fetch`).

import type { Snapshot } from '@spool/share-kit'

export type SnapshotFetchResult =
  | { kind: 'ok'; snapshot: Snapshot }
  | { kind: 'gone'; reason: 'revoked' | 'expired'; at: number }
  | { kind: 'not-found' }
  | { kind: 'error' }

interface TombstoneBody {
  revoked?: true
  expired?: true
  at?: number
}

export function decideSnapshotState(
  status: number,
  body: unknown,
): SnapshotFetchResult {
  if (status === 200) {
    return { kind: 'ok', snapshot: body as Snapshot }
  }
  if (status === 410) {
    const b = (body && typeof body === 'object' ? body : {}) as TombstoneBody
    const at = typeof b.at === 'number' ? b.at : Date.now()
    if (b.revoked) return { kind: 'gone', reason: 'revoked', at }
    return { kind: 'gone', reason: 'expired', at }
  }
  if (status === 404) return { kind: 'not-found' }
  return { kind: 'error' }
}

export async function fetchSnapshot(id: string): Promise<SnapshotFetchResult> {
  try {
    const r = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
    })
    let body: unknown = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    return decideSnapshotState(r.status, body)
  } catch {
    return { kind: 'error' }
  }
}

export type ReportReason =
  | 'csam'
  | 'doxx'
  | 'harassment'
  | 'spam'
  | 'impersonation'
  | 'other'

export interface ReportPayload {
  id: string
  reason: ReportReason
  note?: string
  email?: string
}

export type ReportResult =
  | { kind: 'ok' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error' }

export async function submitReport(payload: ReportPayload): Promise<ReportResult> {
  try {
    const r = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.status === 204 || r.status === 200) return { kind: 'ok' }
    if (r.status === 429) return { kind: 'rate-limited' }
    if (r.status === 400 || r.status === 422) {
      const body = (await r.json().catch(() => null)) as { detail?: string } | null
      return { kind: 'invalid', message: body?.detail ?? 'Invalid report.' }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}
