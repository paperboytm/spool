// Purge confirmation modal — one-way door, NOT a fearmonger.
//
// Friction is a literal before/after preview of the substitution that's
// about to happen, not a red banner. The modal shows the exact mask
// rewrite in monospace.

import {
  HIGH_SEVERITY_KINDS,
  detectVendor,
  rotationUrlForToken,
  type SensitiveKind,
} from '@spool-lab/redact'
import { AlertTriangle, Eraser, ExternalLink, KeyRound } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useHotkeys } from '../../hooks/useHotkeys.js'
import { friendlyMaskName } from './format.js'
import { truncateValue } from './truncate-value.js'

interface BulkSample {
  /** Raw value being rewritten (may be truncated by caller). */
  value: string
  /** Session title for the sample row's right-hand label. */
  sessionTitle: string
}

interface Props {
  open: boolean
  count: number
  /** SensitiveKind being purged — drives the friendly mask label. */
  kind: string
  /** Real raw value preview, for single-finding mode. Optional. */
  before?: string
  /** True for the bulk variant — different copy + samples. */
  bulk?: boolean
  /** Up to 4 sample rows shown in the bulk variant; the rest collapse into
   *  a "+ N more" footer. Optional — the modal still renders without them. */
  bulkSamples?: BulkSample[]
  /** Whether the purge set contains a credential-tier finding, driving
   *  the rotate-reminder. For single-kind purges leave it undefined and
   *  the dialog derives it from `kind`; mixed/bulk callers must pass it
   *  explicitly since `kind` is then only a representative label. */
  hasCredential?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function PurgeConfirmDialog({
  open,
  count,
  kind,
  before,
  bulk,
  bulkSamples,
  hasCredential,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])
  useHotkeys({ Escape: onCancel }, { active: open, modal: true })

  if (!open) return null

  const friendly = friendlyMaskName(kind)
  const afterValue = `[redacted: ${friendly}]`
  const beforePreview = before ? truncateValue(before) : undefined
  const showBeforeRow = Boolean(beforePreview && !bulk)
  // Credentials (api-key, token, connection-string, private-key, …) can
  // still be live. Purging only masks Spool's copy — the original
  // session file is untouched and the value may already be exposed — so
  // for these kinds the only action that actually closes the leak is
  // rotating/revoking at the source. Identity-tier kinds (email, phone)
  // can't be "rotated", so the reminder is scoped to high severity.
  // Single-kind purges derive this from `kind`; mixed/bulk callers pass
  // `hasCredential` explicitly because `kind` is then just a label.
  const isCredential = hasCredential ?? HIGH_SEVERITY_KINDS.has(kind as SensitiveKind)

  // Rotate-at-source deep link. Only meaningful for single-finding
  // purges where we have the raw value to resolve the vendor — bulk
  // purges span many (possibly mixed-vendor) values, so no single link
  // applies. Falls back to null (reminder text only) for unknown
  // vendors or vendors without a verified rotation URL.
  const vendor = isCredential && before && !bulk ? detectVendor(before) : null
  const rotateUrl = vendor ? rotationUrlForToken(before!) : null

  return (
    <div
      data-testid="purge-confirm"
      role="dialog"
      aria-modal="true"
      className="bg-warm-text/30 fixed inset-0 z-50 flex items-center justify-center dark:bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className={`bg-warm-bg dark:bg-dark-bg rounded-[10px] font-sans ${bulk ? 'w-[520px]' : 'w-[460px]'} border-warm-border dark:border-dark-border max-w-[90vw] overflow-hidden border`}
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <div className="px-6 pt-5 pb-4">
          <div className="text-accent dark:text-accent-dark flex items-center gap-1.5 text-[12px] font-medium">
            <AlertTriangle size={13} strokeWidth={1.7} aria-hidden />
            <span>
              {bulk
                ? t('security.purge_pretitle_bulk', { defaultValue: 'One-way action · bulk' })
                : t('security.purge_pretitle', { defaultValue: 'One-way action' })}
            </span>
          </div>
          <h2 className="text-warm-text dark:text-dark-text mt-2 text-[16px] leading-[22px] font-semibold tracking-[-0.005em]">
            {bulk ? (
              <>
                {t('security.purge_title_bulk_a', { defaultValue: 'Rewrite' })}{' '}
                <span className="font-mono tabular-nums">{count}</span>{' '}
                <span className="text-accent dark:text-accent-dark font-mono text-[15px]">
                  {kind}
                </span>{' '}
                {t('security.purge_title_bulk_b', { defaultValue: 'findings?' })}
              </>
            ) : (
              t('security.purge_title_single', {
                defaultValue: 'Rewrite this finding inside Spool?',
              })
            )}
          </h2>

          <div className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface mt-4 overflow-hidden rounded-lg border">
            {showBeforeRow ? (
              <DiffRow
                label={t('security.diff_before', { defaultValue: 'before' })}
                value={beforePreview!}
                variant="before"
              />
            ) : bulk ? (
              <DiffRow
                label={t('security.diff_pattern', { defaultValue: 'pattern' })}
                value={t('security.purge_bulk_pattern', {
                  defaultValue: '{{count}} values across the active set',
                  count,
                })}
                variant="before"
              />
            ) : (
              <DiffRow
                label={t('security.diff_before', { defaultValue: 'before' })}
                value={t('security.purge_unknown_value', { defaultValue: 'the matched value' })}
                variant="before"
              />
            )}
            <DiffRow
              label={
                bulk
                  ? t('security.diff_becomes', { defaultValue: 'becomes' })
                  : t('security.diff_after', { defaultValue: 'after' })
              }
              value={afterValue}
              variant="after"
            />
          </div>

          {bulk && bulkSamples && bulkSamples.length > 0 && (
            <div className="mt-4">
              <div className="text-warm-muted dark:text-dark-muted mb-2 text-[11px] leading-[14px] font-semibold">
                {t('security.purge_bulk_samples_label', {
                  defaultValue: 'Sample of values that will be rewritten',
                })}
              </div>
              <ul className="m-0 grid list-none gap-1 p-0">
                {bulkSamples.slice(0, 4).map((s, i) => (
                  <li
                    key={i}
                    className="text-warm-muted dark:text-dark-muted grid gap-3 font-mono text-[11px] tabular-nums"
                    style={{ gridTemplateColumns: '1fr auto' }}
                  >
                    <span className="text-warm-text dark:text-dark-text truncate">{s.value}</span>
                    <span className="text-warm-faint dark:text-dark-muted max-w-[200px] truncate">
                      {s.sessionTitle}
                    </span>
                  </li>
                ))}
                {count > 4 && (
                  <li className="text-warm-faint dark:text-dark-muted mt-0.5 font-mono text-[11px] tabular-nums">
                    {t('security.purge_bulk_samples_more', {
                      count: count - 4,
                      defaultValue: '+ {{count}} more',
                    })}
                  </li>
                )}
              </ul>
            </div>
          )}

          {isCredential && (
            <div className="border-accent/20 dark:border-accent-dark/20 bg-accent/[0.06] dark:bg-accent-dark/[0.07] mt-4 rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <KeyRound
                  size={14}
                  strokeWidth={1.7}
                  className="text-accent dark:text-accent-dark mt-[1px] flex-none"
                  aria-hidden
                />
                <p className="text-warm-text dark:text-dark-text m-0 text-[12px] leading-[17px]">
                  {t('security.purge_rotate_reminder', {
                    defaultValue:
                      'This only masks Spool’s copy. If it’s a live secret, rotate or revoke it at the source — it may already be exposed elsewhere.',
                  })}
                </p>
              </div>
              {rotateUrl && (
                <div className="mt-2 flex justify-end">
                  <a
                    data-testid="rotate-link"
                    data-vendor={vendor!}
                    href={rotateUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent dark:text-accent-dark inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap underline-offset-2 transition-colors hover:underline"
                  >
                    {t('security.rotate_at_vendor', {
                      vendor,
                      defaultValue: 'Rotate at {{vendor}}',
                    })}
                    <ExternalLink size={12} strokeWidth={1.7} aria-hidden className="opacity-80" />
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="mt-3.5 flex flex-col gap-1.5">
            <Fact>
              {t('security.purge_fact_originals', {
                defaultValue:
                  'Originals in ~/.claude/sessions/ are untouched — the session stays resumable.',
              })}
            </Fact>
            <Fact>
              {t('security.purge_fact_permanent', {
                defaultValue:
                  "The mask is permanent inside Spool — you won't be able to recover the value from here.",
              })}
            </Fact>
            {bulk && (
              <Fact>
                {t('security.purge_fact_fts', {
                  defaultValue:
                    'FTS index updates automatically; pinned and shared sessions keep their references.',
                })}
              </Fact>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 pt-3 pb-5">
          <button
            ref={cancelRef}
            type="button"
            data-testid="purge-cancel"
            onClick={onCancel}
            className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:border-warm-border2 dark:hover:border-dark-border2 inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            data-testid="purge-confirm-button"
            onClick={onConfirm}
            className="bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark hover:bg-accent/90 dark:hover:bg-accent-dark/90 inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium text-white transition-colors"
          >
            <Eraser size={12} strokeWidth={1.7} aria-hidden />
            {t('security.purge_confirm', { defaultValue: 'Purge' })}
          </button>
        </div>
      </div>
    </div>
  )
}

function DiffRow({
  label,
  value,
  variant,
}: {
  label: string
  value: string
  variant: 'before' | 'after'
}) {
  const valueClass =
    variant === 'before'
      ? 'text-warm-text dark:text-dark-text'
      : 'text-accent dark:text-accent-dark'
  return (
    <div
      className="border-warm-border dark:border-dark-border grid border-t border-dashed font-mono text-[12px] leading-[18px] first:border-t-0"
      style={{ gridTemplateColumns: '60px 1fr' }}
    >
      <span className="text-warm-faint dark:text-dark-muted border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface border-r px-2.5 py-2 text-right text-[11px]">
        {label}
      </span>
      <span className={`truncate px-3 py-2 ${valueClass}`}>{value}</span>
    </div>
  )
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-warm-muted dark:text-dark-muted grid gap-2 text-[12px] leading-4"
      style={{ gridTemplateColumns: '12px 1fr' }}
    >
      <span className="text-accent dark:text-accent-dark leading-4 font-bold">·</span>
      <span>{children}</span>
    </div>
  )
}
