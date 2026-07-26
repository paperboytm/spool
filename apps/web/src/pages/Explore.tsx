import type { DiscoverySessionItem } from '@spool-lab/session-kit'
import { Button, SearchField, Tabs } from '@spool-lab/ui'
import {
  FolderKanban,
  GitFork,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  Search,
  Star,
  Wrench,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  SessionFeedRow,
  SessionFeedSkeleton,
  SessionSourceBadge,
} from '../components/SessionFeedRow'
import {
  DiscoveryRequestError,
  fetchDiscoverySessions,
  type ExploreSort,
  type ExploreSearchState,
} from '../lib/discovery'
import { sessionLanguageTag, useSessionLanguage } from '../lib/language'
import {
  formatSessionCost,
  resolveLocalizedSessionSummary,
  resolveLocalizedTitle,
} from '../lib/session-title'

interface PublicFeedProps {
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
  return `${search.q ?? ''}\u0000${search.sort}`
}

export function submittedExploreSearch(
  search: ExploreSearchState,
  query: string,
): ExploreSearchState {
  const q = query.trim().replace(/\s+/g, ' ')
  return {
    ...(q ? { q } : {}),
    sort: search.sort,
  }
}

export function clearedExploreSearch(search: ExploreSearchState): ExploreSearchState {
  return { sort: search.sort }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

function SearchHeader({
  search,
  query,
  onQueryChange,
  onSubmit,
  onClear,
  onSortChange,
}: {
  search: ExploreSearchState
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onClear: () => void
  onSortChange: (sort: ExploreSort) => void
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
    </header>
  )
}

export function DiscoveryRow({ item }: { item: DiscoverySessionItem }) {
  const language = useSessionLanguage()
  const localizedTitle = resolveLocalizedTitle(item.titles, item.title, language)
  const localizedSummary = resolveLocalizedSessionSummary(
    item.summaryExcerpts,
    item.summaryExcerpt,
    language,
  )
  const title = localizedTitle.text ?? item.title
  const summary = localizedSummary.text
  const costLabel = formatSessionCost(item.cost)
  const starCount = item.starCount ?? 0
  const projectOwnerHandle = item.project?.owner?.handle ?? item.author.handle

  return (
    <SessionFeedRow
      sid={item.sid}
      title={title}
      summary={summary}
      titleLanguage={
        localizedTitle.language ? sessionLanguageTag(localizedTitle.language) : undefined
      }
      summaryLanguage={
        localizedSummary.language ? sessionLanguageTag(localizedSummary.language) : undefined
      }
      author={item.author}
      timestamp={item.publishedAt}
      timestampVerb="published"
      metadata={
        <div className="session-feed-row-meta">
          {item.project && projectOwnerHandle ? (
            <a
              className="session-feed-project"
              href={`/@${encodeURIComponent(projectOwnerHandle)}/${encodeURIComponent(item.project.slug)}`}
              title={`Project · @${projectOwnerHandle}/${item.project.slug}`}
            >
              <FolderKanban size={13} strokeWidth={1.7} aria-hidden="true" />
              {item.project.name}
            </a>
          ) : null}
          <SessionSourceBadge provider={item.agent} />
          <span title={`${item.evidence.messages} messages`}>
            <MessageSquareText size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(item.evidence.messages)} messages
          </span>
          <span title={`${item.evidence.toolCalls} tool calls`}>
            <Wrench size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(item.evidence.toolCalls)} tools
          </span>
          {costLabel && (
            <span
              className="session-feed-cost"
              title="Estimated API cost from recorded token usage"
            >
              {costLabel}
            </span>
          )}
          <span title={`${starCount} ${starCount === 1 ? 'star' : 'stars'}`}>
            <Star size={13} strokeWidth={1.7} aria-hidden="true" />
            {compactNumber(starCount)} {starCount === 1 ? 'star' : 'stars'}
          </span>
          {(item.evidence.additions > 0 || item.evidence.deletions > 0) && (
            <span className="session-feed-diff" title="Machine-derived diffstat">
              <span>+{compactNumber(item.evidence.additions)}</span>
              <span>−{compactNumber(item.evidence.deletions)}</span>
            </span>
          )}
        </div>
      }
      lineage={
        item.lineage ? (
          <a
            className="session-feed-lineage"
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

function EmptyFeed({ search, onReset }: { search: ExploreSearchState; onReset: () => void }) {
  const constrained = Boolean(search.q)
  return (
    <div className="session-feed-state">
      <Search size={22} strokeWidth={1.6} aria-hidden="true" />
      <h2>{constrained ? 'No Sessions match this search' : 'No Public Sessions yet'}</h2>
      <p>
        {constrained
          ? 'Try a broader search.'
          : 'Public Sessions will appear here as authors share their work.'}
      </p>
      {constrained && (
        <Button type="button" variant="outline" onClick={onReset}>
          <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
          Clear search
        </Button>
      )}
    </div>
  )
}

export function PublicFeed({ search, onSearchChange }: PublicFeedProps) {
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
              : 'Could not load Sessions. Check your connection and try again.',
        })
      })

    return () => {
      requestIdRef.current += 1
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [currentFilterKey, retryToken])

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
    <>
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
      />

      <section
        id="explore-results"
        className="session-feed"
        role="tabpanel"
        aria-label="Public Sessions"
        aria-live="polite"
      >
        {feed.loading ? (
          <SessionFeedSkeleton />
        ) : feed.items.length === 0 && !feed.error ? (
          <EmptyFeed search={search} onReset={reset} />
        ) : (
          feed.items.map((item) => <DiscoveryRow key={item.sid} item={item} />)
        )}

        {feed.error && (
          <div className="session-feed-error" role="alert">
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
            className="session-feed-load-more"
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
    </>
  )
}
