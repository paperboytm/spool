import type { DiscoverySessionItem, DiscoverySort } from '@spool-lab/session-kit'
import {
  BookOpen,
  Bot,
  Compass,
  FileCode2,
  GitFork,
  Home,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  Search,
  SunMoon,
  SquareTerminal,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { relativeDate } from '../lib/dates'
import {
  DiscoveryRequestError,
  fetchDiscoverySessions,
  type DiscoveryAgentFilter,
  type ExploreSearchState,
} from '../lib/discovery'
import { readThemeAttr, writeThemeAttr } from '../lib/theme'

interface ExplorePageProps {
  search: ExploreSearchState
  onSearchChange: (next: ExploreSearchState) => void
}

interface FeedState {
  items: DiscoverySessionItem[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

const INITIAL_FEED: FeedState = {
  items: [],
  nextCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
}

function filterKey(search: ExploreSearchState): string {
  return `${search.q ?? ''}\u0000${search.sort}\u0000${search.agent ?? ''}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function initials(item: DiscoverySessionItem): string {
  const label = item.author.displayName ?? item.author.handle ?? 'Spool author'
  const parts = label.trim().split(/\s+/)
  return parts.length > 1
    ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
    : (parts[0]?.slice(0, 1).toUpperCase() ?? 'S')
}

function authorLabel(item: DiscoverySessionItem): string {
  if (item.author.handle) return `@${item.author.handle}`
  return item.author.displayName ?? 'Spool author'
}

function agentLabel(agent: DiscoverySessionItem['agent']): string {
  return agent === 'claude' ? 'Claude Code' : 'Codex CLI'
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

function ExploreThemeButton() {
  return (
    <button
      type="button"
      className="explore-icon-button"
      title="Toggle light or dark theme"
      aria-label="Toggle light or dark theme"
      onClick={() => writeThemeAttr(readThemeAttr() === 'dark' ? 'light' : 'dark')}
    >
      <SunMoon size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  )
}

function LeftNavigation() {
  return (
    <aside className="explore-left" aria-label="Primary navigation">
      <a className="explore-wordmark" href="/" aria-label="Spool home">
        Spool<span>.</span>
      </a>
      <nav className="explore-nav">
        <a href="/">
          <Home size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>Home</span>
        </a>
        <a href="/explore" className="is-active" aria-current="page">
          <Compass size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>Explore</span>
        </a>
        <a href="/docs/installation">
          <BookOpen size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>Docs</span>
        </a>
        <a href="/me">
          <UserRound size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>Account</span>
        </a>
      </nav>
      <a className="explore-share-link" href="/docs/guides/publishing">
        <SquareTerminal size={17} strokeWidth={1.7} aria-hidden="true" />
        <span>Share a Session</span>
      </a>
      <div className="explore-left-footer">
        <ExploreThemeButton />
        <span>Warm Index</span>
      </div>
    </aside>
  )
}

function AgentFilters({
  selected,
  onChange,
  compact = false,
}: {
  selected: DiscoveryAgentFilter | undefined
  onChange: (agent?: DiscoveryAgentFilter) => void
  compact?: boolean
}) {
  return (
    <div className={compact ? 'explore-agent-filters is-compact' : 'explore-agent-filters'}>
      <button
        type="button"
        className={!selected ? 'is-active' : ''}
        aria-pressed={!selected}
        onClick={() => onChange(undefined)}
      >
        All agents
      </button>
      <button
        type="button"
        className={selected === 'claude' ? 'is-active' : ''}
        aria-pressed={selected === 'claude'}
        onClick={() => onChange('claude')}
      >
        <span className="explore-source-dot is-claude" aria-hidden="true" />
        Claude Code
      </button>
      <button
        type="button"
        className={selected === 'codex' ? 'is-active' : ''}
        aria-pressed={selected === 'codex'}
        onClick={() => onChange('codex')}
      >
        <span className="explore-source-dot is-codex" aria-hidden="true" />
        Codex CLI
      </button>
    </div>
  )
}

function RightRail({
  search,
  onAgentChange,
}: {
  search: ExploreSearchState
  onAgentChange: (agent?: DiscoveryAgentFilter) => void
}) {
  return (
    <aside className="explore-right" aria-label="Explore filters">
      <section>
        <h2>Agent</h2>
        <AgentFilters selected={search.agent} onChange={onAgentChange} />
      </section>
      <section className="explore-about">
        <h2>About Explore</h2>
        <p>
          Public Sessions from real agent work, ranked by useful evidence, recency, and qualified
          reading—not vanity metrics.
        </p>
        <a href="/docs/guides/reading-resuming">How Session reading works</a>
      </section>
      <nav className="explore-legal" aria-label="Legal">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/spool-lab/spool">GitHub</a>
      </nav>
    </aside>
  )
}

function SearchHeader({
  search,
  query,
  onQueryChange,
  onSubmit,
  onClear,
  onSortChange,
  onAgentChange,
}: {
  search: ExploreSearchState
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onClear: () => void
  onSortChange: (sort: DiscoverySort) => void
  onAgentChange: (agent?: DiscoveryAgentFilter) => void
}) {
  const searching = Boolean(search.q)
  const tabs: Array<{ label: string; sort: DiscoverySort }> = searching
    ? [
        { label: 'Top', sort: 'recommended' },
        { label: 'Latest', sort: 'recent' },
      ]
    : [
        { label: 'For you', sort: 'recommended' },
        { label: 'Trending', sort: 'trending' },
        { label: 'Recent', sort: 'recent' },
      ]

  return (
    <header className="explore-center-header">
      <div className="explore-mobile-brand">
        <a href="/" aria-label="Spool home">
          Spool<span>.</span>
        </a>
        <ExploreThemeButton />
      </div>
      <form
        className="explore-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Search size={18} strokeWidth={1.7} aria-hidden="true" />
        <label className="explore-sr-only" htmlFor="explore-query">
          Search public Sessions
        </label>
        <input
          id="explore-query"
          type="search"
          value={query}
          maxLength={120}
          placeholder="Search Sessions"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {(query !== '' || search.q) && (
          <button type="button" aria-label="Clear search" onClick={onClear}>
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </form>
      <nav
        className="explore-tabs"
        aria-label={searching ? 'Search result order' : 'Explore order'}
      >
        {tabs.map((tab) => (
          <button
            key={tab.sort}
            type="button"
            className={search.sort === tab.sort ? 'is-active' : ''}
            aria-current={search.sort === tab.sort ? 'page' : undefined}
            onClick={() => onSortChange(tab.sort)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="explore-inline-filters" aria-label="Agent filters">
        <AgentFilters compact selected={search.agent} onChange={onAgentChange} />
      </div>
    </header>
  )
}

export function DiscoveryRow({ item }: { item: DiscoverySessionItem }) {
  const profileHref = item.author.handle ? `/@${encodeURIComponent(item.author.handle)}` : null
  const published = relativeDate(item.publishedAt).toLowerCase()

  return (
    <article className="explore-row">
      <div className="explore-row-avatar" aria-hidden="true">
        {item.author.avatarUrl ? (
          <img src={item.author.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span>{initials(item)}</span>
        )}
      </div>
      <div className="explore-row-content">
        <div className="explore-attribution">
          {profileHref ? (
            <a href={profileHref}>{authorLabel(item)}</a>
          ) : (
            <span>{authorLabel(item)}</span>
          )}
          <span aria-hidden="true">·</span>
          <time
            dateTime={new Date(item.publishedAt).toISOString()}
            title={new Date(item.publishedAt).toLocaleString()}
          >
            published {published}
          </time>
        </div>
        <h2>
          <a href={`/session/${encodeURIComponent(item.sid)}`}>{item.title}</a>
        </h2>
        {item.summaryExcerpt ? (
          <p className="explore-summary">{item.summaryExcerpt}</p>
        ) : (
          <p className="explore-summary is-missing">
            No Summary provided. Open the Session to inspect the source record.
          </p>
        )}
        <div className="explore-row-meta">
          <span className={`explore-source is-${item.agent}`}>
            <Bot size={13} strokeWidth={1.7} aria-hidden="true" />
            {agentLabel(item.agent)}
          </span>
          <span title={`${item.evidence.messages} messages`}>
            <MessageSquareText size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(item.evidence.messages)} messages
          </span>
          <span title={`${item.evidence.toolCalls} tool calls`}>
            <Wrench size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(item.evidence.toolCalls)} tools
          </span>
          <span title={`${item.evidence.files} files changed`}>
            <FileCode2 size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(item.evidence.files)} files
          </span>
          {(item.evidence.additions > 0 || item.evidence.deletions > 0) && (
            <span className="explore-diff" title="Machine-derived diffstat">
              <span>+{compactNumber(item.evidence.additions)}</span>
              <span>−{compactNumber(item.evidence.deletions)}</span>
            </span>
          )}
        </div>
        {item.lineage && (
          <a
            className="explore-lineage"
            href={`/session/${encodeURIComponent(item.lineage.sourceSid)}`}
          >
            <GitFork size={13} strokeWidth={1.7} aria-hidden="true" />
            Continued from source Session
          </a>
        )}
      </div>
    </article>
  )
}

function FeedSkeleton() {
  return (
    <div className="explore-skeleton-list" aria-label="Loading Sessions" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="explore-skeleton-row" key={index} aria-hidden="true">
          <span className="explore-skeleton-avatar" />
          <span className="explore-skeleton-copy">
            <span className="explore-skeleton-line is-meta" />
            <span className="explore-skeleton-line is-title" />
            <span className="explore-skeleton-line" />
            <span className="explore-skeleton-line is-short" />
            <span className="explore-skeleton-line is-evidence" />
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyFeed({ search, onReset }: { search: ExploreSearchState; onReset: () => void }) {
  const constrained = Boolean(search.q || search.agent)
  return (
    <div className="explore-feed-state">
      <Search size={22} strokeWidth={1.6} aria-hidden="true" />
      <h2>{constrained ? 'No Sessions match these filters' : 'Explore is quiet right now'}</h2>
      <p>
        {constrained
          ? `Try a broader search${search.agent ? ' or include every agent' : ''}.`
          : 'Public Sessions will appear here as authors share their work.'}
      </p>
      {constrained && (
        <button type="button" onClick={onReset}>
          <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
          Clear search and filters
        </button>
      )}
    </div>
  )
}

export function ExplorePage({ search, onSearchChange }: ExplorePageProps) {
  const [query, setQuery] = useState(search.q ?? '')
  const [feed, setFeed] = useState<FeedState>(INITIAL_FEED)
  const [retryToken, setRetryToken] = useState(0)
  const requestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const currentFilterKey = filterKey(search)
  const currentFilterKeyRef = useRef(currentFilterKey)
  currentFilterKeyRef.current = currentFilterKey

  useEffect(() => {
    setQuery(search.q ?? '')
  }, [search.q])

  useEffect(() => {
    requestRef.current?.abort()
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    requestRef.current = controller
    setFeed(INITIAL_FEED)

    void fetchDiscoverySessions({ ...search, signal: controller.signal })
      .then((response) => {
        if (requestId !== requestIdRef.current) return
        setFeed({
          items: response.items,
          nextCursor: response.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (requestId !== requestIdRef.current || isAbortError(error)) return
        setFeed({
          items: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error:
            error instanceof DiscoveryRequestError
              ? error.message
              : 'Could not load Explore. Check your connection and try again.',
        })
      })

    return () => {
      requestIdRef.current += 1
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [currentFilterKey, retryToken])

  const changeAgent = (agent?: DiscoveryAgentFilter) => {
    onSearchChange({
      ...(search.q ? { q: search.q } : {}),
      sort: search.sort,
      ...(agent ? { agent } : {}),
    })
  }

  const reset = () => {
    setQuery('')
    onSearchChange({ sort: 'recommended' })
  }

  const loadMore = () => {
    if (feed.loadingMore || !feed.nextCursor) return
    requestRef.current?.abort()
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    requestRef.current = controller
    const requestedKey = currentFilterKey
    setFeed((current) => ({ ...current, loadingMore: true, error: null }))

    void fetchDiscoverySessions({
      ...search,
      cursor: feed.nextCursor,
      signal: controller.signal,
    })
      .then((response) => {
        if (requestId !== requestIdRef.current || requestedKey !== currentFilterKeyRef.current) {
          return
        }
        setFeed((current) => ({
          ...current,
          items: [...current.items, ...response.items],
          nextCursor: response.nextCursor,
          loadingMore: false,
        }))
      })
      .catch((error: unknown) => {
        if (requestId !== requestIdRef.current || isAbortError(error)) return
        setFeed((current) => ({
          ...current,
          loadingMore: false,
          error:
            error instanceof DiscoveryRequestError
              ? error.message
              : 'Could not load more Sessions. Try again.',
        }))
      })
  }

  return (
    <div className="explore-root">
      <div className="explore-shell">
        <LeftNavigation />
        <main className="explore-center">
          <SearchHeader
            search={search}
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => {
              const q = query.trim().replace(/\s+/g, ' ')
              onSearchChange({
                ...(q ? { q } : {}),
                sort: q ? 'recommended' : search.sort,
                ...(search.agent ? { agent: search.agent } : {}),
              })
            }}
            onClear={() => {
              setQuery('')
              onSearchChange({
                sort: 'recommended',
                ...(search.agent ? { agent: search.agent } : {}),
              })
            }}
            onSortChange={(sort) => onSearchChange({ ...search, sort })}
            onAgentChange={changeAgent}
          />

          <section className="explore-feed" aria-label="Public Sessions" aria-live="polite">
            {feed.loading ? (
              <FeedSkeleton />
            ) : feed.items.length === 0 && !feed.error ? (
              <EmptyFeed search={search} onReset={reset} />
            ) : (
              feed.items.map((item) => <DiscoveryRow key={item.sid} item={item} />)
            )}

            {feed.error && (
              <div className="explore-feed-error" role="alert">
                <p>{feed.error}</p>
                <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
                  <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}

            {!feed.loading && feed.nextCursor && (
              <button
                type="button"
                className="explore-load-more"
                disabled={feed.loadingMore}
                onClick={loadMore}
              >
                {feed.loadingMore && (
                  <LoaderCircle
                    className="explore-spin"
                    size={16}
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                )}
                {feed.loadingMore ? 'Loading Sessions…' : 'Load more Sessions'}
              </button>
            )}
          </section>
        </main>
        <RightRail search={search} onAgentChange={changeAgent} />
      </div>
    </div>
  )
}
