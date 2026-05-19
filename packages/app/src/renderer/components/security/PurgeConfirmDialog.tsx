// Purge confirmation modal — the only destructive action in the
// Security Scan feature gets explicit friction, distinct from the
// inline Dismiss buttons.

import { Trash2, AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  count: number
  /** Optional one-line preview ("API keys", "API key + email", etc.) */
  summary?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function PurgeConfirmDialog({
  open,
  count,
  summary,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null
  return (
    <div
      data-testid="purge-confirm"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-warm-bg dark:bg-dark-bg rounded-lg shadow-xl w-[420px] max-w-[90vw] p-5 border border-warm-border dark:border-dark-border">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={22}
            strokeWidth={1.5}
            className="text-warm-accent dark:text-dark-accent flex-none mt-0.5"
            aria-hidden
          />
          <div className="flex-1">
            <h2 className="text-base font-medium text-warm-text dark:text-dark-text">
              Purge {count} finding{count === 1 ? '' : 's'}{summary ? ` (${summary})` : ''}?
            </h2>
            <p className="mt-2 text-sm text-warm-muted dark:text-dark-muted">
              This rewrites the raw value with a mask in your local archive.
              The originals in the source transcript files
              (<code className="font-mono text-xs">~/.claude/sessions/</code>…)
              are not changed.
            </p>
            <p className="mt-2 text-sm text-warm-muted dark:text-dark-muted">
              You will not be able to recover the original values from Spool.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="purge-cancel"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="purge-confirm-button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-warm-accent dark:bg-dark-accent text-white hover:opacity-90"
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
            Purge
          </button>
        </div>
      </div>
    </div>
  )
}
