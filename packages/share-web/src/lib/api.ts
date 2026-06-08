// Thin typed wrappers over fetch. Keep the side-effect surface narrow
// so the pages can be tested by mocking these helpers (or by replacing
// `globalThis.fetch`).

import type { Snapshot } from '@spool/share-kit'

import { invalidateAuthCache } from './auth-cache'
import { clearCachedMe, writeCachedMe } from './me-cache'

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

export interface ProfileShareSummary {
  id: string
  title: string
  published_at: number
  version: number
}

export interface ProfileResponse {
  handle: string
  name: string | null
  avatar_url: string | null
  shares: ProfileShareSummary[]
}

export type ProfileFetchResult =
  | { kind: 'ok'; profile: ProfileResponse }
  | { kind: 'not-found' }
  | { kind: 'error' }

export async function fetchProfile(handle: string): Promise<ProfileFetchResult> {
  try {
    const r = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
    })
    if (r.status === 200) {
      const body = (await r.json()) as ProfileResponse
      return { kind: 'ok', profile: body }
    }
    if (r.status === 404) return { kind: 'not-found' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export interface MeResponse {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  handle: string | null
  /** Epoch-ms when the deletion worker will hard-delete this account;
   *  null when the account is healthy. Non-null means the user is in
   *  the 24h grace window — every endpoint except /api/me and the
   *  DELETE cancel path will 403. */
  deletion_pending_until: number | null
}

export interface MeShareRow {
  id: string
  title: string
  visibility: 'unlisted' | 'profile-listed'
  expires_at: number | null
  version: number
  published_at: number
  republished_at: number | null
  revoked_at: number | null
}

export type MeFetchResult =
  | { kind: 'ok'; me: MeResponse }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export async function fetchMe(): Promise<MeFetchResult> {
  try {
    const r = await fetch('/api/me', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (r.status === 200) {
      const me = (await r.json()) as MeResponse
      // Write the public-identity slice into the SWR cache so the next
      // page mount can paint the avatar before the round trip lands.
      writeCachedMe({ name: me.name, avatar_url: me.avatar_url })
      return { kind: 'ok', me }
    }
    if (r.status === 401) {
      // Cookie expired / signed out from another tab — drop both the
      // localStorage avatar cache AND the in-memory auth promise so the
      // next Header mount doesn't paint stale identity.
      clearCachedMe()
      invalidateAuthCache()
      return { kind: 'unauthenticated' }
    }
    // 403 = deletion-pending account; leave the cache alone, the user
    // is still effectively signed in for the recovery surface.
    if (r.status === 403) return { kind: 'forbidden' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type MySharesFetchResult =
  | { kind: 'ok'; shares: MeShareRow[] }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export async function fetchMyShares(): Promise<MySharesFetchResult> {
  try {
    const r = await fetch('/api/me/shares', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (r.status === 200) {
      const body = (await r.json()) as { items: MeShareRow[] }
      return { kind: 'ok', shares: body.items ?? [] }
    }
    if (r.status === 401) return { kind: 'unauthenticated' }
    if (r.status === 403) return { kind: 'forbidden' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type RevokeShareResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'rate-limited' }
  | { kind: 'error' }

export async function revokeShare(id: string): Promise<RevokeShareResult> {
  try {
    const r = await fetch(`/api/revoke/${encodeURIComponent(id)}`, {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (r.status === 200) return { kind: 'ok' }
    if (r.status === 404) return { kind: 'not-found' }
    if (r.status === 403) return { kind: 'forbidden' }
    if (r.status === 429) return { kind: 'rate-limited' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type CheckHandleResult =
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'error' }

export async function checkHandle(handle: string): Promise<CheckHandleResult> {
  try {
    const r = await fetch(`/api/handles/check?h=${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
    })
    if (r.status !== 200) return { kind: 'error' }
    const body = (await r.json()) as { available?: boolean; reason?: string }
    if (body.available === true) return { kind: 'available' }
    if (body.reason) return { kind: 'invalid', reason: body.reason }
    return { kind: 'taken' }
  } catch {
    return { kind: 'error' }
  }
}

export async function claimHandle(handle: string): Promise<
  | { kind: 'ok'; handle: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'taken' }
  | { kind: 'rate-limited' }
  | { kind: 'error' }
> {
  try {
    const r = await fetch('/api/handles/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ handle }),
    })
    if (r.status === 200) {
      const body = (await r.json()) as { handle: string }
      return { kind: 'ok', handle: body.handle }
    }
    if (r.status === 409) return { kind: 'taken' }
    if (r.status === 422) {
      const body = (await r.json().catch(() => null)) as { detail?: string } | null
      return { kind: 'invalid', reason: body?.detail ?? 'Invalid handle.' }
    }
    if (r.status === 429) return { kind: 'rate-limited' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function signOut(): Promise<boolean> {
  // Always drop the local identity cache, even if the network call
  // fails — the user's intent is "log me out of this device" and a
  // stale cached avatar is the wrong signal.
  clearCachedMe()
  invalidateAuthCache()
  try {
    const r = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
    })
    return r.ok
  } catch {
    return false
  }
}

export type DeleteAccountResult =
  | { kind: 'ok'; scheduled_at: number }
  | { kind: 'error' }

export async function scheduleAccountDeletion(): Promise<DeleteAccountResult> {
  try {
    const r = await fetch('/api/me/delete', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (r.status === 200) {
      const body = (await r.json()) as { scheduled_at: number }
      return { kind: 'ok', scheduled_at: body.scheduled_at }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function cancelAccountDeletion(): Promise<boolean> {
  try {
    const r = await fetch('/api/me/delete', {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    return r.ok
  } catch {
    return false
  }
}
