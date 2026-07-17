// "Ignored items" modal (formerly "Manage allowlist").
//
// Lists every finding the user told Spool to stop flagging. The
// allowlist stores only a non-crypto hash of the value for rescan
// matching (never plaintext), so a hash slice is meaningless to a
// human. Each row LEADS with the live value, reconstructed at read
// time from the source message — exactly the plaintext the findings
// view displays — with the same blur + hover/click reveal (driven by
// `securityPageValuesBlurred`). Kind is a muted subtitle; scope + time
// sit on the right and swap to the "Stop ignoring" action on hover.
//
// Layout borrows the calm list-row pattern from Linear / Raycast:
// borderless rows, full-row hover highlight, primary value + secondary
// subtitle on the left, right-aligned meta that yields to an on-hover
// action — and a macOS-Settings-style search tucked into the header
// rather than a floating box. One flat recency list, not scope-grouped
// (two stacked groups bury the smaller once the larger grows); scope is
// a per-row label and the filter narrows by value / kind / session.
//
// "Stop ignoring" un-ignores a value (removes the allowlist row) so the
// next scan surfaces it again. NOT destructive — click-twice in-place
// confirm, no trash icon, hidden until hover.

import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Search, ChevronDown } from 'lucide-react'
import { useHotkeys } from '../../hooks/useHotkeys.js'
import type { AllowlistEntryRow } from '@spool-lab/core'
import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'
import { securityApi } from '../../api/security.js'
import Menu from '../Menu.js'
import { formatScanAgo } from './page-helpers.js'
import { truncateValue } from './truncate-value.js'
import { filterIgnoredEntries } from './filter-ignored.js'

interface Props {
  onClose: () => void
}

export default function AllowlistManageModal({ onClose }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<AllowlistEntryRow[] | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'session'>('all')

  useEffect(() => {
    void securityApi.listAllowlistEntries().then(setEntries).catch(() => setEntries([]))
  }, [])
  // Clear a pending in-place confirm when the filters change, so a row
  // that's filtered out and later reappears doesn't come back mid-confirm.
  useEffect(() => { setConfirmKey(null) }, [filter, kindFilter, scopeFilter])
  useHotkeys({ Escape: onClose }, { modal: true })

  const total = entries?.length ?? 0

  // Distinct kinds present in the list, for the type dropdown — scoped
  // to what's actually ignored, not all 20+ detector kinds.
  const presentKinds = useMemo(() => {
    if (!entries) return [] as Array<{ kind: string; label: string }>
    const seen = new Map<string, string>()
    for (const e of entries) {
      if (!seen.has(e.kind)) seen.set(e.kind, SENSITIVE_KIND_LABEL[e.kind as SensitiveKind] ?? e.kind)
    }
    return [...seen.entries()]
      .map(([kind, label]) => ({ kind, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [entries])

  const visible = useMemo(() => {
    if (!entries) return []
    return filterIgnoredEntries(entries, { scope: scopeFilter, kind: kindFilter, query: filter })
  }, [entries, filter, kindFilter, scopeFilter])

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

  return (
    <div
      data-testid="ignored-manage"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-text/50 dark:bg-black/65 backdrop-blur-md pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-warm-bg dark:bg-dark-bg rounded-[10px] w-[720px] max-w-[calc(100vw-64px)] min-h-[240px] max-h-[70vh] flex flex-col overflow-hidden border border-warm-border dark:border-dark-border"
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-2">
          <h2 className="min-w-0 text-[15px] leading-[20px] font-semibold tracking-[-0.005em] text-warm-text dark:text-dark-text">
            {t('settings.security.allowlist_modal_title', { defaultValue: 'Ignored items' })}
          </h2>
          <button
            type="button"
            aria-label={t('common.close', { defaultValue: 'Close' })}
            data-testid="ignored-close"
            onClick={onClose}
            className="flex-none w-7 h-7 inline-flex items-center justify-center text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface rounded-md -mr-1"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        {total > 0 && (
          <div className="flex items-center gap-1 px-5 pb-3">
            <FilterMenu
              first
              testId="ignored-scope-menu"
              label={
                scopeFilter === 'all'
                  ? t('settings.security.allowlist_all_scopes', { defaultValue: 'All scopes' })
                  : scopeFilter === 'global'
                    ? t('settings.security.allowlist_scope_everywhere', { defaultValue: 'Everywhere' })
                    : t('settings.security.allowlist_bucket_session', { defaultValue: 'Per session' })
              }
              items={[
                { label: t('settings.security.allowlist_all_scopes', { defaultValue: 'All scopes' }), active: scopeFilter === 'all', onSelect: () => setScopeFilter('all') },
                { label: t('settings.security.allowlist_scope_everywhere', { defaultValue: 'Everywhere' }), active: scopeFilter === 'global', onSelect: () => setScopeFilter('global') },
                { label: t('settings.security.allowlist_bucket_session', { defaultValue: 'Per session' }), active: scopeFilter === 'session', onSelect: () => setScopeFilter('session') },
              ]}
            />
            <FilterMenu
              testId="ignored-kind-menu"
              label={
                kindFilter
                  ? (SENSITIVE_KIND_LABEL[kindFilter as SensitiveKind] ?? kindFilter)
                  : t('settings.security.allowlist_all_types', { defaultValue: 'All types' })
              }
              items={[
                { label: t('settings.security.allowlist_all_types', { defaultValue: 'All types' }), active: kindFilter === null, onSelect: () => setKindFilter(null) },
                ...presentKinds.map((k) => ({ label: k.label, active: kindFilter === k.kind, onSelect: () => setKindFilter(k.kind) })),
              ]}
            />
            <div className="flex items-center gap-1.5 h-6 flex-1 min-w-0 max-w-[220px] ml-1 px-2 rounded bg-warm-surface dark:bg-dark-surface">
              <Search size={12} strokeWidth={1.75} className="text-warm-faint dark:text-dark-faint shrink-0" aria-hidden />
              <input
                type="text"
                data-testid="ignored-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('settings.security.allowlist_filter_placeholder', { defaultValue: 'Filter…' })}
                className="flex-1 min-w-0 bg-transparent text-[12px] text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-faint outline-none"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
          {entries === null ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          ) : total === 0 ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('settings.security.allowlist_empty', { defaultValue: 'Nothing ignored yet. Findings you choose to ignore will appear here.' })}
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-6 text-center">
              {t('settings.security.allowlist_no_matches', { defaultValue: 'No ignored items match your filter.' })}
            </p>
          ) : (
            <ul className="list-none m-0 p-0">
              {visible.map((entry) => (
                <IgnoredRow
                  key={rowKey(entry)}
                  entry={entry}
                  isConfirming={confirmKey === rowKey(entry)}
                  isBusy={busyKey === rowKey(entry)}
                  onStopIgnoring={stopIgnoring}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  entry: AllowlistEntryRow
  isConfirming: boolean
  isBusy: boolean
  onStopIgnoring: (e: AllowlistEntryRow) => void
}
function IgnoredRow({ entry, isConfirming, isBusy, onStopIgnoring }: RowProps) {
  const { t } = useTranslation()
  const kindLabel = SENSITIVE_KIND_LABEL[entry.kind as SensitiveKind] ?? entry.kind
  const hasValue = entry.value !== null && entry.value !== undefined
  const kindOrUnavailable = hasValue
    ? kindLabel
    : t('settings.security.allowlist_value_unavailable', { defaultValue: 'original no longer available' })
  // Kind + scope live together under the value; the right column is a
  // clean, consistent time stamp (no ragged scope text floating right).
  const subtitle = `${kindOrUnavailable} · ${scopeLabel(entry, t)}`
  const time = entry.createdAt ? formatScanAgo(entry.createdAt) : ''
  return (
    <li
      data-testid="ignored-row"
      className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
    >
      <div className="min-w-0 flex-1">
        {hasValue
          ? <IgnoredValue value={entry.value as string} />
          : <span className="block text-[13px] text-warm-muted dark:text-dark-muted truncate">{kindLabel}</span>}
        <div className="text-[11px] text-warm-faint dark:text-dark-faint truncate mt-0.5">{subtitle}</div>
      </div>
      <div className="relative flex-none flex items-center justify-end min-w-[100px]">
        <span
          className={`whitespace-nowrap text-[11px] tabular-nums text-warm-faint dark:text-dark-faint transition-opacity duration-100 ${
            isConfirming ? 'opacity-0' : 'group-hover:opacity-0'
          }`}
        >
          {time}
        </span>
        <button
          type="button"
          data-testid="stop-ignoring-button"
          disabled={isBusy}
          onClick={() => onStopIgnoring(entry)}
          className={[
            'absolute right-0 inset-y-0 my-auto h-6 inline-flex items-center px-2 rounded-md text-xs whitespace-nowrap transition-opacity duration-100 focus-visible:opacity-100',
            isConfirming
              ? 'opacity-100 text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
              : 'opacity-0 group-hover:opacity-100 text-warm-muted dark:text-dark-muted bg-warm-surface2 dark:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text',
            isBusy ? 'opacity-60' : '',
          ].join(' ')}
        >
          {isConfirming
            ? t('settings.security.allowlist_confirm', { defaultValue: 'Confirm' })
            : t('settings.security.allowlist_remove', { defaultValue: 'Stop ignoring' })}
        </button>
      </div>
    </li>
  )
}

// Compact filter dropdown used for both the scope and the kind filters
// in the toolbar — a subtle pill whose label reflects the current
// selection, opening the shared Menu.
function FilterMenu({ testId, label, items, first }: {
  testId: string
  label: string
  items: ComponentProps<typeof Menu>['items']
  first?: boolean
}) {
  // Native-select trick: stack every option label in one grid cell so
  // the trigger is exactly as wide as its WIDEST option — tight (no
  // dead space) AND stable (never reflows the row when the selection
  // changes). Only the current label is visible.
  const labels = items.flatMap((i) => ('label' in i ? [i.label] : []))
  return (
    <Menu
      align="left"
      testId={testId}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          data-testid={testId.replace('-menu', '-filter')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex-none inline-flex items-center gap-1 h-6 px-1.5 rounded text-[12px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors ${first ? '-ml-1.5' : ''}`}
        >
          <span className="grid max-w-[160px] text-left">
            {labels.map((l) => (
              <span key={l} className={`col-start-1 row-start-1 truncate ${l === label ? '' : 'invisible'}`}>{l}</span>
            ))}
          </span>
          <ChevronDown size={12} strokeWidth={1.7} aria-hidden className="shrink-0 text-warm-faint dark:text-dark-faint" />
        </button>
      )}
      items={items}
    />
  )
}

// Per-row scope label — replaces the old scope group headers so a flat
// recency list still tells global from session-scoped at a glance.
function scopeLabel(entry: AllowlistEntryRow, t: TFunction): string {
  if (entry.scope === 'global') {
    return t('settings.security.allowlist_scope_everywhere', { defaultValue: 'Everywhere' })
  }
  const title = entry.sessionTitle?.trim()
  return title
    ? t('settings.security.allowlist_in_session', { title, defaultValue: 'in {{title}}' })
    : t('settings.security.allowlist_in_one_session', { defaultValue: 'in one session' })
}

// Live value cell. These are values the user explicitly chose to
// ignore, so the management list shows them in the clear (no blur) —
// the value is reconstructed read-time from the source message, never
// persisted.
function IgnoredValue({ value }: { value: string }) {
  return (
    <span
      data-testid="ignored-value"
      title={value}
      className="block font-mono text-xs truncate text-warm-text dark:text-dark-text select-text"
    >
      {truncateValue(value)}
    </span>
  )
}

function rowKey(entry: AllowlistEntryRow): string {
  return `${entry.scope}:${entry.sessionUuid ?? '-'}:${entry.kind}:${entry.valueHash}`
}
