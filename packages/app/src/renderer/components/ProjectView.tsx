import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp } from 'lucide-react'
import type { ProjectGroup, Session, SessionSource, ProjectSessionSortOrder, SessionsCursor, DirectoryCount } from '@spool-lab/core'
import VirtualSessionList, { type SessionListRow } from './VirtualSessionList.js'
import Menu from './Menu.js'
import { insertSessionSorted } from '../../shared/sessionSort.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { PROJECT_SORT_OPTIONS } from '../../shared/projectView.js'
import { securityFeatureEnabled } from '../featureFlags.js'
import { securityApi } from '../api/security.js'

type Props = {
  identityKey: string
  sortOrder: ProjectSessionSortOrder
  onSortOrderChange: (next: ProjectSessionSortOrder) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}

const PAGE_SIZE = 50

export default function ProjectView({
  identityKey,
  sortOrder,
  onSortOrderChange,
  onOpenSession,
  onCopySessionId,
  onShare,
}: Props) {
  const { t, i18n } = useTranslation()
  const projectSortLabel = (value: ProjectSessionSortOrder): string => {
    switch (value) {
      case 'recent': return t('project.sort_recent')
      case 'oldest': return t('project.sort_oldest')
      case 'most_messages': return t('project.sort_most_messages')
      case 'title': return t('project.sort_title')
    }
  }
  const [group, setGroup] = useState<ProjectGroup | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [directoryCounts, setDirectoryCounts] = useState<DirectoryCount[]>([])
  const [cursor, setCursor] = useState<SessionsCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeSources, setActiveSources] = useState<Set<SessionSource>>(new Set())
  const [isolatedCwd, setIsolatedCwd] = useState<string | null>(null)
  const [scanRefreshKey, setScanRefreshKey] = useState(0)
  const fetchTokenRef = useRef(0)

  // Re-fetch the session list when the scan worker updates findings —
  // the scan_finding_count denormalised counter on Session rows drives
  // the Library row badge, and without a refetch the badge never
  // appears after the initial backfill.
  //
  // Gated by securityFeatureEnabled() so the IPC subscription, the
  // mount-time bump, and the initial backfill check are all skipped
  // when the feature is off — prod builds (where VITE_FEATURE_SECURITY
  // isn't set) see this effect as a no-op.
  //
  // Debounce: backfill of N sessions publishes N session-rescanned
  // events. Without coalescing, the renderer would refetch + re-render
  // N times. Trail-edge debounce so we refetch once 300ms after the
  // burst settles — fast enough that the badge feels live, slow
  // enough that 500-session backfill collapses to a single refetch.
  useEffect(() => {
    if (!securityFeatureEnabled()) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleBump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        setScanRefreshKey(k => k + 1)
      }, 300)
    }

    // Subscribe BEFORE the mount bump so an event that arrives
    // between these two lines isn't missed. Both execute in the same
    // JS tick — events can't actually interleave — but the ordering
    // documents the invariant.
    const off = securityApi.onChange(scheduleBump)

    // Bump once on mount (immediate, not debounced) to catch the
    // cold-start race: a scan that completed between app boot and
    // this subscription would otherwise leave us showing the
    // pre-scan counts until the next change event lands.
    setScanRefreshKey(k => k + 1)

    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])

  useEffect(() => {
    setActiveSources(new Set())
    setIsolatedCwd(null)
  }, [identityKey])

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(groups => {
        if (cancelled) return
        setGroup(groups.find(g => g.identityKey === identityKey) ?? null)
      })
      .catch(() => { if (!cancelled) setGroup(null) })
    return () => { cancelled = true }
  }, [identityKey])

  useEffect(() => {
    const token = ++fetchTokenRef.current
    setSessions(null)
    setCursor(null)
    setLoadingMore(false)
    const sourcesArray = Array.from(activeSources)
    const sharedOptions = sourcesArray.length > 0 ? { sources: sourcesArray } : {}
    Promise.all([
      window.spool.listPinnedSessionsByIdentity(identityKey),
      window.spool.listSessionsByIdentity(identityKey, {
        sortOrder,
        excludePinned: true,
        limit: PAGE_SIZE,
        ...sharedOptions,
      }),
      window.spool.listProjectDirectoryCounts(identityKey, sourcesArray.length > 0 ? sourcesArray : undefined),
    ])
      .then(([pinned, page, counts]) => {
        if (fetchTokenRef.current !== token) return
        const filteredPinned = sourcesArray.length > 0
          ? pinned.filter(s => sourcesArray.includes(s.source))
          : pinned
        setPinnedSessions(filteredPinned)
        setSessions(page.sessions)
        setCursor(page.nextCursor)
        setDirectoryCounts(counts)
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return
        setPinnedSessions([])
        setSessions([])
        setDirectoryCounts([])
      })
  }, [identityKey, sortOrder, activeSources, scanRefreshKey])

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore
  const fetchArgsRef = useRef({ identityKey, sortOrder, activeSources })
  fetchArgsRef.current = { identityKey, sortOrder, activeSources }
  const pinnedSessionsRef = useRef<Session[]>([])
  pinnedSessionsRef.current = pinnedSessions
  const pinnedUuidsRef = useRef(new Set<string>())
  pinnedUuidsRef.current = new Set(pinnedSessions.map(s => s.sessionUuid))

  useEffect(() => {
    // Pin events from sibling components. Diff against pinnedSessionsRef
    // to detect what was unpinned externally and reinsert into the body
    // list — otherwise sidebar/menu-driven unpins make sessions vanish
    // from this view.
    function handlePinEvent() {
      const { identityKey: key, sortOrder: order, activeSources: srcs } = fetchArgsRef.current
      const sourcesArray = Array.from(srcs)
      window.spool.listPinnedSessionsByIdentity(key)
        .then(pinned => {
          const filtered = sourcesArray.length > 0
            ? pinned.filter(s => sourcesArray.includes(s.source))
            : pinned
          const freshUuids = new Set(filtered.map(s => s.sessionUuid))
          const newlyUnpinned = pinnedSessionsRef.current.filter(
            s => !freshUuids.has(s.sessionUuid),
          )
          setPinnedSessions(filtered)
          setSessions(prev => {
            if (!prev) return prev
            let acc = prev.filter(s => !freshUuids.has(s.sessionUuid))
            for (const candidate of newlyUnpinned) {
              // Re-respect the source filter — a pin from a filtered-out
              // source shouldn't reappear in the body when filtered.
              if (sourcesArray.length > 0 && !sourcesArray.includes(candidate.source)) continue
              // exhausted=true so candidates older than the loaded range
              // still surface; loadMore filters dedupe by uuid against
              // already-loaded rows.
              acc = insertSessionSorted(acc, candidate, order, true)
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
    // Soft-merge on sync. Always refresh directoryCounts (cheap, keeps
    // chip badges accurate); only refresh the body list when sortOrder
    // is 'recent', where new sessions reliably surface on the first
    // page. For other sort orders the refetched first page wouldn't
    // contain the new rows anyway (they're highest by startedAt, not by
    // title/oldest/message_count), so a merge would be misleading.
    const off = window.spool.onNewSessions(() => {
      if (loadingRef.current) return
      const { identityKey: key, sortOrder: order, activeSources: srcs } = fetchArgsRef.current
      const sourcesArray = Array.from(srcs)
      window.spool.listProjectDirectoryCounts(key, sourcesArray.length > 0 ? sourcesArray : undefined)
        .then(setDirectoryCounts)
        .catch(() => {})
      if (order !== 'recent') return
      window.spool.listSessionsByIdentity(key, {
        sortOrder: order,
        excludePinned: true,
        limit: PAGE_SIZE,
        ...(sourcesArray.length > 0 ? { sources: sourcesArray } : {}),
      })
        .then(page => {
          setSessions(prev => {
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
    const { identityKey: key, sortOrder: order, activeSources: srcs } = fetchArgsRef.current
    const sourcesArray = Array.from(srcs)
    window.spool.listSessionsByIdentity(key, {
      sortOrder: order,
      excludePinned: true,
      limit: PAGE_SIZE,
      cursor: cursorRef.current,
      ...(sourcesArray.length > 0 ? { sources: sourcesArray } : {}),
    })
      .then(page => {
        if (fetchTokenRef.current !== token) return
        setSessions(prev => {
          const base = prev ?? []
          // Dedupe against handlePinEvent's reinserted candidates and
          // any pin/unpin races since the cursor was captured.
          const seen = new Set(base.map(s => s.sessionUuid))
          const additions = page.sessions.filter(s => !seen.has(s.sessionUuid))
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
      const candidate = sessions?.find(s => s.sessionUuid === sessionUuid)
      if (candidate) {
        setSessions(prev => (prev ?? []).filter(s => s.sessionUuid !== sessionUuid))
        setPinnedSessions(prev => [candidate, ...prev])
      }
    } else {
      const candidate = pinnedSessions.find(s => s.sessionUuid === sessionUuid)
      setPinnedSessions(prev => prev.filter(s => s.sessionUuid !== sessionUuid))
      if (candidate) {
        // exhausted=true: see handlePinEvent for why we force this and
        // why loadMore dedupes against already-loaded rows.
        setSessions(prev =>
          prev ? insertSessionSorted(prev, candidate, sortOrder, true) : prev,
        )
      }
    }
  }

  const availableSources = group?.sources ?? []
  const displayPath = useMemo(() => {
    return pinnedSessions[0]?.projectDisplayPath ?? sessions?.[0]?.projectDisplayPath ?? null
  }, [pinnedSessions, sessions])

  // Bodies are grouped over loaded data so sections only show what we
  // can render. Chip badges run off directoryCounts (full project) so
  // their numbers stay accurate while pages stream in.
  const directoryGroups = useMemo(() => {
    if (!sessions) return null
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      const key = cwdOf(s)
      const arr = map.get(key)
      if (arr) arr.push(s)
      else map.set(key, [s])
    }
    return Array.from(map.entries())
      .map(([cwd, unpinned]) => {
        const lastAt = unpinned.reduce((acc, s) => (s.startedAt > acc ? s.startedAt : acc), '')
        return { cwd, unpinned, lastAt }
      })
      .sort((a, b) => (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0))
  }, [sessions])

  useEffect(() => {
    if (isolatedCwd === null) return
    if (!directoryCounts.some(c => c.cwd === isolatedCwd)) setIsolatedCwd(null)
  }, [directoryCounts, isolatedCwd])

  const visiblePinned = useMemo(() => {
    if (isolatedCwd === null) return pinnedSessions
    return pinnedSessions.filter(s => cwdOf(s) === isolatedCwd)
  }, [pinnedSessions, isolatedCwd])

  const visibleUnpinned = useMemo<Session[]>(() => {
    if (!sessions) return []
    if (isolatedCwd === null) return sessions
    return sessions.filter(s => cwdOf(s) === isolatedCwd)
  }, [sessions, isolatedCwd])

  const groupByDirectory = isolatedCwd === null && (directoryGroups?.length ?? 0) >= 2

  const looseT = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const meta = useMemo(() => {
    if (!group) return null
    const lastActivity = group.lastSessionAt ? formatRelativeDate(group.lastSessionAt, { t: looseT }) : null
    return { count: group.sessionCount, lastActivity, sources: group.sources }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, i18n.language])

  function toggleSource(source: SessionSource) {
    setActiveSources(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  // When the user isolates to one cwd we filter client-side, so the
  // footer count must reflect what's actually visible — otherwise the
  // "End of N sessions" line disagrees with the chip badge.
  const totalLoaded = isolatedCwd === null
    ? (sessions?.length ?? 0) + pinnedSessions.length
    : visiblePinned.length + visibleUnpinned.length
  const exhausted = sessions !== null && cursor === null
  const pinnedLabel = useMemo(
    () => t('library.section_pinned', { count: visiblePinned.length }),
    [t, visiblePinned.length],
  )
  const rows = useMemo<SessionListRow[]>(() => {
    const out: SessionListRow[] = []
    if (visiblePinned.length > 0) {
      out.push({
        kind: 'header',
        id: 'pinned',
        label: pinnedLabel,
        testId: 'project-view-pinned-header',
      })
      for (const s of visiblePinned) {
        out.push({
          kind: 'session', id: `p-${s.sessionUuid}`, session: s,
          pinned: true, headerId: 'pinned',
        })
      }
    }
    if (groupByDirectory && directoryGroups) {
      for (const g of directoryGroups) {
        if (g.unpinned.length === 0) continue
        const { name } = formatCwdLabel(g.cwd, displayPath)
        const headerId = `cwd-${g.cwd}`
        out.push({
          kind: 'header',
          id: headerId,
          label: <DirectoryHeaderLabel name={name} count={g.unpinned.length} />,
          testId: 'project-view-directory-group-header',
          dataAttr: { 'data-cwd': g.cwd },
        })
        for (const s of g.unpinned) {
          out.push({ kind: 'session', id: s.sessionUuid, session: s, headerId })
        }
      }
    } else {
      if (visiblePinned.length > 0 && visibleUnpinned.length > 0) {
        out.push({
          kind: 'header',
          id: 'recent',
          label: t('library.section_recent'),
          testId: 'project-view-recent-header',
        })
      }
      for (const s of visibleUnpinned) {
        out.push({ kind: 'session', id: s.sessionUuid, session: s, headerId: 'recent' })
      }
    }
    out.push({ kind: 'footer', id: 'footer', loading: loadingMore, exhausted, total: totalLoaded })
    return out
  }, [visiblePinned, visibleUnpinned, groupByDirectory, directoryGroups, displayPath, loadingMore, exhausted, totalLoaded, pinnedLabel])

  return (
    <div data-testid="project-view" className="flex flex-col h-full overflow-hidden">
      <div className="flex-none px-6 pt-1.5 pb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-warm-text dark:text-dark-text">
            {group?.displayName ?? identityKey}
          </h1>
          {displayPath && (
            <span className="text-[11px] font-mono text-warm-faint/80 dark:text-dark-muted/80 truncate" title={displayPath}>
              {displayPath}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {meta && (
            <p className="text-xs text-warm-muted dark:text-dark-muted flex items-center gap-2 flex-wrap min-w-0">
              <span>{t('project.sessionCount_other', { count: meta.count })}</span>
              {meta.lastActivity && <><span aria-hidden>·</span><span>{t('project.updatedWhen', { when: meta.lastActivity })}</span></>}
              {meta.sources.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-2 flex-wrap">
                    {meta.sources.map(src => {
                      const isInteractive = availableSources.length > 1
                      const active = activeSources.has(src)
                      const noFilter = activeSources.size === 0
                      const visualActive = noFilter || active
                      const content = (
                        <>
                          <span
                            aria-hidden
                            className="w-1.5 h-1.5 rounded-full flex-none"
                            style={{ background: getSessionSourceColor(src) }}
                          />
                          <span>{getSessionSourceLabel(src)}</span>
                        </>
                      )
                      if (!isInteractive) {
                        return (
                          <span key={src} className="flex items-center gap-1">{content}</span>
                        )
                      }
                      return (
                        <button
                          key={src}
                          type="button"
                          data-testid="source-filter-pill"
                          data-source={src}
                          aria-pressed={active}
                          onClick={() => toggleSource(src)}
                          className={`flex items-center gap-1 rounded transition-opacity hover:text-warm-text dark:hover:text-dark-text ${
                            visualActive ? 'opacity-100' : 'opacity-40'
                          } ${active ? 'text-warm-text dark:text-dark-text' : ''}`}
                        >
                          {content}
                        </button>
                      )
                    })}
                  </span>
                </>
              )}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Menu
              align="right"
              testId="project-sort-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="project-sort"
                  data-value={sortOrder}
                  aria-label={t('fragment.sortAriaLabel')}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                  className="inline-flex items-center gap-1.5 h-7 px-2 text-xs font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
                >
                  <ArrowDownUp size={13} strokeWidth={1.5} aria-hidden />
                  <span>{t('fragment.sortLabel', { value: projectSortLabel(sortOrder) })}</span>
                </button>
              )}
              items={PROJECT_SORT_OPTIONS.map(option => ({
                label: projectSortLabel(option.value),
                active: sortOrder === option.value,
                onSelect: () => onSortOrderChange(option.value),
              }))}
            />
          </div>
        </div>

        {directoryCounts.length >= 2 && (
          <DirectoryChipStrip
            counts={directoryCounts}
            isolatedCwd={isolatedCwd}
            projectDisplayPath={displayPath}
            onSelect={setIsolatedCwd}
          />
        )}

        {isolatedCwd && isolatedCwd !== '(unknown)' && (
          <p
            data-testid="project-isolated-cwd"
            className="mt-1.5 font-mono text-[11px] text-warm-faint/80 dark:text-dark-muted/80 truncate"
            title={isolatedCwd}
          >
            {isolatedCwd}
          </p>
        )}
      </div>

      {sessions === null ? (
        <div className="px-4 py-8 text-center text-sm text-warm-faint dark:text-dark-muted">
          {t('common.loading')}
        </div>
      ) : visibleUnpinned.length === 0 && visiblePinned.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-warm-muted dark:text-dark-muted">{t('project.noSessions')}</p>
          <div className="mt-2 flex items-center justify-center gap-3 text-xs">
            {activeSources.size > 0 && (
              <button
                type="button"
                onClick={() => setActiveSources(new Set())}
                className="text-accent hover:underline"
              >
                {t('project.clearSourceFilter')}
              </button>
            )}
            {isolatedCwd !== null && (
              <button
                type="button"
                onClick={() => setIsolatedCwd(null)}
                className="text-accent hover:underline"
              >
                {t('project.clearDirectoryFilter')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <VirtualSessionList
          rows={rows}
          onEndReached={loadMore}
          onPinChange={handlePinChange}
          onOpenSession={onOpenSession}
          onCopySessionId={onCopySessionId}
          {...(onShare ? { onShare } : {})}
          testId="project-view-scroll"
        />
      )}
    </div>
  )
}

function DirectoryHeaderLabel({ name, count }: { name: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[11px] font-medium truncate">{name}</span>
      {count > 1 && (
        <span className="font-mono text-[10px] tabular-nums flex-none">{count}</span>
      )}
    </span>
  )
}

const MAX_INLINE_CHIPS = 4

function DirectoryChipStrip({
  counts,
  isolatedCwd,
  projectDisplayPath,
  onSelect,
}: {
  counts: DirectoryCount[]
  isolatedCwd: string | null
  projectDisplayPath: string | null
  onSelect: (cwd: string | null) => void
}) {
  const totalSessions = counts.reduce((sum, c) => sum + c.sessionCount, 0)
  const top = counts.slice(0, MAX_INLINE_CHIPS)
  let inline = top
  if (
    isolatedCwd !== null
    && !top.some(c => c.cwd === isolatedCwd)
    && counts.some(c => c.cwd === isolatedCwd)
  ) {
    const active = counts.find(c => c.cwd === isolatedCwd)!
    inline = [...top.slice(0, MAX_INLINE_CHIPS - 1), active]
  }
  const inlineSet = new Set(inline.map(c => c.cwd))
  const overflow = counts.filter(c => !inlineSet.has(c.cwd))

  return (
    <div data-testid="project-directory-chips" className="mt-2 flex items-center gap-1 flex-wrap">
      <DirectoryChip
        active={isolatedCwd === null}
        label="All"
        count={totalSessions}
        onClick={() => onSelect(null)}
      />
      {inline.map(c => {
        const { name } = formatCwdLabel(c.cwd, projectDisplayPath)
        return (
          <DirectoryChip
            key={c.cwd}
            active={isolatedCwd === c.cwd}
            label={name}
            title={c.cwd === '(unknown)' ? undefined : c.cwd}
            count={c.sessionCount}
            onClick={() => onSelect(c.cwd)}
          />
        )
      })}
      {overflow.length > 0 && (
        <Menu
          align="left"
          testId="project-directory-overflow"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="project-directory-overflow-trigger"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={toggle}
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface/60 dark:hover:bg-dark-surface/60 transition-colors"
            >
              <span>+{overflow.length} more</span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden className="text-warm-faint dark:text-dark-muted">
                <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          items={overflow.map(c => {
            const { name } = formatCwdLabel(c.cwd, projectDisplayPath)
            return {
              label: `${name} · ${c.sessionCount}`,
              active: isolatedCwd === c.cwd,
              onSelect: () => onSelect(c.cwd),
            }
          })}
        />
      )}
    </div>
  )
}

function DirectoryChip({
  active,
  label,
  count,
  title,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  title?: string | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid="project-directory-chip"
      data-active={active ? 'true' : undefined}
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium transition-colors ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface/60 dark:hover:bg-dark-surface/60'
      }`}
    >
      <span className="truncate max-w-[120px]">{label}</span>
      <span className="font-mono tabular-nums text-[10px] text-warm-faint dark:text-dark-muted">
        {count}
      </span>
    </button>
  )
}

function cwdOf(s: Session): string {
  return s.cwd && s.cwd.length > 0 ? s.cwd : '(unknown)'
}

function formatCwdLabel(cwd: string, projectDisplayPath: string | null): { name: string; tail: string } {
  if (cwd === '(unknown)') return { name: 'no cwd', tail: '' }
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length === 0) return { name: cwd, tail: '' }
  const name = parts[parts.length - 1]!
  if (projectDisplayPath && cwd === projectDisplayPath) {
    return { name, tail: 'project root' }
  }
  if (projectDisplayPath && cwd.startsWith(projectDisplayPath + '/')) {
    const rel = cwd.slice(projectDisplayPath.length + 1).split('/').filter(Boolean)
    const parent = rel.slice(0, -1).join('/')
    return { name, tail: parent }
  }
  const parent = parts.slice(0, -1).join('/')
  return { name, tail: parent ? '/' + parent : '' }
}
