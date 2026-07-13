import { useCallback, useEffect, useState } from 'react'
import type { ShareDraftListItem, ShareDraftRow } from '@spool-lab/core'

interface UseShareDraftsResult {
  drafts: ShareDraftListItem[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /** Delete a draft. Optimistically drops it from the local list, then
   *  asks main to DELETE from the share_drafts table. Returns the full
   *  row that was deleted so callers can offer Undo. */
  removeDraft: (draftId: string) => Promise<ShareDraftRow | null>
  /** Re-insert a previously-deleted draft via upsert. Used by Undo. */
  restoreDraft: (row: ShareDraftRow) => Promise<void>
}

/**
 * Reads the local share_drafts table via the preload bridge. Light: no
 * push notification yet, so callers refresh after a known-to-mutate
 * action (editor autosave, delete, etc.). PR 3 will revisit this once
 * the editor exists and we can decide whether to push a "draft changed"
 * IPC event vs. just refetch on focus.
 */
export function useShareDrafts(opts: { limit?: number } = {}): UseShareDraftsResult {
  const [drafts, setDrafts] = useState<ShareDraftListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await window.spool.shareDraft.list(opts.limit)
      setDrafts(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [opts.limit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const removeDraft = useCallback(async (draftId: string): Promise<ShareDraftRow | null> => {
    // Fetch the full row first so the caller can offer Undo with the
    // snapshot intact. listShareDrafts omits snapshot_json on purpose.
    const full = await window.spool.shareDraft.get(draftId)
    if (!full) return null
    setDrafts(prev => prev.filter(d => d.draft_id !== draftId))
    try {
      await window.spool.shareDraft.delete(draftId)
      return full
    } catch (err) {
      // Roll back the optimistic remove if the delete itself failed.
      void refresh()
      throw err
    }
  }, [refresh])

  const restoreDraft = useCallback(async (row: ShareDraftRow): Promise<void> => {
    await window.spool.shareDraft.upsert({
      draft_id: row.draft_id,
      source_kind: row.source_kind,
      source_origin: row.source_origin,
      title: row.title,
      snapshot_json: row.snapshot_json,
      preview_json: row.preview_json,
    })
    await refresh()
  }, [refresh])

  return { drafts, loading, error, refresh, removeDraft, restoreDraft }
}

/**
 * Cheap count of share drafts whose `source_kind = 'spool-session'` and
 * origin matches the given session uuid. Used by the ShareSourceChip on
 * SessionDetail to show that a session already has drafts at a glance.
 *
 * Fetches once per `sessionUuid` change; callers don't need to worry
 * about render-loop refetches.
 */
export function useDraftCountForSession(sessionUuid: string): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.spool.shareDraft.countBySession(sessionUuid)
      .then((n) => { if (!cancelled) setCount(n) })
      .catch(() => { if (!cancelled) setCount(0) })
    return () => { cancelled = true }
  }, [sessionUuid])

  return count
}
