// Allowlist Manage modal.
//
// Lists every dismissed-as-ignore entry: per-session and global scopes.
// Per-row destroy uses a click-twice confirm pattern (no separate
// confirmation dialog) — removing an entry doesn't un-dismiss the
// historical finding, it just lets future scans surface that kind+value
// again.
//
// Grouping: rows are bucketed by scope then alphabetised by kind. The
// global bucket renders first because those entries affect every
// session, the per-session bucket second.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Trash2 } from 'lucide-react'
import { useHotkeys } from '../../hooks/useHotkeys.js'
import type { AllowlistEntryRow } from '@spool-lab/core'
import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'
import { securityApi } from '../../api/security.js'

interface Props {
  onClose: () => void
}

export default function AllowlistManageModal({ onClose }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<AllowlistEntryRow[] | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    void securityApi.listAllowlistEntries().then(setEntries).catch(() => setEntries([]))
  }, [])
  useHotkeys({ Escape: onClose }, { modal: true })

  const buckets = useMemo(() => {
    if (!entries) return { global: [] as AllowlistEntryRow[], session: [] as AllowlistEntryRow[] }
    return {
      global: entries.filter((e) => e.scope === 'global'),
      session: entries.filter((e) => e.scope === 'session'),
    }
  }, [entries])

  async function remove(entry: AllowlistEntryRow) {
    const key = rowKey(entry)
    if (confirmKey !== key) { setConfirmKey(key); return }
    setBusyKey(key)
    try {
      await securityApi.removeAllowlistEntry({
        scope: entry.scope,
        kind: entry.kind as SensitiveKind,
        valueHash: entry.valueHash,
        ...(entry.sessionUuid ? { sessionUuid: entry.sessionUuid } : {}),
      })
      setEntries((prev) => prev?.filter((e) => rowKey(e) !== key) ?? [])
    } finally {
      setBusyKey(null)
      setConfirmKey(null)
    }
  }

  const total = entries?.length ?? 0

  return (
    <div
      data-testid="allowlist-manage"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-text/50 dark:bg-black/65 backdrop-blur-md pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-warm-bg dark:bg-dark-bg rounded-[10px] w-[720px] max-w-[calc(100vw-64px)] max-h-[70vh] flex flex-col overflow-hidden border border-warm-border dark:border-dark-border"
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-warm-border dark:border-dark-border">
          <div>
            <h2 className="text-[15px] leading-[20px] font-semibold tracking-[-0.005em] text-warm-text dark:text-dark-text">
              {t('settings.security.allowlist_modal_title', { defaultValue: 'Manage allowlist' })}
            </h2>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-0.5">
              {t('settings.security.allowlist_modal_sub', {
                count: total,
                defaultValue_one: '{{count}} ignored finding · click Remove to surface it again',
                defaultValue_other: '{{count}} ignored findings · click Remove to surface them again',
                defaultValue: `${total} ignored findings · click Remove to surface them again`,
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common.close', { defaultValue: 'Close' })}
            data-testid="allowlist-close"
            onClick={onClose}
            className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text p-1 rounded"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {entries === null ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          ) : total === 0 ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('settings.security.allowlist_empty', { defaultValue: 'No allowlist entries yet. Findings you dismiss as "ignore" will appear here.' })}
            </p>
          ) : (
            <>
              {buckets.global.length > 0 && (
                <Bucket
                  label={t('settings.security.allowlist_bucket_global', { defaultValue: 'Global (every session)' })}
                  entries={buckets.global}
                  confirmKey={confirmKey}
                  busyKey={busyKey}
                  onRemove={remove}
                />
              )}
              {buckets.session.length > 0 && (
                <Bucket
                  label={t('settings.security.allowlist_bucket_session', { defaultValue: 'Per-session' })}
                  entries={buckets.session}
                  confirmKey={confirmKey}
                  busyKey={busyKey}
                  onRemove={remove}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface BucketProps {
  label: string
  entries: AllowlistEntryRow[]
  confirmKey: string | null
  busyKey: string | null
  onRemove: (e: AllowlistEntryRow) => void
}
function Bucket({ label, entries, confirmKey, busyKey, onRemove }: BucketProps) {
  const { t } = useTranslation()
  return (
    <section className="mb-4 last:mb-0">
      <div className="text-[11px] font-medium text-warm-muted dark:text-dark-muted mb-1.5">{label}</div>
      <ul className="list-none m-0 p-0 divide-y divide-warm-border dark:divide-dark-border border border-warm-border dark:border-dark-border rounded-md overflow-hidden bg-warm-surface dark:bg-dark-surface">
        {entries.map((entry) => {
          const key = rowKey(entry)
          const isConfirming = confirmKey === key
          const isBusy = busyKey === key
          const label = SENSITIVE_KIND_LABEL[entry.kind as SensitiveKind] ?? entry.kind
          return (
            <li
              key={key}
              data-testid="allowlist-row"
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-warm-text dark:text-dark-text truncate">
                  {label}
                  <span className="ml-2 font-mono text-[10px] text-warm-faint dark:text-dark-muted">
                    {entry.valueHash.slice(0, 10)}…
                  </span>
                </div>
                {entry.sessionTitle && (
                  <div className="text-xs text-warm-muted dark:text-dark-muted truncate">
                    {entry.sessionTitle}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid="allowlist-remove"
                disabled={isBusy}
                onClick={() => onRemove(entry)}
                className={[
                  'inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
                  isConfirming
                    ? 'border-accent dark:border-accent-dark text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-bg dark:hover:bg-dark-bg',
                  isBusy ? 'opacity-60' : '',
                ].join(' ')}
              >
                <Trash2 size={11} strokeWidth={1.75} aria-hidden />
                {isConfirming
                  ? t('settings.security.allowlist_confirm', { defaultValue: 'Confirm' })
                  : t('settings.security.allowlist_remove', { defaultValue: 'Remove' })}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function rowKey(entry: AllowlistEntryRow): string {
  return `${entry.scope}:${entry.sessionUuid ?? '-'}:${entry.kind}:${entry.valueHash}`
}
