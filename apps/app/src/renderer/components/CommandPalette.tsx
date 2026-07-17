import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { AlertCircle, Inbox, Search as SearchIcon, SearchX, SlidersHorizontal } from 'lucide-react'
import type { Session, SearchResult, SessionSource, SessionsCursor } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import Hint from './Hint.js'
import ScopeSelector, { type ScopeValue } from './ScopeSelector.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { snippetToStrongHtml } from '../lib/snippet.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import { bucketSessionsByDate } from './LibraryLanding.js'

/**
 * Unified row shape. Recent mode populates everything except snippet;
 * search mode adds snippet (and messageId for cmdk navigation).
 */
export type PaletteRow = {
  sessionUuid: string
  title: string
  source: SessionSource
  projectLabel: string
  startedAt: string
  msgCount?: number
  /** HTML-with-<mark> from FTS; undefined in recent mode. */
  snippet?: string
  /** Fragment-level anchor for cmdk navigation. */
  messageId?: number
}

const RECENT_PAGE_SIZE = 50
const SEARCH_LIMIT = 30
const DEBOUNCE_MS = 150

export type CommandPaletteLabels = {
  /** Footer hint for ↵ — e.g. "open", "ask". */
  enterHint: string
  /** Footer hint for ⇧↵. Omit/empty disables the hint. */
  shiftEnterHint?: string
  /** Body when in search mode with zero matches. */
  noMatches: (query: string) => string
  /** Body when not in search mode and no sessions exist anywhere. */
  emptyNoSessions: string
  /** Body when scope is set and that scope has no sessions. */
  emptyInProject: (projectName: string) => string
  /** Footer affordance for search-mode results — clickable when `onCommit`
   *  is set (jumps to the full results page). Omit to hide. */
  resultsTotal?: (count: number) => string
}

type Props = {
  testId: string
  placeholder: string
  initialQuery?: string
  /** Controlled scope state (null = all projects). */
  scope: ScopeValue | null
  onScopeChange: (next: ScopeValue | null) => void
  /** When set, Tab toggles between this contextual scope and null. */
  contextualScope?: ScopeValue | null
  /** Slot above the search input on the right (e.g. Fast/AI pill). */
  headerExtras?: ReactNode
  /** Slot on the scope row, right side (e.g. AgentSelector when in AI mode). */
  scopeRowExtras?: ReactNode
  /** When true, recents are grouped under date bucket headers. */
  groupRecentsByDate?: boolean
  /** When true, query change does not trigger FTS — Enter commits instead. */
  searchDisabled?: boolean
  /** When provided, Tab is shown as an active hint in the scope row. */
  showTabScopeHint?: boolean
  /** When true, the options row is open on mount even if scope is null. */
  optionsDefaultOpen?: boolean
  /** Footer hint configuration — see CommandPaletteLabels. */
  labels: CommandPaletteLabels
  /** ↵ on a row. Also fires when searchDisabled is false. */
  onSubmit: (row: PaletteRow, query: string) => void
  /** ⇧↵ commit, or ↵ when searchDisabled is true. */
  onCommit?: (query: string) => void
  onClose: () => void
}

export default function CommandPalette({
  testId,
  placeholder,
  initialQuery = '',
  scope,
  onScopeChange,
  contextualScope,
  headerExtras,
  scopeRowExtras,
  groupRecentsByDate = false,
  searchDisabled = false,
  showTabScopeHint = false,
  optionsDefaultOpen = false,
  labels,
  onSubmit,
  onCommit,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const noTitle = t('common.noTitle')
  const [query, setQuery] = useState(initialQuery)
  const [recent, setRecent] = useState<Session[] | null>(null)
  const [recentCursor, setRecentCursor] = useState<SessionsCursor | null>(null)
  const [recentLoadingMore, setRecentLoadingMore] = useState(false)
  const [results, setResults] = useState<PaletteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(scope !== null || optionsDefaultOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const requestSeqRef = useRef(0)
  const recentTokenRef = useRef(0)
  // Refs keep the endReached closure stable — same pattern as LibraryLanding.
  const recentCursorRef = useRef(recentCursor)
  recentCursorRef.current = recentCursor
  const recentLoadingRef = useRef(recentLoadingMore)
  recentLoadingRef.current = recentLoadingMore
  const scopeKeyRef = useRef(scope?.identityKey)
  scopeKeyRef.current = scope?.identityKey

  // Auto-expand whenever scope flips to non-null so the user can see the
  // active filter; collapsing is left to the user via the toggle.
  useEffect(() => {
    if (scope) setFiltersOpen(true)
  }, [scope?.identityKey])

  // Re-seed query whenever the caller pushes a new initialQuery (e.g. cmdk
  // re-opening with a different starting term).
  useEffect(() => { setQuery(initialQuery) }, [initialQuery])

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  // Modal layer — stacks below any popover (e.g. ScopeSelector popover)
  // and routes Escape to onClose.
  useHotkeys({ Escape: onClose }, { modal: true })

  // Recents fetch (scoped if a project is selected). Cursor pagination —
  // initial page first, more on Virtuoso endReached.
  useEffect(() => {
    const token = ++recentTokenRef.current
    setRecent(null)
    setRecentCursor(null)
    setRecentLoadingMore(false)
    setError(null)
    fetchRecentsPage(scope?.identityKey, null)
      .then((page) => {
        if (recentTokenRef.current !== token) return
        setRecent(page.sessions)
        setRecentCursor(page.nextCursor)
      })
      .catch((err) => {
        if (recentTokenRef.current !== token) return
        setError(err instanceof Error ? err.message : t('common.error'))
        setRecent([])
        setRecentCursor(null)
      })
  }, [scope?.identityKey])

  const loadMoreRecents = useCallback(() => {
    if (recentLoadingRef.current || !recentCursorRef.current) return
    const token = recentTokenRef.current
    setRecentLoadingMore(true)
    fetchRecentsPage(scopeKeyRef.current, recentCursorRef.current)
      .then((page) => {
        if (recentTokenRef.current !== token) return
        setRecent((prev) => {
          const base = prev ?? []
          const seen = new Set(base.map((s) => s.sessionUuid))
          const additions = page.sessions.filter((s) => !seen.has(s.sessionUuid))
          return additions.length === 0 ? base : [...base, ...additions]
        })
        setRecentCursor(page.nextCursor)
        setRecentLoadingMore(false)
      })
      .catch(() => {
        if (recentTokenRef.current !== token) return
        setRecentLoadingMore(false)
        setRecentCursor(null)
      })
  }, [])

  // FTS search with optional project scope. Skipped when `searchDisabled`
  // (AI mode etc.); empty query clears results and re-shows recents.
  useEffect(() => {
    if (searchDisabled) {
      setResults(null)
      setIsSearching(false)
      return
    }
    const q = query.trim()
    if (!q) {
      setResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const seq = ++requestSeqRef.current
    const handle = setTimeout(() => {
      const req = scope
        ? window.spool.search(q, SEARCH_LIMIT, undefined, false, scope.identityKey)
        : window.spool.searchPreview(q, SEARCH_LIMIT)
      req
        .then((rows) => {
          if (seq !== requestSeqRef.current) return
          const seen = new Set<string>()
          const unique: PaletteRow[] = []
          for (const r of rows) {
            if (seen.has(r.sessionUuid)) continue
            seen.add(r.sessionUuid)
            unique.push(searchResultToRow(r, noTitle))
          }
          setResults(unique)
          setIsSearching(false)
        })
        .catch(() => {
          if (seq !== requestSeqRef.current) return
          setResults([])
          setIsSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(handle) }
  }, [query, scope?.identityKey, searchDisabled])

  const inSearchMode = !searchDisabled && query.trim().length > 0
  const recentRows = useMemo(
    () => recent?.map(s => sessionToRow(s, noTitle)) ?? null,
    [recent, noTitle],
  )
  const rows: PaletteRow[] | null = inSearchMode ? results : recentRows

  const queryTokens = inSearchMode
    ? query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    : []

  const showProjectOnRow = !scope

  // Flatten recents into virtual items (headers + rows + loading sentinel).
  // The header path only activates when groupRecentsByDate is set; otherwise
  // it's just rows + sentinel.
  const tLoose = t as unknown as (k: string) => string
  const virtualRecents = useMemo<{ items: VirtualItem[]; rowIndexToVirtualIndex: number[] }>(() => {
    if (!recent) return { items: [], rowIndexToVirtualIndex: [] }
    return buildVirtualRecents(recent, noTitle, groupRecentsByDate ? tLoose : null, recentLoadingMore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, noTitle, groupRecentsByDate, recentLoadingMore, t])

  // Reset active row whenever the visible list changes shape (scope flip,
  // mode toggle, or new search results). Appending a recents page should
  // NOT reset, so we deliberately do not depend on `recent.length`.
  useEffect(() => {
    setActiveIndex(0)
  }, [inSearchMode, scope?.identityKey, results?.length])

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (inSearchMode) {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    } else {
      const virtualIndex = virtualRecents.rowIndexToVirtualIndex[activeIndex]
      if (virtualIndex != null) {
        virtuosoRef.current?.scrollIntoView({ index: virtualIndex })
      }
    }
  }, [activeIndex, inSearchMode, virtualRecents])

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Tab' && contextualScope) {
      e.preventDefault()
      onScopeChange(scope?.identityKey === contextualScope.identityKey ? null : contextualScope)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey || searchDisabled) {
        if (query.trim()) onCommit?.(query)
        return
      }
      const row = rows?.[activeIndex]
      if (row) onSubmit(row, query)
      return
    }
    if (!rows || rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(rows.length - 1)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={testId}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[12vh] animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-[560px] max-h-[70vh] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex-none flex items-center gap-2.5 px-5 py-3">
          <SearchIcon
            size={15}
            strokeWidth={1.6}
            aria-hidden
            className="flex-none text-warm-faint dark:text-dark-muted"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKey}
            placeholder={placeholder}
            data-testid={`${testId}-input`}
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted"
          />
          {isSearching && (
            <span className="flex-none text-[10px] text-warm-faint dark:text-dark-muted">{t('search.searchingShort')}</span>
          )}
          {headerExtras && <div className="flex-none">{headerExtras}</div>}
          <button
            type="button"
            data-testid={`${testId}-options-toggle`}
            aria-pressed={filtersOpen}
            aria-label={t('palette.toggleOptions')}
            onClick={() => {
              setFiltersOpen(v => !v)
              inputRef.current?.focus()
            }}
            className={`flex-none rounded-md p-1 -ml-1 transition-colors ${
              scope
                ? 'text-accent hover:bg-accent/10 dark:text-accent-dark dark:hover:bg-accent-dark/10'
                : filtersOpen
                  ? 'bg-warm-surface2 text-warm-text dark:bg-dark-surface2 dark:text-dark-text'
                  : 'text-warm-faint hover:bg-warm-surface2 hover:text-warm-text dark:text-dark-muted dark:hover:bg-dark-surface2 dark:hover:text-dark-text'
            }`}
          >
            <SlidersHorizontal size={13} strokeWidth={1.6} aria-hidden />
          </button>
        </div>

        {/* Options row — scope + caller-provided extras (agent selector, etc). */}
        {filtersOpen && (
          <div
            data-testid={`${testId}-options-row`}
            className="flex-none px-5 pb-2 flex items-center gap-1.5"
          >
            <ScopeSelector
              value={scope}
              onChange={(next) => {
                onScopeChange(next)
                // Return focus to the search input so the Tab shortcut and
                // arrow-nav remain live after the popover closes.
                inputRef.current?.focus()
              }}
              onPopoverClose={() => inputRef.current?.focus()}
              testIdPrefix={`${testId}-scope`}
            />
            {showTabScopeHint && contextualScope && (
              <span
                data-testid={`${testId}-scope-tabhint`}
                className="flex items-center gap-1.5 text-[10px] text-warm-faint dark:text-dark-muted ml-1"
              >
                <kbd className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">Tab</kbd>
                <span>{t('search.scope_switchHint')}</span>
              </span>
            )}
            {scopeRowExtras && <div className="ml-auto">{scopeRowExtras}</div>}
          </div>
        )}

        {/* Results / recents. Min-height keeps the modal a usable shape even
            when Virtuoso has no intrinsic height to push against the modal's
            max-h-[70vh]; each branch owns its scroll context. */}
        <div ref={listRef} className="flex-1 min-h-[40vh] flex flex-col">
          {rows === null ? (
            <div className="overflow-y-auto">
              <PaletteSkeleton count={6} />
            </div>
          ) : error && !inSearchMode ? (
            <PaletteEmpty
              icon={<AlertCircle size={18} strokeWidth={1.6} aria-hidden />}
              message={t('newDraft.loadError', { error })}
            />
          ) : rows.length === 0 ? (
            <PaletteEmpty
              icon={inSearchMode
                ? <SearchX size={18} strokeWidth={1.6} aria-hidden />
                : <Inbox size={18} strokeWidth={1.6} aria-hidden />}
              message={inSearchMode
                ? labels.noMatches(query.trim())
                : scope
                  ? labels.emptyInProject(scope.displayName)
                  : labels.emptyNoSessions}
            />
          ) : inSearchMode ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <FlatList
                testId={testId}
                rows={rows}
                queryTokens={queryTokens}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                onSelect={(row) => onSubmit(row, query)}
                showProject={showProjectOnRow}
              />
            </div>
          ) : (
            <VirtualRecents
              testId={testId}
              virtuosoRef={virtuosoRef}
              items={virtualRecents.items}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              onSelect={(row) => onSubmit(row, query)}
              onEndReached={loadMoreRecents}
              showProject={showProjectOnRow}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex-none w-full px-4 py-2 text-[11px] flex items-center justify-between text-warm-faint dark:text-dark-muted gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {rows && rows.length > 0 && (
              <>
                <Hint keys={['↑', '↓']} label={t('newDraft.navigate')} />
                <Hint keys={['↵']} label={labels.enterHint} />
              </>
            )}
            {labels.shiftEnterHint && rows && rows.length > 0 && (
              <Hint keys={['⇧', '↵']} label={labels.shiftEnterHint} />
            )}
            <Hint keys={['esc']} label={t('newDraft.close')} />
          </div>
          {inSearchMode && labels.resultsTotal && rows && rows.length > 0 && (
            onCommit ? (
              <button
                type="button"
                data-testid={`${testId}-results-total`}
                onClick={() => onCommit(query)}
                className="flex-none rounded-md px-1.5 py-0.5 -my-0.5 hover:bg-warm-surface2 hover:text-warm-text dark:hover:bg-dark-surface2 dark:hover:text-dark-text transition-colors"
              >
                {labels.resultsTotal(rows.length)}
              </button>
            ) : (
              <span className="flex-none">{labels.resultsTotal(rows.length)}</span>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function FlatList({
  testId,
  rows,
  queryTokens,
  activeIndex,
  setActiveIndex,
  onSelect,
  showProject,
}: {
  testId: string
  rows: PaletteRow[]
  queryTokens: string[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  onSelect: (row: PaletteRow) => void
  showProject: boolean
}) {
  return (
    <ul role="listbox">
      {rows.map((row, index) => (
        <li
          key={`${row.sessionUuid}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          data-row-index={index}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <PaletteRowButton
            testId={testId}
            row={row}
            queryTokens={queryTokens}
            active={index === activeIndex}
            showProject={showProject}
            onSelect={() => onSelect(row)}
          />
        </li>
      ))}
    </ul>
  )
}

type VirtualItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'row'; key: string; row: PaletteRow; rowIndex: number }
  | { kind: 'loading'; key: 'loading-more' }

function buildVirtualRecents(
  sessions: Session[],
  noTitle: string,
  t: ((k: string) => string) | null,
  loadingMore: boolean,
): { items: VirtualItem[]; rowIndexToVirtualIndex: number[] } {
  const items: VirtualItem[] = []
  const rowIndexToVirtualIndex: number[] = []
  const pushRow = (session: Session): void => {
    rowIndexToVirtualIndex.push(items.length)
    items.push({
      kind: 'row',
      key: session.sessionUuid,
      row: sessionToRow(session, noTitle),
      rowIndex: rowIndexToVirtualIndex.length - 1,
    })
  }
  if (t) {
    for (const bucket of bucketSessionsByDate(sessions, t)) {
      items.push({ kind: 'header', key: `h-${bucket.label}`, label: bucket.label })
      for (const session of bucket.sessions) pushRow(session)
    }
  } else {
    for (const session of sessions) pushRow(session)
  }
  if (loadingMore) items.push({ kind: 'loading', key: 'loading-more' })
  return { items, rowIndexToVirtualIndex }
}

function VirtualRecents({
  testId,
  virtuosoRef,
  items,
  activeIndex,
  setActiveIndex,
  onSelect,
  onEndReached,
  showProject,
}: {
  testId: string
  virtuosoRef: React.MutableRefObject<VirtuosoHandle | null>
  items: VirtualItem[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  onSelect: (row: PaletteRow) => void
  onEndReached: () => void
  showProject: boolean
}) {
  const { t } = useTranslation()
  return (
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      data-testid={`${testId}-virtual`}
      computeItemKey={(_index, item) => item.key}
      defaultItemHeight={40}
      increaseViewportBy={200}
      endReached={onEndReached}
      role="listbox"
      className="flex-1 min-h-0"
      itemContent={(_virtualIndex, item) => {
        if (item.kind === 'header') {
          return (
            <div
              data-testid={`${testId}-bucket-header`}
              className="px-5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.04em] text-warm-faint dark:text-dark-muted"
            >
              {item.label}
            </div>
          )
        }
        if (item.kind === 'loading') {
          return (
            <div
              data-testid={`${testId}-loading-more`}
              className="px-5 py-3 text-center text-[11px] text-warm-faint dark:text-dark-muted"
            >
              {t('library.footer_loadingMore')}
            </div>
          )
        }
        const active = item.rowIndex === activeIndex
        return (
          <div
            role="option"
            aria-selected={active}
            data-row-index={item.rowIndex}
            onMouseEnter={() => setActiveIndex(item.rowIndex)}
          >
            <PaletteRowButton
              testId={testId}
              row={item.row}
              queryTokens={[]}
              active={active}
              showProject={showProject}
              onSelect={() => onSelect(item.row)}
            />
          </div>
        )
      }}
    />
  )
}

function PaletteRowButton({
  testId,
  row,
  queryTokens,
  active,
  showProject,
  onSelect,
}: {
  testId: string
  row: PaletteRow
  queryTokens: string[]
  active: boolean
  showProject: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const date = formatRelativeDate(row.startedAt, { t: t as unknown as (k: string, o?: Record<string, unknown>) => string })
  const inSearchMode = queryTokens.length > 0
  const snippetHtml = inSearchMode && row.snippet ? snippetToStrongHtml(row.snippet) : null
  const activeBg = active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
  const projectVisible = showProject && row.projectLabel

  return (
    <button
      type="button"
      data-testid={`${testId}-row`}
      data-session-uuid={row.sessionUuid}
      onClick={onSelect}
      title={projectVisible ? `${row.title} · ${row.projectLabel}` : row.title}
      className={`w-full flex items-start gap-3 px-5 py-2 text-left transition-colors duration-75 ${activeBg}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <SourceBadge source={row.source} />
          <span className="flex-1 min-w-0 text-sm truncate">
            <span className="text-warm-text dark:text-dark-text">{row.title}</span>
            {projectVisible && (
              <span className="text-[11px] text-warm-faint dark:text-dark-muted"> · {row.projectLabel}</span>
            )}
          </span>
        </div>
        {snippetHtml && (
          <div
            className="mt-0.5 pl-1.5 text-[11px] text-warm-faint dark:text-dark-muted truncate [&_strong]:font-medium [&_strong]:text-accent dark:[&_strong]:text-accent-dark"
            dangerouslySetInnerHTML={{ __html: snippetHtml }}
          />
        )}
      </div>
      <span className="flex-none font-mono text-[11px] leading-[20px] text-warm-faint dark:text-dark-muted tabular-nums">
        {date}
      </span>
    </button>
  )
}

function PaletteEmpty({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center bg-warm-surface dark:bg-dark-surface text-warm-faint dark:text-dark-muted"
        aria-hidden
      >
        {icon}
      </div>
      <p className="text-sm text-warm-muted dark:text-dark-muted max-w-[320px]">{message}</p>
    </div>
  )
}

function PaletteSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-2">
          <div className="h-4 w-12 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          <div className="flex-1 h-4 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          <div className="h-3 w-16 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-40 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function fetchRecentsPage(scopeKey: string | undefined, cursor: SessionsCursor | null) {
  const options = { limit: RECENT_PAGE_SIZE, ...(cursor ? { cursor } : {}) }
  return scopeKey
    ? window.spool.listSessionsByIdentity(scopeKey, options)
    : window.spool.listSessions(options)
}

function sessionToRow(s: Session, noTitle: string): PaletteRow {
  return {
    sessionUuid: s.sessionUuid,
    title: s.title?.trim() || noTitle,
    source: s.source,
    projectLabel: s.projectDisplayName ?? '',
    startedAt: s.startedAt,
    ...(typeof s.messageCount === 'number' ? { msgCount: s.messageCount } : {}),
  }
}

function searchResultToRow(r: SearchResult, noTitle: string): PaletteRow {
  const basename = r.project.split('/').filter(Boolean).pop() ?? r.project
  return {
    sessionUuid: r.sessionUuid,
    title: r.sessionTitle?.trim() || noTitle,
    source: r.source,
    projectLabel: basename,
    startedAt: r.startedAt,
    snippet: r.snippet,
    messageId: r.messageId,
  }
}
