import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SquareTerminal, SquarePen, MoreHorizontal, Copy, ShieldAlert, Check, RotateCcw } from 'lucide-react'
import type { Session, Message } from '@spool-lab/core'
import { type FindRange } from './MessageBubble.js'
import MessageList, { type MessageListHandle } from './MessageList.js'
import SessionFindBar from './SessionFindBar.js'
import FindingsStrip from './security/FindingsStrip.js'
import RefreshFromSourceDialog from './session/RefreshFromSourceDialog.js'
import { securityApi } from '../api/security.js'
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
  onShare: (session: Session, messages: Message[]) => void
}

export default function SessionDetail({ sessionUuid, targetMessageId, onCopySessionId, onBack, onShare }: Props) {
  const { t } = useTranslation()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [pinned, setPinned] = useState(false)
  // Findings strip is collapsed by default — only the risk pill in the
  // meta row appears. Clicking the pill drops the strip in; the strip's
  // × button puts it away again. Reset on session change so opening
  // session A's strip doesn't leak into B.
  const [stripOpen, setStripOpen] = useState(false)
  useEffect(() => { setStripOpen(false) }, [sessionUuid])
  const [resuming, setResuming] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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

  // Re-fetch the session record on security mutations so the
  // meta-row pill (which reads session.scanFindingCount /
  // scanHighCount / scanPurgedCount / scanCompletedAt) flips to
  // its "cleared ✓" state immediately after a Purge all, rather
  // than staying stuck on the pre-purge counts until the user
  // navigates away and back. Debounced because a Purge all of
  // N findings publishes N events.
  useEffect(() => {
    const sessionId = session?.id
    if (sessionId === undefined) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange((c) => {
      if (c.sessionId !== sessionId) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        window.spool.getSession(sessionUuid).then((result) => {
          if (result) setSession(result.session)
        }).catch(() => {})
      }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [sessionUuid, session?.id])

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

  async function handleRefreshFromSource() {
    if (!session || refreshing) return
    setRefreshing(true)
    try {
      const out = await window.spool.forceResyncSession(session.sessionUuid)
      if (out.ok) {
        // Reload the session + messages so the rebuilt transcript
        // and the cleared scan_* counts surface immediately. Without
        // this the refresh succeeds in the DB but the user keeps
        // looking at the pre-refresh transcript, which is the exact
        // confusion this action exists to dispel.
        const reloaded = await window.spool.getSession(session.sessionUuid)
        if (reloaded) {
          setSession(reloaded.session)
          setMessages(reloaded.messages)
        }
        toast.success(t('session.refreshSuccess'))
        setRefreshDialogOpen(false)
      } else {
        toast.error(t('session.refreshError', { error: out.error }))
      }
    } catch (err) {
      toast.error(t('session.refreshError', { error: String(err) }))
    } finally {
      setRefreshing(false)
    }
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
            <RiskPill session={session} open={stripOpen} onToggle={() => setStripOpen(v => !v)} />
          </p>
        </div>

        <div className="flex-none self-end flex items-center gap-0.5">
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={setPinned}
          />

          {session && (
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
              {
                label: t('session.refreshFromSource'),
                icon: <RotateCcw size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { setRefreshDialogOpen(true) },
              },
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

      <FindingsStrip session={session} open={stripOpen} onClose={() => setStripOpen(false)} />

      <RefreshFromSourceDialog
        open={refreshDialogOpen}
        busy={refreshing}
        onConfirm={() => { void handleRefreshFromSource() }}
        onCancel={() => { if (!refreshing) setRefreshDialogOpen(false) }}
      />

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

/** Small risk indicator placed inline in the session meta row,
 *  immediately after the message count. Reads as a session stat
 *  ("4 risks" alongside "84 messages") rather than another command.
 *  Click toggles the FindingsStrip open/closed.
 *
 *  Shown only when the session has either active findings or a
 *  non-zero purged-history tally. */
function RiskPill({
  session,
  open,
  onToggle,
}: {
  session: Session
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()

  const high = session.scanHighCount ?? 0
  const total = session.scanFindingCount ?? 0
  const purged = session.scanPurgedCount ?? 0
  const completed = session.scanCompletedAt != null

  // Defensive: if the session has no visible messages, suppress the
  // pill. Stale findings can land on sessions whose user/assistant
  // messages were stripped (sidechain-only state, file rewrite) and
  // there's no useful action the user can take from this surface
  // when the body is empty.
  if ((session.messageCount ?? 0) === 0) return null

  // Three pill states:
  //   active   — has findings; click drops the strip in
  //   resolved — was scanned, no active findings, ≥1 was purged at
  //              some point; shield + ✓
  //   none     — never had findings, or never scanned; nothing renders
  let icon: React.ReactNode
  let label: React.ReactNode
  let tone: string
  let title: string
  let clickable = true

  if (total > 0) {
    const low = Math.max(0, total - high)
    icon = <ShieldAlert size={12} strokeWidth={1.75} aria-hidden />
    label = total
    tone = high > 0
      ? 'text-accent dark:text-accent-dark'
      : 'text-warm-muted dark:text-dark-muted'
    title = high > 0 && low > 0
      ? t('security.pill_tooltip_mixed', { high, low, defaultValue: '{{high}} high-risk · {{low}} low' })
      : high > 0
      ? t('security.pill_tooltip_high', { count: high, defaultValue: '{{count}} high-risk' })
      : t('security.pill_tooltip_low', { count: low, defaultValue: '{{count}} low' })
  } else if (completed && purged > 0) {
    // Cleared: scan ran, was once dirty, now empty.
    icon = <ShieldAlert size={12} strokeWidth={1.75} aria-hidden />
    label = <Check size={12} strokeWidth={1.9} aria-hidden />
    tone = 'text-warm-muted dark:text-dark-muted'
    title = t('security.pill_tooltip_resolved', { count: purged, defaultValue: '{{count}} resolved' })
    // No strip to drop — the pill is a status indicator only.
    clickable = false
  } else {
    return null
  }

  // Clickable variant drops the strip; static variant is a status
  // indicator only (the cleared/resolved state has nothing to expand).
  const cls = `flex-none inline-flex items-center gap-1 px-1.5 h-[18px] rounded font-mono tabular-nums text-[11px] leading-none ${tone}`
  return (
    <>
      <span aria-hidden>·</span>
      {clickable ? (
        <button
          type="button"
          data-testid="session-risk-pill"
          data-open={open ? '1' : '0'}
          onClick={onToggle}
          aria-expanded={open}
          aria-label={title}
          title={title}
          className={`${cls} hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ) : (
        <span
          data-testid="session-risk-pill"
          data-resolved="1"
          aria-label={title}
          title={title}
          className={cls}
        >
          {icon}
          <span>{label}</span>
        </span>
      )}
    </>
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
