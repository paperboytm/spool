import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useHotkeys } from '../hooks/useHotkeys.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

type Props = {
  open: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

/**
 * Centered confirmation for scheduling an account deletion.
 *
 * Why a modal (and not the previous in-place card): scheduling the
 * deletion is the gateway to a 24-hour countdown that, once expired,
 * permanently removes the user's account, every live share, and the
 * profile handle. The Spool app already uses a centered modal for the
 * equivalent Unpublish flow (see UnpublishConfirmModal) — keeping the
 * pattern consistent so destructive actions read with the same visual
 * weight everywhere they appear in the renderer.
 */
export function DeleteAccountConfirmModal({
  open,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useTranslation()
  useHotkeys(
    {
      Escape: () => {
        if (!busy) onClose()
      },
    },
    { active: open, modal: true },
  )

  // Lock body scroll while open so the long-form copy below can't
  // push the modal off the viewport on smaller windows.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Focus trap with initial focus on Cancel — see UnpublishConfirmModal.
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const trapRef = useFocusTrap<HTMLDivElement>(open, cancelRef)

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-confirm-title"
      data-testid="delete-account-confirm"
      ref={trapRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-warm-text/30 dark:bg-black/45 backdrop-blur-[2px] px-4 animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-[10px] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3">
          <h2
            id="delete-account-confirm-title"
            className="text-[15px] font-semibold text-warm-text dark:text-dark-text"
          >
            {t('settings.account.deleteConfirm_title')}
          </h2>
          <p className="mt-3 text-[12.5px] leading-relaxed text-warm-text dark:text-dark-text">
            {t('settings.account.deleteConfirm_lead')} <strong>{t('settings.account.deleteConfirm_leadEmphasis')}</strong>{t('settings.account.deleteConfirm_leadSuffix')}
          </p>
          {/* No handle bullet: public profiles are cut from the launch
           *  scope (see PROFILES_ENABLED in SettingsAccount), so the
           *  copy must not surface a handle concept — restore the
           *  deleteConfirm_item_handle line with the profiles flip. */}
          <ul className="mt-2 ml-4 list-disc text-[12.5px] leading-relaxed text-warm-muted dark:text-dark-muted space-y-0.5">
            <li>{t('settings.account.deleteConfirm_item_shares_prefix')} <strong>{t('settings.account.deleteConfirm_item_shares_emphasis')}</strong></li>
            <li>{t('settings.account.deleteConfirm_item_record')}</li>
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-warm-muted dark:text-dark-muted">
            {t('settings.account.deleteConfirm_footnote')}
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
            ref={cancelRef}
            onClick={onClose}
            disabled={busy}
            data-testid="delete-account-confirm-cancel"
            className="px-3 h-8 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="delete-account-confirm-yes"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-[12px] font-medium text-white bg-[color:var(--color-status-error)] hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={11} strokeWidth={1.8} className="animate-spin" aria-hidden />}
            {busy ? t('settings.account.deleteConfirm_scheduling') : t('settings.account.deleteConfirm_confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
