// Top-level Security Scan page — peer to Sessions / Shares / Search.
//
// Layout follows the Claude Design handoff (Spool Security Scan —
// Redesign):
//   1. Tiny meta row (active count · sessions · Rescan icon button)
//   2. Risk board — kind tiles in two boards: high (accent-tinted) and
//      low (neutral). Each tile shows count + how-many-sessions in mono;
//      hover reveals a Purge-all-of-kind icon button.
//   3. Active filter pill (when a kind is pinned)
//   4. Sessions list — each session is a card with title + meta + up to
//      3 findings inline (no expand chevron). Values blur-by-default
//      and hover-reveal. "Show N more" reveals the rest.
//   5. Info drawer — informational signals (paths, IPs, internal-host)
//      collapsed by default with the false-positive audit fact visible.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Info, Loader2, MoreHorizontal, RotateCw, SquarePen, SquareTerminal, Trash2, ShieldAlert, X, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import type {
  FindingRow,
  RiskByCategoryRow,
  ScanStatus,
  FindingFilter,
  SessionFindingFilter,
  SessionWithFindingCounts,
  Session,
} from '@spool-lab/core'
import {
  HIGH_SEVERITY_KINDS,
  INFO_SEVERITY_KINDS,
  SENSITIVE_KIND_LABEL,
  type SensitiveKind,
} from '@spool-lab/redact'
import { securityApi } from '../api/security.js'
import { securityFeatureEnabled } from '../featureFlags.js'
import PurgeConfirmDialog from './security/PurgeConfirmDialog.js'
import { parseQualifier, toggleKindQualifier } from './security/parse-qualifier.js'
import { truncateValue } from './security/truncate-value.js'
import { SourceBadge } from './Badges.js'
import Menu from './Menu.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
  /** Optional share-draft starter; rendered as a menu item when share
   *  feature is enabled. App.tsx wires this only when shareEnabled. */
  onShareSession?: (sessionUuid: string) => void
}

type Sess = SessionWithFindingCounts & { source: Session['source'] }

export default function SecurityPage(props: Props) {
  // Belt-and-suspenders gate at the wrapper so the inner component's
  // hooks never run when the feature is off — keeping the conditional
  // return ABOVE the hooks would violate Rules of Hooks the moment
  // the flag becomes anything other than a build-time constant.
  if (!securityFeatureEnabled()) return null
  return <SecurityPageInner {...props} />
}

function SecurityPageInner({ onOpenSession, onShareSession }: Props) {
  const { t } = useTranslation()
  const [risk, setRisk] = useState<RiskByCategoryRow[]>([])
  const [sessions, setSessions] = useState<Sess[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Default to collapsed so the sessions list — the main thing users
  // come here to act on — gets the bulk of the viewport. The header
  // renders a one-line preview of the top kinds so the category grid
  // still hints at its contents even when folded.
  const [showHigh, setShowHigh] = useState(false)
  const [showLow, setShowLow] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [bulkPurgeKind, setBulkPurgeKind] = useState<string | null>(null)
  const [bulkPurgeSamples, setBulkPurgeSamples] = useState<Array<{ value: string; sessionTitle: string }>>([])
  // Default: reveal values. The page exists so the user can review
  // what got captured — hiding the very thing they came to read is
  // anti-UX. The eye-off toggle is for screen-share / step-away moments.
  const [valuesHidden, setValuesHidden] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  // True between the click on Rescan and the moment the worker reports
  // queued/scanning/backfillRemaining > 0. Gives the button + banner an
  // optimistic visible state — without this, very fast rescans (small
  // archives) can complete inside one 500 ms poll window and the user
  // sees no feedback at all.
  const [rescanInFlight, setRescanInFlight] = useState(false)
  // Snapshot captured the moment the worker transitions from busy to
  // idle. Keeps the "scan complete" banner pinned so the user gets a
  // confirmation moment instead of a flash; cleared only via the X.
  const [scanResult, setScanResult] = useState<{ scanned: number; high: number; low: number } | null>(null)
  const wasScanningRef = useRef(false)
  // `backfillStart` is captured the first tick the worker reports
  // backfillRemaining > 0 — the scanning banner reads "12 of N" from
  // it. Reset when the worker goes idle.
  const [backfillStart, setBackfillStart] = useState<number | null>(null)
  // The latest moment `scan_completed_at` was set on ANY session — used
  // as the "scanned X ago" line in the meta row.
  const [lastScanCompletedAt, setLastScanCompletedAt] = useState<string | null>(null)
  // Per-burst id used to fully remount ScanBanner on each new idle→busy
  // transition. Without this, the bar's `width` CSS transition carries
  // over from the previous burst's final 100% to the new burst's 0%,
  // visually "rewinding" before going forward again.
  const [scanBurstKey, setScanBurstKey] = useState(0)
  const parsed = useMemo(() => parseQualifier(query), [query])

  const filter: SessionFindingFilter = parsed.filter

  const refresh = useCallback(async () => {
    try {
      const [r, s, st] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindings(filter),
        securityApi.getScanStatus(),
      ])
      setRisk(r)
      setSessions(s as Sess[])
      setScanStatus(st)
      // Pick the most recent scan_completed_at across the session set
      // we just fetched. Cheap because s is already in-memory.
      const completedAts = (s as Sess[])
        .map(x => x.scanCompletedAt)
        .filter((x): x is string => Boolean(x))
      if (completedAts.length > 0) {
        completedAts.sort()
        setLastScanCompletedAt(completedAts[completedAts.length - 1] ?? null)
      }
      setLoading(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void refresh()
    const off = securityApi.onChange(() => { void refresh() })
    return () => { off() }
  }, [refresh])

  // Refs for the snapshot the result-banner reads on the busy→idle
  // edge; lets the edge-detection effect stay on stable deps instead
  // of re-running whenever risk / sessions / backfillStart change.
  const backfillStartRef = useRef<number | null>(null)
  backfillStartRef.current = backfillStart
  const riskRef = useRef<RiskByCategoryRow[]>([])
  riskRef.current = risk
  const sessionsLenRef = useRef(0)
  sessionsLenRef.current = sessions.length

  // Subscribe to scan-status pushes from the worker. One getStatus()
  // call seeds the first render; everything after lands via the
  // event channel — zero polling latency on the busy→idle edge that
  // drives the result banner.
  useEffect(() => {
    let active = true
    void securityApi.getScanStatus().then((s) => { if (active) setScanStatus(s) }).catch(() => {})
    const off = securityApi.onScanStatus((next) => {
      setScanStatus(next)
      const inFlight = next.backfillRemaining + (next.scanning !== null ? 1 : 0)
      const nowBusy = next.queued > 0 || next.scanning !== null || next.backfillRemaining > 0
      if (nowBusy) {
        if (!wasScanningRef.current) {
          // Just transitioned idle → busy. New scan started, so the
          // captured start represents THIS scan's max in-flight, not
          // a stale value from a prior burst. Clear any lingering
          // result banner at the same time. Bump burst key so the
          // progress bar remounts and doesn't CSS-transition from
          // the prior 100% back to 0%.
          setBackfillStart(inFlight)
          setScanResult(null)
          setScanBurstKey((k) => k + 1)
        } else {
          // Mid-scan — grow if a new high-water mark appears (e.g.
          // backfill kicked in mid-scan stacking on top of queued).
          setBackfillStart((prev) => (prev === null || inFlight > prev) ? inFlight : prev)
        }
        wasScanningRef.current = true
      } else if (wasScanningRef.current) {
        // Busy → idle edge. KEEP backfillStart so the result banner
        // reads the true max-in-flight from this scan; it gets reset
        // on the next idle → busy transition above.
        wasScanningRef.current = false
        setRescanInFlight(false)
        setScanResult({
          scanned: backfillStartRef.current ?? sessionsLenRef.current,
          high: riskRef.current.filter(r => r.severity === 'high').reduce((a, c) => a + c.count, 0),
          low: riskRef.current.filter(r => r.severity === 'low').reduce((a, c) => a + c.count, 0),
        })
      }
    })
    return () => {
      active = false
      off()
    }
  }, [])

  const isScanning = rescanInFlight || (scanStatus !== null &&
    (scanStatus.queued > 0 || scanStatus.scanning !== null || scanStatus.backfillRemaining > 0))

  async function handleRescanAll() {
    if (rescanInFlight) return
    // Reset stale per-burst state synchronously so the click is the
    // visible "0% start" frame, not the prior burst's "100% end".
    // The worker's first status event will then re-capture
    // backfillStart for THIS burst.
    setBackfillStart(null)
    setScanResult(null)
    setScanBurstKey((k) => k + 1)
    setRescanInFlight(true)
    await securityApi.rescanAll().catch(() => { setRescanInFlight(false) })
  }

  function toggleKindFilter(kind: string) {
    setQuery((q) => toggleKindQualifier(q, kind))
  }

  function clearKindFilter() {
    setQuery('')
  }

  // Stable references — string-array identity from parseQualifier
  // changes on every input character, but the SessionCard load
  // callback's dep array only cares about content equality. Memoise
  // off the joined string so a debounced parent re-render doesn't
  // refetch every session card.
  const kindsKey = (parsed.filter.kinds ?? []).join('|')
  const activeKinds = useMemo<readonly string[]>(
    () => kindsKey ? kindsKey.split('|') : [],
    [kindsKey],
  )
  const activeKindSet = useMemo(() => new Set(activeKinds), [activeKinds])

  async function openBulkPurge(kind: string) {
    setBulkPurgeKind(kind)
    const rows = await securityApi.listFindings({
      kind: kind as NonNullable<FindingFilter['kind']>,
      state: 'active',
    })
    const sample = rows.slice(0, 4)
    const values = await securityApi.getFindingValues(sample.map(r => r.id)).catch(() => ({} as Record<number, string | null>))
    const samples = sample.flatMap(r => {
      const v = values[r.id]
      if (!v) return []
      const session = sessions.find(s => s.id === r.sessionId)
      return [{ value: truncateValue(v), sessionTitle: session?.title?.trim() || '(no title)' }]
    })
    setBulkPurgeSamples(samples)
  }

  async function confirmBulkPurgeKind() {
    if (!bulkPurgeKind) return
    const rows = await securityApi.listFindings({
      kind: bulkPurgeKind as NonNullable<FindingFilter['kind']>,
      state: 'active',
    })
    if (rows.length > 0) {
      await securityApi.purgeFindings(rows.map((r) => r.id))
    }
    setBulkPurgeKind(null)
    setBulkPurgeSamples([])
    void refresh()
  }

  const highCats = risk.filter(r => r.severity === 'high')
  const lowCats = risk.filter(r => r.severity === 'low')
  const infoCats = risk.filter(r => r.severity === 'info')
  const highCount = highCats.reduce((a, c) => a + c.count, 0)
  const lowCount = lowCats.reduce((a, c) => a + c.count, 0)
  const infoCount = infoCats.reduce((a, c) => a + c.count, 0)
  const visibleActive = highCount + lowCount

  return (
    <div data-testid="security-page" className="flex flex-col flex-1 min-h-0">
      {/* Meta row — matches SharesPage's pattern (px-6 pt-1.5 pb-3) so
       *  the distance from the sidebar reads identical across pages. */}
      <div className="flex-none flex items-center gap-3 px-6 pt-1.5 pb-3">
        <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
          {t('security.summary', { findings: visibleActive, sessions: sessions.length, defaultValue: '{{findings}} risk · {{sessions}} sessions' })}
          {infoCount > 0 && (
            <span className="opacity-70">
              {' · '}
              {t('security.summary_info', { count: infoCount, defaultValue: '{{count}} info' })}
            </span>
          )}
          {lastScanCompletedAt && !isScanning && (
            <>
              {' · '}
              {t('security.scanned_ago', {
                ago: formatScanAgo(lastScanCompletedAt),
                defaultValue: 'scanned {{ago}}',
              })}
            </>
          )}
          {activeKinds.length > 0 && (
            <>
              {' · '}
              {t('security.filter_active', {
                count: activeKinds.length,
                defaultValue: 'filtered by {{count}} kind(s)',
              })}
              {' '}
              <button
                type="button"
                data-testid="security-filter-clear"
                onClick={clearKindFilter}
                className="text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark underline-offset-2 hover:underline transition-colors"
              >
                {t('security.filter_clear', { defaultValue: 'clear' })}
              </button>
            </>
          )}
        </span>
        <button
          type="button"
          data-testid="security-rescan-all"
          onClick={handleRescanAll}
          disabled={rescanInFlight}
          title={t('security.rescanAll', { defaultValue: 'Rescan all' })}
          aria-label={t('security.rescanAll', { defaultValue: 'Rescan all' })}
          className={`flex-none inline-flex items-center justify-center w-5 h-5 rounded transition-colors duration-75 ${
            rescanInFlight
              ? 'text-accent dark:text-accent-dark cursor-wait'
              : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
          }`}
        >
          <RotateCw
            size={13}
            strokeWidth={1.75}
            className={rescanInFlight ? 'animate-spin' : ''}
            aria-hidden
          />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="max-w-[720px]">
          {loading ? null : error ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-4">
              {t('common.error')}: {error}
            </p>
          ) : risk.length === 0 && !isScanning ? (
            <EmptyState onRescan={handleRescanAll} lastScan={lastScanCompletedAt} currentProfile={scanStatus?.currentProfile ?? null} />
          ) : (
            <>
              {isScanning && scanStatus && (
                <ScanBanner key={scanBurstKey} status={scanStatus} backfillStart={backfillStart} />
              )}
              {!isScanning && scanResult && (
                <ScanResultBanner
                  result={scanResult}
                  onDismiss={() => setScanResult(null)}
                />
              )}

              {highCats.length > 0 && (
                <section className="mb-3" data-testid="security-high-section">
                  <CollapsibleHeader
                    expanded={showHigh}
                    onToggle={() => setShowHigh(v => !v)}
                    testid="security-toggle-high"
                    label={t('security.severity_high', { defaultValue: 'High · credentials' })}
                    count={highCount}
                    leading={<AlertTriangle size={11} strokeWidth={1.75} className="text-accent dark:text-accent-dark" aria-hidden />}
                    preview={{ rows: highCats }}
                  />
                  {showHigh && (
                    <KindGrid
                      rows={highCats}
                      tone="high"
                      activeKinds={activeKindSet}
                      onToggle={toggleKindFilter}
                      onBulkPurge={(k) => void openBulkPurge(k)}
                    />
                  )}
                </section>
              )}

              {lowCats.length > 0 && (
                <section className="mb-3" data-testid="security-low-section">
                  <CollapsibleHeader
                    expanded={showLow}
                    onToggle={() => setShowLow(v => !v)}
                    testid="security-toggle-low"
                    label={t('security.severity_low', { defaultValue: 'Low · identity' })}
                    count={lowCount}
                    leading={<AlertTriangle size={11} strokeWidth={1.75} className="text-warm-faint dark:text-dark-muted" aria-hidden />}
                    preview={{ rows: lowCats }}
                  />
                  {showLow && (
                    <KindGrid
                      rows={lowCats}
                      tone="default"
                      activeKinds={activeKindSet}
                      onToggle={toggleKindFilter}
                      onBulkPurge={(k) => void openBulkPurge(k)}
                    />
                  )}
                </section>
              )}

              {infoCats.length > 0 && (
                <section className="mb-4" data-testid="security-info-section">
                  <CollapsibleHeader
                    expanded={showInfo}
                    onToggle={() => setShowInfo(v => !v)}
                    testid="security-toggle-info"
                    label={t('security.severity_info', { defaultValue: 'Info · environment' })}
                    count={infoCount}
                    leading={<Info size={11} strokeWidth={1.75} className="text-warm-faint dark:text-dark-muted" aria-hidden />}
                    preview={{ rows: infoCats }}
                  />
                  {showInfo && (
                    <>
                      <KindGrid
                        rows={infoCats}
                        tone="info"
                        activeKinds={activeKindSet}
                        onToggle={toggleKindFilter}
                        onBulkPurge={(k) => void openBulkPurge(k)}
                      />
                      <p className="mt-2 text-[11px] text-warm-faint dark:text-dark-muted">
                        {t('security.info_footnote', {
                          defaultValue: 'Signals are kept as audit records but never surfaced as standalone findings. Click a tile to add it to the filter; the chip will light up and the sessions list will include matching findings.',
                        })}
                      </p>
                    </>
                  )}
                </section>
              )}

              {/* No filter-pill row: when kinds are selected, the tiles
                  themselves carry the selected state (accent ring) and
                  the meta row shows `filtered by N · clear`. Click a
                  lit tile again to drop it from the filter. */}

              <section className="mb-5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[13px] font-medium leading-[18px] text-warm-text dark:text-dark-text">
                    {t('security.sessions_with_findings', { defaultValue: 'Sessions with active findings' })}
                  </span>
                  <span className="font-mono text-[12px] text-warm-faint dark:text-dark-muted tabular-nums ml-1">
                    {sessions.length}
                  </span>
                  {/* Icon-only toggle, tooltip via title.
                   *  Eye = values currently visible, click to hide;
                   *  EyeOff = values blurred, click to reveal. */}
                  {sessions.length > 0 && (
                    <button
                      type="button"
                      data-testid="security-toggle-values"
                      onClick={() => setValuesHidden(v => !v)}
                      aria-pressed={valuesHidden}
                      aria-label={valuesHidden
                        ? t('security.show_values_full', { defaultValue: 'Show values' })
                        : t('security.hide_values_full', { defaultValue: 'Hide values for screen-share' })}
                      title={valuesHidden
                        ? t('security.show_values_full', { defaultValue: 'Show values' })
                        : t('security.hide_values_full', { defaultValue: 'Hide values for screen-share' })}
                      className={`ml-auto inline-flex items-center justify-center w-5 h-5 rounded transition-colors duration-75 ${
                        valuesHidden
                          ? 'bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark'
                          : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
                      }`}
                    >
                      {valuesHidden
                        ? <EyeOff size={13} strokeWidth={1.75} aria-hidden />
                        : <Eye size={13} strokeWidth={1.75} aria-hidden />}
                    </button>
                  )}
                </div>
                {sessions.length === 0 ? (
                  <p className="font-mono text-[11px] text-warm-faint dark:text-dark-muted py-2">
                    {t('security.empty_sessions', { defaultValue: 'No sessions match this filter.' })}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {sessions.map(s => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        activeKinds={activeKinds}
                        valuesHidden={valuesHidden}
                        onOpen={() => onOpenSession(s.sessionUuid)}
                        {...(onShareSession ? { onShare: () => onShareSession(s.sessionUuid) } : {})}
                        onRefresh={refresh}
                      />
                    ))}
                  </div>
                )}
              </section>

            </>
          )}
        </div>
      </div>

      <PurgeConfirmDialog
        open={bulkPurgeKind !== null}
        count={bulkPurgeKind ? (risk.find((c) => c.kind === bulkPurgeKind)?.count ?? 0) : 0}
        kind={bulkPurgeKind ?? ''}
        bulk
        bulkSamples={bulkPurgeSamples}
        onConfirm={() => { void confirmBulkPurgeKind() }}
        onCancel={() => { setBulkPurgeKind(null); setBulkPurgeSamples([]) }}
      />
    </div>
  )
}

function ScanBanner({ status, backfillStart }: { status: ScanStatus; backfillStart: number | null }) {
  const { t } = useTranslation()
  const inFlight = status.backfillRemaining + (status.scanning !== null ? 1 : 0)
  const total = backfillStart ?? inFlight
  const done = Math.max(0, total - inFlight)
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  return (
    <div
      data-testid="security-scan-banner"
      className="relative grid items-center gap-3 mb-5 px-4 py-2.5 rounded-lg bg-accent-bg dark:bg-accent-bg-dark border border-accent-bg-strong dark:border-accent-bg-strong-dark overflow-hidden"
      style={{ gridTemplateColumns: 'auto 1fr auto' }}
    >
      <span className="relative inline-flex items-center justify-center w-4 h-4">
        <span className="absolute inset-1 rounded-full bg-accent dark:bg-accent-dark" />
        <span className="absolute inset-0 rounded-full bg-accent dark:bg-accent-dark opacity-30 animate-ping" />
      </span>
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <span className="text-[13px] font-medium text-accent dark:text-accent-dark">
          {t('security.scanning', { defaultValue: 'Scanning' })}
        </span>
        <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted tabular-nums">
          {status.currentProfile}
        </span>
      </div>
      <span aria-hidden />
      {/* Deterministic progress strip. The pct read here is fine
       *  ratio-wise: `backfillRemaining` is the worker's pending
       *  counter and the captured max-in-flight is a stable
       *  denominator for the current burst. The numeric values aren't
       *  shown (X / N stayed misleading because backfillRemaining is
       *  cumulative across burst stacking) but the *ratio* still
       *  faithfully reflects progress within whichever burst the user
       *  is observing. ScanBanner is keyed by burst id at the call
       *  site so width transitions never carry over between bursts. */}
      <div
        className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent dark:bg-accent-dark transition-[width] duration-300"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  )
}

function ScanResultBanner({
  result,
  onDismiss,
}: {
  result: { scanned: number; high: number; low: number }
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const noFindings = result.high === 0 && result.low === 0
  return (
    <div
      data-testid="security-scan-result-banner"
      className="relative grid items-center gap-3 mb-5 px-4 py-2.5 rounded-lg bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border overflow-hidden"
      style={{ gridTemplateColumns: 'auto 1fr auto' }}
    >
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full"
        style={{ background: 'var(--color-status-success)' }}
      >
        <Check size={11} strokeWidth={2.2} className="text-white" aria-hidden />
      </span>
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <span className="text-[13px] text-warm-text dark:text-dark-text font-medium">
          {t('security.scan_done', { defaultValue: 'Scan complete' })}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted">
          {noFindings ? (
            t('security.scan_done_clean', { defaultValue: 'nothing high-risk found' })
          ) : (
            <>
              <span className="text-accent dark:text-accent-dark">
                {t('security.scan_done_high', { count: result.high, defaultValue: '{{count}} high' })}
              </span>
              {result.low > 0 && (
                <>
                  {' · '}
                  {t('security.scan_done_low', { count: result.low, defaultValue: '{{count}} low' })}
                </>
              )}
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        data-testid="security-scan-result-dismiss"
        onClick={onDismiss}
        title={t('common.close', { defaultValue: 'Close' })}
        aria-label={t('common.close', { defaultValue: 'Close' })}
        className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <X size={13} strokeWidth={1.6} aria-hidden />
      </button>
    </div>
  )
}

function CollapsibleHeader({
  expanded,
  onToggle,
  testid,
  label,
  count,
  leading,
  trailing,
  preview,
}: {
  expanded: boolean
  onToggle: () => void
  testid: string
  label: string
  count: number
  leading?: React.ReactNode
  trailing?: React.ReactNode
  /** Rows summarised inline when the section is collapsed. Top-3 kinds
   *  plus a `+N more` chip — keeps the category grid discoverable
   *  without making the user expand it. */
  preview?: { rows: RiskByCategoryRow[]; visibleN?: number }
}) {
  const visibleN = preview?.visibleN ?? 3
  const previewRows = preview?.rows.slice(0, visibleN) ?? []
  const previewMore = preview ? Math.max(0, preview.rows.length - visibleN) : 0
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onToggle}
      aria-expanded={expanded}
      className="w-full flex items-center gap-2 mb-1.5 rounded -ml-1 pl-1 py-0.5 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
    >
      {/* Left group: shrinks so the preview truncates instead of
       *  pushing the chevron off-screen when counts are large. */}
      <span className="flex-1 min-w-0 inline-flex items-baseline gap-2 overflow-hidden">
        {leading && <span className="flex-none self-center">{leading}</span>}
        <span className="flex-none text-[13px] font-medium leading-[18px] text-warm-text dark:text-dark-text">
          {label}
        </span>
        <span className="flex-none font-mono text-[12px] text-warm-faint dark:text-dark-muted tabular-nums">
          {count}
        </span>
        {!expanded && previewRows.length > 0 && (
          <span
            data-testid={`${testid}-preview`}
            className="hidden sm:inline-block truncate font-mono text-[11px] text-warm-faint dark:text-dark-muted"
          >
            {previewRows.map((r, i) => (
              <span key={r.kind}>
                {i > 0 && <span className="opacity-50"> · </span>}
                <span className="text-warm-muted dark:text-dark-muted">{r.kind} </span>
                <span className="tabular-nums">{r.count}</span>
              </span>
            ))}
            {previewMore > 0 && (
              <span className="opacity-60"> · +{previewMore}</span>
            )}
          </span>
        )}
      </span>
      <span className="flex-none inline-flex items-center gap-1.5 text-warm-faint dark:text-dark-muted">
        {trailing}
        {expanded
          ? <ChevronDown size={12} strokeWidth={1.7} aria-hidden />
          : <ChevronRight size={12} strokeWidth={1.7} aria-hidden />}
      </span>
    </button>
  )
}

function KindGrid({
  rows,
  tone,
  activeKinds,
  onToggle,
  onBulkPurge,
}: {
  rows: RiskByCategoryRow[]
  tone: 'high' | 'default' | 'info'
  activeKinds: ReadonlySet<string>
  onToggle: (kind: string) => void
  onBulkPurge: (kind: string) => void
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
    >
      {rows.map(r => (
        <KindTile
          key={r.kind}
          kind={r.kind}
          count={r.count}
          sessions={r.sessions}
          tone={tone}
          active={activeKinds.has(r.kind)}
          onSelect={() => onToggle(r.kind)}
          onBulkPurge={() => onBulkPurge(r.kind)}
        />
      ))}
    </div>
  )
}

function KindTile({
  kind,
  count,
  sessions,
  tone,
  active,
  onSelect,
  onBulkPurge,
}: {
  kind: string
  count: number
  sessions: number
  tone: 'high' | 'default' | 'info'
  active: boolean
  onSelect: () => void
  onBulkPurge: () => void
}) {
  const toneClasses =
    tone === 'high'
      ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent-bg-strong dark:border-accent-bg-strong-dark hover:border-accent dark:hover:border-accent-dark'
      : tone === 'info'
        ? 'bg-transparent border-warm-border2 dark:border-dark-border2 border-dashed opacity-90'
        : 'bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2 hover:bg-warm-surface2 dark:hover:bg-dark-surface2'

  const activeClasses = active ? 'border-accent ring-1 ring-accent dark:border-accent-dark dark:ring-accent-dark' : ''
  const countColor = tone === 'high' ? 'text-accent dark:text-accent-dark' : 'text-warm-text dark:text-dark-text'

  return (
    <div
      data-testid="risk-category-chip"
      data-kind={kind}
      data-severity={tone}
      className={`group relative flex flex-col justify-between min-w-[132px] h-14 px-3 py-2 rounded-lg border ${toneClasses} ${activeClasses} transition-colors cursor-pointer`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${kind} · ${count} ${count === 1 ? 'finding' : 'findings'} in ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
    >
      <span className="font-mono text-[12px] text-warm-text dark:text-dark-text truncate">
        {kind}
      </span>
      <span className="flex items-baseline justify-between gap-2 min-w-0">
        <span className={`font-mono tabular-nums text-[15px] leading-none font-medium tracking-[-0.01em] flex-none ${countColor}`}>
          {count}
        </span>
        <span className="font-mono text-[10px] text-warm-muted dark:text-dark-muted tabular-nums truncate">
          {sessions} {sessions === 1 ? 'session' : 'sessions'}
        </span>
      </span>
      <button
        type="button"
        data-testid="risk-bulk-purge"
        title={`Purge all ${kind}`}
        aria-label={`Purge all ${kind}`}
        onClick={(e) => { e.stopPropagation(); onBulkPurge() }}
        className="absolute top-1.5 right-1.5 w-[18px] h-[18px] rounded inline-flex items-center justify-center text-warm-faint dark:text-dark-muted opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 hover:text-accent dark:hover:text-accent-dark transition-opacity"
      >
        <Trash2 size={12} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  )
}

function SessionCard({
  session,
  activeKinds,
  valuesHidden,
  onOpen,
  onShare,
  onRefresh,
}: {
  session: Sess
  activeKinds: readonly string[]
  valuesHidden: boolean
  onOpen: () => void
  onShare?: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Click-to-collapse on the title row. Default expanded so the user
  // sees what's inside each card; can fold shut once they've reviewed.
  const [collapsed, setCollapsed] = useState(false)
  const [resuming, setResuming] = useState(false)
  const LIMIT = 3
  const [values, setValues] = useState<Record<number, string | null>>({})

  const load = useCallback(async () => {
    const f: FindingFilter = { sessionId: session.id, state: 'active' }
    if (activeKinds.length > 0) {
      f.kinds = activeKinds as NonNullable<FindingFilter['kinds']>
    }
    try {
      const rows = await securityApi.listFindings(f)
      setFindings(rows)
      // Bulk-fetch raw values for the rows we're about to render in
      // one IPC trip instead of one-per-row. Caller passes the value
      // down as a prop; FindingItem no longer needs its own fetch.
      if (rows.length > 0) {
        const map = await securityApi.getFindingValues(rows.map(r => r.id))
        setValues(map)
      } else {
        setValues({})
      }
    } catch (err) {
      console.error('[security] listFindings failed for session', session.id, err)
      setFindings([])
      setValues({})
    }
  }, [session.id, activeKinds])

  useEffect(() => { void load() }, [load])

  async function handleCopyId() {
    try { await navigator.clipboard.writeText(session.sessionUuid) } catch { /* clipboard blocked */ }
  }
  async function handleRescan() {
    await securityApi.rescanSession(session.id)
  }
  async function handleResume() {
    setResuming(true)
    try {
      await window.spool.resumeCLI(session.sessionUuid, session.source as never, session.cwd ?? undefined)
    } finally {
      setTimeout(() => setResuming(false), 1000)
    }
  }
  const resumeCommand = getSessionResumeCommand(session.source as never, session.sessionUuid, session.cwd)
  async function handleCopyCommand() {
    if (!resumeCommand) return
    try { await navigator.clipboard.writeText(resumeCommand) } catch { /* clipboard blocked */ }
  }

  if (findings === null) {
    return (
      <article className="py-2" />
    )
  }

  // Hide info-tier kinds (absolute-path / ip / internal-host) from the
  // inline list unless the user has explicitly pinned one as a filter —
  // info findings are stored as an audit record but have ~98% false-
  // positive rate, so showing 848 absolute-path rows would drown the
  // real leaks. The Info drawer at the bottom is where they surface.
  const allowInfo = activeKinds.some(k => INFO_SEVERITY_KINDS.has(k as SensitiveKind))
  const reportable = allowInfo
    ? findings
    : findings.filter(f => !INFO_SEVERITY_KINDS.has(f.kind as SensitiveKind))

  const visible = showAll ? reportable : reportable.slice(0, LIMIT)
  const hidden = reportable.length - visible.length
  const high = reportable.filter(f => f.state === 'active' && HIGH_SEVERITY_KINDS.has(f.kind as SensitiveKind)).length
  const low = reportable.filter(f => f.state === 'active' && !HIGH_SEVERITY_KINDS.has(f.kind as SensitiveKind)).length
  const title = session.title?.trim() || t('common.noTitle')

  // Match SessionRow's meta format exactly: relative date · N msgs · model
  const looseT = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const dateStr = formatRelativeDate(session.startedAt, { t: looseT })
  const msgsStr = t('session.msgs_other', { count: session.messageCount })
  const modelStr = compactModel(session.model)

  return (
    <article
      data-testid="security-session-row"
      data-session-uuid={session.sessionUuid}
      className="py-2"
    >
      <header className="group flex items-center gap-2 -ml-1">
        <button
          type="button"
          data-testid="security-session-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed
            ? t('common.expand', { defaultValue: 'Expand' })
            : t('common.collapse', { defaultValue: 'Collapse' })}
          className="flex-1 min-w-0 flex items-center gap-2 pl-1 pr-1 py-0.5 rounded text-left cursor-default hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
        >
          <SourceBadge source={session.source} />
          <span className="flex-1 min-w-0 text-[13px] font-medium text-warm-text dark:text-dark-text truncate">
            {title}
          </span>
          {/* Chevron sits after the title, hidden until hover so the row
           *  reads as title-first. Slot is always present (no layout
           *  shift on hover); only its opacity toggles. Whichever
           *  direction the chevron points is the action it'll perform
           *  on click — collapsed → expand (▶), expanded → collapse (▼). */}
          <span className="flex-none inline-flex items-center justify-center w-3.5 h-3.5 text-warm-faint dark:text-dark-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {collapsed
              ? <ChevronRight size={12} strokeWidth={1.7} aria-hidden />
              : <ChevronDown size={12} strokeWidth={1.7} aria-hidden />}
          </span>
        </button>
        <span className="flex-none flex items-center gap-2">
          {high > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono tabular-nums text-[11px] text-accent dark:text-accent-dark">
              <AlertTriangle size={12} strokeWidth={1.7} aria-hidden />
              {high}
            </span>
          )}
          {low > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono tabular-nums text-[11px] text-warm-muted dark:text-dark-muted">
              <span className="w-1 h-1 rounded-full bg-warm-muted dark:bg-dark-muted" />
              {low}
            </span>
          )}
          <Menu
            align="right"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                data-testid="security-session-menu"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
                aria-label={t('common.moreActions', { defaultValue: 'More actions' })}
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
              >
                <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
              </button>
            )}
            items={[
              {
                label: t('security.view_session_detail', { defaultValue: 'View session detail' }),
                icon: <Eye size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => onOpen(),
              },
              ...(onShare ? [{
                label: t('shareEditor.openNew', { defaultValue: 'Edit share draft' }),
                icon: <SquarePen size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => onShare(),
              }] : []),
              {
                label: resuming
                  ? t('common.openingTerminal', { defaultValue: 'Opening terminal…' })
                  : t('session.resume_inTerminal', { defaultValue: 'Continue in terminal' }),
                icon: resuming
                  ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" aria-hidden />
                  : <SquareTerminal size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleResume() },
                disabled: resuming,
              },
              ...(resumeCommand ? [{
                label: t('common.copyResumeCommand', { defaultValue: 'Copy terminal command' }),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyCommand() },
              }] : []),
              {
                label: t('sidebar.copySessionId', { defaultValue: 'Copy session ID' }),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyId() },
              },
              {
                label: t('security.rescan_session', { defaultValue: 'Rescan this session' }),
                icon: <RotateCw size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleRescan() },
              },
            ]}
          />
        </span>
      </header>
      <p className="mt-0.5 pl-1.5 font-mono text-[11px] tabular-nums text-warm-faint dark:text-dark-muted truncate">
        {session.projectDisplayName && (
          <>
            <span className="text-warm-muted dark:text-dark-muted">{session.projectDisplayName}</span>
            {' · '}
          </>
        )}
        {dateStr} · {msgsStr}{modelStr ? ` · ${modelStr}` : ''}
      </p>
      {!collapsed && visible.length > 0 && (
        <div className="mt-1 flex flex-col gap-px">
          {visible.map((f) => (
            <FindingItem
              key={f.id}
              finding={f}
              value={values[f.id] ?? null}
              valuesHidden={valuesHidden}
              onChange={() => { void load(); onRefresh() }}
            />
          ))}
          {hidden > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="self-start ml-6 mt-0.5 h-[22px] px-2 rounded bg-transparent font-mono text-[11px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              {t('security.show_more', { count: hidden, defaultValue: 'show {{count}} more' })}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** Drops the long `claude-sonnet-4-5-20251022` form to `sonnet 4.5`.
 *  Mirrors SessionRow's helper. */
function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

function FindingItem({
  finding,
  value,
  valuesHidden,
  onChange,
}: {
  finding: FindingRow
  /** Raw value — fetched in bulk by the parent SessionCard so a card
   *  with N findings stays at one IPC round-trip total. */
  value: string | null
  /** Global hide toggle (screen-share mode). When true, blur every value
   *  until the user hover-reveals it. When false (default), values render
   *  in clear — the user is here to review them. */
  valuesHidden: boolean
  onChange: () => void
}) {
  const { t } = useTranslation()
  // Per-row reveal override — only meaningful when valuesHidden is true.
  const [localReveal, setLocalReveal] = useState(false)
  const [purgePending, setPurgePending] = useState(false)

  const revealed = !valuesHidden || localReveal

  async function dismiss(scope: 'session' | 'global') {
    await securityApi.dismissFinding(finding.id, scope)
    onChange()
    // Undo toast — dismiss is the highest-frequency action on this
    // page (Linear / Gmail set the precedent: cheap actions get a
    // soft undo, not a modal). Sonner's 4s default is fine for one-
    // hand workflows; users mass-dismissing a kind can mash-undo as
    // toasts stack.
    toast(
      scope === 'global'
        ? t('security.dismissed_global_toast', { kind: finding.kind, defaultValue: 'Dismissed {{kind}} everywhere' })
        : t('security.dismissed_session_toast', { kind: finding.kind, defaultValue: 'Dismissed {{kind}}' }),
      {
        action: {
          label: t('common.undo', { defaultValue: 'Undo' }),
          onClick: () => {
            void securityApi.undismissFinding(finding.id)
              .then(() => onChange())
              .catch(() => { toast.error(t('security.undo_failed', { defaultValue: 'Could not undo' })) })
          },
        },
      },
    )
  }
  async function purge() {
    await securityApi.purgeFinding(finding.id)
    setPurgePending(false)
    onChange()
  }

  const isActive = finding.state === 'active'
  const isPurged = finding.state === 'purged'
  const high = HIGH_SEVERITY_KINDS.has(finding.kind as SensitiveKind)
  const bulletClass = isPurged
    ? 'bg-warm-faint dark:bg-dark-faint'
    : high
      ? 'bg-accent dark:bg-accent-dark'
      : 'bg-warm-muted dark:bg-dark-muted'

  const valueClass = isPurged
    ? 'line-through text-warm-faint dark:text-dark-faint'
    : revealed
      ? 'text-warm-text dark:text-dark-text'
      : 'text-warm-text dark:text-dark-text blur-[3.5px] cursor-pointer select-none'

  const displayValue = isPurged
    ? `[redacted: ${(SENSITIVE_KIND_LABEL[finding.kind as SensitiveKind] ?? finding.kind)}]`
    : value === null
      ? t('security.value_unavailable', { defaultValue: '(value unavailable)' })
      : value

  return (
    <div
      data-testid="finding-row"
      data-finding-id={finding.id}
      data-kind={finding.kind}
      data-state={finding.state}
      className="group grid items-center gap-3 pl-6 pr-2 py-0.5 rounded font-mono text-[11px] hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
      style={{ gridTemplateColumns: '14px 110px 1fr auto', opacity: finding.state === 'dismissed' ? 0.5 : 1 }}
    >
      <span className={`justify-self-center w-1 h-1 rounded-full ${bulletClass}`} />
      <span className="text-warm-muted dark:text-dark-muted truncate">{finding.kind}</span>
      <span
        className={`truncate transition-[filter] duration-100 ${valueClass}`}
        onMouseEnter={() => valuesHidden && !isPurged && setLocalReveal(true)}
        onClick={() => valuesHidden && !isPurged && setLocalReveal(true)}
      >
        {displayValue}
      </span>
      {isActive ? (
        <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            data-testid="dismiss-in-session"
            onClick={() => { void dismiss('session') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_session', { defaultValue: 'Dismiss in this session' })}
          >
            {t('security.dismiss', { defaultValue: 'Dismiss' })}
          </button>
          <button
            type="button"
            data-testid="dismiss-everywhere"
            onClick={() => { void dismiss('global') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_global', { defaultValue: 'Dismiss everywhere' })}
          >
            {t('security.everywhere', { defaultValue: 'Everywhere' })}
          </button>
          <button
            type="button"
            data-testid="purge-button"
            onClick={() => setPurgePending(true)}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-accent dark:hover:text-accent-dark inline-flex items-center gap-1 transition-colors"
            title={t('security.purge', { defaultValue: 'Purge from local archive' })}
          >
            <Trash2 size={10} strokeWidth={1.7} aria-hidden />
            {t('security.purge', { defaultValue: 'Purge' })}
          </button>
          <PurgeConfirmDialog
            open={purgePending}
            count={1}
            kind={finding.kind}
            {...(value !== null ? { before: value } : {})}
            onConfirm={() => { void purge() }}
            onCancel={() => setPurgePending(false)}
          />
        </span>
      ) : (
        <span className="font-sans text-[10px] uppercase tracking-[0.08em] font-semibold text-warm-faint dark:text-dark-muted">
          {finding.state}
        </span>
      )}
    </div>
  )
}

function EmptyState({
  onRescan,
  lastScan,
  currentProfile,
}: {
  onRescan: () => void
  lastScan: string | null
  currentProfile: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-4 max-w-[560px] pt-4">
      <span className="flex-none w-9 h-9 rounded-lg bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border inline-flex items-center justify-center text-warm-muted dark:text-dark-muted mt-0.5">
        <ShieldAlert size={18} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-2.5 flex-1 min-w-0">
        <h2 className="text-[15px] font-semibold text-warm-text dark:text-dark-text leading-5 tracking-[-0.005em]">
          {t('security.empty_title', { defaultValue: 'Nothing to review.' })}
        </h2>
        <p className="text-[13px] text-warm-muted dark:text-dark-muted leading-[18px] max-w-[480px]">
          {t('security.empty_body', {
            defaultValue: "We scanned your sessions and found nothing high-risk. Spool re-scans whenever new sessions sync.",
          })}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <button
            type="button"
            onClick={onRescan}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border text-[12px] font-medium text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:border-warm-border2 dark:hover:border-dark-border2 transition-colors"
          >
            <RotateCw size={12} strokeWidth={1.6} aria-hidden />
            {t('security.rescanAll', { defaultValue: 'Rescan all' })}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <SettingsIcon size={12} strokeWidth={1.6} aria-hidden />
            {t('security.detector_settings', { defaultValue: 'Detector settings' })}
          </button>
        </div>

        {(lastScan || currentProfile) && (
          <div className="mt-1.5 rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold leading-[14px] text-warm-muted dark:text-dark-muted mb-1.5">
              {t('security.last_scan', { defaultValue: 'Last scan' })}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted leading-[18px]">
              {lastScan && (
                <div>
                  {t('security.last_scan_when', { ago: formatScanAgo(lastScan), defaultValue: 'scanned {{ago}}' })}
                </div>
              )}
              {currentProfile && (
                <div>{currentProfile}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Format a scan_completed_at timestamp as "2m ago" / "just now". */
function formatScanAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const ms = Date.now() - t
    if (!Number.isFinite(ms) || ms < 0) return 'just now'
    const s = Math.floor(ms / 1000)
    if (s < 45) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  } catch {
    return ''
  }
}

