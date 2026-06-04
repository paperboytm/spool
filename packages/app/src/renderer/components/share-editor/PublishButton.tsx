import { useCallback, useState } from 'react'
import { ChevronDown, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation, EditorOpts } from '@spool/share-kit'
import { PublishModal } from './PublishModal.js'
import { PublishedBadge, type PublishedBadgeAction } from './PublishedBadge.js'
import { useShareAuth } from '../../hooks/useShareAuth.js'
import { usePublishShare } from '../../hooks/usePublishShare.js'
import type { PublishSuccess } from '../../../shared/share-publish.js'

type Props = {
  /** Lazy editor-state getter — called only when the user opens the
   *  modal or republishes, so we don't pay for a Conversation clone
   *  on every render. Returns null while the editor is still loading. */
  getEditorState: () => { conversation: Conversation; opts: EditorOpts } | null
  /** Called when the user clicks "Redact all" in the modal's high-risk
   *  warning. Should flip `opts.redact` to true in the editor's state
   *  so the live PII gate clears. */
  onRedactAll?: () => void
  /** Initial published state, e.g. when reopening a draft that's
   *  already live. `null` means "draft only". */
  initialPublished?: PublishSuccess | null
}

/**
 * Editor topbar publish CTA. Two visual states:
 *
 *  1. Draft (signed in OR out) → "Publish ▾" — click opens
 *     `PublishModal`. The modal renders a ConnectCard when signed-out
 *     so we never gate the button itself on auth.
 *  2. Already published (current snapshot has a slug) → `PublishedBadge`
 *     with the View / Copy / Republish / Unpublish menu.
 */
export function PublishButton({ getEditorState, onRedactAll, initialPublished = null }: Props) {
  const { user, loading } = useShareAuth()
  const { open, openModal, closeModal, published, handlePublished, clearPublished } =
    usePublishShare(initialPublished)
  const [pending, setPending] = useState<{ conversation: Conversation; opts: EditorOpts } | null>(
    null,
  )

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  const openPublishModal = useCallback(() => {
    const state = getEditorState()
    if (!state) {
      toast.error('Nothing to publish yet — the editor is still loading.')
      return
    }
    setPending(state)
    openModal()
  }, [getEditorState, openModal])

  const onBadgeAction = useCallback(
    async (action: PublishedBadgeAction) => {
      if (!published) return
      if (action.kind === 'view') {
        window.open(published.url, '_blank', 'noopener,noreferrer')
        return
      }
      if (action.kind === 'copy') {
        try {
          await navigator.clipboard.writeText(published.url)
          toast.success('Link copied')
        } catch {
          toast.error('Could not copy link')
        }
        return
      }
      if (action.kind === 'republish') {
        openPublishModal()
        return
      }
      if (action.kind === 'unpublish') {
        try {
          await window.spoolShare.revoke(published.id)
          clearPublished()
          toast.success('Unpublished')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not unpublish.')
        }
        return
      }
    },
    [published, openPublishModal, clearPublished],
  )

  if (loading) {
    return (
      <div
        className="inline-flex items-center h-6 px-2 rounded text-[12px] font-medium text-warm-faint dark:text-dark-muted"
        style={noDragStyle}
      >
        …
      </div>
    )
  }

  if (published) {
    return (
      <>
        <PublishedBadge url={published.url} onAction={(a) => { void onBadgeAction(a) }} />
        {open && pending && user && (
          <PublishModal
            conversation={pending.conversation}
            opts={pending.opts}
            hasHandle={!!user.handle}
            existingSlug={published.id}
            {...(onRedactAll && { onRedactAll })}
            onClose={closeModal}
            onPublished={(r) => {
              handlePublished(r)
              toast.success('Republished')
            }}
          />
        )}
      </>
    )
  }

  // Draft branch — signed in or out. The button always reads "Publish".
  // The modal handles the signed-out case by rendering the ConnectCard
  // ahead of the form, so a fresh user lands in one consistent place
  // instead of two diverging entry points.
  return (
    <>
      <button
        type="button"
        onClick={openPublishModal}
        data-testid="share-editor-publish"
        style={noDragStyle}
        className="inline-flex items-center gap-1.5 h-[26px] px-[9px] rounded-md text-[12px] font-medium text-warm-text dark:text-dark-text border border-warm-border2 dark:border-dark-border2 bg-transparent hover:bg-accent-bg hover:dark:bg-accent-bg-dark hover:border-accent hover:dark:border-accent-dark hover:text-accent hover:dark:text-accent-dark transition-colors"
      >
        <Send size={12} strokeWidth={1.8} aria-hidden className="text-accent dark:text-accent-dark" />
        <span>Publish</span>
        <ChevronDown size={11} strokeWidth={1.8} aria-hidden />
      </button>
      {open && pending && (
        <PublishModal
          conversation={pending.conversation}
          opts={pending.opts}
          hasHandle={!!user?.handle}
          {...(onRedactAll && { onRedactAll })}
          onClose={closeModal}
          onPublished={(r) => {
            handlePublished(r)
            toast.success('Published')
          }}
        />
      )}
    </>
  )
}
