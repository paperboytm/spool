import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SquareTerminal, SquarePen, MoreHorizontal, Copy } from 'lucide-react'
import type { Session, Message } from '@spool-lab/core'
import { type FindRange } from './MessageBubble.js'
import MessageList, { type MessageListHandle } from './MessageList.js'
import SessionFindBar from './SessionFindBar.js'
import FindingsStrip from './security/FindingsStrip.js'
import PinButton from './PinButton.js'
import Menu from './Menu.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import { getSessionSourceColor, getSessionSourceShortLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { useIsDark } from '../hooks/useIsDark.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import { useDraftCountForSession } from '../hooks/useShareDrafts.js'
import { extractRenderedText } from '../markdown/extractRenderedText.js'

type Props = {
  sessionUuid: string
  targetMessageId?: number | null
  onCopySessionId: (source: Session['source']) => void
  onBack?: () => void
  onShare?: (session: Session, messages: Message[]) => void
}

export default function SessionDetail({ sessionUuid, targetMessageId, onCopySessionId, onBack, onShare }: Props) {
  const { t } = useTranslation()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [pinned, setPinned] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [showFindBar, setShowFindBar] = useState(false)
  const [showTargetHighlight, setShowTargetHighlight] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findResultNonce, setFindResultNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const listRef = useRef<MessageListHandle>(null)
  const activeFindMatchRef = useRef<HTMLElement | null>(null)
  const isDark = useIsDark()
  const hasDraft = useDraftCountForSession(sessionUuid) > 0

  const normalizedFindQuery = findQuery.trim().toLocaleLowerCase()

  const {
    messageFindRanges,
    totalFindMatches,
  } = useMemo(() => {
    let offset = 0
    const rangesByMessage = new Map<number, { ranges: FindRange[]; offset: number }>()

    // Only project markdown → rendered text when a query is active. For a 1500-message
    // session this saves ~1500 remark.parse calls on session open.
    if (normalizedFindQuery) {
      for (const message of messages) {
        const source = message.contentText || (message.role === 'system' ? '(summary)' : '')
        const text = extractRenderedText(source)
        const ranges = getFindRanges(text, normalizedFindQuery)
        if (ranges.length > 0) {
          rangesByMessage.set(message.id, { ranges, offset })
          offset += ranges.length
        }
      }
    }

    return {
      messageFindRanges: rangesByMessage,
      totalFindMatches: offset,
    }
  }, [messages, normalizedFindQuery])

  const activeMatchOrdinal = totalFindMatches > 0 ? activeMatchIndex + 1 : 0

  const clearFind = useCallback(() => {
    setFindQuery('')
    setActiveMatchIndex(0)
  }, [])

  const closeFindBar = useCallback(() => {
    setShowFindBar(false)
    clearFind()
  }, [clearFind])

  const runFind = useCallback((query: string) => {
    setFindQuery(query)
    setActiveMatchIndex(0)
  }, [])

  const findNext = useCallback(() => {
    if (totalFindMatches === 0) return
    setActiveMatchIndex((value) => (value + 1) % totalFindMatches)
  }, [totalFindMatches])

  const findPrevious = useCallback(() => {
    if (totalFindMatches === 0) return
    setActiveMatchIndex((value) => (value - 1 + totalFindMatches) % totalFindMatches)
  }, [totalFindMatches])

  useEffect(() => {
    setLoading(true)
    window.spool.getSession(sessionUuid).then((result) => {
      if (result) {
        setSession(result.session)
        setMessages(result.messages)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionUuid])

  useEffect(() => {
    let cancelled = false
    function refresh() {
      window.spool.getPinnedUuids()
        .then(uuids => { if (!cancelled) setPinned(uuids.includes(sessionUuid)) })
        .catch(() => { if (!cancelled) setPinned(false) })
    }
    refresh()
    window.addEventListener('spool:pin-change', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('spool:pin-change', refresh)
    }
  }, [sessionUuid])

  useEffect(() => {
    if (!loading && targetMessageId) {
      listRef.current?.scrollToMessageId(targetMessageId)
      setShowTargetHighlight(true)
      const timer = setTimeout(() => setShowTargetHighlight(false), 2000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [loading, targetMessageId])

  useEffect(() => {
    setShowFindBar(false)
    setFindFocusNonce(0)
    setFindResultNonce(0)
    clearFind()
  }, [sessionUuid, clearFind])

  useEffect(() => {
    if (!normalizedFindQuery || totalFindMatches === 0) {
      setActiveMatchIndex(0)
      return
    }

    setActiveMatchIndex((value) => Math.min(value, totalFindMatches - 1))
  }, [normalizedFindQuery, totalFindMatches])

  useEffect(() => {
    if (!showFindBar) return
    setFindResultNonce((value) => value + 1)
  }, [showFindBar, totalFindMatches, activeMatchIndex])

  useHotkeys({
    'mod+f': () => {
      setShowFindBar(true)
      setFindFocusNonce((value) => value + 1)
    },
  })

  useHotkeys({
    Escape: closeFindBar,
    'mod+arrowleft': findPrevious,
    'mod+arrowright': findNext,
  }, { active: showFindBar })

  useEffect(() => {
    if (!showFindBar || totalFindMatches === 0) return
    for (const [messageId, state] of messageFindRanges) {
      if (activeMatchIndex >= state.offset && activeMatchIndex < state.offset + state.ranges.length) {
        listRef.current?.scrollToMessageId(messageId)
        // Tall messages: row centering isn't enough — wait for the row to mount,
        // then nudge the active mark itself into view.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            activeFindMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
          })
        })
        break
      }
    }
  }, [showFindBar, activeMatchIndex, totalFindMatches, messageFindRanges])

  const bindActiveFindMatch = useCallback((node: HTMLElement | null) => {
    activeFindMatchRef.current = node
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-warm-faint dark:text-dark-muted">
        <p className="text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-warm-faint dark:text-dark-muted">
        <p className="text-sm">Session not found.</p>
      </div>
    )
  }

  async function handleCopySessionId() {
    if (!session) return
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
  }

  async function handleCopyCommand() {
    if (!session) return
    const command = getSessionResumeCommand(session.source, session.sessionUuid, session.cwd)
    if (!command) return
    await navigator.clipboard.writeText(command)
    setCommandCopied(true)
    setTimeout(() => setCommandCopied(false), 1500)
  }

  async function handleResume() {
    if (!session) return
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  const resumeCommandAvailable = Boolean(session && getSessionResumeCommand(session.source, session.sessionUuid))

  return (
    <div className="relative flex flex-col h-full" data-testid="session-detail">
      {/* Session header */}
      <div className="flex-none flex items-start gap-3 px-6 pt-1.5 pb-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            title={t('common.back')}
            className="flex-none flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
              <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-medium text-warm-text dark:text-dark-text truncate" title={session.title ?? undefined}>
            {session.title ?? t('common.noTitle')}
          </h2>

          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-warm-faint dark:text-dark-muted min-w-0">
            <span className="inline-flex items-center gap-1 flex-none">
              <span
                aria-hidden
                className="block w-1.5 h-1.5 rounded-full"
                style={{ background: getSessionSourceColor(session.source) }}
              />
              <span className="font-mono">{getSessionSourceShortLabel(session.source)}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono truncate" title={session.projectDisplayPath}>{session.projectDisplayPath}</span>
            <span aria-hidden>·</span>
            <span className="flex-none">{formatRelativeDate(session.startedAt, { t: t as unknown as (k: string, o?: Record<string, unknown>) => string })}</span>
            <span aria-hidden>·</span>
            <span className="flex-none">{t('session.messages_other', { count: session.messageCount })}</span>
          </p>
        </div>

        <div className="flex-none self-end flex items-center gap-0.5">
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={setPinned}
          />

          {onShare && session && (
            <button
              data-testid="detail-share"
              onClick={() => onShare(session, messages)}
              title={hasDraft ? t('shareEditor.openExisting') : t('shareEditor.openNew')}
              aria-label={hasDraft ? t('shareEditor.openExisting') : t('shareEditor.openNew')}
              className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
                hasDraft
                  ? 'text-accent dark:text-accent-dark hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
                  : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
              }`}
            >
              <SquarePen size={13} strokeWidth={1.6} aria-hidden />
            </button>
          )}

          <button
            data-testid="detail-resume"
            onClick={handleResume}
            disabled={resuming}
            title={resuming ? t('common.loading') : t('session.resume_inTerminal')}
            aria-label={resuming ? t('common.loading') : t('session.resume_inTerminal')}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <SquareTerminal size={13} strokeWidth={1.6} aria-hidden />
          </button>

          <Menu
            align="right"
            testId="detail-actions-menu"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label={t('common.more')}
                className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
              >
                <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
              </button>
            )}
            items={[
              {
                label: t('sidebar.copySessionId'),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopySessionId() },
              },
              ...(resumeCommandAvailable ? [{
                label: commandCopied ? t('common.copiedResumeCommand') : t('common.copyResumeCommand'),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyCommand() },
              }] : []),
            ]}
          />
        </div>
      </div>

      <SessionFindBar
        visible={showFindBar}
        focusNonce={findFocusNonce}
        resultNonce={findResultNonce}
        query={findQuery}
        matches={totalFindMatches}
        activeMatchOrdinal={activeMatchOrdinal}
        onChange={runFind}
        onNext={findNext}
        onPrevious={findPrevious}
        onClose={closeFindBar}
      />

      <FindingsStrip session={session} />

      {/* Messages */}
      <MessageList
        key={session.sessionUuid}
        ref={listRef}
        messages={messages}
        isDark={isDark}
        showFindBar={showFindBar}
        messageFindRanges={messageFindRanges}
        activeMatchIndex={activeMatchIndex}
        onActiveMatchRef={bindActiveFindMatch}
        targetMessageId={targetMessageId ?? null}
        showTargetHighlight={showTargetHighlight}
      />
    </div>
  )
}

function getFindRanges(text: string, normalizedQuery: string): FindRange[] {
  if (!normalizedQuery || !text) return []

  const lowerText = text.toLocaleLowerCase()
  const ranges: FindRange[] = []
  let fromIndex = 0

  while (fromIndex < lowerText.length) {
    const index = lowerText.indexOf(normalizedQuery, fromIndex)
    if (index === -1) break
    ranges.push({ start: index, end: index + normalizedQuery.length })
    fromIndex = index + Math.max(normalizedQuery.length, 1)
  }

  return ranges
}
