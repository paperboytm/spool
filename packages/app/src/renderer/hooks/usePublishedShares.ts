import { useCallback, useEffect, useState } from 'react'
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

/**
 * Merge a fresh remote response over the existing local cache: any row
 * present in `remote` wins; rows that are absent from `remote` are
 * dropped. Kept as a pure function so its semantics are testable
 * without a live electron / sqlite environment.
 */
export function mergeRemoteIntoCache(
  _local: ReadonlyArray<PublishedShareCacheItem>,
  remote: ReadonlyArray<MyShare>,
  now: number = Date.now(),
): PublishedShareCacheItem[] {
  return remote.map((r) => toCacheItem(r, now))
}

export interface UsePublishedSharesResult {
  items: PublishedShareCacheItem[]
  loading: boolean
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
      const merged = mergeRemoteIntoCache(items, remote.items)
      if (mutationGen.current !== fetchGen) {
        // A local mutation landed during the fetch — skip both the
        // in-memory swap AND the cache replaceAll. A subsequent
        // refresh will reconcile once the remote sees the mutation.
        return
      }
      setItems(merged)
      await window.spoolShare.cachePublished(merged)
    } catch (err) {
      // Network / auth failure leaves the cached view intact. Logging
      // only — the Published tab will keep showing stale rows rather
      // than blanking out when the user is offline.
      console.warn('[usePublishedShares] refresh failed:', err)
    }
    // intentionally exclude items from deps — refresh always reads the latest remote
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const cached = await window.spoolShare.cachedPublished()
        if (alive) setItems(cached)
      } catch (err) {
        console.warn('[usePublishedShares] cache read failed:', err)
      }
      await refresh()
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [refresh])

  return { items, loading, refresh, noteLocalMutation }
}
