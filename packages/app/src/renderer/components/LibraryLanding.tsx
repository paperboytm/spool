import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers3 as LibraryIcon } from 'lucide-react'
import type { Session, SessionsCursor } from '@spool-lab/core'
import VirtualSessionList, { type SessionListRow } from './VirtualSessionList.js'
import { FeaturedEmptyState } from './EmptyState.js'
import { insertSessionSorted } from '../../shared/sessionSort.js'

type BucketKey = 'today' | 'yesterday' | 'earlierWeek' | 'earlierMonth' | 'older'

type Props = {
  onSelectProject: (identityKey: string) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare: (uuid: string) => void
}

type DateBucket = {
  key: BucketKey
  label: string
  sessions: Session[]
}

const PAGE_SIZE = 50

export default function LibraryLanding({ onOpenSession, onCopySessionId, onShare }: Props) {
  const { t, i18n } = useTranslation()
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[] | null>(null)
  const [cursor, setCursor] = useState<SessionsCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Per fetch we capture a token; only the freshest fetch is allowed to
  // mutate state. Replaces the per-effect `cancelled` flag so the initial
  // load and subsequent endReached pages share one rule.
  const fetchTokenRef = useRef(0)

  // Refs keep endReached's closure stable across renders.
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore
  const pinnedSessionsRef = useRef<Session[]>([])
  pinnedSessionsRef.current = pinnedSessions
  const pinnedUuidsRef = useRef(new Set<string>())
  pinnedUuidsRef.current = new Set(pinnedSessions.map(s => s.sessionUuid))

  useEffect(() => {
    const token = ++fetchTokenRef.current
    setRecentSessions(null)
    setCursor(null)
    setLoadingMore(false)
    Promise.all([
      window.spool.listPinnedSessions(),
      window.spool.listSessions({ limit: PAGE_SIZE }),
    ])
      .then(([pinned, page]) => {
        if (fetchTokenRef.current !== token) return
        const pinnedUuids = new Set(pinned.map(s => s.sessionUuid))
        setPinnedSessions(pinned)
        setRecentSessions(page.sessions.filter(s => !pinnedUuids.has(s.sessionUuid)))
        setCursor(page.nextCursor)
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return
        setPinnedSessions([])
        setRecentSessions([])
      })
  }, [])

  useEffect(() => {
    // Pin events from sibling components (sidebar, session detail).
    // Diff the fresh pinned list against the current one: anything that
    // disappeared was unpinned externally and must be reinserted into
    // recent — otherwise the session vanishes from this view entirely.
    //
    // We force `exhausted=true` for the reinsertion. Without it,
    // insertSessionSorted would drop candidates older than the last
    // loaded row (they'd "live in a future page"), which is exactly
    // the situation we're trying to avoid here — the user just had the
    // session in their pinned section and expects it to stay visible.
    // loadMore filters dedupe against already-loaded UUIDs so the
    // keyset query won't surface this session a second time.
    function handlePinEvent() {
      window.spool.listPinnedSessions()
        .then(freshPinned => {
          const freshUuids = new Set(freshPinned.map(s => s.sessionUuid))
          const newlyUnpinned = pinnedSessionsRef.current.filter(
            s => !freshUuids.has(s.sessionUuid),
          )
          setPinnedSessions(freshPinned)
          setRecentSessions(prev => {
            if (!prev) return prev
            let acc = prev.filter(s => !freshUuids.has(s.sessionUuid))
            for (const candidate of newlyUnpinned) {
              acc = insertSessionSorted(acc, candidate, 'recent', true)
            }
            return acc
          })
        })
        .catch(() => {})
    }
    window.addEventListener('spool:pin-change', handlePinEvent)
    return () => window.removeEventListener('spool:pin-change', handlePinEvent)
  }, [])

  useEffect(() => {
    // New sessions arrived via sync: soft-merge them into the first page
    // without unmounting the list. Skipped while we're between pages
    // (`loadingMore`) because the merge would race with that fetch.
    const off = window.spool.onNewSessions(() => {
      if (loadingRef.current) return
      window.spool.listSessions({ limit: PAGE_SIZE })
        .then(page => {
          setRecentSessions(prev => {
            if (prev === null) return page.sessions
            const known = new Set(prev.map(s => s.sessionUuid))
            const pinnedUuids = pinnedUuidsRef.current
            const additions = page.sessions.filter(s =>
              !known.has(s.sessionUuid) && !pinnedUuids.has(s.sessionUuid),
            )
            return additions.length === 0 ? prev : [...additions, ...prev]
          })
        })
        .catch(() => {})
    })
    return () => { off() }
  }, [])

  const loadMore = useCallback(() => {
    if (loadingRef.current || !cursorRef.current) return
    const token = ++fetchTokenRef.current
    setLoadingMore(true)
    window.spool.listSessions({ limit: PAGE_SIZE, cursor: cursorRef.current })
      .then(page => {
        if (fetchTokenRef.current !== token) return
        setRecentSessions(prev => {
          const base = prev ?? []
          // Dedupe against pinned + already-loaded. The keyset cursor
          // alone would suffice if nothing else mutated the list, but
          // handlePinEvent reinserts unpinned candidates regardless of
          // whether they sit beyond the loaded range, so they can
          // re-appear here when the page is fetched.
          const seen = new Set(base.map(s => s.sessionUuid))
          const additions = page.sessions.filter(s =>
            !pinnedUuidsRef.current.has(s.sessionUuid) && !seen.has(s.sessionUuid),
          )
          return [...base, ...additions]
        })
        setCursor(page.nextCursor)
        setLoadingMore(false)
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return
        setLoadingMore(false)
        setCursor(null)
      })
  }, [])

  function handlePinChange(sessionUuid: string, pinned: boolean) {
    if (pinned) {
      const candidate = recentSessions?.find(s => s.sessionUuid === sessionUuid)
      if (candidate) {
        setRecentSessions(prev => (prev ?? []).filter(s => s.sessionUuid !== sessionUuid))
        setPinnedSessions(prev => [candidate, ...prev])
      }
    } else {
      const candidate = pinnedSessions.find(s => s.sessionUuid === sessionUuid)
      setPinnedSessions(prev => prev.filter(s => s.sessionUuid !== sessionUuid))
      if (candidate) {
        // exhausted=true so an unpinned session deeper than the loaded
        // range still appears — see handlePinEvent for the rationale.
        setRecentSessions(prev =>
          prev ? insertSessionSorted(prev, candidate, 'recent', true) : prev,
        )
      }
    }
  }

  // i18n.language is a stable per-locale key; depending on `t` (which
  // changes identity on most renders) would rebuild rows constantly.
  const buckets = useMemo(
    () => (recentSessions ? bucketByDate(recentSessions, looseTranslator(t)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentSessions, i18n.language],
  )
  const totalSessions = pinnedSessions.length + (recentSessions?.length ?? 0)
  const pinnedLabel = useMemo(
    () => t('library.section_pinned', { count: pinnedSessions.length }),
    [t, pinnedSessions.length],
  )
  const exhausted = recentSessions !== null && cursor === null

  const rows = useMemo<SessionListRow[]>(() => {
    const out: SessionListRow[] = []
    if (pinnedSessions.length > 0) {
      out.push({
        kind: 'header',
        id: 'pinned',
        label: pinnedLabel,
        testId: 'library-pinned-header',
      })
      for (const s of pinnedSessions) {
        out.push({ kind: 'session', id: `p-${s.sessionUuid}`, session: s, pinned: true, showProject: true, headerId: 'pinned' })
      }
    }
    for (const bucket of buckets) {
      out.push({
        kind: 'header',
        id: `bucket-${bucket.key}`,
        label: bucket.label,
        testId: 'library-bucket-header',
        dataAttr: { 'data-bucket': bucket.key },
        sticky: true,
        collapsible: false,
      })
      for (const s of bucket.sessions) {
        out.push({
          kind: 'session',
          id: s.sessionUuid,
          session: s,
          showProject: true,
          bucket: bucket.key,
          headerId: `bucket-${bucket.key}`,
        })
      }
    }
    out.push({ kind: 'footer', id: 'footer', loading: loadingMore, exhausted, total: totalSessions })
    return out
  }, [pinnedSessions, pinnedLabel, buckets, loadingMore, exhausted, totalSessions])

  return (
    <div data-testid="library-landing" className="flex flex-col h-full overflow-hidden">
      {recentSessions === null ? (
        <SessionRowsSkeleton count={6} />
      ) : totalSessions === 0 ? (
        <FeaturedEmptyState
          icon={<LibraryIcon size={22} strokeWidth={1.5} />}
          title={t('library.empty_title')}
          hint={t('library.empty_body')}
        />
      ) : (
        <VirtualSessionList
          rows={rows}
          onEndReached={loadMore}
          onPinChange={handlePinChange}
          onOpenSession={onOpenSession}
          onCopySessionId={onCopySessionId}
          onShare={onShare}
          testId="library-landing-scroll"
          stickyHeaders
        />
      )}
    </div>
  )
}

function looseTranslator(t: ReturnType<typeof useTranslation>['t']): TranslateFn {
  return (key) => (t as unknown as (k: string) => string)(key)
}

export function CollapsibleSection({
  label,
  children,
  testId,
  dataAttr,
  defaultOpen = true,
}: {
  label: string
  children: ReactNode
  testId?: string
  dataAttr?: Record<string, string>
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId} {...(dataAttr ?? {})}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-1.5 px-6 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none"
      >
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && children}
    </div>
  )
}

function SessionRowsSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-5 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-4 w-12 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
            </div>
            <div className="h-3 w-1/3 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

type TranslateFn = (key: string) => string

export function bucketSessionsByDate(sessions: Session[], t?: TranslateFn): DateBucket[] {
  const fallback: TranslateFn = (key: string) => {
    switch (key) {
      case 'library.bucket_today': return 'Today'
      case 'library.bucket_yesterday': return 'Yesterday'
      case 'library.bucket_earlierWeek': return 'Earlier this week'
      case 'library.bucket_earlierMonth': return 'Earlier this month'
      case 'library.bucket_older': return 'Older'
      default: return key
    }
  }
  return bucketByDate(sessions, t ?? fallback)
}

function bucketByDate(sessions: Session[], t: TranslateFn): DateBucket[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const startOfWeek = startOfToday - 6 * 86400000
  const startOfMonth = startOfToday - 30 * 86400000

  const today: Session[] = []
  const yesterday: Session[] = []
  const earlierWeek: Session[] = []
  const earlierMonth: Session[] = []
  const older: Session[] = []

  for (const session of sessions) {
    const ts = Date.parse(session.startedAt)
    if (Number.isNaN(ts)) {
      older.push(session)
      continue
    }
    if (ts >= startOfToday) today.push(session)
    else if (ts >= startOfYesterday) yesterday.push(session)
    else if (ts >= startOfWeek) earlierWeek.push(session)
    else if (ts >= startOfMonth) earlierMonth.push(session)
    else older.push(session)
  }

  const buckets: DateBucket[] = []
  if (today.length > 0) buckets.push({ key: 'today', label: t('library.bucket_today'), sessions: today })
  if (yesterday.length > 0) buckets.push({ key: 'yesterday', label: t('library.bucket_yesterday'), sessions: yesterday })
  if (earlierWeek.length > 0) buckets.push({ key: 'earlierWeek', label: t('library.bucket_earlierWeek'), sessions: earlierWeek })
  if (earlierMonth.length > 0) buckets.push({ key: 'earlierMonth', label: t('library.bucket_earlierMonth'), sessions: earlierMonth })
  if (older.length > 0) buckets.push({ key: 'older', label: t('library.bucket_older'), sessions: older })
  return buckets
}
