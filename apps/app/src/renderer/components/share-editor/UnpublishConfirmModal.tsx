import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useFocusTrap } from '../../hooks/useFocusTrap.js'
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
export function UnpublishConfirmModal({ open, title, busy, error, onClose, onConfirm }: Props) {
  const { t } = useTranslation()
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

  // Focus trap: Tab/Shift+Tab stays inside the modal; initial focus
  // lands on Cancel (the safe default for a destructive confirm) so a
  // user pressing Enter immediately on open doesn't commit the action.
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const trapRef = useFocusTrap<HTMLDivElement>(open, cancelRef)

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unpublish-confirm-title"
      data-testid="unpublish-confirm"
      ref={trapRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      className="bg-warm-text/30 animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center px-4 backdrop-blur-[2px] duration-150 dark:bg-black/45"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] border shadow-xl"
      >
        <div className="px-5 pt-5 pb-3">
          <h2
            id="unpublish-confirm-title"
            className="text-warm-text dark:text-dark-text text-[15px] font-semibold"
          >
            {t('shareEditor.unpublishConfirm.title')}
          </h2>
          <p
            className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted mt-2 truncate rounded-md border px-2 py-1.5 font-mono text-[11.5px]"
            title={title}
          >
            {title}
          </p>
          <p className="text-warm-text dark:text-dark-text mt-3 text-[12.5px] leading-relaxed">
            {t('shareEditor.unpublishConfirm.body_prefix')}{' '}
            <strong>{t('shareEditor.unpublishConfirm.body_emphasis')}</strong>
            {t('shareEditor.unpublishConfirm.body_suffix')}
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
        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5">
          <button
            type="button"
            ref={cancelRef}
            onClick={onClose}
            disabled={busy}
            data-testid="unpublish-confirm-cancel"
            className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface h-8 rounded-md px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="unpublish-confirm-yes"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[color:var(--color-status-error)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 size={11} strokeWidth={1.8} className="animate-spin" aria-hidden />}
            {busy
              ? t('shareEditor.unpublishConfirm.confirming')
              : t('shareEditor.unpublishConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
