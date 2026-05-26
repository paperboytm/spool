// "Ignored items" modal (formerly "Manage allowlist").
//
// Lists every finding the user told Spool to stop flagging — per-
// session and global scopes. The allowlist stores only a non-crypto
// hash of the value for rescan matching (never plaintext), so a hash
// slice is meaningless to a human. This surface reframes each row for
// RECOGNITION: kind label + a lossy, non-reversible preview
// (`Stripe ••a39f`, computed at ignore time) + where it applies +
// how long ago it was ignored.
//
// "Stop ignoring" un-ignores a value (removes the allowlist row) so
// the next scan surfaces it again. It is NOT destructive — no data is
// deleted, the historical dismissed finding is untouched — hence a
// non-trash icon and the click-twice in-place confirm (no modal).
//
// Grouping: rows bucket by scope. "Everywhere" (global) renders first
// because those decisions affect every session; "This session"
// per-session entries second.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, EyeOff } from 'lucide-react'
import { useHotkeys } from '../../hooks/useHotkeys.js'
import type { AllowlistEntryRow, DismissReason } from '@spool-lab/core'
import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'
import { securityApi } from '../../api/security.js'
import { formatScanAgo } from './page-helpers.js'

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

  async function stopIgnoring(entry: AllowlistEntryRow) {
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
              {t('settings.security.allowlist_modal_title', { defaultValue: 'Ignored items' })}
            </h2>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-0.5">
              {t('settings.security.allowlist_modal_sub', {
                defaultValue: 'Things you told Spool to stop flagging. Stop ignoring one and the next scan flags it again.',
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
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {entries === null ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          ) : total === 0 ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('settings.security.allowlist_empty', { defaultValue: 'Nothing ignored yet. Findings you choose to ignore will appear here.' })}
            </p>
          ) : (
            <>
              {buckets.global.length > 0 && (
                <Bucket
                  label={t('settings.security.allowlist_bucket_global', { defaultValue: 'Everywhere' })}
                  entries={buckets.global}
                  confirmKey={confirmKey}
                  busyKey={busyKey}
                  onStopIgnoring={stopIgnoring}
                />
              )}
              {buckets.session.length > 0 && (
                <Bucket
                  label={t('settings.security.allowlist_bucket_session', { defaultValue: 'This session' })}
                  entries={buckets.session}
                  confirmKey={confirmKey}
                  busyKey={busyKey}
                  onStopIgnoring={stopIgnoring}
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
  onStopIgnoring: (e: AllowlistEntryRow) => void
}
function Bucket({ label, entries, confirmKey, busyKey, onStopIgnoring }: BucketProps) {
  const { t } = useTranslation()
  return (
    <section className="mb-4 last:mb-0">
      <div className="text-[11px] font-medium text-warm-muted dark:text-dark-muted mb-1.5">{label}</div>
      <ul className="list-none m-0 p-0 divide-y divide-warm-border dark:divide-dark-border border border-warm-border dark:border-dark-border rounded-md overflow-hidden bg-warm-surface dark:bg-dark-surface">
        {entries.map((entry) => {
          const key = rowKey(entry)
          const isConfirming = confirmKey === key
          const isBusy = busyKey === key
          const kindLabel = SENSITIVE_KIND_LABEL[entry.kind as SensitiveKind] ?? entry.kind
          return (
            <li
              key={key}
              data-testid="allowlist-row"
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm text-warm-text dark:text-dark-text shrink-0">{kindLabel}</span>
                  {entry.preview && (
                    <span
                      data-testid="allowlist-preview"
                      className="font-mono text-[11px] text-warm-muted dark:text-dark-muted truncate"
                    >
                      {entry.preview}
                    </span>
                  )}
                </div>
                <div className="text-xs text-warm-muted dark:text-dark-muted truncate mt-0.5">
                  {locationLabel(entry, t)}
                  {entry.createdAt && (
                    <span className="text-warm-faint dark:text-dark-faint"> · {formatScanAgo(entry.createdAt)}</span>
                  )}
                  {entry.reason && (
                    <span className="text-warm-faint dark:text-dark-faint"> · {reasonLabel(entry.reason, t)}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                data-testid="allowlist-remove"
                disabled={isBusy}
                onClick={() => onStopIgnoring(entry)}
                className={[
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors shrink-0',
                  isConfirming
                    ? 'border-accent dark:border-accent-dark text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-bg dark:hover:bg-dark-bg',
                  isBusy ? 'opacity-60' : '',
                ].join(' ')}
              >
                <EyeOff size={12} strokeWidth={1.5} aria-hidden />
                {isConfirming
                  ? t('settings.security.allowlist_confirm', { defaultValue: 'Confirm' })
                  : t('settings.security.allowlist_remove', { defaultValue: 'Stop ignoring' })}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function locationLabel(entry: AllowlistEntryRow, t: TFunction): string {
  if (entry.scope === 'global') {
    return t('settings.security.allowlist_in_every_session', { defaultValue: 'in every session' })
  }
  const title = entry.sessionTitle?.trim()
  return title
    ? t('settings.security.allowlist_in_session', { title, defaultValue: 'in {{title}}' })
    : t('settings.security.allowlist_in_one_session', { defaultValue: 'in one session' })
}

function reasonLabel(reason: DismissReason, t: TFunction): string {
  switch (reason) {
    case 'not-secret':
      return t('settings.security.reason_not_secret', { defaultValue: 'Not a real secret' })
    case 'test-credential':
      return t('settings.security.reason_test_credential', { defaultValue: 'Test credential' })
    case 'low-risk':
      return t('settings.security.reason_low_risk', { defaultValue: 'Low-risk / mine' })
    case 'acknowledged':
      return t('settings.security.reason_acknowledged', { defaultValue: 'Acknowledged' })
  }
}

function rowKey(entry: AllowlistEntryRow): string {
  return `${entry.scope}:${entry.sessionUuid ?? '-'}:${entry.kind}:${entry.valueHash}`
}
