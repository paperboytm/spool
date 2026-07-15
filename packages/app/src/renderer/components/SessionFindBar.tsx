import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

type Props = {
  visible: boolean
  focusNonce: number
  resultNonce: number
  query: string
  pending: boolean
  matches: number
  activeMatchOrdinal: number
  onChange: (query: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export default function SessionFindBar({
  visible,
  focusNonce,
  resultNonce,
  query,
  pending,
  matches,
  activeMatchOrdinal,
  onChange,
  onNext,
  onPrevious,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const isMacLike = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const previousShortcutLabel = isMacLike ? '⌘←' : 'Ctrl+←'
  const nextShortcutLabel = isMacLike ? '⌘→' : 'Ctrl+→'

  const rememberSelection = useCallback((input: HTMLInputElement) => {
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    selectionRef.current = { start, end }
  }, [])

  const focusInput = useCallback((mode: 'end' | 'preserve') => {
    const input = inputRef.current
    if (!input) return

    input.focus()

    if (mode === 'preserve' && selectionRef.current) {
      const start = Math.min(selectionRef.current.start, input.value.length)
      const end = Math.min(selectionRef.current.end, input.value.length)
      input.setSelectionRange(start, end)
      return
    }

    const caret = input.value.length
    input.setSelectionRange(caret, caret)
    selectionRef.current = { start: caret, end: caret }
  }, [])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      focusInput('end')
    })
  }, [visible, focusNonce, focusInput])

  useEffect(() => {
    if (!visible) return
    const input = inputRef.current
    if (!input || document.activeElement === input) return
    // Reclaim focus only when it sits on the bar's own controls (prev/next
    // button clicks) so typing stays seamless — focus the user moved into
    // the message list must stay there.
    if (!containerRef.current?.contains(document.activeElement)) return
    requestAnimationFrame(() => {
      focusInput('preserve')
    })
  }, [visible, resultNonce, focusInput])

  if (!visible) return null

  const hasQuery = query.trim().length > 0
  const hasMatches = matches > 0
  // While a new query is pending the previous count stays visible (dimmed)
  // and navigable; only "No matches" waits for the settle, so it never
  // flashes mid-typing.
  const statusLabel = !hasQuery
    ? ''
    : hasMatches
      ? t('session.find_matches_other', { current: activeMatchOrdinal, total: matches })
      : pending
        ? ''
        : t('session.find_noMatch')

  return (
    <div
      ref={containerRef}
      className="absolute top-8 right-4 z-20 flex items-center gap-0.5 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg/95 dark:bg-dark-surface2/95 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] pl-2 pr-1 py-0.5 w-[320px] animate-in fade-in transition-[border-color,box-shadow] focus-within:border-accent/55 dark:focus-within:border-accent-dark/60 focus-within:shadow-[0_0_0_3px_rgba(200,90,0,0.10),0_4px_12px_rgba(0,0,0,0.06)] dark:focus-within:shadow-[0_0_0_3px_rgba(240,112,32,0.15),0_4px_12px_rgba(0,0,0,0.4)]"
      role="search"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => {
          rememberSelection(event.currentTarget)
          onChange(event.target.value)
        }}
        onClick={(event) => rememberSelection(event.currentTarget)}
        onKeyUp={(event) => rememberSelection(event.currentTarget)}
        onSelect={(event) => rememberSelection(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) {
              onPrevious()
            } else {
              onNext()
            }
            rememberSelection(event.currentTarget)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder={t('session.find_placeholder')}
        className="flex-1 min-w-0 bg-transparent text-[13px] text-warm-text dark:text-dark-text outline-none placeholder:text-warm-faint dark:placeholder:text-dark-muted"
        autoComplete="off"
        spellCheck={false}
        data-testid="session-find-input"
      />
      <span
        className={`flex-none font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted whitespace-nowrap pl-1 transition-opacity ${pending ? 'opacity-60' : ''}`}
        data-testid="session-find-status"
        data-pending={pending ? 'true' : undefined}
      >
        {statusLabel}
      </span>
      <div className="flex-none w-px h-4 bg-warm-border dark:bg-dark-border mx-0.5" />
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasQuery || !hasMatches}
        className="flex-none inline-flex items-center justify-center w-6 h-6 rounded text-warm-muted dark:text-dark-muted transition-colors enabled:hover:bg-warm-surface enabled:hover:text-warm-text enabled:dark:hover:bg-dark-surface enabled:dark:hover:text-dark-text disabled:opacity-40"
        aria-label={`${t('session.find_prev')} (${previousShortcutLabel})`}
        title={`${t('session.find_prev')} (${previousShortcutLabel})`}
        data-testid="session-find-prev"
      >
        <ChevronUp size={12} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasQuery || !hasMatches}
        className="flex-none inline-flex items-center justify-center w-6 h-6 rounded text-warm-muted dark:text-dark-muted transition-colors enabled:hover:bg-warm-surface enabled:hover:text-warm-text enabled:dark:hover:bg-dark-surface enabled:dark:hover:text-dark-text disabled:opacity-40"
        aria-label={`${t('session.find_next')} (${nextShortcutLabel})`}
        title={`${t('session.find_next')} (${nextShortcutLabel})`}
        data-testid="session-find-next"
      >
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex-none inline-flex items-center justify-center w-6 h-6 rounded text-warm-muted dark:text-dark-muted transition-colors hover:bg-warm-surface hover:text-warm-text dark:hover:bg-dark-surface dark:hover:text-dark-text"
        aria-label={t('session.find_close')}
        title={`${t('session.find_close')} (Esc)`}
      >
        <X size={12} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  )
}
