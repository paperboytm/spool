import { useCallback, useState } from 'react'
import type { PublishSuccess } from '../../shared/share-publish.js'

/**
 * Tracks the publish modal's open/closed state plus the most recent
 * publish result. `PublishButton` owns one of these; downstream
 * surfaces (PublishedBadge) read the same `published` value so the
 * UI agrees on whether the current draft is live.
 */
export function usePublishShare(initial: PublishSuccess | null = null) {
  const [open, setOpen] = useState(false)
  const [published, setPublished] = useState<PublishSuccess | null>(initial)

  const openModal = useCallback(() => setOpen(true), [])
  const closeModal = useCallback(() => setOpen(false), [])

  const handlePublished = useCallback((result: PublishSuccess) => {
    setPublished(result)
    setOpen(false)
  }, [])

  const clearPublished = useCallback(() => setPublished(null), [])

  return { open, openModal, closeModal, published, handlePublished, clearPublished }
}
