import type { FragmentResult } from '@spool-lab/core'
import { isSessionProvider } from '@spool-lab/session-kit'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatRelativeDate } from '../../shared/formatDate.js'
import { SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'
import { getSessionSourceLabel } from '../../shared/sessionSources.js'
import { snippetToStrongHtml } from '../lib/snippet.js'
import { SourceBadge } from './Badges.js'
import ContinueActions from './ContinueActions.js'
import Menu from './Menu.js'

type FragmentRowResult = FragmentResult & { kind: 'fragment' }

type Props = {
  results: FragmentRowResult[]
  query: string
  onOpenSession: (uuid: string, messageId?: number) => void
  defaultSortOrder: SearchSortOrder
  onCopySessionId: (source: FragmentResult['source']) => void
  onShareSession: (uuid: string) => void
}

export default function FragmentResults({
  results,
  query,
  onOpenSession,
  defaultSortOrder,
  onCopySessionId,
  onShareSession,
}: Props) {
  const { t } = useTranslation()
  const sortLabel = (value: SearchSortOrder): string => {
    switch (value) {
      case 'relevance':
        return t('fragment.sort_relevance')
      case 'newest':
        return t('fragment.sort_newest')
      case 'oldest':
        return t('fragment.sort_oldest')
    }
  }
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SearchSortOrder>(defaultSortOrder)

  useEffect(() => {
    setSortOrder(defaultSortOrder)
  }, [defaultSortOrder])

  if (results.length === 0) {
    return (
      <div className="text-warm-faint dark:text-dark-muted flex h-full flex-col items-center justify-center gap-2 pb-12">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="opacity-30">
          <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M22 22L28 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p className="text-warm-muted dark:text-dark-muted text-sm">
          {t('fragment.noResultsForQuery', { query })}
        </p>
        <p className="text-warm-faint dark:text-dark-muted text-xs opacity-80">
          {t('fragment.noResultsHint')}
        </p>
      </div>
    )
  }

  const sourceKeys = [...new Set(results.map((r) => r.source))]
  const filtered =
    activeFilter === 'all' ? results : results.filter((r) => r.source === activeFilter)
  const sortedResults = sortResults(filtered, sortOrder)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-warm-border dark:border-dark-border flex min-h-11 flex-none items-center gap-3 border-b px-6">
        <div className="flex min-w-0 flex-1 scrollbar-none gap-0 overflow-x-auto overflow-y-hidden">
          {(['all', ...sourceKeys] as string[]).map((src) => (
            <button
              key={src}
              onClick={() => setActiveFilter(src)}
              className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                activeFilter === src
                  ? 'border-accent text-warm-text dark:text-dark-text'
                  : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text border-transparent'
              }`}
            >
              {src === 'all' ? t('fragment.filterAll') : formatSourceFilterLabel(src)}
            </button>
          ))}
        </div>

        <Menu
          align="right"
          testId="search-sort-menu"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="search-sort"
              data-value={sortOrder}
              aria-label={t('fragment.sortAriaLabel')}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={toggle}
              className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text inline-flex h-7 items-center gap-1 px-2 text-xs font-medium transition-colors"
            >
              <span>{t('fragment.sortLabel', { value: sortLabel(sortOrder) })}</span>
              <svg
                aria-hidden="true"
                width="9"
                height="9"
                viewBox="0 0 12 12"
                className="text-warm-faint dark:text-dark-muted"
                fill="none"
              >
                <path
                  d="M2.5 4.5L6 8l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          items={SEARCH_SORT_OPTIONS.map((option) => ({
            label: sortLabel(option.value),
            active: sortOrder === option.value,
            onSelect: () => setSortOrder(option.value),
          }))}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="divide-warm-border dark:divide-dark-border divide-y">
          {sortedResults.map((result, i) => (
            <FragmentRow
              key={`frag-${result.sessionUuid}-${i}`}
              result={result}
              onOpenSession={onOpenSession}
              onCopySessionId={onCopySessionId}
              onShareSession={onShareSession}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function formatSourceFilterLabel(source: string): string {
  return isSessionProvider(source) ? getSessionSourceLabel(source) : source
}

function FragmentRow({
  result,
  onOpenSession,
  onCopySessionId,
  onShareSession,
}: {
  result: FragmentRowResult
  onOpenSession: (uuid: string, messageId?: number) => void
  onCopySessionId: (source: FragmentResult['source']) => void
  onShareSession: (uuid: string) => void
}) {
  const { t } = useTranslation()
  const snippet = snippetToStrongHtml(result.snippet)
  const date = formatRelativeDate(result.startedAt, {
    t: t as unknown as (k: string, o?: Record<string, unknown>) => string,
  })
  const project = result.project.split('/').pop() ?? result.project
  const title = result.sessionTitle?.trim() || t('common.noTitle')

  return (
    <div
      data-testid="fragment-row"
      className="group hover:bg-warm-surface dark:hover:bg-dark-surface relative cursor-pointer px-6 py-3 transition-colors"
      onClick={() => onOpenSession(result.sessionUuid, result.messageId)}
    >
      <div className="mb-1 flex items-center gap-2">
        <SourceBadge source={result.source} />
        <h3 className="text-warm-text dark:text-dark-text min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h3>
        <span className="text-warm-faint dark:text-dark-muted flex-none text-xs">{date}</span>
        <ContinueActions
          result={result}
          onOpenSession={onOpenSession}
          onCopySessionId={onCopySessionId}
          onShare={() => onShareSession(result.sessionUuid)}
        />
      </div>

      <div className="pl-1.5">
        <div className="text-warm-muted dark:text-dark-muted mb-1.5 truncate text-xs">
          {project}
          {result.profileLabel && <span> · {result.profileLabel}</span>}
          {result.matchCount > 1 && (
            <span data-testid="match-count">
              {' '}
              · {t('fragment.matchCount_other', { count: result.matchCount })}
            </span>
          )}
        </div>

        <p
          className="text-warm-text dark:text-dark-text [&>strong]:text-accent dark:[&>strong]:text-accent-dark cursor-text font-mono text-xs leading-relaxed select-text [&>strong]:font-semibold"
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      </div>
    </div>
  )
}

function sortResults(
  results: FragmentRowResult[],
  sortOrder: SearchSortOrder,
): FragmentRowResult[] {
  if (sortOrder === 'relevance') return results

  const sorted = [...results]
  if (sortOrder === 'newest') {
    sorted.sort((a, b) => getResultTimestamp(b) - getResultTimestamp(a) || a.rank - b.rank)
    return sorted
  }

  sorted.sort((a, b) => getResultTimestamp(a) - getResultTimestamp(b) || a.rank - b.rank)
  return sorted
}

function getResultTimestamp(result: FragmentRowResult): number {
  const timestamp = Date.parse(result.startedAt)
  return Number.isNaN(timestamp) ? 0 : timestamp
}
