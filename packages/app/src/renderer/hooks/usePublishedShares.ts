import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublishedShareCacheItem } from '@spool-lab/core'
import type { MyShare } from '../../shared/share-publish.js'

/** Convert a wire-format `MyShare` into the local cache row shape. The
 *  cache stores all timestamps as plain integers and stamps an
 *  `updated_at` at write time so the renderer can detect staleness when
 *  the remote fetch has been failing for a while. */
export function toCacheItem(remote: MyShare, now: number = Date.now()): PublishedShareCacheItem {
  return {
    id: remote.id,
    title: remote.title,
    visibility: remote.visibility,
    version: remote.version,
    published_at: remote.published_at,
    revoked_at: remote.revoked_at,
    expires_at: remote.expires_at,
    draft_id: remote.draft_id,
    client_request_id: remote.client_request_id,
    updated_at: now,
  }
}

/** Remote is the source of truth: any row absent from the response is
 *  dropped from the cache on next refresh. Kept as a pure function so
 *  the semantics are testable without electron / sqlite. */
export function remoteToCacheItems(
  remote: ReadonlyArray<MyShare>,
  now: number = Date.now(),
): PublishedShareCacheItem[] {
  return remote.map((r) => toCacheItem(r, now))
}

export interface UsePublishedSharesResult {
  items: PublishedShareCacheItem[]
  loading: boolean
  /** True when the most recent remote fetch failed — `items` is the
   *  cached view and may be behind the backend (a share revoked from
   *  the web won't show as revoked here). Cleared by the next refresh
   *  that succeeds. Drives the "showing cached data" banner so the
   *  user can tell stale-but-rendered apart from fresh. */
  stale: boolean
  refresh: () => Promise<void>
  /** Notify the hook that a local mutation (revoke, etc.) is about to
   *  happen. Increments a generation counter; an in-flight `refresh`
   *  that captured the older generation will skip its `replaceAll`
   *  cache write to avoid clobbering the optimistic local change.
   *  Call this BEFORE awaiting the IPC that mutates state. */
  noteLocalMutation: () => void
}

export function usePublishedShares(): UsePublishedSharesResult {
  const [items, setItems] = useState<PublishedShareCacheItem[]>([])
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const aliveRef = useRef(true)
  // Mutation generation — bumped by `noteLocalMutation()` and read by
  // `refresh()`. The Published tab triggers a refresh on focus events;
  // if the user just clicked Unpublish (which optimistically wrote
  // `revoked_at` via main IPC's `markRevoked`), a focus-triggered
  // refresh that captured the pre-mutation gen would `replaceAll` the
  // cache with the stale myShares response and wipe the optimistic
  // revoke. The gen check at write time prevents that.
  const mutationGen = useRef(0)

  const noteLocalMutation = useCallback(() => {
    mutationGen.current += 1
  }, [])

  const refresh = useCallback(async () => {
    const fetchGen = mutationGen.current
    try {
      const remote = await window.spoolShare.myShares()
      const merged = remoteToCacheItems(remote.items)
      if (!aliveRef.current) return
      if (mutationGen.current !== fetchGen) {
        // A local mutation landed during the fetch — skip both the
        // in-memory swap AND the cache replaceAll. A subsequent
        // refresh will reconcile once the remote sees the mutation.
        return
      }
      setItems(merged)
      setStale(false)
      try {
        await window.spoolShare.cachePublished(merged)
      } catch (err) {
        // Cache write failure ≠ stale data — the in-memory view above
        // IS fresh; only the next cold start pays for the miss. Don't
        // raise the stale banner over it.
        console.warn('[usePublishedShares] cache write failed:', err)
      }
    } catch (err) {
      // Network / auth failure leaves the cached view intact — the
      // Published tab keeps showing stale rows rather than blanking out
      // when the user is offline. `stale` tells the surface to say so;
      // silently rendering a cache that may miss remote revocations
      // looked identical to fresh data.
      console.warn('[usePublishedShares] refresh failed:', err)
      if (aliveRef.current) setStale(true)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void (async () => {
      try {
        const cached = await window.spoolShare.cachedPublished()
        if (aliveRef.current) setItems(cached)
      } catch (err) {
        console.warn('[usePublishedShares] cache read failed:', err)
      }
      await refresh()
      if (aliveRef.current) setLoading(false)
    })()
    return () => {
      aliveRef.current = false
    }
  }, [refresh])

  return { items, loading, stale, refresh, noteLocalMutation }
}
