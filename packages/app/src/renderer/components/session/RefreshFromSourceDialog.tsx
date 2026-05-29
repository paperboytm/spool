// Confirms the "Refresh from source" action — rebuilds a single
// session's messages from its source jsonl, bypassing the append-only
// sync's classifySync gate. Surfaces the gravity (purged content
// reappears as raw, scanner re-runs) in the visual hierarchy the user
// will actually read: pretitle for the action, title for the
// question, one short lead paragraph, the load-bearing security
// caveat in a tinted callout box that earns its own attention, and
// the reassuring dismiss-survives footnote underneath. Mirrors
// PurgeConfirmDialog's outer shape (modal + Esc / click-outside
// cancel) so the two destructive flows feel uniform.

import { RotateCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from '../../hooks/useHotkeys.js'

interface Props {
  open: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function RefreshFromSourceDialog({ open, busy, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])
  useHotkeys({ Escape: onCancel }, { active: open && !busy, modal: true })

  if (!open) return null

  return (
    <div
      data-testid="refresh-from-source-confirm"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-warm-text/30 dark:bg-black/40"
      onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="font-sans bg-warm-bg dark:bg-dark-bg rounded-[10px] w-[460px] max-w-[90vw] overflow-hidden border border-warm-border dark:border-dark-border"
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent dark:text-accent-dark">
            <RotateCcw size={13} strokeWidth={1.7} aria-hidden />
            <span>{t('session.refreshPretitle')}</span>
          </div>
          <h2 className="mt-2 text-[16px] leading-[22px] font-semibold tracking-[-0.005em] text-warm-text dark:text-dark-text">
            {t('session.refreshConfirmTitle')}
          </h2>

          <p className="mt-3 text-[13px] leading-[19px] text-warm-muted dark:text-dark-muted">
            {t('session.refreshConfirmLead')}
          </p>

          <div
            className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 dark:border-accent-dark/35 bg-accent/[0.06] dark:bg-accent-dark/[0.10] p-3"
            role="note"
          >
            <ShieldAlert
              size={15}
              strokeWidth={1.7}
              aria-hidden
              className="flex-none mt-0.5 text-accent dark:text-accent-dark"
            />
            <div className="flex-1 min-w-0 text-[12.5px] leading-[18px] text-warm-text dark:text-dark-text">
              <div className="font-medium">{t('session.refreshConfirmWarnTitle')}</div>
              <div className="mt-1 text-warm-muted dark:text-dark-muted">
                {t('session.refreshConfirmWarnBody')}
              </div>
            </div>
          </div>

          <p className="mt-3 text-[12px] leading-[18px] text-warm-faint dark:text-dark-muted">
            {t('session.refreshConfirmDismissNote')}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-5 pt-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center h-7 px-2.5 rounded-md bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border text-[12px] font-medium text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:border-warm-border2 dark:hover:border-dark-border2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="refresh-from-source-commit"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-accent dark:bg-accent-dark border border-accent dark:border-accent-dark text-[12px] font-medium text-white hover:bg-accent/90 dark:hover:bg-accent-dark/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} strokeWidth={1.7} aria-hidden />
            {t('session.refreshConfirmAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
