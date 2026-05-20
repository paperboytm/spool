// Top-level Security Scan page — peer to Library / Search.
//
// Watchtower-style layout: Risk panel (categories with active counts)
// up top, then a list of sessions that have findings. Each row offers
// per-finding Dismiss actions; bulk Purge ships when the purge PR
// merges.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronRight, ShieldAlert, RotateCw } from 'lucide-react'
import type {
  FindingRow,
  RiskByCategoryRow,
  SessionWithFindingCounts,
} from '@spool-lab/core'
import { securityApi } from '../api/security.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
}

// 300ms trailing debounce for onChange-driven refreshes. backfill of N
// sessions publishes N change events; without coalescing, each one
// kicks two IPC calls (riskByCategory + listSessionsWithFindings) and
// a state replace + re-render. Trailing-edge so we still feel live
// (toggle a mute → see the page update under 300ms) without storming.
const REFRESH_DEBOUNCE_MS = 300

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; risk: RiskByCategoryRow[]; sessions: SessionWithFindingCounts[] }

export default function SecurityPage({ onOpenSession }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const [risk, sessions] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindings({}),
      ])
      setState({ kind: 'ready', risk, sessions })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Subscribe to scan events, but coalesce the refresh — see comment
  // on REFRESH_DEBOUNCE_MS.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [refresh])

  const handleRescanAll = useCallback(async () => {
    await securityApi.rescanAll()
    void refresh()
  }, [refresh])

  if (state.kind === 'loading') {
    return (
      <div className="p-8 text-warm-muted dark:text-dark-muted">
        {t('common.loading', { defaultValue: 'Loading…' })}
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="p-8 text-red-600 dark:text-red-400">
        {t('security.loadFailed', { defaultValue: 'Security page failed to load: {{message}}', message: state.message })}
      </div>
    )
  }

  const { risk, sessions } = state
  const highCats = risk.filter(r => r.severity === 'high')
  const lowCats = risk.filter(r => r.severity === 'low')
  const totalActive = risk.reduce((acc, r) => acc + r.count, 0)
  const totalSessions = sessions.length

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert
            size={24}
            strokeWidth={1.5}
            className="text-accent dark:text-accent-dark"
            aria-hidden
          />
          <h1 className="text-2xl font-medium text-warm-text dark:text-dark-text">
            {t('security.title', { defaultValue: 'Security' })}
          </h1>
        </div>
        <button
          type="button"
          data-testid="security-rescan-all"
          onClick={() => { void handleRescanAll() }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface transition"
        >
          <RotateCw size={14} strokeWidth={1.75} aria-hidden />
          {t('security.rescanAll', { defaultValue: 'Rescan all' })}
        </button>
      </header>

      <section
        data-testid="security-risk-panel"
        className="rounded-lg border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg-2 p-5 mb-6"
      >
        <p className="text-sm text-warm-muted dark:text-dark-muted mb-3">
          {t('security.summary', {
            defaultValue: '{{findings}} active across {{sessions}} sessions',
            findings: totalActive,
            sessions: totalSessions,
          })}
        </p>

        {highCats.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-warm-text dark:text-dark-text mb-2">
              <AlertTriangle size={14} className="text-accent dark:text-accent-dark" aria-hidden />
              {t('security.severityHigh', { defaultValue: 'High' })}
            </div>
            <div className="flex flex-wrap gap-2">
              {highCats.map(c => (
                <CategoryChip key={c.kind} kind={c.kind} count={c.count} severity="high" />
              ))}
            </div>
          </div>
        )}

        {lowCats.length > 0 && (
          <LowCategoriesGroup categories={lowCats} />
        )}

        {risk.length === 0 && (
          <p className="text-sm text-warm-muted dark:text-dark-muted">
            {t('security.noFindings', { defaultValue: 'No active findings.' })}
          </p>
        )}
      </section>

      <section data-testid="security-session-list">
        <h2 className="text-xs uppercase tracking-wide text-warm-muted dark:text-dark-muted mb-2">
          {t('security.sessionsWithFindings', { defaultValue: 'Sessions with findings' })}
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-warm-muted dark:text-dark-muted">
            {t('security.noSessions', { defaultValue: 'No sessions have findings yet.' })}
          </p>
        ) : (
          <ul className="divide-y divide-warm-border dark:divide-dark-border border border-warm-border dark:border-dark-border rounded-lg overflow-hidden">
            {sessions.map(s => (
              <SecuritySessionRow
                key={s.id}
                session={s}
                onOpen={() => onOpenSession(s.sessionUuid)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function LowCategoriesGroup({ categories }: { categories: RiskByCategoryRow[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const total = categories.reduce((a, c) => a + c.count, 0)
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition"
      >
        {open
          ? <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
          : <ChevronRight size={12} strokeWidth={1.75} aria-hidden />}
        {t('security.lowGroupLabel', {
          defaultValue: 'Low ({{categories}} categories, {{items}} items)',
          categories: categories.length,
          items: total,
        })}
      </button>
      {open && (
        <div className="flex flex-wrap gap-2 mt-2">
          {categories.map(c => (
            <CategoryChip key={c.kind} kind={c.kind} count={c.count} severity="low" />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryChip({ kind, count, severity }: { kind: string; count: number; severity: 'high' | 'low' }) {
  const cls = severity === 'high'
    ? 'bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text border-accent/40 dark:border-accent-dark/40'
    : 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted border-warm-border dark:border-dark-border'
  return (
    <span
      data-testid="risk-category-chip"
      data-kind={kind}
      data-severity={severity}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs ${cls}`}
    >
      <span>{kind}</span>
      <span className="text-warm-muted dark:text-dark-muted">·</span>
      <span className="font-mono">{count}</span>
    </span>
  )
}

function SecuritySessionRow({
  session,
  onOpen,
}: {
  session: SessionWithFindingCounts
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const [values, setValues] = useState<Record<number, string | null>>({})

  const loadFindings = useCallback(async () => {
    const rows = await securityApi.listFindings({ sessionId: session.id })
    setFindings(rows)
    // Bulk-fetch values in one IPC instead of one-per-row useEffect.
    if (rows.length > 0) {
      const map = await securityApi.getFindingValues(rows.map(r => r.id))
      setValues(map)
    }
  }, [session.id])

  useEffect(() => {
    if (!expanded || findings !== null) return
    void loadFindings()
  }, [expanded, findings, loadFindings])

  // Optimistic dismiss: drop the row from local state immediately so
  // the user sees the action take effect without waiting on the
  // round-trip + re-fetch. The worker's onChange fires anyway and the
  // parent debounces a refresh.
  const handleDismiss = useCallback(async (findingId: number, scope: 'session' | 'global') => {
    setFindings(prev => prev?.filter(f => f.id !== findingId) ?? null)
    try {
      await securityApi.dismissFinding(findingId, scope)
    } catch {
      // Rollback on failure — reload the authoritative list.
      void loadFindings()
    }
  }, [loadFindings])

  const titleText = session.title?.trim() || t('session.noTitle', { defaultValue: '(untitled)' })

  return (
    <li className="px-4 py-3">
      {/* One row, two click zones. Each zone is its own button so
       *  there are no nested buttons; data-testid covers either way. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="security-row-toggle"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-label={expanded
            ? t('common.collapse', { defaultValue: 'Collapse' })
            : t('common.expand', { defaultValue: 'Expand' })}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface transition"
        >
          {expanded
            ? <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            : <ChevronRight size={14} strokeWidth={1.75} aria-hidden />}
        </button>
        <button
          type="button"
          data-testid="security-row-open"
          onClick={onOpen}
          className="flex-1 text-left min-w-0 hover:underline decoration-warm-faint underline-offset-2"
        >
          <span className="block truncate font-medium text-warm-text dark:text-dark-text">
            {titleText}
          </span>
          <span className="block text-xs text-warm-muted dark:text-dark-muted">
            {new Date(session.startedAt).toLocaleString()}
            {session.highCount > 0 && (
              <>
                {' · '}
                <span className="text-accent dark:text-accent-dark">
                  {t('security.nHighRisk', {
                    defaultValue: '{{count}} high-risk',
                    count: session.highCount,
                  })}
                </span>
              </>
            )}
            {session.findingCount > session.highCount && (
              <>
                {' · '}
                <span>
                  {t('security.nLow', {
                    defaultValue: '{{count}} low',
                    count: session.findingCount - session.highCount,
                  })}
                </span>
              </>
            )}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="mt-3 ml-6 space-y-1">
          {findings === null ? (
            <p className="text-xs text-warm-muted dark:text-dark-muted">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          ) : findings.length === 0 ? (
            <p className="text-xs text-warm-muted dark:text-dark-muted">
              {t('security.noFindingsInSession', { defaultValue: 'No active findings.' })}
            </p>
          ) : (
            findings.map(f => (
              <FindingRowView
                key={f.id}
                finding={f}
                value={values[f.id] ?? null}
                onDismiss={handleDismiss}
              />
            ))
          )}
        </div>
      )}
    </li>
  )
}

function FindingRowView({
  finding,
  value,
  onDismiss,
}: {
  finding: FindingRow
  value: string | null
  onDismiss: (findingId: number, scope: 'session' | 'global') => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="finding-row"
      data-finding-id={finding.id}
      data-kind={finding.kind}
      className="flex items-center gap-2 text-sm py-1"
    >
      <span className="font-mono text-xs text-warm-muted dark:text-dark-muted w-32 truncate">
        {finding.kind}
      </span>
      <span className="font-mono text-xs flex-1 truncate text-warm-text dark:text-dark-text">
        {value ?? <em className="text-warm-faint dark:text-dark-faint">{t('security.valueUnavailable', { defaultValue: '(unavailable)' })}</em>}
      </span>
      <span className="text-xs text-warm-faint dark:text-dark-faint">
        {finding.provider}
      </span>
      {finding.state === 'active' ? (
        <>
          <button
            type="button"
            data-testid="dismiss-in-session"
            onClick={() => onDismiss(finding.id, 'session')}
            className="text-xs px-2 py-0.5 rounded hover:bg-warm-surface dark:hover:bg-dark-surface"
            title={t('security.dismissInSessionTooltip', { defaultValue: 'Dismiss in this session' })}
          >
            {t('security.dismissInSession', { defaultValue: 'Dismiss in session' })}
          </button>
          <button
            type="button"
            data-testid="dismiss-everywhere"
            onClick={() => onDismiss(finding.id, 'global')}
            className="text-xs px-2 py-0.5 rounded hover:bg-warm-surface dark:hover:bg-dark-surface"
            title={t('security.dismissEverywhereTooltip', { defaultValue: 'Dismiss everywhere' })}
          >
            {t('security.dismissEverywhere', { defaultValue: 'Everywhere' })}
          </button>
        </>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-warm-muted dark:text-dark-muted">
          {finding.state}
        </span>
      )}
    </div>
  )
}
