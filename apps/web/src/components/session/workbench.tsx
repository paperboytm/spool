import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Clock3,
  Copy,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  MessageSquareText,
  Terminal,
  UserRound,
  X,
} from 'lucide-react'
import {
  MessageList,
  type ConversationMessage,
  type MessageListHandle,
} from '@spool-lab/session-view'
import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import {
  TimelineBody,
  collectRedactList,
  firstLinePreview,
  redactPlainText,
  selectSegments,
  type RedactReplacement,
} from '@spool/share-kit/timeline'

import { humanDateTime, relativeDate } from '../../lib/dates'
import type { HubSessionMeta, RangeFetcher } from '../../lib/hub-api'
import { authorLabel, parseWorkspaceCard, resumeCommandFor } from '../../lib/session-page'
import type { ParsedConversation } from '../../lib/session-messages'
import { DiffPane } from './diff-pane'
import { SessionNote } from './session-note'

interface Props {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  provider: 'claude' | 'codex'
  conversation: ParsedConversation
  isDark: boolean
  fetchRange: RangeFetcher
  initialRecordIndex: number | null
  spoolDocument: SpoolDocument | null
}

export interface UserPromptEntry {
  id: number
  excerpt: string
  preview: string
}

export interface SpoolPromptEntry {
  turnIndex: number
  excerpt: string
  preview: string
}

const MAX_PROMPT_EXCERPT_LENGTH = 100

/** The public-session table of contents is a projection of authored prompts only. */
export function getUserPromptEntries(
  messages: readonly ConversationMessage[],
): UserPromptEntry[] {
  const entries: UserPromptEntry[] = []

  for (const message of messages) {
    if (message.role !== 'user') continue
    const prompt = promptDetails(message.contentText)
    if (!prompt) continue
    entries.push({ id: message.id, ...prompt })
  }

  return entries
}

/** User-authored turns that the attached publication will actually render. */
export function getSpoolPromptEntries(
  document: SpoolDocument,
  injectedRedactList?: readonly RedactReplacement[],
): SpoolPromptEntry[] {
  const redactList = injectedRedactList
    ?? (document.opts.redact
      ? collectRedactList(document.conversation.turns, document.opts)
      : [])
  return selectSegments(document.conversation, document.opts).turns.flatMap((turn) => {
    if (turn.role !== 'user') return []
    const body = document.opts.redact ? redactPlainText(turn.body, redactList) : turn.body
    const prompt = promptDetails(body)
    if (!prompt) return []
    return [{ turnIndex: turn.origIndex, ...prompt }]
  })
}

function promptDetails(content: string): { excerpt: string; preview: string } | null {
  const preview = content.trim()
  if (!preview) return null

  const firstLine = firstLinePreview(content)
  const summary = firstLine || preview.replace(/\s+/g, ' ')
  const excerpt = summary.length <= MAX_PROMPT_EXCERPT_LENGTH
    ? summary
    : `${summary.slice(0, MAX_PROMPT_EXCERPT_LENGTH - 1).trimEnd()}…`

  return { excerpt, preview }
}

function visibleSpoolTurnCount(document: SpoolDocument): number {
  return selectSegments(document.conversation, document.opts).kept
}

function promptBarWidth(excerpt: string): string {
  if (excerpt.length > 72) return 'w-6'
  if (excerpt.length > 40) return 'w-5'
  if (excerpt.length > 20) return 'w-4'
  return 'w-3'
}

function formatObserved(observed: string): string {
  const timestamp = Date.parse(observed)
  return Number.isFinite(timestamp) ? humanDateTime(timestamp) : observed
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function SessionWorkbench({
  meta,
  view,
  provider,
  conversation,
  isDark,
  fetchRange,
  initialRecordIndex,
  spoolDocument,
}: Props) {
  const initialMessageId = initialRecordIndex === null
    ? null
    : conversation.recordToMessageId.get(initialRecordIndex) ?? null
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(initialMessageId)
  const [targetTurnIndex, setTargetTurnIndex] = useState<number | null>(null)
  const [highlightRecord, setHighlightRecord] = useState<number | null>(initialRecordIndex)
  const [copied, setCopied] = useState(false)
  const [previewPromptKey, setPreviewPromptKey] = useState<string | null>(null)
  const listRef = useRef<MessageListHandle>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const focusedTurnRef = useRef<HTMLElement | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const jumpFrameRef = useRef<number | null>(null)
  const diffDialogRef = useRef<HTMLElement>(null)
  const closeDiffButtonRef = useRef<HTMLButtonElement>(null)
  const diffTriggerRef = useRef<HTMLButtonElement | null>(null)
  const drawerWasOpenRef = useRef(false)

  const card = parseWorkspaceCard(meta.cardJson)
  const resume = resumeCommandFor(meta.sid)
  const providerLabel = provider === 'claude' ? 'Claude Code' : 'Codex CLI'
  const rawPrompts = useMemo(
    () => getUserPromptEntries(conversation.messages),
    [conversation.messages],
  )
  const spoolRedactList = useMemo(
    () => spoolDocument !== null && spoolDocument.opts.redact
      ? collectRedactList([
          ...spoolDocument.conversation.turns,
          { role: 'user', body: spoolDocument.conversation.title },
        ], spoolDocument.opts)
      : [],
    [spoolDocument],
  )
  const spoolTitle = spoolDocument?.conversation.title.trim() ?? ''
  const title = (spoolDocument !== null && spoolDocument.opts.redact
    ? redactPlainText(spoolTitle, spoolRedactList)
    : spoolTitle)
    || conversation.title.trim()
    || 'Shared session'
  const spoolPrompts = useMemo(
    () => spoolDocument === null
      ? []
      : getSpoolPromptEntries(spoolDocument, spoolRedactList),
    [spoolDocument, spoolRedactList],
  )
  const prompts = spoolDocument === null
    ? rawPrompts.map((entry) => ({
        key: `message-${entry.id}`,
        excerpt: entry.excerpt,
        preview: entry.preview,
        messageId: entry.id,
        turnIndex: null,
      }))
    : spoolPrompts.map((entry) => ({
        key: `turn-${entry.turnIndex}`,
        excerpt: entry.excerpt,
        preview: entry.preview,
        messageId: null,
        turnIndex: entry.turnIndex,
      }))
  const messageCount = spoolDocument === null
    ? conversation.messages.length
    : visibleSpoolTurnCount(spoolDocument)

  const jumpToTurn = useCallback((turnIndex: number) => {
    setTargetTurnIndex(turnIndex)
    if (jumpFrameRef.current !== null) window.cancelAnimationFrame(jumpFrameRef.current)

    let attempts = 0
    const focusTurn = () => {
      const turn = timelineRef.current?.querySelector<HTMLElement>(
        `[data-turn-index="${turnIndex}"]`,
      )
      if (!turn) {
        attempts++
        if (attempts <= 120) {
          jumpFrameRef.current = window.requestAnimationFrame(focusTurn)
        } else {
          jumpFrameRef.current = null
        }
        return
      }
      jumpFrameRef.current = null

      if (focusedTurnRef.current !== null && focusedTurnRef.current !== turn) {
        focusedTurnRef.current.blur()
        focusedTurnRef.current.removeAttribute('tabindex')
      }
      focusedTurnRef.current = turn
      turn.tabIndex = -1
      turn.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
      turn.focus({ preventScroll: true })
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = window.setTimeout(() => {
        turn.blur()
        turn.removeAttribute('tabindex')
        if (focusedTurnRef.current === turn) focusedTurnRef.current = null
        focusTimerRef.current = null
      }, 1600)
    }
    focusTurn()
  }, [])

  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    if (jumpFrameRef.current !== null) window.cancelAnimationFrame(jumpFrameRef.current)
    focusedTurnRef.current?.removeAttribute('tabindex')
  }, [])

  useEffect(() => {
    if (openFile === null) {
      drawerWasOpenRef.current = false
      return
    }
    if (drawerWasOpenRef.current) return
    drawerWasOpenRef.current = true

    const frame = window.requestAnimationFrame(() => {
      const target = closeDiffButtonRef.current ?? diffDialogRef.current
      target?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [openFile])

  const copy = () => {
    void navigator.clipboard.writeText(resume)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const jumpToMessage = (messageId: number) => {
    setTargetMessageId(messageId)
    listRef.current?.scrollToMessageId(messageId)
  }

  const jumpToPrompt = (messageId: number | null, turnIndex: number | null) => {
    if (turnIndex !== null) jumpToTurn(turnIndex)
    else if (messageId !== null) jumpToMessage(messageId)
  }

  const jumpToRecord = (index: number) => {
    setHighlightRecord(index)
    const messageId = conversation.recordToMessageId.get(index)
    if (messageId === undefined) return
    jumpToMessage(messageId)
  }

  const closeDiff = useCallback(() => {
    setOpenFile(null)
    const trigger = diffTriggerRef.current
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus()
    })
  }, [])

  const toggleDiff = (path: string, trigger: HTMLButtonElement) => {
    if (openFile === path) {
      closeDiff()
      return
    }
    if (openFile === null) diffTriggerRef.current = trigger
    setOpenFile(path)
  }

  const handleDiffDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDiff()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = diffDialogRef.current
    if (!dialog) return
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hasAttribute('disabled'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <main
      className="relative min-w-0 flex-1 bg-[var(--bg)] text-[var(--text)]"
      aria-labelledby="sw-workbench-title"
    >
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 md:px-6 lg:px-8 lg:py-8">
        <header
          className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-5 md:flex-row md:items-end md:justify-between"
          title={`Session ${meta.sid}`}
        >
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-2 font-medium text-[var(--text)]">
                {meta.author.avatarUrl ? (
                  <img
                    src={meta.author.avatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full border border-[var(--border)] object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card-2)]">
                    <UserRound size={13} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                )}
                {authorLabel(meta)}
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    provider === 'claude'
                      ? 'bg-[#C26A4E] [[data-theme=dark]_&]:bg-[#E89A7C]'
                      : 'bg-[#4A9670] [[data-theme=dark]_&]:bg-[#7CC9A2]'
                  }`}
                  aria-hidden="true"
                />
                {providerLabel}
              </span>
              <span title={humanDateTime(meta.updatedAt)}>Shared {relativeDate(meta.updatedAt)}</span>
            </div>
            <h1
              id="sw-workbench-title"
              className="m-0 max-w-[760px] [overflow-wrap:anywhere] text-xl font-semibold leading-8 tracking-[-0.02em] text-[var(--text)] md:text-2xl"
            >
              {title}
            </h1>
            <span className="sr-only">Session ID: {meta.sid}</span>
          </div>

          <div className="flex h-8 min-w-0 shrink-0 md:max-w-[320px]" aria-label="Resume command">
            <code
              className="flex h-8 min-w-0 flex-1 items-center truncate rounded-l-md border border-r-0 border-[var(--border-strong)] bg-[var(--card)] px-3 font-mono text-[11px] text-[var(--muted)]"
              title={resume}
            >
              {resume}
            </code>
            <button
              type="button"
              className="m-0 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-[var(--border-strong)] bg-[var(--card)] p-0 text-[var(--muted)] transition-colors duration-[80ms] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title={copied ? 'Copied' : 'Copy resume command'}
              aria-label={copied ? 'Resume command copied' : 'Copy resume command'}
              onClick={copy}
            >
              {copied
                ? <Check size={14} strokeWidth={1.8} aria-hidden="true" />
                : <Copy size={14} strokeWidth={1.8} aria-hidden="true" />}
              <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
            </button>
          </div>
        </header>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,720px)_280px] lg:items-start lg:gap-8">
          <div className="min-w-0">
            <SessionNote markdown={meta.noteMd} className="mb-6" />

            <section aria-labelledby="session-timeline-title">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 id="session-timeline-title" className="m-0 text-base font-semibold text-[var(--text)]">
                  Session
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-[var(--faint)]">
                  {messageCount}{' '}
                  {spoolDocument === null
                    ? (messageCount === 1 ? 'message' : 'messages')
                    : (messageCount === 1 ? 'turn' : 'turns')}
                </span>
              </div>

              <div className="min-w-0 lg:grid lg:grid-cols-[24px_minmax(0,1fr)] lg:gap-4">
                {prompts.length > 0 && (
                  <nav className="relative mb-4 min-w-0 lg:mb-0" aria-label="User prompts">
                    <div className="mb-2 flex items-center justify-between gap-3 lg:hidden">
                      <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                        Prompts
                      </h3>
                      <span className="font-mono text-[10px] tabular-nums text-[var(--faint)]">
                        {prompts.length}
                      </span>
                    </div>
                    <div className="lg:sticky lg:top-6 lg:py-2">
                      <h3 className="sr-only">User prompts</h3>
                      <ol className="m-0 flex list-none snap-x gap-2 overflow-x-auto p-0 pb-2 lg:block lg:overflow-visible lg:pb-0">
                        {prompts.map((entry, index) => {
                          const active = entry.turnIndex !== null
                            ? targetTurnIndex === entry.turnIndex
                            : targetMessageId === entry.messageId
                          const tooltipId = `prompt-preview-${entry.key}`
                          const showPreview = previewPromptKey === entry.key
                          return (
                            <li
                              key={entry.key}
                              className="group relative shrink-0 snap-start lg:flex lg:h-6 lg:items-center"
                              onMouseEnter={() => setPreviewPromptKey(entry.key)}
                              onMouseLeave={(event) => {
                                if (!event.currentTarget.contains(document.activeElement)) {
                                  setPreviewPromptKey(null)
                                }
                              }}
                              onFocus={() => setPreviewPromptKey(entry.key)}
                              onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget)) {
                                  setPreviewPromptKey(null)
                                }
                              }}
                            >
                              <button
                                type="button"
                                className={`m-0 flex h-12 w-48 cursor-pointer items-center gap-2 rounded-md border px-3 py-0 text-left font-sans transition-colors duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:h-6 lg:w-6 lg:border-0 lg:bg-transparent lg:p-0 ${
                                  active
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
                                }`}
                                aria-label={`Prompt ${index + 1}: ${entry.excerpt}`}
                                aria-describedby={showPreview ? tooltipId : undefined}
                                aria-current={active ? 'location' : undefined}
                                onClick={() => jumpToPrompt(entry.messageId, entry.turnIndex)}
                              >
                                <span className="font-mono text-[10px] tabular-nums text-[var(--accent)] lg:hidden">
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="line-clamp-2 min-w-0 text-[11px] leading-4 lg:hidden">
                                  {entry.excerpt}
                                </span>
                                <span
                                  className={`hidden h-px transition-colors duration-[80ms] lg:block ${promptBarWidth(entry.excerpt)} ${
                                    active
                                      ? 'bg-[var(--accent)]'
                                      : 'bg-[var(--border-strong)] group-hover:bg-[var(--text)] group-focus-within:bg-[var(--text)]'
                                  }`}
                                  aria-hidden="true"
                                />
                              </button>
                              {showPreview && (
                                <span
                                  id={tooltipId}
                                  role="tooltip"
                                  className="absolute left-8 top-0 z-20 hidden max-h-80 w-80 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--border)] bg-[var(--card)] p-4 text-[13px] leading-5 text-[var(--text)] shadow-[0_8px_24px_color-mix(in_srgb,var(--text)_10%,transparent)] lg:block"
                                >
                                  {entry.preview}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                    </div>
                  </nav>
                )}

                <div className="min-w-0">
                  {spoolDocument !== null ? (
                    messageCount > 0 ? (
                      <div
                        ref={timelineRef}
                        className="min-w-0 overflow-x-auto [&_[data-turn-index]:focus]:outline-none [&_[data-turn-index]:focus_[data-turn-body]]:rounded-md [&_[data-turn-index]:focus_[data-turn-body]]:outline-2 [&_[data-turn-index]:focus_[data-turn-body]]:outline-offset-4 [&_[data-turn-index]:focus_[data-turn-body]]:outline-[var(--accent)]"
                      >
                        <TimelineBody
                          convo={spoolDocument.conversation}
                          opts={spoolDocument.opts}
                          redactList={spoolRedactList}
                          progressive
                        />
                      </div>
                    ) : (
                      <p className="m-0 border-t border-[var(--border)] py-6 text-[13px] text-[var(--faint)]">
                        No turns were selected for this session.
                      </p>
                    )
                  ) : conversation.messages.length > 0 ? (
                    <div className="h-[70vh] min-h-96 overflow-hidden border-t border-[var(--border)]">
                      <MessageList
                        ref={listRef}
                        messages={conversation.messages}
                        isDark={isDark}
                        targetMessageId={targetMessageId}
                        showTargetHighlight={targetMessageId !== null}
                      />
                    </div>
                  ) : (
                    <p className="m-0 border-t border-[var(--border)] py-6 text-[13px] text-[var(--faint)]">
                      No renderable messages in this session.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside aria-label="Session metadata" className="min-w-0 lg:sticky lg:top-6">
            <div className="border-t border-[var(--border)]">
              <h2 className="m-0 border-b border-[var(--border)] py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                Metadata
              </h2>
              <dl className="m-0 text-[11px]">
                <MetadataRow label="Provider">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        provider === 'claude'
                          ? 'bg-[#C26A4E] [[data-theme=dark]_&]:bg-[#E89A7C]'
                          : 'bg-[#4A9670] [[data-theme=dark]_&]:bg-[#7CC9A2]'
                      }`}
                      aria-hidden="true"
                    />
                    {providerLabel}
                  </span>
                </MetadataRow>
                <MetadataRow label="Shared">
                  <span className="inline-flex items-center gap-2">
                    <Clock3 size={12} strokeWidth={1.7} aria-hidden="true" />
                    <time dateTime={new Date(meta.updatedAt).toISOString()}>
                      {humanDateTime(meta.updatedAt)}
                    </time>
                  </span>
                </MetadataRow>
                <MetadataRow label="Messages">
                  <span className="inline-flex items-center gap-2 font-mono tabular-nums">
                    <MessageSquareText size={12} strokeWidth={1.7} aria-hidden="true" />
                    {messageCount}
                  </span>
                </MetadataRow>
                <MetadataRow label="Records">
                  <span className="font-mono tabular-nums">{meta.count}</span>
                </MetadataRow>
                {view && (
                  <MetadataRow label="Changes">
                    <span className="font-mono tabular-nums">
                      {view.diffstat.files} {view.diffstat.files === 1 ? 'file' : 'files'}{' '}
                      <span className="font-medium text-[#6BAF6B] [[data-theme=dark]_&]:text-[#7DC07D]">
                        +{view.diffstat.adds}
                      </span>{' '}
                      <span className="font-medium text-[#C95A4F] [[data-theme=dark]_&]:text-[#D67259]">
                        -{view.diffstat.dels}
                      </span>
                    </span>
                  </MetadataRow>
                )}
              </dl>
            </div>

            {card && (
              <section className="mt-6 border-t border-[var(--border)]" aria-labelledby="workspace-title">
                <h2
                  id="workspace-title"
                  className="m-0 border-b border-[var(--border)] py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]"
                >
                  Workspace
                </h2>
                <dl className="m-0 text-[11px]">
                  <MetadataRow label="Remote">
                    {card.remotes.length > 0 ? (
                      <span className="flex min-w-0 flex-col gap-1">
                        {card.remotes.map((remote) => (
                          <span key={remote} className="[overflow-wrap:anywhere] font-mono" title={remote}>
                            {remote}
                          </span>
                        ))}
                      </span>
                    ) : '—'}
                  </MetadataRow>
                  <MetadataRow label="Branch">
                    <span className="inline-flex min-w-0 items-start gap-2 [overflow-wrap:anywhere] font-mono">
                      <GitBranch className="mt-0.5 shrink-0" size={12} strokeWidth={1.7} aria-hidden="true" />
                      {card.branch ?? '(detached)'}
                    </span>
                  </MetadataRow>
                  <MetadataRow label="Head">
                    <span className="inline-flex min-w-0 items-start gap-2 [overflow-wrap:anywhere] font-mono" title={card.head ?? undefined}>
                      <GitCommitHorizontal className="mt-0.5 shrink-0" size={12} strokeWidth={1.7} aria-hidden="true" />
                      {card.head ?? '—'}
                    </span>
                  </MetadataRow>
                  <MetadataRow label="Dirty">
                    <span className="font-mono tabular-nums">
                      {card.dirty.length} {card.dirty.length === 1 ? 'file' : 'files'}
                    </span>
                  </MetadataRow>
                  <MetadataRow label="Observed">
                    {card.observed ? (
                      <time className="font-mono" dateTime={card.observed} title={card.observed}>
                        {formatObserved(card.observed)}
                      </time>
                    ) : '—'}
                  </MetadataRow>
                </dl>
              </section>
            )}

            {view && view.files.length > 0 && (
              <section className="mt-6 border-t border-[var(--border)]" aria-labelledby="files-title">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-3">
                  <h2
                    id="files-title"
                    className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]"
                  >
                    Files
                  </h2>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--faint)]">
                    {view.files.length}
                  </span>
                </div>
                <div className="py-2">
                  {view.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      aria-pressed={openFile === file.path}
                      className={`m-0 flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 px-2 py-1 text-left font-sans transition-colors duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                        openFile === file.path
                          ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                          : 'bg-transparent text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--text)]'
                      }`}
                      onClick={(event) => toggleDiff(file.path, event.currentTarget)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileCode2 className="shrink-0" size={12} strokeWidth={1.7} aria-hidden="true" />
                        <span className="truncate font-mono text-[11px]" title={file.path}>
                          {file.path}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums">
                        <span className="font-medium text-[#6BAF6B] [[data-theme=dark]_&]:text-[#7DC07D]">
                          +{file.adds}
                        </span>{' '}
                        <span className="font-medium text-[#C95A4F] [[data-theme=dark]_&]:text-[#D67259]">
                          -{file.dels}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      {openFile && view && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close file diff"
            className="fixed inset-0 z-40 m-0 cursor-pointer border-0 bg-[color-mix(in_srgb,var(--text)_12%,transparent)] p-0"
            onClick={closeDiff}
          />
          <aside
            ref={diffDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-diff-title"
            tabIndex={-1}
            className="fixed inset-y-0 right-0 z-50 flex w-full min-w-0 flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-[-8px_0_24px_color-mix(in_srgb,var(--text)_12%,transparent)] sm:w-[min(640px,80vw)]"
            onKeyDown={handleDiffDialogKeyDown}
          >
            <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
              <span className="flex min-w-0 items-center gap-2">
                <Terminal className="shrink-0 text-[var(--accent)]" size={14} strokeWidth={1.7} aria-hidden="true" />
                <span
                  id="file-diff-title"
                  className="truncate font-mono text-[11px] text-[var(--text)]"
                  title={openFile}
                >
                  {openFile}
                </span>
              </span>
              <button
                ref={closeDiffButtonRef}
                type="button"
                className="m-0 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--muted)] transition-colors duration-[80ms] hover:bg-[var(--card-2)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                aria-label="Close diff"
                onClick={closeDiff}
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <DiffPane
                view={view}
                provider={provider}
                fetchRange={fetchRange}
                openFile={openFile}
                highlightRecord={highlightRecord}
                onSelectFile={setOpenFile}
                {...(spoolDocument === null ? { onJumpToRecord: jumpToRecord } : {})}
              />
            </div>
          </aside>
        </>
      )}
    </main>
  )
}

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] py-2 last:border-b-0">
      <dt className="m-0 text-[var(--faint)]">{label}</dt>
      <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-[var(--muted)]">{children}</dd>
    </div>
  )
}
