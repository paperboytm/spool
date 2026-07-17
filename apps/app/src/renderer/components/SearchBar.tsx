import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SegmentedPill from './SegmentedPill.js'

export type SearchMode = 'fast' | 'ai'

interface Props {
  query: string
  onChange: (q: string) => void
  onBack?: (() => void) | undefined
  onSubmit?: (() => void) | undefined
  isSearching: boolean
  variant?: ('home' | 'compact') | undefined
  mode?: SearchMode | undefined
  onModeChange?: ((mode: SearchMode) => void) | undefined
  placeholder?: string | undefined
  scoped?: boolean | undefined
}

export default function SearchBar({ query, onChange, onBack, onSubmit, isSearching, variant = 'compact', mode = 'fast', onModeChange, placeholder, scoped = false }: Props) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [showBusyIndicator, setShowBusyIndicator] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!isSearching) {
      setShowBusyIndicator(false)
      return
    }
    const timer = setTimeout(() => setShowBusyIndicator(true), 120)
    return () => clearTimeout(timer)
  }, [isSearching])

  const isHome = variant === 'home'

  return (
    <div className="flex items-center gap-2 w-full">
      {onBack && (
        <button
          onClick={onBack}
          className="flex-none text-warm-muted hover:text-warm-text dark:text-dark-muted dark:hover:text-dark-text transition-colors"
          aria-label={t('session.backToResults')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <div className="relative flex-1 group">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-faint dark:text-dark-muted">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={`absolute inset-0 transition-opacity duration-150 ${showBusyIndicator ? 'opacity-0' : 'opacity-100'}`}
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <svg
            className={`absolute inset-0 transition-opacity duration-150 ${showBusyIndicator ? 'opacity-100 animate-spin' : 'opacity-0'}`}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="30" strokeDashoffset="10"/>
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit?.()
          }}
          placeholder={placeholder ?? (isHome ? t('search.placeholder_home') : t('search.placeholder_results'))}
          className={[
            'w-full rounded-full outline-none',
            scoped
              ? 'bg-accent/5 dark:bg-accent-dark/5'
              : 'bg-warm-surface dark:bg-dark-surface',
            scoped
              ? 'border border-accent/30 dark:border-accent-dark/30'
              : 'border border-warm-border dark:border-dark-border',
            'placeholder:text-warm-faint dark:placeholder:text-dark-muted',
            'text-warm-text dark:text-dark-text',
            'focus:ring-0',
            'transition-[border-color,box-shadow,background-color] duration-150',
            isHome
              ? 'pl-10 pr-[130px] py-3 text-[15px] shadow-sm'
              : 'pl-9 pr-[100px] py-[7px] text-[13.5px]',
          ].join(' ')}
          autoComplete="off"
          spellCheck={false}
          data-testid="search-input"
        />
        {/* Mode toggle pill — inside search bar, right side */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              onClick={() => onChange('')}
              className="text-warm-faint hover:text-warm-muted dark:text-dark-muted dark:hover:text-dark-text p-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {onModeChange && (
            <SegmentedPill
              value={mode}
              onChange={onModeChange}
              compact={!isHome}
              ariaLabel={t('search.mode_fast') + ' / ' + t('search.mode_ai')}
              options={[
                {
                  value: 'fast',
                  label: t('search.mode_fast'),
                  icon: <ZapIcon size={!isHome ? 12 : 13} />,
                  hideLabel: !isHome,
                },
                {
                  value: 'ai',
                  label: t('search.mode_ai'),
                  icon: <SparklesIcon size={!isHome ? 12 : 13} />,
                  hideLabel: !isHome,
                  testId: 'mode-agent',
                },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ZapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  )
}

function SparklesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      <path d="M5 3v4M19 17v4M3 5h4M17 19h4"/>
    </svg>
  )
}
