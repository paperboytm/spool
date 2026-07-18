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
      className="bg-warm-text/30 fixed inset-0 z-50 flex items-center justify-center dark:bg-black/40"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border w-[460px] max-w-[90vw] overflow-hidden rounded-[10px] border font-sans"
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <div className="px-6 pt-5 pb-4">
          <div className="text-accent dark:text-accent-dark flex items-center gap-1.5 text-[12px] font-medium">
            <RotateCcw size={13} strokeWidth={1.7} aria-hidden />
            <span>{t('session.refreshPretitle')}</span>
          </div>
          <h2 className="text-warm-text dark:text-dark-text mt-2 text-[16px] leading-[22px] font-semibold tracking-[-0.005em]">
            {t('session.refreshConfirmTitle')}
          </h2>

          <p className="text-warm-muted dark:text-dark-muted mt-3 text-[13px] leading-[19px]">
            {t('session.refreshConfirmLead')}
          </p>

          <div
            className="border-accent/30 dark:border-accent-dark/35 bg-accent/[0.06] dark:bg-accent-dark/[0.10] mt-4 flex items-start gap-2 rounded-lg border p-3"
            role="note"
          >
            <ShieldAlert
              size={15}
              strokeWidth={1.7}
              aria-hidden
              className="text-accent dark:text-accent-dark mt-0.5 flex-none"
            />
            <div className="text-warm-text dark:text-dark-text min-w-0 flex-1 text-[12.5px] leading-[18px]">
              <div className="font-medium">{t('session.refreshConfirmWarnTitle')}</div>
              <div className="text-warm-muted dark:text-dark-muted mt-1">
                {t('session.refreshConfirmWarnBody')}
              </div>
            </div>
          </div>

          <p className="text-warm-faint dark:text-dark-muted mt-3 text-[12px] leading-[18px]">
            {t('session.refreshConfirmDismissNote')}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-6 pt-3 pb-5">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:border-warm-border2 dark:hover:border-dark-border2 inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="refresh-from-source-commit"
            onClick={onConfirm}
            className="bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark hover:bg-accent/90 dark:hover:bg-accent-dark/90 inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw size={12} strokeWidth={1.7} aria-hidden />
            {t('session.refreshConfirmAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
