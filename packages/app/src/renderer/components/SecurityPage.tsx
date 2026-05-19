// Top-level Security Scan page — peer to Library / Search.
//
// Watchtower-style layout: Risk panel (categories with active counts)
// up top, then a list of sessions that have findings. Each row offers
// per-finding Dismiss actions; Purge ships in PR 4.
//
// Keep the component flat and small for now. The full filter-bar /
// qualifier parser / kind allowlist UI is deferred — this surface
// already lets a user see what was found, click into the session,
// and dismiss things.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ShieldAlert, RotateCw, X } from 'lucide-react'
import type {
  FindingRow,
  RiskByCategoryRow,
  SessionWithFindingCounts,
} from '@spool-lab/core'
import { securityApi } from '../api/security.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
}

export default function SecurityPage({ onOpenSession }: Props) {
  const [risk, setRisk] = useState<RiskByCategoryRow[]>([])
  const [sessions, setSessions] = useState<SessionWithFindingCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindings({}),
      ])
      setRisk(r)
      setSessions(s)
      setLoading(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = securityApi.onChange(() => { void refresh() })
    return () => { off() }
  }, [refresh])

  async function handleRescanAll() {
    await securityApi.rescanAll()
    void refresh()
  }

  if (loading) {
    return <div className="p-8 text-warm-muted dark:text-dark-muted">Loading…</div>
  }
  if (error) {
    return <div className="p-8 text-red-600 dark:text-red-400">Security page failed to load: {error}</div>
  }

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
            className="text-warm-accent dark:text-dark-accent"
            aria-hidden
          />
          <h1 className="text-2xl font-medium text-warm-text dark:text-dark-text">Security</h1>
        </div>
        <button
          type="button"
          data-testid="security-rescan-all"
          onClick={handleRescanAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface transition"
        >
          <RotateCw size={14} strokeWidth={1.75} aria-hidden />
          Rescan all
        </button>
      </header>

      <section
        data-testid="security-risk-panel"
        className="rounded-lg border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg-2 p-5 mb-6"
      >
        <p className="text-sm text-warm-muted dark:text-dark-muted mb-3">
          {totalActive} active finding{totalActive === 1 ? '' : 's'} across {totalSessions} session{totalSessions === 1 ? '' : 's'}
        </p>

        {highCats.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-warm-text dark:text-dark-text mb-2">
              <AlertTriangle size={14} className="text-warm-accent dark:text-dark-accent" aria-hidden />
              High
            </div>
            <div className="flex flex-wrap gap-2">
              {highCats.map(c => (
                <CategoryChip key={c.kind} kind={c.kind} count={c.count} severity="high" />
              ))}
            </div>
          </div>
        )}

        {lowCats.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition">
              ▸ Low ({lowCats.length} categor{lowCats.length === 1 ? 'y' : 'ies'},
              {' '}{lowCats.reduce((a, c) => a + c.count, 0)} items)
            </summary>
            <div className="flex flex-wrap gap-2 mt-2">
              {lowCats.map(c => (
                <CategoryChip key={c.kind} kind={c.kind} count={c.count} severity="low" />
              ))}
            </div>
          </details>
        )}

        {risk.length === 0 && (
          <p className="text-sm text-warm-muted dark:text-dark-muted">No active findings.</p>
        )}
      </section>

      <section data-testid="security-session-list">
        <h2 className="text-sm uppercase tracking-wide text-warm-muted dark:text-dark-muted mb-2">
          Sessions with findings
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-warm-muted dark:text-dark-muted">No sessions have findings yet.</p>
        ) : (
          <ul className="divide-y divide-warm-border dark:divide-dark-border border border-warm-border dark:border-dark-border rounded-lg overflow-hidden">
            {sessions.map(s => (
              <SecuritySessionRow
                key={s.id}
                session={s}
                onOpen={() => onOpenSession(s.sessionUuid)}
                onRefresh={refresh}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function CategoryChip({ kind, count, severity }: { kind: string; count: number; severity: 'high' | 'low' }) {
  const cls = severity === 'high'
    ? 'bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text border-warm-accent/40 dark:border-dark-accent/40'
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
  onRefresh,
}: {
  session: SessionWithFindingCounts
  onOpen: () => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [findings, setFindings] = useState<FindingRow[] | null>(null)

  async function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && findings === null) {
      const rows = await securityApi.listFindings({ sessionId: session.id })
      setFindings(rows)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
          aria-expanded={expanded}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 text-left min-w-0"
        >
          <span className="block truncate font-medium text-warm-text dark:text-dark-text">
            {session.title ?? '(untitled)'}
          </span>
          <span className="block text-xs text-warm-muted dark:text-dark-muted">
            {new Date(session.startedAt).toLocaleString()} ·{' '}
            {session.highCount > 0 && (
              <span className="text-warm-accent dark:text-dark-accent">
                {session.highCount} high
              </span>
            )}
            {session.highCount > 0 && session.findingCount > session.highCount ? ' · ' : ''}
            {session.findingCount > session.highCount && (
              <span>{session.findingCount - session.highCount} low</span>
            )}
          </span>
        </button>
      </div>
      {expanded && findings && (
        <div className="mt-3 ml-6 space-y-1">
          {findings.map(f => (
            <FindingRowView key={f.id} finding={f} onChange={() => { setFindings(null); onRefresh() }} />
          ))}
        </div>
      )}
    </li>
  )
}

function FindingRowView({
  finding,
  onChange,
}: {
  finding: FindingRow
  onChange: () => void
}) {
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    securityApi.getFindingValue(finding.id).then(setValue).catch(() => setValue(null))
  }, [finding.id])

  async function dismiss(scope: 'session' | 'global') {
    await securityApi.dismissFinding(finding.id, scope)
    onChange()
  }

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
        {value ?? <em className="text-warm-faint dark:text-dark-faint">(unavailable)</em>}
      </span>
      <span className="text-xs text-warm-faint dark:text-dark-faint">
        {finding.provider}
      </span>
      {finding.state === 'active' ? (
        <>
          <button
            type="button"
            data-testid="dismiss-in-session"
            onClick={() => { void dismiss('session') }}
            className="text-xs px-2 py-0.5 rounded hover:bg-warm-surface dark:hover:bg-dark-surface"
            title="Dismiss in this session"
          >
            Dismiss in session
          </button>
          <button
            type="button"
            data-testid="dismiss-everywhere"
            onClick={() => { void dismiss('global') }}
            className="text-xs px-2 py-0.5 rounded hover:bg-warm-surface dark:hover:bg-dark-surface"
            title="Dismiss everywhere"
          >
            Everywhere
          </button>
        </>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-warm-muted dark:text-dark-muted">
          <X size={12} aria-hidden />
          {finding.state}
        </span>
      )}
    </div>
  )
}
