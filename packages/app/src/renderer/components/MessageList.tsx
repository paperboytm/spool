import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Message } from '@spool-lab/core'
import MessageBubble, { type FindRange } from './MessageBubble.js'

type DividerLabel = (iso: string, now: Date) => string

export interface MessageListHandle {
  scrollToMessageId: (id: number) => void
}

interface MatchState {
  ranges: FindRange[]
  offset: number
}

interface Props {
  messages: Message[]
  isDark: boolean
  showFindBar: boolean
  messageFindRanges: Map<number, MatchState>
  activeMatchIndex: number
  onActiveMatchRef: (node: HTMLElement | null) => void
  targetMessageId?: number | null
  showTargetHighlight: boolean
}

/** A virtualised row is either an actual message or a day-divider header. */
type Row =
  | { kind: 'msg'; msg: Message; showAvatar: boolean }
  | { kind: 'sidechain'; key: string; label: string; timestamp: string; messages: Message[] }
  | { kind: 'divider'; key: string; isoDay: string; label: string }

/** Stable per-local-day key used for divider grouping + dedup. */
function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function makeDividerLabel(today: string, yesterday: string, locale: string | undefined): DividerLabel {
  return (iso, now) => {
    const d = new Date(iso)
    if (sameLocalDay(d, now)) return today
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (sameLocalDay(d, y)) return yesterday
    const opts: Intl.DateTimeFormatOptions =
      d.getFullYear() === now.getFullYear()
        ? { weekday: 'short', month: 'short', day: 'numeric' }
        : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    return new Intl.DateTimeFormat(locale, opts).format(d)
  }
}

const OPENCODE_SUBAGENT_HEADER_PREFIX = 'OpenCode subagent:'

function sidechainKey(message: Message): string {
  return message.parentUuid ?? `sidechain:${message.id}`
}

function isSubagentHeader(message: Message): boolean {
  return message.role === 'system' && message.contentText.startsWith(OPENCODE_SUBAGENT_HEADER_PREFIX)
}

function makeSidechainLabel(messages: Message[]): string {
  const header = messages.find(isSubagentHeader)
  if (!header) return 'Subagent'
  return header.contentText.slice(OPENCODE_SUBAGENT_HEADER_PREFIX.length).trim() || 'Subagent'
}

function visibleSidechainMessages(messages: Message[]): Message[] {
  return messages.filter(message => !isSubagentHeader(message))
}

function groupSidechainMessages(messages: Message[]): Map<string, Message[]> {
  const groups = new Map<string, Message[]>()
  for (const message of messages) {
    if (!message.isSidechain) continue
    const key = sidechainKey(message)
    const group = groups.get(key) ?? []
    group.push(message)
    groups.set(key, group)
  }
  return groups
}

/** Build the virtualised row list. A divider is inserted whenever the
 *  message's local day differs from the previous row — except before the
 *  very first message, since the session header already shows the start
 *  date and a duplicate divider there just reads as chrome noise.
 *  `showAvatar` is pre-computed here so itemContent stays cheap and so
 *  role-grouping resets across day boundaries (the first message after
 *  a divider always shows its avatar). */
function buildRows(messages: Message[], label: DividerLabel): Row[] {
  const rows: Row[] = []
  const sidechainGroups = groupSidechainMessages(messages)
  const emittedSidechains = new Set<string>()
  // Seed prevDay with the first message's day so the divider branch
  // only fires on actual day transitions — the leading divider above
  // the very first message is suppressed without a separate guard.
  let prevDay: string | null = messages[0] ? localDayKey(messages[0].timestamp) : null
  let prevMsg: Message | null = null
  const now = new Date()
  for (const msg of messages) {
    let row: Row
    if (msg.isSidechain) {
      const key = sidechainKey(msg)
      if (emittedSidechains.has(key)) continue
      emittedSidechains.add(key)
      const group = sidechainGroups.get(key) ?? [msg]
      row = {
        kind: 'sidechain',
        key,
        label: makeSidechainLabel(group),
        timestamp: group[0]?.timestamp ?? msg.timestamp,
        messages: visibleSidechainMessages(group),
      }
    } else {
      const showAvatar: boolean =
        !prevMsg || prevMsg.role !== msg.role || prevMsg.role === 'system'
      row = { kind: 'msg', msg, showAvatar }
    }

    const rowTimestamp = row.kind === 'msg' ? row.msg.timestamp : row.timestamp
    const day = localDayKey(rowTimestamp)
    if (day !== prevDay) {
      rows.push({
        kind: 'divider',
        key: `div-${day}`,
        isoDay: day,
        label: label(rowTimestamp, now),
      })
      prevDay = day
      prevMsg = null
    }

    rows.push(row)
    prevMsg = row.kind === 'msg' ? msg : null
  }
  return rows
}

function shouldShowAvatarInGroup(messages: Message[], index: number): boolean {
  const message = messages[index]
  const previous = index > 0 ? messages[index - 1] : null
  return !message || !previous || previous.role !== message.role || previous.role === 'system'
}

function hasFindMatch(messages: Message[], messageFindRanges: Map<number, MatchState>): boolean {
  return messages.some(message => messageFindRanges.has(message.id))
}

function formatRowTime(iso: string, locale: string | undefined): string {
  try {
    return new Date(iso).toLocaleTimeString(locale)
  } catch {
    return ''
  }
}

const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(
  { messages, isDark, showFindBar, messageFindRanges, activeMatchIndex, onActiveMatchRef, targetMessageId, showTargetHighlight },
  ref,
) {
  const { t, i18n } = useTranslation()
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const [expandedSidechains, setExpandedSidechains] = useState<Set<string>>(() => new Set())

  const dividerLabel = useMemo(
    () => makeDividerLabel(t('session.divider_today'), t('session.divider_yesterday'), i18n.language),
    [t, i18n.language],
  )
  const rows = useMemo(() => buildRows(messages, dividerLabel), [messages, dividerLabel])

  // Maps a message id to its row index. Row indices include day dividers,
  // so this is the only correct way to translate "scroll to message X" into
  // a Virtuoso index after dividers are inserted.
  const idToRowIndex = useMemo(() => {
    const map = new Map<number, number>()
    rows.forEach((row, i) => {
      if (row.kind === 'msg') map.set(row.msg.id, i)
      else if (row.kind === 'sidechain') {
        for (const message of row.messages) map.set(message.id, i)
      }
    })
    return map
  }, [rows])

  // Captured once at mount: Virtuoso reads this before its first paint, so the
  // target row is already centered when the user sees the list. Subsequent
  // target changes (same session, different match) flow through the imperative
  // scrollToMessageId handle. Cross-session navigation is expected to remount
  // this component (parent should pass `key={sessionUuid}`), which re-engages
  // initialTopMostItemIndex with the fresh target.
  const initialIndex = useMemo(() => {
    if (targetMessageId == null) return undefined
    const idx = idToRowIndex.get(targetMessageId)
    return idx == null ? undefined : { index: idx, align: 'center' as const }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToMessageId(id) {
      const idx = idToRowIndex.get(id)
      if (idx == null) return
      virtuosoRef.current?.scrollIntoView({ index: idx, align: 'center', behavior: 'auto' })
    },
  }), [idToRowIndex])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-faint dark:text-dark-muted">
        <p className="text-sm">No messages to display.</p>
      </div>
    )
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={rows}
      computeItemKey={(_index, row) => row.kind === 'msg' ? `m-${row.msg.id}` : row.key}
      defaultItemHeight={64}
      {...(initialIndex ? { initialTopMostItemIndex: initialIndex } : {})}
      increaseViewportBy={400}
      data-testid="message-list-scroll"
      className="flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      itemContent={(index, row) => {
        if (row.kind === 'divider') {
          return (
            <div
              data-index={index}
              data-testid="day-divider"
              data-day={row.isoDay}
              className="px-6 pt-5 pb-2 flex items-center gap-3 select-none"
            >
              <span className="flex-1 h-px bg-warm-border dark:bg-dark-border" />
              <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-warm-faint dark:text-dark-muted">
                {row.label}
              </span>
              <span className="flex-1 h-px bg-warm-border dark:bg-dark-border" />
            </div>
          )
        }
        if (row.kind === 'sidechain') {
          const rowHasFindMatch = showFindBar && hasFindMatch(row.messages, messageFindRanges)
          const rowHasTarget = targetMessageId != null && row.messages.some(message => message.id === targetMessageId)
          const expanded = expandedSidechains.has(row.key) || rowHasFindMatch || rowHasTarget
          const rowTime = formatRowTime(row.timestamp, i18n.language)

          return (
            <div data-index={index} className="px-6 py-2">
              <button
                type="button"
                onClick={() => {
                  setExpandedSidechains((current) => {
                    const next = new Set(current)
                    if (next.has(row.key)) next.delete(row.key)
                    else next.add(row.key)
                    return next
                  })
                }}
                className="w-full min-w-0 flex items-center gap-2 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface/70 dark:bg-dark-surface/70 px-3 py-2 text-left hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
              >
                {expanded ? (
                  <ChevronDown size={14} strokeWidth={1.8} className="flex-none text-warm-faint dark:text-dark-muted" aria-hidden />
                ) : (
                  <ChevronRight size={14} strokeWidth={1.8} className="flex-none text-warm-faint dark:text-dark-muted" aria-hidden />
                )}
                <span className="flex-1 min-w-0 truncate text-xs font-medium text-warm-muted dark:text-dark-muted">
                  {row.label}
                </span>
                <span className="flex-none text-[10px] font-mono text-warm-faint dark:text-dark-muted">
                  {t('session.messages_other', { count: row.messages.length })}
                  {rowTime ? ` · ${rowTime}` : ''}
                </span>
              </button>

              {expanded && (
                <div className="mt-2 ml-2 border-l border-warm-border dark:border-dark-border">
                  {row.messages.map((message, messageIndex) => {
                    const matchState = showFindBar ? messageFindRanges.get(message.id) : undefined
                    const containsActive = matchState != null
                      && activeMatchIndex >= matchState.offset
                      && activeMatchIndex < matchState.offset + matchState.ranges.length
                    const isTarget = message.id === targetMessageId

                    return (
                      <div
                        key={message.id}
                        {...(isTarget ? { 'data-testid': 'target-message' } : {})}
                        {...(isTarget && showTargetHighlight ? { 'data-highlighted': '1' } : {})}
                        className={`transition-colors duration-700 ${
                          isTarget && showTargetHighlight ? 'bg-accent/10 dark:bg-accent-dark/10' : ''
                        }`}
                      >
                        <MessageBubble
                          message={message}
                          isDark={isDark}
                          showAvatar={shouldShowAvatarInGroup(row.messages, messageIndex)}
                          {...(matchState ? { findRanges: matchState.ranges, matchIndexOffset: matchState.offset } : {})}
                          activeMatchIndex={containsActive ? activeMatchIndex : -1}
                          {...(containsActive ? { onActiveMatchRef } : {})}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }
        const msg = row.msg
        const matchState = showFindBar ? messageFindRanges.get(msg.id) : undefined
        const containsActive = matchState != null
          && activeMatchIndex >= matchState.offset
          && activeMatchIndex < matchState.offset + matchState.ranges.length
        const isTarget = msg.id === targetMessageId

        return (
          <div
            data-index={index}
            {...(isTarget ? { 'data-testid': 'target-message' } : {})}
            {...(isTarget && showTargetHighlight ? { 'data-highlighted': '1' } : {})}
            className={`transition-colors duration-700 ${
              isTarget && showTargetHighlight ? 'bg-accent/10 dark:bg-accent-dark/10' : ''
            }`}
          >
            <MessageBubble
              message={msg}
              isDark={isDark}
              showAvatar={row.showAvatar}
              {...(matchState ? { findRanges: matchState.ranges, matchIndexOffset: matchState.offset } : {})}
              activeMatchIndex={containsActive ? activeMatchIndex : -1}
              {...(containsActive ? { onActiveMatchRef } : {})}
            />
          </div>
        )
      }}
    />
  )
})

export default MessageList
