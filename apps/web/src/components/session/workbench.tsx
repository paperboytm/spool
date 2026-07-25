import {
  SESSION_PROVIDER_LABELS,
  extractGuidanceRecord,
  isResumableSessionProvider,
  parseSummaryFrontMatter,
  type SessionGuidanceTurnV1,
  type SessionGuidanceV1,
  type SessionProvider,
  type SessionViewV1,
} from '@spool-lab/session-kit'
import {
  MessageList,
  type ConversationMessage,
  type MessageListHandle,
} from '@spool-lab/session-view'
import { Avatar, Badge, Button, Dialog, IconButton, Tabs } from '@spool-lab/ui'
import type { SpoolDocument } from '@spool/share-kit'
import {
  TimelineBody,
  collectRedactList,
  firstLinePreview,
  redactPlainText,
  selectSegments,
  type RedactReplacement,
} from '@spool/share-kit/timeline'
import {
  Bot,
  ChevronRight,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  Link2,
  MessageSquareText,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { humanDateTime, relativeDate } from '../../lib/dates'
import { fetchRecordsByIndices, makeRangeFetcher, type HubSessionMeta } from '../../lib/hub-api'
import { sessionLanguageTag, useSessionLanguage } from '../../lib/language'
import { normalizeTabTitle } from '../../lib/page-title'
import type { ParsedConversation } from '../../lib/session-messages'
import { authorLabel, parseWorkspaceCard, repositoryUrlForRemote } from '../../lib/session-page'
import {
  formatSessionCost,
  resolveLocalizedSessionSummary,
  resolveLocalizedTitle,
} from '../../lib/session-title'
import { SessionActions } from './session-actions'
import { SessionMarkdown, SessionSummary } from './session-summary'

interface Props {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  viewResolved: boolean
  provider: SessionProvider
  conversation: ParsedConversation | null
  isDark: boolean
  initialRecordIndex: number | null
  spoolDocument: SpoolDocument | null
  history: SessionHistoryState
  onLoadHistory: () => void
}

export type SessionHistoryState =
  | { phase: 'idle'; total: number }
  | { phase: 'loading'; source: 'publication' | 'records'; loaded: number; total: number }
  | { phase: 'ready'; total: number }
  | {
      phase: 'error'
      source: 'publication' | 'records'
      loaded: number
      total: number
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

export interface LocalGuidanceTurn {
  prompt: string
  replies: string[]
  replyChars: number
  toolCalls: number | null
}

const MAX_PROMPT_EXCERPT_LENGTH = 100
const MAX_SESSION_TITLE_LENGTH = 96

/** The public-session table of contents is a projection of authored prompts only. */
export function getUserPromptEntries(messages: readonly ConversationMessage[]): UserPromptEntry[] {
  const entries: UserPromptEntry[] = []

  for (const message of messages) {
    if (message.role !== 'user' || message.isSidechain) continue
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
  const redactList =
    injectedRedactList ??
    (document.opts.redact ? collectRedactList(document.conversation.turns, document.opts) : [])
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
  const excerpt =
    summary.length <= MAX_PROMPT_EXCERPT_LENGTH
      ? summary
      : `${summary.slice(0, MAX_PROMPT_EXCERPT_LENGTH - 1).trimEnd()}…`

  return { excerpt, preview }
}

function compactSessionTitle(content: string): string {
  const fallback = content.trim().replace(/\s+/g, ' ')
  const title = firstLinePreview(content) || fallback
  return title.length <= MAX_SESSION_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`
}

function visibleSpoolTurnCount(document: SpoolDocument): number {
  return selectSegments(document.conversation, document.opts).kept
}

function characterCount(value: string): number {
  return Array.from(value.trim()).length
}

/** Fallback guidance for an already loaded legacy conversation. */
export function getConversationGuidanceTurns(
  messages: readonly ConversationMessage[],
): LocalGuidanceTurn[] {
  const turns: LocalGuidanceTurn[] = []
  let current: LocalGuidanceTurn | null = null

  for (const message of messages) {
    if (message.isSidechain) continue
    const text = message.contentText.trim()
    if (message.role === 'user') {
      if (!text) continue
      if (current !== null) turns.push(current)
      current = { prompt: text, replies: [], replyChars: 0, toolCalls: 0 }
      continue
    }
    if (message.role !== 'assistant' || current === null) continue
    current.toolCalls = (current.toolCalls ?? 0) + message.toolNames.length
    if (!text) continue
    current.replies.push(text)
    current.replyChars += characterCount(text)
  }

  if (current !== null) turns.push(current)
  return turns
}

/** Guidance for a curated .spool publication follows its selection and redaction. */
export function getSpoolGuidanceTurns(
  document: SpoolDocument,
  injectedRedactList?: readonly RedactReplacement[],
): LocalGuidanceTurn[] {
  const redactList =
    injectedRedactList ??
    (document.opts.redact ? collectRedactList(document.conversation.turns, document.opts) : [])
  const turns: LocalGuidanceTurn[] = []
  let current: LocalGuidanceTurn | null = null

  for (const turn of selectSegments(document.conversation, document.opts).turns) {
    const body = (document.opts.redact ? redactPlainText(turn.body, redactList) : turn.body).trim()
    if (turn.role === 'user') {
      if (!body) continue
      if (current !== null) turns.push(current)
      current = { prompt: body, replies: [], replyChars: 0, toolCalls: null }
      continue
    }
    if (turn.role !== 'assistant' || current === null || !body) continue
    current.replies.push(body)
    current.replyChars += characterCount(body)
  }

  if (current !== null) turns.push(current)
  return turns
}

function formatObserved(observed: string): string {
  const timestamp = Date.parse(observed)
  return Number.isFinite(timestamp) ? humanDateTime(timestamp) : observed
}

export function SessionWorkbench({
  meta,
  view,
  viewResolved,
  provider,
  conversation,
  isDark,
  initialRecordIndex,
  spoolDocument,
  history,
  onLoadHistory,
}: Props) {
  const [readingMode, setReadingMode] = useState<'full' | 'guidance'>('full')
  // An attached .spool document is the authored publication boundary. Raw
  // records and their machine-derived view must never become a UI fallback
  // while that curated artifact is pending or unavailable.
  const rawConversation = meta.spoolFileOid == null ? conversation : null
  const initialMessageId =
    initialRecordIndex === null || rawConversation === null
      ? null
      : (rawConversation.recordToMessageId.get(initialRecordIndex) ?? null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(initialMessageId)
  const [targetTurnIndex, setTargetTurnIndex] = useState<number | null>(null)
  const [previewPromptKey, setPreviewPromptKey] = useState<string | null>(null)
  const listRef = useRef<MessageListHandle>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const focusedTurnRef = useRef<HTMLElement | null>(null)
  const jumpFrameRef = useRef<number | null>(null)
  const appliedInitialRecordRef = useRef(initialMessageId !== null)

  const card = parseWorkspaceCard(meta.cardJson)
  const resumable = isResumableSessionProvider(provider)
  const providerLabel = SESSION_PROVIDER_LABELS[provider]
  const isPublic = meta.visibility === 'public'
  const isTeam = meta.visibility === 'team'
  const visibilityTimestamp = isPublic ? meta.createdAt : meta.updatedAt
  const avatarName = meta.author.displayName ?? meta.author.handle ?? 'Spool author'
  const rawPrompts = useMemo(
    () => getUserPromptEntries(rawConversation?.messages ?? []),
    [rawConversation?.messages],
  )
  const spoolRedactList = useMemo(
    () =>
      spoolDocument !== null && spoolDocument.opts.redact
        ? collectRedactList(
            [
              ...spoolDocument.conversation.turns,
              { role: 'user', body: spoolDocument.conversation.title },
            ],
            spoolDocument.opts,
          )
        : [],
    [spoolDocument],
  )
  // The stored summary carries the bilingual task titles as front-matter;
  // parse both out once so the H1 gets the reader's language and the
  // Summary card renders only the body.
  const parsedSummary = useMemo(() => parseSummaryFrontMatter(meta.summaryMd), [meta.summaryMd])
  const spoolTitle = spoolDocument?.conversation.title.trim() ?? ''
  const derivedTitle =
    spoolDocument === null
      ? rawConversation?.title.trim() ||
        (meta.spoolFileOid == null ? view?.firstPrompt.trim() : '') ||
        'Shared session'
      : (spoolDocument.opts.redact ? redactPlainText(spoolTitle, spoolRedactList) : spoolTitle) ||
        'Shared session'
  const language = useSessionLanguage()
  const localizedTitle = resolveLocalizedTitle(parsedSummary.titles, derivedTitle, language)
  const localizedSummary = resolveLocalizedSessionSummary(
    parsedSummary.summaries,
    parsedSummary.body || null,
    language,
  )
  const fullTitle = localizedTitle.text ?? derivedTitle
  const title = compactSessionTitle(fullTitle)
  const costLabel = formatSessionCost(meta.cost)
  const spoolPrompts = useMemo(
    () => (spoolDocument === null ? [] : getSpoolPromptEntries(spoolDocument, spoolRedactList)),
    [spoolDocument, spoolRedactList],
  )
  const prompts =
    spoolDocument === null
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
  const messageCount =
    spoolDocument === null
      ? (rawConversation?.messages.length ?? 0)
      : visibleSpoolTurnCount(spoolDocument)
  const localGuidanceTurns = useMemo(
    () =>
      spoolDocument !== null
        ? getSpoolGuidanceTurns(spoolDocument, spoolRedactList)
        : rawConversation !== null
          ? getConversationGuidanceTurns(rawConversation.messages)
          : [],
    [rawConversation, spoolDocument, spoolRedactList],
  )
  const curatedGuidancePending = meta.spoolFileOid != null && spoolDocument === null
  const guidance =
    spoolDocument === null && rawConversation === null && !curatedGuidancePending
      ? (view?.guidance ?? meta.guidance ?? null)
      : null
  const guidanceCount = guidance?.turns.length ?? localGuidanceTurns.length
  const guidanceCountLabel =
    (curatedGuidancePending || !viewResolved) &&
    guidance === null &&
    localGuidanceTurns.length === 0
      ? 'Preparing guidance'
      : `${guidanceCount} human ${guidanceCount === 1 ? 'instruction' : 'instructions'}`

  useEffect(() => {
    document.title = `${normalizeTabTitle(fullTitle)} · spool.new`
  }, [fullTitle])

  useEffect(() => {
    if (
      appliedInitialRecordRef.current ||
      initialRecordIndex === null ||
      rawConversation === null
    ) {
      return
    }
    const messageId = rawConversation.recordToMessageId.get(initialRecordIndex)
    if (messageId === undefined) return
    appliedInitialRecordRef.current = true
    setTargetMessageId(messageId)
    window.requestAnimationFrame(() => listRef.current?.scrollToMessageId(messageId))
  }, [initialRecordIndex, rawConversation])

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
        focusedTurnRef.current.removeAttribute('tabindex')
      }
      focusedTurnRef.current = turn
      turn.tabIndex = -1
      turn.addEventListener(
        'blur',
        () => {
          turn.removeAttribute('tabindex')
          if (focusedTurnRef.current === turn) focusedTurnRef.current = null
        },
        { once: true },
      )
      turn.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
      turn.focus({ preventScroll: true })
    }
    focusTurn()
  }, [])

  useEffect(
    () => () => {
      if (jumpFrameRef.current !== null) window.cancelAnimationFrame(jumpFrameRef.current)
      focusedTurnRef.current?.removeAttribute('tabindex')
    },
    [],
  )

  const jumpToMessage = (messageId: number) => {
    setTargetMessageId(messageId)
    listRef.current?.scrollToMessageId(messageId)
  }

  const jumpToPrompt = (messageId: number | null, turnIndex: number | null) => {
    if (turnIndex !== null) jumpToTurn(turnIndex)
    else if (messageId !== null) jumpToMessage(messageId)
  }

  return (
    <main
      className="relative min-w-0 flex-1 bg-[var(--bg)] text-[var(--text)]"
      aria-labelledby="sw-workbench-title"
    >
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 md:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 border-b border-[var(--border)] pb-5" title={`Session ${meta.sid}`}>
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-2 font-medium text-[var(--text)]">
                <Avatar src={meta.author.avatarUrl} name={avatarName} alt="" size="sm" />
                {authorLabel(meta)}
              </span>
              <Badge variant={`source-${provider}`}>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: `var(--sp-source-${provider})` }}
                  aria-hidden="true"
                />
                {providerLabel}
              </Badge>
              <Badge data-testid="session-visibility">
                {isPublic ? (
                  <Globe2 size={12} strokeWidth={1.7} aria-hidden="true" />
                ) : isTeam ? (
                  <UsersRound size={12} strokeWidth={1.7} aria-hidden="true" />
                ) : (
                  <Link2 size={12} strokeWidth={1.7} aria-hidden="true" />
                )}
                {isPublic
                  ? 'Public'
                  : isTeam
                    ? `Team · ${meta.team?.name ?? 'members'}`
                    : 'Link-only'}
              </Badge>
              <span title={humanDateTime(visibilityTimestamp)}>
                {isPublic ? 'Published' : 'Shared'} {relativeDate(visibilityTimestamp)}
              </span>
              {costLabel && (
                <span
                  className="font-mono text-[11px] text-[var(--muted)] tabular-nums"
                  title="Estimated API cost from recorded token usage"
                >
                  {costLabel}
                </span>
              )}
            </div>
            <h1
              id="sw-workbench-title"
              lang={
                localizedTitle.language ? sessionLanguageTag(localizedTitle.language) : undefined
              }
              className="m-0 max-w-[760px] text-2xl leading-8 font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] text-[var(--text)]"
              title={fullTitle}
            >
              {title}
            </h1>
            <span className="sr-only">Session ID: {meta.sid}</span>
          </div>

          {(resumable || isPublic) && (
            <section
              className="mt-4 w-full max-w-[720px] min-w-0"
              aria-labelledby="session-actions-title"
            >
              <h2 id="session-actions-title" className="sr-only">
                Session actions
              </h2>
              <SessionActions
                sid={meta.sid}
                providerLabel={providerLabel}
                publicSession={isPublic}
                resumable={resumable}
              />
            </section>
          )}
        </header>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,720px)_280px] lg:items-start lg:gap-8">
          <div className="min-w-0">
            <SessionSummary
              markdown={localizedSummary.text}
              language={
                localizedSummary.language
                  ? sessionLanguageTag(localizedSummary.language)
                  : undefined
              }
              className="mb-6"
            />

            <section aria-labelledby="session-timeline-title">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2
                  id="session-timeline-title"
                  className="m-0 text-base font-semibold text-[var(--text)]"
                >
                  Session
                </h2>
                <span className="font-mono text-[11px] text-[var(--faint)] tabular-nums">
                  {readingMode === 'guidance'
                    ? guidanceCountLabel
                    : history.phase === 'ready'
                      ? `${messageCount} ${
                          spoolDocument === null
                            ? messageCount === 1
                              ? 'message'
                              : 'messages'
                            : messageCount === 1
                              ? 'turn'
                              : 'turns'
                        }`
                      : history.phase === 'loading' && history.source === 'publication'
                        ? 'Preparing conversation'
                        : `${history.total.toLocaleString('en-US')} records`}
                </span>
              </div>

              <Tabs
                aria-label="Session view"
                className="mb-5"
                value={readingMode}
                onValueChange={(value) =>
                  setReadingMode(value === 'guidance' ? 'guidance' : 'full')
                }
                items={[
                  {
                    value: 'full',
                    label: 'Full session',
                    id: 'session-view-full-tab',
                    ariaControls: 'session-view-full-panel',
                  },
                  {
                    value: 'guidance',
                    label: 'Human guidance',
                    id: 'session-view-guidance-tab',
                    ariaControls: 'session-view-guidance-panel',
                  },
                ]}
              />

              {readingMode === 'guidance' ? (
                <div
                  id="session-view-guidance-panel"
                  role="tabpanel"
                  aria-labelledby="session-view-guidance-tab"
                >
                  <HumanGuidanceView
                    guidance={guidance}
                    history={history}
                    localTurns={localGuidanceTurns}
                    onLoadHistory={onLoadHistory}
                    provider={provider}
                    sid={meta.sid}
                    viewResolved={viewResolved}
                  />
                </div>
              ) : (
                <div
                  id="session-view-full-panel"
                  role="tabpanel"
                  aria-labelledby="session-view-full-tab"
                  className={`min-w-0 ${
                    prompts.length > 0 ? 'lg:grid lg:grid-cols-[24px_minmax(0,1fr)] lg:gap-4' : ''
                  }`}
                >
                  {prompts.length > 0 && (
                    <nav className="relative z-30 mb-4 min-w-0 lg:mb-0" aria-label="User prompts">
                      <div className="mb-2 flex items-center justify-between gap-3 lg:hidden">
                        <h3 className="m-0 text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
                          Prompts
                        </h3>
                        <span className="font-mono text-[10px] text-[var(--faint)] tabular-nums">
                          {prompts.length}
                        </span>
                      </div>
                      <div className="sw-session-sticky lg:sticky lg:py-1">
                        <h3 className="sr-only">User prompts</h3>
                        <ol className="m-0 flex snap-x list-none gap-2 overflow-x-auto p-0 pb-2 lg:block lg:overflow-visible lg:pb-0">
                          {prompts.map((entry, index) => {
                            const active =
                              entry.turnIndex !== null
                                ? targetTurnIndex === entry.turnIndex
                                : targetMessageId === entry.messageId
                            const tooltipId = `prompt-preview-${entry.key}`
                            const showPreview = previewPromptKey === entry.key
                            return (
                              <li
                                key={entry.key}
                                className={`group relative shrink-0 snap-start lg:flex lg:h-4 lg:items-center ${showPreview ? 'z-50' : ''}`}
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
                                  className={`m-0 flex h-12 w-48 cursor-pointer items-center gap-2 rounded-md border px-3 py-0 text-left font-sans transition-colors duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:h-4 lg:w-6 lg:border-0 lg:bg-transparent lg:p-0 ${
                                    active
                                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
                                  }`}
                                  aria-label={`Prompt ${index + 1}: ${entry.excerpt}`}
                                  aria-describedby={showPreview ? tooltipId : undefined}
                                  aria-current={active ? 'location' : undefined}
                                  onClick={() => jumpToPrompt(entry.messageId, entry.turnIndex)}
                                >
                                  <span className="font-mono text-[10px] text-[var(--accent)] tabular-nums lg:hidden">
                                    {String(index + 1).padStart(2, '0')}
                                  </span>
                                  <span className="line-clamp-2 min-w-0 text-[11px] leading-4 lg:hidden">
                                    {entry.excerpt}
                                  </span>
                                  <span
                                    className={`hidden h-px transition-[width,background-color] duration-150 ease-out lg:block ${
                                      active
                                        ? 'w-6 bg-[var(--accent)]'
                                        : 'w-4 bg-[var(--border-strong)] group-focus-within:w-6 group-focus-within:bg-[var(--text)] group-hover:w-6 group-hover:bg-[var(--text)]'
                                    }`}
                                    aria-hidden="true"
                                  />
                                </button>
                                {showPreview && (
                                  <span
                                    id={tooltipId}
                                    role="tooltip"
                                    className="absolute top-[-4px] left-7 z-50 hidden max-h-72 w-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-[12px] leading-[18px] break-words whitespace-pre-wrap text-[var(--text)] shadow-[0_8px_24px_color-mix(in_srgb,var(--text)_10%,transparent)] lg:block"
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
                    {history.phase !== 'ready' && (
                      <SessionHistoryStatus history={history} onLoad={onLoadHistory} />
                    )}
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
                    ) : (rawConversation?.messages.length ?? 0) > 0 ? (
                      <div className="min-w-0">
                        <MessageList
                          ref={listRef}
                          messages={rawConversation?.messages ?? []}
                          isDark={isDark}
                          useWindowScroll
                          targetMessageId={targetMessageId}
                          showTargetHighlight={targetMessageId !== null}
                        />
                      </div>
                    ) : history.phase === 'ready' ? (
                      <p className="m-0 border-t border-[var(--border)] py-6 text-[13px] text-[var(--faint)]">
                        No renderable messages in this session.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          </div>

          <aside
            aria-label="Workspace"
            data-qualified-read-evidence
            className="sw-session-sticky min-w-0 lg:sticky"
          >
            <div>
              <h2
                id="workspace-title"
                className="m-0 border-b border-[var(--border)] py-3 text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)] uppercase"
              >
                Workspace
              </h2>
              <dl className="m-0 text-[11px]">
                <MetadataRow label="Provider">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `var(--sp-source-${provider})` }}
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
                    {history.phase === 'ready'
                      ? messageCount
                      : messageCount > 0
                        ? `${messageCount}+`
                        : '—'}
                  </span>
                </MetadataRow>
                <MetadataRow label="Records">
                  <span className="font-mono tabular-nums">{meta.count}</span>
                </MetadataRow>
                {view && (
                  <MetadataRow label="Changes">
                    <span className="font-mono tabular-nums">
                      {view.diffstat.files} {view.diffstat.files === 1 ? 'file' : 'files'}{' '}
                      <span className="font-medium text-[var(--sp-success)]">
                        +{view.diffstat.adds}
                      </span>{' '}
                      <span className="font-medium text-[var(--sp-error)]">
                        -{view.diffstat.dels}
                      </span>
                    </span>
                  </MetadataRow>
                )}
                {card && (
                  <>
                    <MetadataRow label="Remote">
                      {card.remotes.length > 0 ? (
                        <span className="flex min-w-0 flex-col gap-1">
                          {card.remotes.map((remote) => (
                            <RemoteValue key={remote} remote={remote} />
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </MetadataRow>
                    <MetadataRow label="Branch">
                      <span className="inline-flex min-w-0 items-start gap-2 font-mono [overflow-wrap:anywhere]">
                        <GitBranch
                          className="mt-0.5 shrink-0"
                          size={12}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        {card.branch ?? '(detached)'}
                      </span>
                    </MetadataRow>
                    <MetadataRow label="Head">
                      <span
                        className="inline-flex min-w-0 items-start gap-2 font-mono [overflow-wrap:anywhere]"
                        title={card.head ?? undefined}
                      >
                        <GitCommitHorizontal
                          className="mt-0.5 shrink-0"
                          size={12}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
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
                      ) : (
                        '—'
                      )}
                    </MetadataRow>
                  </>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

type GuidancePromptState =
  | { phase: 'idle'; key: string }
  | { phase: 'loading'; key: string; prompts: Map<number, string> }
  | { phase: 'ready'; key: string; prompts: Map<number, string> }
  | { phase: 'error'; key: string }

type ActiveAgentReply = {
  key: string
  turnNumber: number
  replyChars: number
  toolCalls: number | null
  replyRecords: number[] | null
  phase: 'loading' | 'ready' | 'error'
  texts: string[]
}

function formatAgentResponse(toolCalls: number | null, replyChars: number): string {
  const details = [
    toolCalls === null
      ? null
      : `${toolCalls.toLocaleString('en-US')} tool ${toolCalls === 1 ? 'call' : 'calls'}`,
    `${replyChars.toLocaleString('en-US')} ${replyChars === 1 ? 'char' : 'chars'}`,
  ].filter((part): part is string => part !== null)
  return `Agent response · ${details.join(' · ')}`
}

function HumanGuidanceView({
  guidance,
  history,
  localTurns,
  onLoadHistory,
  provider,
  sid,
  viewResolved,
}: {
  guidance: SessionGuidanceV1 | null
  history: SessionHistoryState
  localTurns: readonly LocalGuidanceTurn[]
  onLoadHistory: () => void
  provider: SessionProvider
  sid: string
  viewResolved: boolean
}) {
  const guidanceKey = useMemo(
    () =>
      guidance === null
        ? ''
        : `${sid}:${guidance.turns
            .map(
              (turn) =>
                `${turn.promptRecord}:${turn.replyRecords.join(',')}:${turn.replyChars}:${turn.toolCalls}`,
            )
            .join('|')}`,
    [guidance, sid],
  )
  const [promptRetry, setPromptRetry] = useState(0)
  const [promptState, setPromptState] = useState<GuidancePromptState>({
    phase: 'idle',
    key: guidanceKey,
  })
  const [activeReply, setActiveReply] = useState<ActiveAgentReply | null>(null)
  const [replyRetry, setReplyRetry] = useState(0)
  const replyCacheRef = useRef(new Map<string, string[]>())

  useEffect(() => {
    if (guidance === null) {
      setPromptState({ phase: 'idle', key: '' })
      return
    }
    if (guidance.turns.length === 0) {
      setPromptState({ phase: 'ready', key: guidanceKey, prompts: new Map() })
      return
    }

    const abortController = new AbortController()
    setPromptState({ phase: 'loading', key: guidanceKey, prompts: new Map() })
    void fetchRecordsByIndices(
      makeRangeFetcher(sid, abortController.signal),
      guidance.turns.map((turn) => turn.promptRecord),
      {
        onRecords: (records) => {
          const received = new Map<number, string>()
          for (const record of records) {
            const visible = extractGuidanceRecord(provider, record)
            if (visible?.role === 'user') received.set(record.i, visible.text)
          }
          if (received.size === 0) return
          setPromptState((current) => {
            if (current.key !== guidanceKey || current.phase !== 'loading') return current
            const prompts = new Map(current.prompts)
            for (const [record, text] of received) prompts.set(record, text)
            return { ...current, prompts }
          })
        },
      },
    )
      .then((records) => {
        const prompts = new Map<number, string>()
        for (const record of records) {
          const visible = extractGuidanceRecord(provider, record)
          if (visible?.role === 'user') prompts.set(record.i, visible.text)
        }
        setPromptState((current) =>
          current.key === guidanceKey ? { phase: 'ready', key: guidanceKey, prompts } : current,
        )
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return
        setPromptState((current) =>
          current.key === guidanceKey ? { phase: 'error', key: guidanceKey } : current,
        )
        void error
      })

    return () => abortController.abort()
  }, [guidance, guidanceKey, promptRetry, provider, sid])

  useEffect(() => {
    if (
      activeReply === null ||
      activeReply.replyRecords === null ||
      activeReply.phase !== 'loading'
    ) {
      return
    }

    const cached = replyCacheRef.current.get(activeReply.key)
    if (cached !== undefined) {
      setActiveReply((current) =>
        current?.key === activeReply.key ? { ...current, phase: 'ready', texts: cached } : current,
      )
      return
    }

    const abortController = new AbortController()
    void fetchRecordsByIndices(
      makeRangeFetcher(sid, abortController.signal),
      activeReply.replyRecords,
    )
      .then((records) => {
        const texts = records.flatMap((record) => {
          const visible = extractGuidanceRecord(provider, record)
          return visible?.role === 'assistant' ? [visible.text] : []
        })
        replyCacheRef.current.set(activeReply.key, texts)
        setActiveReply((current) =>
          current?.key === activeReply.key ? { ...current, phase: 'ready', texts } : current,
        )
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return
        setActiveReply((current) =>
          current?.key === activeReply.key ? { ...current, phase: 'error' } : current,
        )
        void error
      })

    return () => abortController.abort()
  }, [activeReply, provider, replyRetry, sid])

  const openIndexedReply = (turn: SessionGuidanceTurnV1, turnNumber: number) => {
    if (turn.replyRecords.length === 0) return
    const key = `${guidanceKey}:reply:${turnNumber}`
    const cached = replyCacheRef.current.get(key)
    setActiveReply({
      key,
      turnNumber,
      replyChars: turn.replyChars,
      toolCalls: turn.toolCalls,
      replyRecords: [...turn.replyRecords],
      phase: cached === undefined ? 'loading' : 'ready',
      texts: cached ?? [],
    })
  }

  const openLocalReply = (turn: LocalGuidanceTurn, turnNumber: number) => {
    if (turn.replies.length === 0) return
    setActiveReply({
      key: `local:${turnNumber}`,
      turnNumber,
      replyChars: turn.replyChars,
      toolCalls: turn.toolCalls,
      replyRecords: null,
      phase: 'ready',
      texts: turn.replies,
    })
  }

  let content
  if (guidance !== null) {
    content =
      promptState.phase === 'error' ? (
        <GuidanceLoadError onRetry={() => setPromptRetry((value) => value + 1)} />
      ) : (
        <ol
          className="m-0 flex list-none flex-col gap-4 p-0"
          aria-busy={promptState.phase !== 'ready'}
        >
          {guidance.turns.map((turn, index) => (
            <li key={turn.promptRecord}>
              <GuidanceTurnCard
                prompt={
                  promptState.phase === 'ready' || promptState.phase === 'loading'
                    ? (promptState.prompts.get(turn.promptRecord) ?? null)
                    : null
                }
                replyChars={turn.replyChars}
                toolCalls={turn.toolCalls}
                turnNumber={index + 1}
                replyAvailable={turn.replyRecords.length > 0}
                onOpenReply={() => openIndexedReply(turn, index + 1)}
              />
            </li>
          ))}
        </ol>
      )
  } else if (localTurns.length > 0) {
    content = (
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {localTurns.map((turn, index) => (
          <li key={`${index}:${turn.prompt.slice(0, 32)}`}>
            <GuidanceTurnCard
              prompt={turn.prompt}
              replyChars={turn.replyChars}
              toolCalls={turn.toolCalls}
              turnNumber={index + 1}
              replyAvailable={turn.replies.length > 0}
              onOpenReply={() => openLocalReply(turn, index + 1)}
            />
          </li>
        ))}
      </ol>
    )
  } else if (!viewResolved || history.phase === 'loading') {
    content = <GuidanceSkeleton />
  } else if (history.phase === 'idle' || history.phase === 'error') {
    content = (
      <div className="border-y border-[var(--border)] py-5">
        <p className="m-0 text-[13px] font-medium text-[var(--text)]">
          Human guidance is not indexed for this Session yet
        </p>
        <p className="mt-1 mb-4 max-w-[560px] text-[12px] leading-5 text-[var(--muted)]">
          Load the full history once to build this view in your browser.
        </p>
        <Button size="lg" variant="outline" onClick={onLoadHistory}>
          Load and build guidance
        </Button>
      </div>
    )
  } else {
    content = (
      <p className="m-0 border-y border-[var(--border)] py-6 text-[13px] text-[var(--faint)]">
        No human instructions were found in this Session.
      </p>
    )
  }

  return (
    <>
      <p className="mt-0 mb-4 max-w-[620px] text-[12px] leading-5 text-[var(--muted)]">
        Read the human instructions in full. Agent work stays compact until you open the response
        you need.
      </p>
      {content}
      <AgentReplyDialog
        activeReply={activeReply}
        onClose={() => setActiveReply(null)}
        onRetry={() => {
          setActiveReply((current) =>
            current === null ? null : { ...current, phase: 'loading', texts: [] },
          )
          setReplyRetry((value) => value + 1)
        }}
      />
    </>
  )
}

function GuidanceTurnCard({
  onOpenReply,
  prompt,
  replyAvailable,
  replyChars,
  toolCalls,
  turnNumber,
}: {
  onOpenReply: () => void
  prompt: string | null
  replyAvailable: boolean
  replyChars: number
  toolCalls: number | null
  turnNumber: number
}) {
  const responseLabel = formatAgentResponse(toolCalls, replyChars)
  return (
    <article className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
        <UserRound size={14} strokeWidth={1.7} aria-hidden="true" />
        Human instruction
        <span className="ml-auto font-mono text-[var(--faint)] tabular-nums">
          {String(turnNumber).padStart(2, '0')}
        </span>
      </div>
      <div className="min-h-20 px-4 py-4">
        {prompt === null ? (
          <div aria-label="Loading human instruction" className="animate-pulse">
            <div className="mb-2 h-3 w-5/6 rounded bg-[var(--surface2)]" />
            <div className="mb-2 h-3 w-full rounded bg-[var(--surface2)]" />
            <div className="h-3 w-3/5 rounded bg-[var(--surface2)]" />
          </div>
        ) : (
          <p className="m-0 font-mono text-[12px] leading-5 break-words whitespace-pre-wrap text-[var(--text)]">
            {prompt}
          </p>
        )}
      </div>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 border-0 border-t border-[var(--border)] bg-[var(--bg-sink)] px-4 py-2 text-left font-sans text-[12px] text-[var(--muted)] transition-colors duration-[80ms] hover:bg-[var(--surface2)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:hover:bg-[var(--bg-sink)] disabled:hover:text-[var(--muted)]"
        disabled={!replyAvailable}
        aria-label={replyAvailable ? `Open ${responseLabel}` : responseLabel}
        onClick={onOpenReply}
      >
        <Bot className="shrink-0" size={15} strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1 font-mono tabular-nums">{responseLabel}</span>
        {replyAvailable && (
          <ChevronRight className="shrink-0" size={15} strokeWidth={1.7} aria-hidden="true" />
        )}
      </button>
    </article>
  )
}

function GuidanceSkeleton() {
  return (
    <div aria-label="Preparing human guidance" aria-busy="true" className="flex flex-col gap-4">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="animate-pulse overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]"
          aria-hidden="true"
        >
          <div className="h-10 border-b border-[var(--border)] bg-[var(--surface)]" />
          <div className="space-y-2 px-4 py-5">
            <div className="h-3 w-4/5 rounded bg-[var(--surface2)]" />
            <div className="h-3 w-full rounded bg-[var(--surface2)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--surface2)]" />
          </div>
          <div className="h-11 border-t border-[var(--border)] bg-[var(--bg-sink)]" />
        </div>
      ))}
    </div>
  )
}

function GuidanceLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-y border-[var(--border)] py-5" role="alert">
      <p className="m-0 text-[13px] font-medium text-[var(--text)]">
        Human instructions did not load
      </p>
      <p className="mt-1 mb-4 text-[12px] leading-5 text-[var(--muted)]">
        The full Session is untouched. Retry the small guidance request.
      </p>
      <Button size="lg" variant="outline" onClick={onRetry}>
        Retry guidance
      </Button>
    </div>
  )
}

function AgentReplyDialog({
  activeReply,
  onClose,
  onRetry,
}: {
  activeReply: ActiveAgentReply | null
  onClose: () => void
  onRetry: () => void
}) {
  const titleId = 'agent-reply-dialog-title'
  return (
    <Dialog
      open={activeReply !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      aria-labelledby={titleId}
    >
      {activeReply !== null && (
        <div className="flex max-h-[calc(100dvh-32px)] min-h-0 flex-col">
          <header className="flex shrink-0 items-start gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="mt-0 mb-1 font-mono text-[10px] tracking-[0.08em] text-[var(--accent)] uppercase">
                Instruction {String(activeReply.turnNumber).padStart(2, '0')}
              </p>
              <h2 id={titleId} className="m-0 text-base font-semibold text-[var(--text)]">
                Agent response
              </h2>
              <p className="mt-1 mb-0 font-mono text-[11px] text-[var(--muted)] tabular-nums">
                {formatAgentResponse(activeReply.toolCalls, activeReply.replyChars).replace(
                  /^Agent response · /,
                  '',
                )}
              </p>
            </div>
            <IconButton aria-label="Close agent response" size="md" onClick={onClose}>
              <X size={16} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-5">
            {activeReply.phase === 'loading' ? (
              <div aria-label="Loading agent response" aria-busy="true" className="animate-pulse">
                <div className="mb-3 h-3 w-4/5 rounded bg-[var(--surface2)]" />
                <div className="mb-3 h-3 w-full rounded bg-[var(--surface2)]" />
                <div className="mb-3 h-3 w-2/3 rounded bg-[var(--surface2)]" />
                <div className="h-28 rounded-md bg-[var(--surface)]" />
              </div>
            ) : activeReply.phase === 'error' ? (
              <div role="alert">
                <p className="m-0 text-[13px] font-medium text-[var(--text)]">
                  This response did not load
                </p>
                <p className="mt-1 mb-4 text-[12px] leading-5 text-[var(--muted)]">
                  Retry only this Agent reply; the rest of the Session stays collapsed.
                </p>
                <Button size="lg" variant="outline" onClick={onRetry}>
                  Retry response
                </Button>
              </div>
            ) : activeReply.texts.length > 0 ? (
              <div className="flex flex-col gap-5">
                {activeReply.texts.map((text, index) => (
                  <section
                    key={`${index}:${text.slice(0, 24)}`}
                    className={index === 0 ? '' : 'border-t border-[var(--border)] pt-5'}
                    aria-label={`Agent response part ${index + 1}`}
                  >
                    <SessionMarkdown markdown={text} />
                  </section>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[13px] text-[var(--muted)]">
                This turn contains Agent activity but no prose response.
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function SessionHistoryStatus({
  history,
  onLoad,
}: {
  history: Exclude<SessionHistoryState, { phase: 'ready' }>
  onLoad: () => void
}) {
  const formattedTotal = history.total.toLocaleString('en-US')

  if (history.phase === 'idle') {
    return (
      <div className="mb-4 border-y border-[var(--border)] py-5" data-testid="session-history-idle">
        <p className="m-0 text-[13px] font-medium text-[var(--text)]">Full session history</p>
        <p className="mt-1 mb-4 max-w-[560px] text-[12px] leading-5 text-[var(--muted)]">
          Summary and workspace details are ready. Load {formattedTotal} source records when you
          want the complete conversation.
        </p>
        <Button size="lg" variant="outline" onClick={onLoad}>
          Load full session
        </Button>
      </div>
    )
  }

  if (history.phase === 'error') {
    const publication = history.source === 'publication'
    return (
      <div
        className="mb-4 border-y border-[var(--border)] py-5"
        data-testid="session-history-error"
      >
        <p className="m-0 text-[13px] font-medium text-[var(--text)]">
          {publication
            ? 'The published conversation did not load'
            : 'The remaining history did not load'}
        </p>
        <p className="mt-1 mb-4 text-[12px] leading-5 text-[var(--muted)]">
          {publication
            ? 'The curated publication remains private while unavailable. Retry without exposing its raw source records.'
            : `${history.loaded.toLocaleString('en-US')} of ${formattedTotal} records are available. Retry from where loading stopped.`}
        </p>
        <Button size="lg" variant="outline" onClick={onLoad}>
          {publication ? 'Retry published conversation' : 'Retry remaining history'}
        </Button>
      </div>
    )
  }

  if (history.source === 'publication') {
    return (
      <div
        className="mb-4 border-y border-[var(--border)] py-5"
        aria-busy="true"
        aria-live="polite"
        data-testid="session-publication-loading"
      >
        <p className="m-0 text-[13px] font-medium text-[var(--text)]">
          Preparing the published session
        </p>
        <p className="mt-1 mb-4 text-[12px] leading-5 text-[var(--muted)]">
          Summary and workspace details are ready while the curated conversation loads.
        </p>
        <HistorySkeleton />
      </div>
    )
  }

  const percentage =
    history.total === 0 ? 100 : Math.min(100, Math.round((history.loaded / history.total) * 100))
  return (
    <div
      className="mb-4 border-y border-[var(--border)] py-5"
      aria-live="polite"
      data-testid="session-history-loading"
    >
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="m-0 text-[13px] font-medium text-[var(--text)]">Loading session history</p>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)] tabular-nums">
          {history.loaded.toLocaleString('en-US')} / {formattedTotal}
        </span>
      </div>
      <div
        className="h-1 overflow-hidden rounded bg-[var(--surface2)]"
        role="progressbar"
        aria-label="Session records loaded"
        aria-valuemin={0}
        aria-valuemax={history.total}
        aria-valuenow={history.loaded}
      >
        <span
          className="block h-full bg-[var(--accent)] transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {history.loaded === 0 && <HistorySkeleton />}
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      <div className="h-3 w-2/5 rounded bg-[var(--surface2)]" />
      <div className="h-3 w-full rounded bg-[var(--surface)]" />
      <div className="h-3 w-4/5 rounded bg-[var(--surface)]" />
    </div>
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

function RemoteValue({ remote }: { remote: string }) {
  const href = repositoryUrlForRemote(remote)
  if (!href) {
    return (
      <span className="font-mono [overflow-wrap:anywhere]" title={remote}>
        {remote}
      </span>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono [overflow-wrap:anywhere] text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      title={`Open ${remote}`}
    >
      {remote}
    </a>
  )
}
