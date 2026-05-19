// Session detail strip — surfaces Security Scan findings inline with
// the session view. Collapsed by default; "Review" expands an inline
// list with Dismiss actions. Render-time gated on
// securityFeatureEnabled() — invisible in prod until ship gate clears.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { Session, FindingRow } from '@spool-lab/core'
import { securityFeatureEnabled } from '../../featureFlags.js'
import { securityApi } from '../../api/security.js'

interface Props {
  session: Session
}

export default function FindingsStrip({ session }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const high = session.scanHighCount ?? 0
  const total = session.scanFindingCount ?? 0
  const low = Math.max(0, total - high)

  const refresh = useCallback(async () => {
    const rows = await securityApi.listFindings({ sessionId: session.id })
    setFindings(rows)
  }, [session.id])

  useEffect(() => {
    if (expanded && findings === null) void refresh()
    if (!expanded) setFindings(null)
  }, [expanded, findings, refresh])

  useEffect(() => {
    const off = securityApi.onChange((c) => {
      if (c.sessionId === session.id && expanded) void refresh()
    })
    return () => { off() }
  }, [session.id, expanded, refresh])

  if (!securityFeatureEnabled()) return null
  if (total === 0) return null

  return (
    <div
      data-testid="findings-strip"
      className="px-5 py-2 border-y border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-sm"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          size={14}
          strokeWidth={1.75}
          className={high > 0 ? 'text-warm-accent dark:text-dark-accent' : 'text-warm-muted dark:text-dark-muted'}
          aria-hidden
        />
        <span className="text-warm-text dark:text-dark-text">
          {high > 0 && <strong className="font-medium">{high} high-risk</strong>}
          {high > 0 && low > 0 && <span className="text-warm-muted dark:text-dark-muted"> · </span>}
          {low > 0 && <span>{low} low</span>}
        </span>
        <button
          type="button"
          data-testid="strip-review-toggle"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="ml-auto text-xs px-2 py-0.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-bg dark:hover:bg-dark-bg inline-flex items-center gap-1"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Review
        </button>
      </div>

      {expanded && findings && (
        <ul className="mt-2 space-y-1">
          {findings.map(f => (
            <StripFindingRow key={f.id} finding={f} onChange={refresh} />
          ))}
        </ul>
      )}
    </div>
  )
}

function StripFindingRow({ finding, onChange }: { finding: FindingRow; onChange: () => void }) {
  const [value, setValue] = useState<string | null>(null)
  useEffect(() => {
    securityApi.getFindingValue(finding.id).then(setValue).catch(() => setValue(null))
  }, [finding.id])

  async function dismiss(scope: 'session' | 'global') {
    await securityApi.dismissFinding(finding.id, scope)
    onChange()
  }

  const isActive = finding.state === 'active'
  return (
    <li
      data-testid="strip-finding"
      data-kind={finding.kind}
      data-state={finding.state}
      className="flex items-center gap-2 text-xs pl-5"
    >
      <span className="font-mono text-warm-muted dark:text-dark-muted w-32 truncate">{finding.kind}</span>
      <span className="font-mono flex-1 truncate text-warm-text dark:text-dark-text">
        {value ?? <em>(unavailable)</em>}
      </span>
      {isActive ? (
        <>
          <button
            type="button"
            onClick={() => { void dismiss('session') }}
            className="px-1.5 py-0.5 rounded hover:bg-warm-bg dark:hover:bg-dark-bg"
            title="Dismiss in this session"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => { void dismiss('global') }}
            className="px-1.5 py-0.5 rounded hover:bg-warm-bg dark:hover:bg-dark-bg"
            title="Dismiss everywhere"
          >
            Everywhere
          </button>
        </>
      ) : (
        <span className="text-warm-muted dark:text-dark-muted">{finding.state}</span>
      )}
    </li>
  )
}
