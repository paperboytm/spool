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
import { AlertTriangle, Check, ChevronDown, ChevronRight, CircleSlash, Copy, Eye, EyeOff, Info, Loader2, MoreHorizontal, RotateCw, SquarePen, SquareTerminal, Eraser, ShieldAlert, X, Settings as SettingsIcon } from 'lucide-react'
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
import { useSecurityEnabled } from '../featureFlags.js'
import { useSecurityReadiness } from '../hooks/useSecurityReadiness.js'
import PurgeConfirmDialog from './security/PurgeConfirmDialog.js'
import AllowlistManageModal from './security/AllowlistManageModal.js'
import BlastRadius from './security/BlastRadius.js'
import DetectorsChip from './security/DetectorsChip.js'
import { parseQualifier, toggleKindQualifier } from './security/parse-qualifier.js'
import { truncateValue } from './security/truncate-value.js'
import {
  AMBIENT_BANNER_THRESHOLD,
  scanInFlightCount,
  shouldShowScanBanner,
} from './security/page-helpers.js'
import { compactModel } from './security/format.js'
import { SourceBadge } from './Badges.js'
import Menu from './Menu.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
  /** Optional share-draft starter; rendered as a menu item when share
   *  feature is enabled. App.tsx wires this only when shareEnabled. */
  onShareSession?: (sessionUuid: string) => void
  /** Open Settings panel pre-focused on the Security tab. Wired from
   *  App.tsx; used by the EmptyState "Detector settings" affordance so
   *  a clean archive isn't a dead end. */
  onOpenSettings?: () => void
}

type Sess = SessionWithFindingCounts & { source: Session['source'] }

export default function SecurityPage(props: Props) {
  // Belt-and-suspenders gate at the wrapper so the inner component's
  // hooks never run when the feature is off — keeping the conditional
  // return ABOVE the hooks would violate Rules of Hooks the moment
  // the flag becomes anything other than a build-time constant.
  if (!useSecurityEnabled()) return null
  return <SecurityPageGate {...props} />
}

function SecurityPageGate(props: Props) {
  const { t } = useTranslation()
  const readiness = useSecurityReadiness()
  if (!readiness.ready) {
    return <SecurityPageNotice reason={readiness.reason} t={t} />
  }
  return <SecurityPageInner {...props} />
}

function SecurityPageNotice({
  reason,
  t,
}: {
  reason: 'booting' | 'scanner-unavailable'
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (reason === 'booting') {
    return (
      <div
        data-testid="security-readiness-booting"
        className="p-6 space-y-3 animate-pulse"
        aria-busy="true"
      >
        <div className="h-3 w-40 rounded bg-warm-border/60 dark:bg-dark-border/60" />
        <div className="h-20 rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface" />
        <div className="h-3 w-32 rounded bg-warm-border/60 dark:bg-dark-border/60" />
      </div>
    )
  }
  return (
    <div className="p-6">
      <div
        data-testid="security-unavailable"
        role="alert"
        className="rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-4 py-3.5 max-w-2xl"
      >
        <p className="text-sm font-medium text-warm-text dark:text-dark-text mb-1">
          {t('security.unavailable_title', { defaultValue: 'Scanner unavailable' })}
        </p>
        <p className="text-[12px] leading-[18px] text-warm-faint dark:text-dark-muted">
          {t('security.unavailable_body', {
            defaultValue: 'Spool could not start the security scan worker. Findings cannot be loaded until it recovers. Restarting the app usually resolves this; if it persists, check the developer console for the boot error.',
          })}
        </p>
      </div>
    </div>
  )
}

function SecurityPageInner({ onOpenSession, onShareSession, onOpenSettings }: Props) {
  const { t } = useTranslation()
  const [risk, setRisk] = useState<RiskByCategoryRow[]>([])
  const [sessions, setSessions] = useState<Sess[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [sessionsTotal, setSessionsTotal] = useState<number | null>(null)
  const [sessionsPageCount, setSessionsPageCount] = useState(1)
  const SESSIONS_PAGE_SIZE = 50
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
  // "Ignored items" — a shallow entry into the same modal Settings →
  // Security exposes. Count is fetched on mount + folded into the
  // findings-changed refresh path (ignoring a finding writes an
  // allowlist row → count moves), so the badge stays live without a
  // dedicated subscription. Hidden when 0 to keep the meta row calm.
  const [ignoredOpen, setIgnoredOpen] = useState(false)
  const [ignoredCount, setIgnoredCount] = useState(0)
  // `securityPageValuesBlurred` is the single source of truth for
  // page-level value visibility. The Eye/EyeOff button writes
  // directly to the pref via setPrefs (no ephemeral override), so the
  // Settings row and the header icon are two surfaces of the same
  // control — clicking either reflects everywhere. The default is
  // false (revealed); the page exists so users can read what was
  // captured.
  const [valuesHidden, setValuesHidden] = useState(false)
  useEffect(() => {
    let cancelled = false
    void securityApi.getPrefs().then(p => {
      if (!cancelled) setValuesHidden(p.securityPageValuesBlurred === true)
    }).catch(() => { /* fall back to default-reveal */ })
    const off = securityApi.onPrefsChanged(p => {
      setValuesHidden(p.securityPageValuesBlurred === true)
    })
    return () => { cancelled = true; off() }
  }, [])
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

  // Reset to first page whenever the active filter changes so a chip
  // toggle doesn't try to display offset-50 of a different result set.
  const filterKey = JSON.stringify(filter)
  useEffect(() => {
    setSessionsPageCount(1)
  }, [filterKey])

  const refresh = useCallback(async () => {
    try {
      const [r, sPage, sTotal, st, lastScan, ignored] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindingsPage({
          ...filter,
          limit: sessionsPageCount * SESSIONS_PAGE_SIZE,
        }),
        securityApi.countSessionsWithFindings(filter),
        securityApi.getScanStatus(),
        securityApi.lastScanCompletedAt(),
        securityApi.countAllowlistEntries(),
      ])
      setRisk(r)
      setIgnoredCount(ignored)
      setSessions(sPage.rows as Sess[])
      setSessionsHasMore(sPage.hasMore)
      setSessionsTotal(sTotal)
      setScanStatus(st)
      // True most-recent scan completion across ALL sessions — not the
      // filtered/paginated findings page. A session scanned + cleaned
      // (now 0 active findings) drops off that list, so deriving from
      // it could read older than the real last scan.
      setLastScanCompletedAt(lastScan)
      setLoading(false)
      setError(null)
      // Return fresh risk so callers (e.g. the manual-rescan ACK
      // banner) can read post-refresh counts without waiting for the
      // next React render to update `riskRef.current`.
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [filter, sessionsPageCount])

  useEffect(() => {
    void refresh()
    // Trailing 300ms debounce — a scanning burst publishes dozens of
    // finding-change events per second. Without coalescing, every
    // event fires three IPC round-trips (`riskByCategory` +
    // `listSessionsWithFindings` + `getScanStatus`), saturating the
    // renderer queue on a large archive. Matches the same pattern
    // FindingsStrip / ProjectView use.
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void refresh() }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [refresh])

  // Refs for the snapshot the result-banner reads on the busy→idle
  // edge; lets the edge-detection effect stay on stable deps instead
  // of re-running whenever risk / sessions change.
  const riskRef = useRef<RiskByCategoryRow[]>([])
  riskRef.current = risk
  const sessionsLenRef = useRef(0)
  sessionsLenRef.current = sessions.length
  // Latest refresh callback held by ref so the onScanStatus effect can
  // pull a refetch on the busy→idle edge WITHOUT re-subscribing every
  // time `filter` changes (which is what would happen if `refresh`
  // were listed as a dep).
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Three-tier scan feedback model:
  //
  //   1. Manual rescan (user clicked "Rescan all") → banner with
  //      progress + result, like before. They asked, they get an
  //      explicit ACK.
  //
  //   2. Background scan that discovers NEW high-risk findings →
  //      sonner toast ("Found N new high-risk findings"). Carries
  //      actual information value; auto-dismisses; doesn't block the
  //      page.
  //
  //   3. Background scan that finds nothing new → silent. The ambient
  //      pulse dot in the meta row + the sidebar badge already carry
  //      "worker is alive and counts are current"; a banner here is
  //      banner fatigue with no payload.
  //
  // `displayBusy` is a sticky-off mirror of the raw worker state —
  // flips ON immediately on busy, OFF only after 1500ms of continuous
  // idle. A live archive can oscillate busy/idle several times a
  // second (file mtime ticks from an active Claude session). Tying
  // banners to the raw status caused strobing; tying them to
  // displayBusy plus the discovery rule above eliminates it.
  const [displayBusy, setDisplayBusy] = useState(false)
  // True once we've seen `status.manualBurstInFlight === true` since
  // the most recent idle→busy edge. Worker-sourced (the rescanAll
  // mutation sets `manualBurstInFlight` and the updateStatus wrapper
  // clears it on full idle), so click-IPC-vs-auto-burst races can't
  // poison the ACK detection. Reset on every new burst start.
  const sawManualDuringBurstRef = useRef(false)
  // High-risk count snapshot captured at idle→busy. Compared against
  // post-scan total to decide whether to surface a discovery toast.
  const highCountAtScanStartRef = useRef(0)
  // Last observed `backfillTotal` from the worker. The worker zeroes
  // it the moment the burst goes fully idle, so we hold onto the
  // peak here for the result banner's "scanned N sessions" line —
  // the trailing 1500ms idle timer fires AFTER the zero arrives.
  const lastBackfillTotalRef = useRef(0)
  useEffect(() => {
    let active = true
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    void securityApi.getScanStatus().then((s) => {
      if (!active) return
      setScanStatus(s)
      const seedBusy = s.queued > 0 || s.scanning !== null || s.backfillRemaining > 0
      if (seedBusy) setDisplayBusy(true)
    }).catch(() => {})
    const off = securityApi.onScanStatus((next) => {
      setScanStatus(next)
      // Track the worker-reported high-water mark so the result
      // banner can still cite "scanned N sessions" after the worker
      // has gone idle and reset `backfillTotal` to 0.
      if (next.backfillTotal > lastBackfillTotalRef.current) {
        lastBackfillTotalRef.current = next.backfillTotal
      }
      // Latch onto the worker's truth — the moment manualBurstInFlight
      // becomes true during a burst, we remember it. The busy→idle
      // edge reads this; cleared on the next idle→busy edge (new burst).
      if (next.manualBurstInFlight) {
        sawManualDuringBurstRef.current = true
      }
      const nowBusy = next.queued > 0 || next.scanning !== null || next.backfillRemaining > 0
      if (nowBusy) {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
        setDisplayBusy(true)
        if (!wasScanningRef.current) {
          // Idle → busy edge. Snapshot the pre-scan high-risk total
          // so the busy→idle edge can decide whether anything *new*
          // was found. Bump burst key so the progress bar remounts
          // cleanly. Reset the manual-burst latch to the worker's
          // truth for THIS burst.
          highCountAtScanStartRef.current = riskRef.current
            .filter(r => r.severity === 'high')
            .reduce((a, c) => a + c.count, 0)
          lastBackfillTotalRef.current = next.backfillTotal
          sawManualDuringBurstRef.current = next.manualBurstInFlight
          // Don't reset scanResult here. The handleRescanAll click
          // path already clears it for the user-initiated case; any
          // OTHER idle→busy (sync-driven auto burst) would yank the
          // "Scan complete" ACK away from a user who just watched
          // their manual scan finish — they should see it until
          // they dismiss it with the × button.
          setScanBurstKey((k) => k + 1)
        }
        wasScanningRef.current = true
      } else if (wasScanningRef.current) {
        // Busy → idle edge.
        wasScanningRef.current = false
        const wasManual = sawManualDuringBurstRef.current
        if (wasManual) {
          // Manual rescan ACK MUST fire synchronously here. The
          // 1500ms idle gate (kept below for auto bursts) gets
          // canceled the instant the next auto burst arrives — and
          // on a live archive a sync-driven enqueue almost always
          // races in within that window — so the "Scan complete"
          // banner the user expected to see after their click would
          // silently never render. Firing immediately + bypassing
          // the gate guarantees the ACK lands.
          if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
          setDisplayBusy(false)
          setRescanInFlight(false)
          // Await the refetch + read counts from its return value, not
          // from riskRef.current — the ref isn't updated until the
          // next React render commits, so reading it synchronously
          // here yields the PRE-refresh counts (banner showed 43+21
          // while the meta row showed 75; this closes that gap).
          void (async () => {
            const fresh = await refreshRef.current()
            const rows = fresh ?? riskRef.current
            const currentHigh = rows.filter(r => r.severity === 'high').reduce((a, c) => a + c.count, 0)
            const currentLow = rows.filter(r => r.severity === 'low').reduce((a, c) => a + c.count, 0)
            setScanResult({
              scanned: lastBackfillTotalRef.current > 0 ? lastBackfillTotalRef.current : sessionsLenRef.current,
              high: currentHigh,
              low: currentLow,
            })
          })()
          return
        }
        // Auto bursts — trailing 1500ms gate so brief idle windows
        // between two backfill waves don't double-fire the
        // discovery toast or prematurely drop displayBusy.
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          idleTimer = null
          setDisplayBusy(false)
          // Pull a refetch so `lastScanCompletedAt` updates even when
          // the scan didn't mutate any findings (re-scan that found
          // nothing new still touches `scan_completed_at`, but emits
          // no onChange event — without this the meta row would keep
          // reading "scanned 5 minutes ago" forever). Read counts
          // from the returned data, not riskRef.current — the ref
          // lags the actual fetch by one React commit.
          void (async () => {
            const fresh = await refreshRef.current()
            const rows = fresh ?? riskRef.current
            const currentHigh = rows.filter(r => r.severity === 'high').reduce((a, c) => a + c.count, 0)
            const delta = currentHigh - highCountAtScanStartRef.current
            if (delta > 0) {
              // Background discovery — non-blocking toast.
              toast.warning(
                t('security.scan_toast_new_findings', {
                  count: delta,
                  defaultValue: 'Found {{count}} new high-risk findings',
                }),
              )
            }
            // delta <= 0 → silent. Ambient dot + sidebar badge already
            // tell the story.
          })()
        }, 1500)
      }
    })
    return () => {
      active = false
      if (idleTimer) clearTimeout(idleTimer)
      off()
    }
  }, [t])

  const isScanning = rescanInFlight || displayBusy

  async function handleRescanAll() {
    if (rescanInFlight) return
    // Reset stale per-burst state synchronously so the click is the
    // visible "0% start" frame, not the prior burst's "100% end".
    // The worker's first status event will deliver the fresh
    // backfillTotal + manualBurstInFlight for THIS burst — the
    // renderer doesn't (and shouldn't) flag manual here, because a
    // race with an auto sync-driven enqueue that completes between
    // the click and the IPC reaching the worker would otherwise be
    // mistakenly treated as the user's scan completing.
    lastBackfillTotalRef.current = 0
    setScanResult(null)
    setScanBurstKey((k) => k + 1)
    setRescanInFlight(true)
    await securityApi.rescanAll().catch(() => {
      setRescanInFlight(false)
    })
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
    // Fetch the sample rows BEFORE opening — opening first then filling
    // `bulkSamples` async makes the modal pop in short and grow as the
    // samples block lands, a visible height jitter. Local sqlite IPC is
    // fast enough that loading first adds no perceptible delay.
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
    setBulkPurgeKind(kind)
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
      <div className="flex-none px-6 pt-1.5 pb-3">
        {/* pr-4 mirrors the SessionCards' px-4 content inset (+ the
         *  scroll area's stable 8px gutter below) so the right-aligned
         *  Ignored entry lines up with the cards' right-edge controls
         *  instead of overhanging them. */}
        <div className="max-w-[720px] pr-3 flex items-center gap-3">
        {/* Left group owns the flex-1 width so the stats truncate without
         *  wrapping, while the ↻ button stays glued to the right of the
         *  "scanned X ago" stamp (reads as "last scanned · refresh").
         *  Only the Ignored entry, as the outer flex-none sibling, floats
         *  to the list's right edge. */}
        <div className="min-w-0 flex-1 flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-[11px] leading-5 text-warm-faint dark:text-dark-muted tabular-nums">
          {t('security.summary', { findings: visibleActive, defaultValue: '{{findings}} risk' })}
          {infoCount > 0 && (
            <span className="opacity-70">
              {' · '}
              {t('security.summary_info', { count: infoCount, defaultValue: '{{count}} info' })}
            </span>
          )}
          {/* Detectors chip qualifies the counts above (which engine
           *  produced them), so it sits next to them — and, being the
           *  most static element, anchors the left of the row while the
           *  width-volatile "scanned X ago" trails at the end. */}
          {scanStatus?.currentProfile && (
            <>
              {' · '}
              <DetectorsChip profile={scanStatus.currentProfile} />
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
          {/* "scanned X ago" is the row's only width-volatile text, so
           *  it trails last: its width changes can't shove the static
           *  counts/chip to its left. Pairing it with the ↻ button
           *  also reads as "last scanned · refresh", giving the bare
           *  icon a label by adjacency.
           *  Plain inline text (no flex wrapper, no inline indicator)
           *  so it shares the surrounding mono baseline exactly and
           *  never reflows the ↻ button. It's a stable "last
           *  completed" fact, NOT a scan-in-flight signal, so it stays
           *  put even under a full ScanBanner — removing it mid-scan
           *  collapsed the row width and shoved the controls sideways,
           *  then back. In-progress scanning is signalled by the
           *  ScanBanner below (≥5 sessions) and by this stamp ticking
           *  to "just now" when a scan settles. */}
          {lastScanCompletedAt && (
            <>
              {' · '}
              <span data-testid="security-scan-state">
                {t('security.scanned_ago', {
                  ago: formatScanAgo(lastScanCompletedAt, t as unknown as (k: string, o?: Record<string, unknown>) => string),
                  defaultValue: 'scanned {{ago}}',
                })}
              </span>
            </>
          )}
        </span>
        {/* Rescan stays paired with the "scanned X ago" stamp (reads as
         *  "last scanned · refresh"); only the Ignored entry floats to
         *  the far right, aligned to the list's right edge. */}
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
        {ignoredCount > 0 && (
          <button
            type="button"
            data-testid="security-ignored-open"
            onClick={() => setIgnoredOpen(true)}
            title={t('security.ignored_manage', { defaultValue: 'Ignored items' })}
            aria-label={t('security.ignored_manage', { defaultValue: 'Ignored items' })}
            className="flex-none inline-flex items-center gap-1.5 h-5 px-1.5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
          >
            <CircleSlash size={13} strokeWidth={1.75} aria-hidden />
            <span className="font-mono text-[11px]">
              {t('security.ignored_label', { defaultValue: 'Ignored' })}
            </span>
          </button>
        )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 [scrollbar-gutter:stable]">
        <div className="max-w-[720px]">
          {/* ScanBanner + ScanResultBanner sit OUTSIDE the empty /
           *  findings / loading branch below so a manual rescan that
           *  finishes with zero findings still surfaces the "Scan
           *  complete · nothing high-risk found" ACK above the
           *  empty-state body. If they were nested inside the else
           *  branch (risk.length > 0 || scanning), a clean archive
           *  would silently swallow the user's click. */}
          {shouldShowScanBanner(scanStatus, displayBusy) && scanStatus && (
            <ScanBanner key={scanBurstKey} status={scanStatus} />
          )}
          {/* ScanResultBanner gate is JUST `scanResult` — no
           *  `!isScanning` check. The old gate AND'd isScanning,
           *  which an auto sync-driven enqueue completing right
           *  after a manual scan would flip back to true within
           *  milliseconds, silently hiding the ACK the user just
           *  earned. Persisting until the × dismiss matches the
           *  "this is your action's result" contract. A new manual
           *  rescan clears it explicitly via `handleRescanAll`. */}
          {scanResult && (
            <ScanResultBanner
              result={scanResult}
              onDismiss={() => setScanResult(null)}
            />
          )}
          {loading ? null : error ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-4">
              {t('common.error')}: {error}
            </p>
          ) : risk.length === 0 && !isScanning ? (
            <EmptyState
              onRescan={handleRescanAll}
              {...(onOpenSettings ? { onOpenSettings } : {})}
              lastScan={lastScanCompletedAt}
              currentProfile={scanStatus?.currentProfile ?? null}
            />
          ) : (
            <>
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
                      <p className="mt-2 text-[11px] text-warm-faint dark:text-dark-muted" data-testid="security-info-footnote">
                        {t('security.info_footnote', {
                          defaultValue: 'Kept as audit records, not surfaced as standalone findings.',
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
                    {sessionsTotal ?? sessions.length}
                  </span>
                  {/* Icon-only toggle, tooltip via title.
                   *  Eye = values currently visible, click to hide;
                   *  EyeOff = values blurred, click to reveal. */}
                  {sessions.length > 0 && (
                    <button
                      type="button"
                      data-testid="security-toggle-values"
                      onClick={() => {
                        const next = !valuesHidden
                        setValuesHidden(next)  // optimistic — pref subscription will mirror
                        void securityApi.setPrefs({ securityPageValuesBlurred: next })
                      }}
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
                    {sessionsHasMore && (
                      <button
                        type="button"
                        data-testid="security-sessions-load-more"
                        onClick={() => setSessionsPageCount((n) => n + 1)}
                        className="self-start mt-2 h-7 px-2.5 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
                      >
                        {t('security.load_more', { defaultValue: 'Load more' })}
                      </button>
                    )}
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

      {ignoredOpen && (
        <AllowlistManageModal
          onClose={() => {
            setIgnoredOpen(false)
            // Un-ignoring inside the modal removes allowlist rows; pull
            // a fresh count so the header badge reflects it immediately.
            void securityApi.countAllowlistEntries().then(setIgnoredCount).catch(() => {})
          }}
        />
      )}
    </div>
  )
}

function ScanBanner({ status }: { status: ScanStatus }) {
  const { t } = useTranslation()
  const inFlight = scanInFlightCount(status)
  // `Math.max` is a belt-and-suspenders guard for an inconsistent
  // snapshot (backfillTotal lagging behind backfillRemaining for one
  // tick) — shouldn't matter with the in-tree worker but keeps the
  // rendering correct.
  const total = Math.max(status.backfillTotal, inFlight)
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
        {/* Burst-scoped progress count: "23 of 145 rescans" makes it
         *  obvious this is the active re-scan batch (sessions whose
         *  scan_profile drifted from current), not the library total.
         *  Without the verb "rescans" the slash format invites
         *  comparison with the sidebar's total-sessions number — which
         *  is a different denominator and would feel inconsistent.
         *  Only show once we have a stable total; suppress while
         *  inFlight=0 (terminal moment before the banner hides). */}
        {total > 0 && (
          <span
            data-testid="security-scan-banner-progress"
            className="font-mono text-[11px] text-warm-muted dark:text-dark-muted tabular-nums whitespace-nowrap"
          >
            {t('security.scanning_progress', {
              done,
              total,
              defaultValue: '{{done}} of {{total}} rescans',
            })}
          </span>
        )}
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
      data-scanned={result.scanned}
      data-high={result.high}
      data-low={result.low}
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
  const { t } = useTranslation()
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
      aria-label={t('security.chip_aria', { kind, count, sessions, defaultValue: '{{kind}} · {{count}} findings in {{sessions}} sessions' })}
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
          {t('sidebar.sessionCount', { count: sessions, defaultValue: '{{count}} sessions' })}
        </span>
      </span>
      <button
        type="button"
        data-testid="risk-bulk-purge"
        title={t('security.purge_all_kind', { kind, defaultValue: 'Purge all {{kind}}' })}
        aria-label={t('security.purge_all_kind', { kind, defaultValue: 'Purge all {{kind}}' })}
        onClick={(e) => { e.stopPropagation(); onBulkPurge() }}
        className="absolute top-1.5 right-1.5 w-[18px] h-[18px] rounded inline-flex items-center justify-center text-warm-faint dark:text-dark-muted opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 hover:text-accent dark:hover:text-accent-dark transition-opacity"
      >
        <Eraser size={12} strokeWidth={1.5} aria-hidden />
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
  const [findingsHasMore, setFindingsHasMore] = useState(false)
  const [findingsPageCount, setFindingsPageCount] = useState(1)
  const FINDINGS_PAGE_SIZE = 200
  const [showAll, setShowAll] = useState(false)
  // Click-to-collapse on the title row. Default expanded so the user
  // sees what's inside each card; can fold shut once they've reviewed.
  const [collapsed, setCollapsed] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [purgeAllPending, setPurgeAllPending] = useState(false)
  const LIMIT = 3
  const [values, setValues] = useState<Record<number, string | null>>({})

  const load = useCallback(async () => {
    const f: FindingFilter = {
      sessionId: session.id,
      state: 'active',
      limit: findingsPageCount * FINDINGS_PAGE_SIZE,
      // Without this, a session with 800+ absolute-path findings would
      // page-window-shove every env-var / api-key off the first page
      // and the strip would render empty. Skip info-tier at the SQL
      // layer; the Info drawer at the bottom of the page is where
      // those audit records surface.
      excludeInfo: true,
    }
    if (activeKinds.length > 0) {
      f.kinds = activeKinds as NonNullable<FindingFilter['kinds']>
      // When the user pins an info kind explicitly, we DO want it back.
      // listFindings already ignores excludeInfo if `kinds` contains an
      // info kind, but flip the flag here too so the contract is
      // obvious at the call site.
      const someInfo = activeKinds.some(k => INFO_SEVERITY_KINDS.has(k as SensitiveKind))
      if (someInfo) f.excludeInfo = false
    }
    try {
      const page = await securityApi.listFindingsPage(f)
      setFindings(page.rows)
      setFindingsHasMore(page.hasMore)
      // Bulk-fetch raw values for the rows we're about to render in
      // one IPC trip instead of one-per-row. Caller passes the value
      // down as a prop; FindingItem no longer needs its own fetch.
      if (page.rows.length > 0) {
        const map = await securityApi.getFindingValues(page.rows.map(r => r.id))
        setValues(map)
      } else {
        setValues({})
      }
    } catch (err) {
      console.error('[security] listFindings failed for session', session.id, err)
      setFindings([])
      setValues({})
    }
  }, [session.id, activeKinds, findingsPageCount])

  useEffect(() => { void load() }, [load])

  // Reset pagination to first page when the active kind filter
  // changes — keeps Load-more counts aligned with the new result set.
  const activeKindsKey = activeKinds.join('|')
  useEffect(() => {
    setFindingsPageCount(1)
  }, [activeKindsKey])

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

  // Session-scoped bulk — the same unit the FindingsStrip acts on, so
  // both surfaces expose it identically (in the ⋯ menu). Re-fetch the
  // full active set rather than trusting the paginated `findings` so a
  // card showing only the first page still purges/dismisses everything.
  async function sessionReportableIds(): Promise<number[]> {
    const rows = await securityApi.listFindings({ sessionId: session.id, state: 'active' })
    return rows.filter(r => !INFO_SEVERITY_KINDS.has(r.kind as SensitiveKind)).map(r => r.id)
  }
  async function handleDismissAll() {
    const ids = await sessionReportableIds()
    if (ids.length === 0) return
    try { await securityApi.dismissFindings(ids, 'session') }
    catch { /* surfaces via reload */ }
    await load(); onRefresh()
  }
  async function handlePurgeAll() {
    const ids = await sessionReportableIds()
    if (ids.length === 0) return
    try { await securityApi.purgeFindings(ids) }
    catch { /* surfaces via reload */ }
    await load(); onRefresh()
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
          className="flex-1 min-w-0 flex items-center gap-2 pl-1 pr-1 py-0.5 rounded text-left cursor-default transition-colors"
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
          {/* Low count: a quiet dot beside the high triangle (it's the
           *  secondary signal), but when there's NO high triangle to
           *  anchor it the bare dot reads weak — so a lone low count
           *  borrows the same triangle in the muted low colour, so the
           *  cluster keeps a consistent icon weight either way. */}
          {low > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono tabular-nums text-[11px] text-warm-muted dark:text-dark-muted">
              {high > 0
                ? <span className="w-1 h-1 rounded-full bg-warm-muted dark:bg-dark-muted" />
                : <AlertTriangle size={12} strokeWidth={1.7} aria-hidden />}
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
              ...(high + low > 0 ? [
                {
                  label: t('security.dismiss_all', { defaultValue: 'Dismiss all' }),
                  icon: <Check size={14} strokeWidth={1.6} aria-hidden />,
                  onSelect: () => { void handleDismissAll() },
                },
                {
                  label: t('security.strip_purge_all', { defaultValue: 'Purge all' }),
                  icon: <Eraser size={14} strokeWidth={1.6} aria-hidden />,
                  onSelect: () => setPurgeAllPending(true),
                },
                { separator: true as const },
              ] : []),
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
              className="self-start mt-0.5 h-[22px] pl-6 pr-2 rounded bg-transparent font-mono text-[11px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text inline-flex items-center gap-3 transition-colors"
            >
              {/* Chevron sits in the same 14px centred slot the finding
               *  bullets use, so it lines up under the dots and the
               *  label aligns with the kind column. */}
              <span className="inline-flex items-center justify-center w-3.5">
                <ChevronDown size={11} strokeWidth={1.7} aria-hidden />
              </span>
              {t('security.show_more', { count: hidden, defaultValue: 'show {{count}} more' })}
            </button>
          )}
          {showAll && findingsHasMore && (
            <button
              type="button"
              data-testid="security-findings-load-more"
              onClick={() => setFindingsPageCount((n) => n + 1)}
              className="self-start ml-6 mt-0.5 h-[22px] px-2 rounded bg-transparent font-mono text-[11px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              {t('security.load_more', { defaultValue: 'Load more' })}
            </button>
          )}
        </div>
      )}
      <PurgeConfirmDialog
        open={purgeAllPending}
        count={high + low}
        kind={reportable[0]?.kind ?? 'mixed'}
        bulk
        hasCredential={high > 0}
        onConfirm={() => { setPurgeAllPending(false); void handlePurgeAll() }}
        onCancel={() => setPurgeAllPending(false)}
      />
    </article>
  )
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
    const kindLabel = SENSITIVE_KIND_LABEL[finding.kind as SensitiveKind] ?? finding.kind
    toast(
      scope === 'global'
        ? t('security.dismissed_global_toast', { kind: kindLabel, defaultValue: 'Ignored {{kind}} everywhere' })
        : t('security.dismissed_session_toast', { kind: kindLabel, defaultValue: 'Ignored {{kind}}' }),
      {
        // Show the value so the confirmation is recognisable, not just
        // "Ignored Env-var secret". Truncated; reconstructed plaintext,
        // same as the row that was just acted on.
        ...(value ? { description: truncateValue(value) } : {}),
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

  // Body sets `user-select: none` app-wide; revealed values need to
  // opt back in so the user can copy a leaked key / phone / email out.
  // Blurred mode keeps `select-none` so a stray drag doesn't reveal
  // the value via selection.
  const valueClass = isPurged
    ? 'line-through text-warm-faint dark:text-dark-faint select-text cursor-text'
    : revealed
      ? 'text-warm-text dark:text-dark-text select-text cursor-text'
      : 'text-warm-text dark:text-dark-text blur-[3.5px] cursor-pointer select-none'

  const displayValue = isPurged
    ? `[redacted: ${(SENSITIVE_KIND_LABEL[finding.kind as SensitiveKind] ?? finding.kind)}]`
    : value === null
      ? t('security.value_unavailable', { defaultValue: '(value unavailable)' })
      : value

  return (
    <div data-testid="finding-row-wrap" data-finding-id={finding.id}>
    <div
      data-testid="finding-row"
      data-finding-id={finding.id}
      data-kind={finding.kind}
      data-state={finding.state}
      data-blurred={!isPurged && !revealed ? '1' : '0'}
      className="group relative grid items-center gap-3 pl-6 pr-2 py-0.5 rounded font-mono text-[11px] hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
      style={{ gridTemplateColumns: '14px 110px 1fr', opacity: finding.state === 'dismissed' ? 0.5 : 1 }}
    >
      <span className={`justify-self-center w-1 h-1 rounded-full ${bulletClass}`} />
      <span className="text-warm-muted dark:text-dark-muted truncate">{finding.kind}</span>
      <span
        data-testid="finding-value"
        className={`truncate transition-[filter] duration-100 ${!isActive ? 'pr-20' : ''} ${valueClass}`}
        title={revealed && value ? value : undefined}
        onMouseEnter={() => valuesHidden && !isPurged && setLocalReveal(true)}
        onClick={() => valuesHidden && !isPurged && setLocalReveal(true)}
      >
        {displayValue}
      </span>
      {/* Actions (active) / state label (otherwise) float over the
       *  value's right edge instead of holding a grid column. An
       *  always-present `auto` column reserved the full button-cluster
       *  width even while the buttons were invisible, so the value
       *  truncated ~200px short of the real right edge. Now the value
       *  spans the row and a gradient mask matching the hover surface
       *  fades it out beneath the buttons so the two never collide. */}
      {isActive ? (
        <span className="absolute inset-y-0 right-0 z-10 flex items-stretch opacity-0 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 transition-opacity">
          {/* A short fade blends the value's tail into the surface
           *  right before an opaque block that carries the controls.
           *  The block colour matches the hovered row, so it's
           *  invisible against it — its only job is to mask the value
           *  beneath. `has-[aria-expanded]` keeps the whole group (and
           *  thus the menu's anchor) visible while the scope menu is
           *  open even after the pointer leaves the row. */}
          <span aria-hidden className="w-10 bg-gradient-to-r from-transparent to-warm-surface dark:to-dark-surface" />
          <span className="flex items-center gap-2 pr-2 bg-warm-surface dark:bg-dark-surface">
            {/* Dismiss is a single trigger that opens the scope menu —
             *  no implicit default action, since "session" vs "everywhere"
             *  is a real choice the user should make deliberately. Label +
             *  caret live in one button so they stay baseline-aligned. */}
            <Menu
              align="right"
              testId="ignore-scope-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="ignore-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className="inline-flex items-center gap-0.5 h-[18px] font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
                  title={t('security.dismiss', { defaultValue: 'Dismiss' })}
                >
                  {t('security.dismiss', { defaultValue: 'Dismiss' })}
                  <ChevronDown size={12} strokeWidth={1.7} aria-hidden className="-mr-0.5" />
                </button>
              )}
              items={[
                {
                  label: t('security.dismiss_session', { defaultValue: 'Dismiss in this session' }),
                  onSelect: () => { void dismiss('session') },
                },
                {
                  label: t('security.dismiss_global', { defaultValue: 'Dismiss everywhere' }),
                  onSelect: () => { void dismiss('global') },
                },
              ]}
            />
            {/* Hairline keeps the destructive Purge visually apart from
             *  the dismiss group. */}
            <span className="h-3 w-px bg-warm-border dark:bg-dark-border" aria-hidden />
            {/* Purge = scrub the value from the local archive, so an
             *  eraser (not a trash can) + its confirm dialog. */}
            <button
              type="button"
              data-testid="purge-button"
              onClick={() => setPurgePending(true)}
              className="inline-flex items-center justify-center h-[18px] w-4 text-warm-faint dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark transition-colors"
              title={t('security.purge', { defaultValue: 'Purge from local archive' })}
            >
              <Eraser size={12} strokeWidth={1.7} aria-hidden />
            </button>
          </span>
        </span>
      ) : (
        <span className="absolute inset-y-0 right-2 flex items-center font-sans text-[10px] uppercase tracking-[0.08em] font-semibold text-warm-faint dark:text-dark-muted">
          {finding.state}
        </span>
      )}
      <PurgeConfirmDialog
        open={purgePending}
        count={1}
        kind={finding.kind}
        {...(value !== null ? { before: value } : {})}
        onConfirm={() => { void purge() }}
        onCancel={() => setPurgePending(false)}
      />
    </div>
    {/* Cross-session blast radius — credentials only, active rows only.
     *  Identity/PII kinds can't be "rotated" and a contact recurring
     *  across sessions is expected, so the radius is reserved for the
     *  high-severity (credential) tier where multi-session exposure is
     *  the actionable signal. */}
    {isActive && high && (
      <div className="grid items-center gap-3 pl-6 pr-2 -mt-1" style={{ gridTemplateColumns: '14px 110px 1fr' }}>
        <div className="col-start-3 min-w-0">
          <BlastRadius kind={finding.kind as SensitiveKind} valueHash={finding.valueHash} currentSessionId={finding.sessionId} />
        </div>
      </div>
    )}
    </div>
  )
}

function EmptyState({
  onRescan,
  onOpenSettings,
  lastScan,
  currentProfile,
}: {
  onRescan: () => void
  onOpenSettings?: () => void
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
        <h2
          data-testid="security-empty-title"
          data-scan-state={lastScan === null ? 'never' : 'clean'}
          className="text-[15px] font-semibold text-warm-text dark:text-dark-text leading-5 tracking-[-0.005em]"
        >
          {lastScan === null
            ? t('security.empty_title_never', { defaultValue: "Scan hasn't run yet." })
            : t('security.empty_title', { defaultValue: 'Nothing to review.' })}
        </h2>
        <p className="text-[13px] text-warm-muted dark:text-dark-muted leading-[18px] max-w-[480px]">
          {lastScan === null
            ? t('security.empty_body_never', {
                defaultValue: 'Click Rescan all to begin.',
              })
            : t('security.empty_body', {
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
          {onOpenSettings && (
            <button
              type="button"
              data-testid="security-empty-detector-settings"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              <SettingsIcon size={12} strokeWidth={1.6} aria-hidden />
              {t('security.detector_settings', { defaultValue: 'Detector settings' })}
            </button>
          )}
        </div>

        {(lastScan || currentProfile) && (
          <div className="mt-1.5 rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold leading-[14px] text-warm-muted dark:text-dark-muted mb-1.5">
              {t('security.last_scan', { defaultValue: 'Last scan' })}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted leading-[18px]">
              {lastScan && (
                <div>
                  {t('security.last_scan_when', { ago: formatScanAgo(lastScan, t as unknown as (k: string, o?: Record<string, unknown>) => string), defaultValue: 'scanned {{ago}}' })}
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

function formatScanAgo(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  try {
    const ts = new Date(iso).getTime()
    const ms = Date.now() - ts
    if (!Number.isFinite(ms) || ms < 0) return t('security.ago_just_now', { defaultValue: 'just now' })
    const s = Math.floor(ms / 1000)
    if (s < 45) return t('security.ago_just_now', { defaultValue: 'just now' })
    const m = Math.floor(s / 60)
    if (m < 60) return t('security.ago_minutes', { count: m, defaultValue: '{{count}}m ago' })
    const h = Math.floor(m / 60)
    if (h < 24) return t('security.ago_hours', { count: h, defaultValue: '{{count}}h ago' })
    const d = Math.floor(h / 24)
    return t('security.ago_days', { count: d, defaultValue: '{{count}}d ago' })
  } catch {
    return ''
  }
}

