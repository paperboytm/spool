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

