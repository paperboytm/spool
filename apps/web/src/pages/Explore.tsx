import type { DiscoverySessionItem } from '@spool-lab/session-kit'
import { Avatar, Badge, Button, ListRow, SearchField, SectionLabel, Tabs } from '@spool-lab/ui'
import {
  Bot,
  FileCode2,
  GitFork,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  Search,
  Wrench,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { WorkspaceFrame } from '../components/WorkspaceFrame'
import { relativeDate } from '../lib/dates'
import {
  DiscoveryRequestError,
  fetchDiscoverySessions,
  type DiscoveryAgentFilter,
  type ExploreSort,
  type ExploreSearchState,
} from '../lib/discovery'

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

export function submittedExploreSearch(
  search: ExploreSearchState,
  query: string,
): ExploreSearchState {
  const q = query.trim().replace(/\s+/g, ' ')
  return {
    ...(q ? { q } : {}),
    sort: search.sort,
    ...(search.agent ? { agent: search.agent } : {}),
  }
}

export function clearedExploreSearch(search: ExploreSearchState): ExploreSearchState {
  return {
    sort: search.sort,
    ...(search.agent ? { agent: search.agent } : {}),
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
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
      <Button
        variant={!selected ? 'outline' : 'ghost'}
        aria-pressed={!selected}
        onClick={() => onChange(undefined)}
      >
        All agents
      </Button>
      <Button
        variant={selected === 'claude' ? 'outline' : 'ghost'}
        aria-pressed={selected === 'claude'}
        onClick={() => onChange('claude')}
      >
        <span className="explore-source-dot is-claude" aria-hidden="true" />
        Claude Code
      </Button>
      <Button
        variant={selected === 'codex' ? 'outline' : 'ghost'}
        aria-pressed={selected === 'codex'}
        onClick={() => onChange('codex')}
      >
        <span className="explore-source-dot is-codex" aria-hidden="true" />
        Codex CLI
      </Button>
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
        <SectionLabel role="heading" aria-level={2}>
          Agent
        </SectionLabel>
        <AgentFilters selected={search.agent} onChange={onAgentChange} />
      </section>
      <section className="explore-about">
        <SectionLabel role="heading" aria-level={2}>
          About Explore
        </SectionLabel>
        <p>
          Top balances useful evidence, recency, and qualified reading. Recent shows the newest
          Public Sessions first.
        </p>
        <a href="/docs/guides/reading-resuming">How Session reading works</a>
      </section>
      <nav className="explore-legal" aria-label="Legal">
        <a href="/docs/installation">Docs</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/paperboytm/spool">GitHub</a>
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
  onSortChange: (sort: ExploreSort) => void
  onAgentChange: (agent?: DiscoveryAgentFilter) => void
}) {
  const tabs: Array<{ label: string; sort: ExploreSort }> = [
    { label: 'Top', sort: 'recommended' },
    { label: 'Recent', sort: 'recent' },
  ]

  return (
    <header className="explore-center-header">
      <form
        className="explore-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <SearchField
          className="explore-search-field"
          id="explore-query"
          aria-label="Search public Sessions"
          value={query}
          maxLength={120}
          placeholder="Search Sessions"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          clearLabel="Clear search"
          {...(query !== '' || search.q ? { onClear } : {})}
        />
      </form>
      <Tabs
        className="explore-tabs"
        aria-label={search.q ? 'Search result order' : 'Explore order'}
        value={search.sort}
        items={tabs.map((tab) => ({
          value: tab.sort,
          label: tab.label,
          ariaControls: 'explore-results',
        }))}
        onValueChange={(sort) => onSortChange(sort as ExploreSort)}
      />
      <div className="explore-inline-filters" aria-label="Agent filters">
        <AgentFilters compact selected={search.agent} onChange={onAgentChange} />
      </div>
    </header>
  )
}

export function DiscoveryRow({ item }: { item: DiscoverySessionItem }) {
  const profileHref = item.author.handle ? `/@${encodeURIComponent(item.author.handle)}` : null
  const published = relativeDate(item.publishedAt).toLowerCase()
  const avatarName = item.author.displayName ?? item.author.handle ?? 'Spool author'

  return (
    <ListRow
      className="explore-row"
      leading={<Avatar src={item.author.avatarUrl} name={avatarName} alt="" size="md" />}
      attribution={
        <>
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
        </>
      }
      title={
        <h2>
          <a href={`/session/${encodeURIComponent(item.sid)}`}>{item.title}</a>
        </h2>
      }
      summary={
        item.summaryExcerpt ? (
          item.summaryExcerpt
        ) : (
          <span className="explore-summary is-missing">
            No Summary provided. Open the Session to inspect the source record.
          </span>
        )
      }
      metadata={
        <div className="explore-row-meta">
          <Badge
            className={`explore-source is-${item.agent}`}
            variant={item.agent === 'claude' ? 'source-claude' : 'source-codex'}
          >
            <Bot size={13} strokeWidth={1.7} aria-hidden="true" />
            {agentLabel(item.agent)}
          </Badge>
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
      }
      lineage={
        item.lineage ? (
          <a
            className="explore-lineage"
            href={`/session/${encodeURIComponent(item.lineage.sourceSid)}`}
          >
            <GitFork size={13} strokeWidth={1.7} aria-hidden="true" />
            Continued from source Session
          </a>
        ) : undefined
      }
    />
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
        <Button type="button" variant="outline" onClick={onReset}>
          <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
          Clear search and filters
        </Button>
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
    <WorkspaceFrame
      active="explore"
      layout="feed"
      rootClassName="explore-root"
      mainClassName="explore-center"
      rightRail={<RightRail search={search} onAgentChange={changeAgent} />}
    >
      <SearchHeader
        search={search}
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => onSearchChange(submittedExploreSearch(search, query))}
        onClear={() => {
          setQuery('')
          onSearchChange(clearedExploreSearch(search))
        }}
        onSortChange={(sort) => onSearchChange({ ...search, sort })}
        onAgentChange={changeAgent}
      />

      <section
        id="explore-results"
        className="explore-feed"
        role="tabpanel"
        aria-label="Public Sessions"
        aria-live="polite"
      >
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetryToken((value) => value + 1)}
            >
              <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}

        {!feed.loading && feed.nextCursor && (
          <Button
            type="button"
            className="explore-load-more"
            variant="outline"
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
          </Button>
        )}
      </section>
    </WorkspaceFrame>
  )
}
