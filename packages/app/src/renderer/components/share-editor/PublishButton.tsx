import { useCallback, useState } from 'react'
import { ChevronDown, LogIn, Send } from 'lucide-react'
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
 * Editor topbar publish CTA. Three states:
 *
 *  1. Signed out → "Sign in to publish" — click runs Google OAuth via
 *     `useShareAuth().signIn`.
 *  2. Signed in, never published → "Publish ▾" — click opens
 *     `PublishModal`.
 *  3. Already published (current snapshot has a slug) → `PublishedBadge`
 *     with the View / Copy / Republish / Unpublish menu.
 */
export function PublishButton({ getEditorState, onRedactAll, initialPublished = null }: Props) {
  const { user, loading, signIn } = useShareAuth()
  const { open, openModal, closeModal, published, handlePublished, clearPublished } =
    usePublishShare(initialPublished)
  const [signingIn, setSigningIn] = useState(false)
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

  const onSignIn = useCallback(async () => {
    if (signingIn) return
    setSigningIn(true)
    try {
      await signIn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setSigningIn(false)
    }
  }, [signIn, signingIn])

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

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => { void onSignIn() }}
        disabled={signingIn}
        data-testid="share-editor-signin"
        style={noDragStyle}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[12px] font-medium text-warm-text dark:text-dark-text border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <LogIn size={12} strokeWidth={1.8} aria-hidden />
        <span>{signingIn ? 'Signing in…' : 'Sign in to publish'}</span>
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openPublishModal}
        data-testid="share-editor-publish"
        style={noDragStyle}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
      >
        <Send size={12} strokeWidth={1.8} aria-hidden />
        <span>Publish</span>
        <ChevronDown size={11} strokeWidth={1.8} aria-hidden />
      </button>
      {open && pending && (
        <PublishModal
          conversation={pending.conversation}
          opts={pending.opts}
          hasHandle={!!user.handle}
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
