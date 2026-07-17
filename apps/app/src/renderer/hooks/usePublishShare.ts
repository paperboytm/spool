import { useCallback, useState } from 'react'
import type { PublishSuccess } from '../../shared/share-publish.js'

/**
 * Tracks the most recent publish result for the current draft. The
 * Share popover (`ShareMenu` + `PublishTab`) reads `published` to
 * decide between the draft publish form and the post-publish manage
 * view; `handlePublished` is called when a publish/republish succeeds;
 * `clearPublished` runs after an unpublish so the UI flips back to
 * the draft form.
 */
export function usePublishShare(initial: PublishSuccess | null = null) {
  const [published, setPublished] = useState<PublishSuccess | null>(initial)

  const handlePublished = useCallback((result: PublishSuccess) => {
    setPublished(result)
  }, [])

  const clearPublished = useCallback(() => setPublished(null), [])

  return { published, handlePublished, clearPublished }
}
