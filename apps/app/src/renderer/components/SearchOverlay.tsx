import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import CommandPalette, { type PaletteRow } from './CommandPalette.js'
import SegmentedPill from './SegmentedPill.js'
import type { ScopeValue } from './ScopeSelector.js'
import type { SearchMode } from './SearchBar.js'

type Props = {
  open: boolean
  initialQuery: string
  scope: ScopeValue | null
  contextualScope: ScopeValue | null
  mode: SearchMode
  onModeChange?: (mode: SearchMode) => void
  agentSelector?: ReactNode
  onClose: () => void
  onScopeChange: (next: ScopeValue | null) => void
  onCommit: (query: string) => void
  onOpenResult: (uuid: string, messageId: number | undefined, query: string) => void
}

export default function SearchOverlay({
  open,
  initialQuery,
  scope,
  contextualScope,
  mode,
  onModeChange,
  agentSelector,
  onClose,
  onScopeChange,
  onCommit,
  onOpenResult,
}: Props) {
  const { t } = useTranslation()

  if (!open) return null

  const searchDisabled = mode === 'ai'

  return (
    <CommandPalette
      testId="search-overlay"
      initialQuery={initialQuery}
      placeholder={searchDisabled ? t('search.placeholder_ask') : t('search.placeholder_home')}
      scope={scope}
      onScopeChange={onScopeChange}
      contextualScope={contextualScope}
      showTabScopeHint={!!contextualScope}
      groupRecentsByDate
      searchDisabled={searchDisabled}
      headerExtras={onModeChange ? (
        <SegmentedPill
          value={mode}
          onChange={onModeChange}
          compact
          ariaLabel={t('search.mode_fast') + ' / ' + t('search.mode_ai')}
          options={[
            { value: 'fast', label: t('search.mode_fast'), icon: <ZapIcon />, hideLabel: true, title: t('search.mode_fast_title') },
            { value: 'ai', label: t('search.mode_ai'), icon: <SparklesIcon />, hideLabel: true, testId: 'mode-agent', title: t('search.mode_ai_title') },
          ]}
        />
      ) : undefined}
      scopeRowExtras={agentSelector && mode === 'ai' ? (
        <div className="flex items-center gap-1.5 text-[10px] text-warm-faint dark:text-dark-muted">
          <span>{t('search.scope_asking')}</span>
          {agentSelector}
        </div>
      ) : undefined}
      labels={{
        enterHint: searchDisabled ? t('search.hint_ask') : t('search.hint_open'),
        ...(searchDisabled ? {} : { shiftEnterHint: t('search.hint_viewAll') }),
        noMatches: () => t('search.noMatches'),
        emptyNoSessions: t('search.noSessionsYet'),
        emptyInProject: () => t('search.noSessionsInProject'),
        ...(searchDisabled ? {} : { resultsTotal: (count) => t('search.resultsArrow_other', { count }) }),
      }}
      onSubmit={(row: PaletteRow, query: string) => {
        onOpenResult(row.sessionUuid, row.messageId, query)
      }}
      onCommit={onCommit}
      onClose={onClose}
    />
  )
}

function ZapIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      <path d="M5 3v4M19 17v4M3 5h4M17 19h4"/>
    </svg>
  )
}
