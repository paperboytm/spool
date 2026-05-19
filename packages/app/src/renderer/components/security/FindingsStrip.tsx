// Session-detail strip — surfaces Security Scan findings inline below
// the header.
//
// Controlled by the parent's `open` state, which is driven by the
// `RiskPill` in the session meta row (right of "84 messages"). The
// pill is the single entry point; default state is closed. The close
// (×) button calls `onClose` to put the strip away again.
//
// Bulk-purge action lives in the strip header; per-row interactions
// stay clean to match the design — the page-level Security surface
// is where individual dismiss / single-purge ops happen.
//
// Render-time gated on securityFeatureEnabled() — invisible in prod
// until the ship gate clears.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { Session, FindingRow } from '@spool-lab/core'
import { securityFeatureEnabled } from '../../featureFlags.js'
import { securityApi } from '../../api/security.js'
import PurgeConfirmDialog from './PurgeConfirmDialog.js'

// Info-tier kinds — high false-positive rate (paths, IPs, internal
// hostnames). Excluded from the strip so the count + rows match the
// session counter columns (scanFindingCount = high + low only).
const INFO_KINDS = new Set(['absolute-path', 'ip', 'internal-host'])

interface Props {
  session: Session
  open: boolean
  onClose: () => void
}

export default function FindingsStrip({ session, open, onClose }: Props) {
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const [values, setValues] = useState<Record<number, string | null>>({})
  const high = session.scanHighCount ?? 0
  const total = session.scanFindingCount ?? 0
  const low = Math.max(0, total - high)
  const [purgePending, setPurgePending] = useState(false)

  const refresh = useCallback(async () => {
    const rows = await securityApi.listFindings({ sessionId: session.id, state: 'active' })
    setFindings(rows)
    const reportable = rows.filter(r => !INFO_KINDS.has(r.kind))
    if (reportable.length > 0) {
      // Bulk-fetch raw values in one IPC instead of one-per-row.
      const map = await securityApi.getFindingValues(reportable.map(r => r.id))
      setValues(map)
    } else {
      setValues({})
    }
  }, [session.id])

  // Drop info-tier rows so the strip mirrors the pill's counter
  // exactly. listFindings has no "severity in (high, low)" filter
  // today, so we filter client-side; cheap given strip lists are
  // bounded by the session's finding count.
  const visibleFindings = useMemo(
    () => (findings ?? []).filter(f => !INFO_KINDS.has(f.kind)),
    [findings],
  )

  // Only fetch while the strip is actually shown — avoids any IPC
  // round-trip cost on every session-detail mount for users who never
  // open the strip.
  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  // onChange-driven refresh with trailing debounce. Same rationale as
  // SecurityPage / ProjectView — backfill bursts collapse to one
  // refetch.
  useEffect(() => {
    if (!open) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange((c) => {
      if (c.sessionId !== session.id) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [session.id, open, refresh])

  if (!securityFeatureEnabled()) return null
  if (total === 0) return null
  if (!open) return null

  async function purgeAll() {
    if (visibleFindings.length === 0) return
    try {
      await securityApi.purgeFindings(visibleFindings.map(f => f.id))
    } catch { /* failure surfaces via onChange / refresh */ }
    await refresh()
  }

  const summary: string[] = []
  if (high > 0) summary.push(`${high} high-risk`)
  if (low > 0) summary.push(`${low} low secret${low === 1 ? '' : 's'}`)

  return (
    <div
      data-testid="findings-strip"
      className="bg-accent-bg dark:bg-accent-bg-dark"
    >
      <div className="px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-accent dark:text-accent-dark">
            Findings
          </span>
          {summary.length > 0 && (
            <span className="text-xs text-warm-muted dark:text-dark-muted">
              {summary.join(' · ')}
            </span>
          )}
          <span className="flex-1" />
          {visibleFindings.length > 0 && (
            <>
              <button
                type="button"
                data-testid="strip-purge-all"
                onClick={() => setPurgePending(true)}
                className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded text-warm-text dark:text-dark-text hover:bg-accent/10 dark:hover:bg-accent-dark/15 transition-colors"
              >
                <Trash2 size={12} strokeWidth={1.75} aria-hidden />
                Purge all
              </button>
              <PurgeConfirmDialog
                open={purgePending}
                count={visibleFindings.length}
                summary={summary.join(' · ')}
                onConfirm={() => { setPurgePending(false); void purgeAll() }}
                onCancel={() => setPurgePending(false)}
              />
            </>
          )}
          <button
            type="button"
            data-testid="strip-close"
            onClick={onClose}
            aria-label="Close findings strip"
            className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-accent/10 dark:hover:bg-accent-dark/15 hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <X size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {visibleFindings.length > 0 && (
          // Scroll the list inside the strip so a long finding set
          // (a packed transcript can produce 50+ rows) doesn't push
          // the messages off-screen. Native scrollbar — macOS auto-
          // hides it; on Linux/Win it stays out of the way with a
          // subtle thumb that only colors in on hover.
          <ul className="mt-2 space-y-1.5 max-h-[320px] overflow-y-auto pr-1
            [&::-webkit-scrollbar]:w-1.5
            [&::-webkit-scrollbar-thumb]:bg-transparent
            [&::-webkit-scrollbar-thumb]:rounded-full
            [&::-webkit-scrollbar-thumb]:transition-colors
            hover:[&::-webkit-scrollbar-thumb]:bg-warm-muted/40
            dark:hover:[&::-webkit-scrollbar-thumb]:bg-dark-muted/40">
            {visibleFindings.map(f => (
              <StripFindingRow key={f.id} finding={f} value={values[f.id] ?? null} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StripFindingRow({ finding, value }: { finding: FindingRow; value: string | null }) {
  // `revealValuesOnHoverOnly` is a Settings preference shipped in the
  // polish PR — until then we apply blur-on-default unconditionally
  // so the screen-share scenario is safe by default. Polish PR will
  // wire the preference through to gate this behavior.
  return (
    <li
      data-testid="strip-finding"
      data-kind={finding.kind}
      data-state={finding.state}
      className="group flex items-center gap-4 text-xs pl-3"
    >
      <span aria-hidden className="text-warm-muted/60 dark:text-dark-muted/60 select-none">•</span>
      <span className="font-mono text-warm-muted dark:text-dark-muted w-24 shrink-0 truncate">
        {finding.kind}
      </span>
      <span
        className="font-mono flex-1 truncate text-warm-text dark:text-dark-text blur-[3px] group-hover:blur-0 transition-[filter] duration-100"
        title="Hover to reveal"
      >
        {value ?? <em>(unavailable)</em>}
      </span>
    </li>
  )
}
