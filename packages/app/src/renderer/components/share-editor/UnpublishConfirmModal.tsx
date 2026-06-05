import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useHotkeys } from '../../hooks/useHotkeys.js'

type Props = {
  open: boolean
  /** Title of the share the user is about to unpublish — shown so the
   *  confirm prompt isn't a generic "are you sure". */
  title: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

/**
 * Centered confirmation for the irreversible Unpublish action.
 *
 * Why a modal (and not in-place click-twice inside the Share popover):
 * unpublish is a one-way operation at the backend — KV writes a
 * tombstone, the R2 snapshot blob is deleted, and the slug becomes
 * permanently 410. Republishing requires the desktop app to re-upload
 * (with a new URL). A popover-internal confirm reads as low-stakes;
 * the modal carries the visual weight the consequence deserves.
 */
export function UnpublishConfirmModal({
  open,
  title,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  useHotkeys(
    {
      Escape: () => {
        if (!busy) onClose()
      },
    },
    { active: open, modal: true },
  )

  // Lock body scroll while open so a long target title can't push the
  // modal off the viewport on smaller windows.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unpublish-confirm-title"
      data-testid="unpublish-confirm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-warm-text/30 dark:bg-black/45 backdrop-blur-[2px] px-4 animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3">
          <h2
            id="unpublish-confirm-title"
            className="text-[15px] font-semibold text-warm-text dark:text-dark-text"
          >
            Unpublish this share?
          </h2>
          <p
            className="mt-2 px-2 py-1.5 rounded-md bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border font-mono text-[11.5px] text-warm-muted dark:text-dark-muted truncate"
            title={title}
          >
            {title}
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-warm-text dark:text-dark-text">
            This is permanent. The link will return <strong>410 Gone</strong>, the snapshot
            is deleted from spool.pro storage, and the URL can't be reused. To share this
            conversation again you'll need to publish a fresh copy — it will have a new URL.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-3 text-[11.5px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="unpublish-confirm-cancel"
            className="px-3 h-8 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="unpublish-confirm-yes"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-[12px] font-medium text-white bg-[color:var(--color-status-error)] hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={11} strokeWidth={1.8} className="animate-spin" aria-hidden />}
            {busy ? 'Unpublishing…' : 'Yes, unpublish permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
