import {
  SESSION_PROVIDER_LABELS,
  isResumableSessionProvider,
  parseSummaryFrontMatter,
  type SessionProvider,
  type SessionViewV1,
} from '@spool-lab/session-kit'
import {
  MessageList,
  type ConversationMessage,
  type MessageListHandle,
} from '@spool-lab/session-view'
import { Avatar, Badge } from '@spool-lab/ui'
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
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  Link2,
  MessageSquareText,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { humanDateTime, relativeDate } from '../../lib/dates'
import type { HubSessionMeta } from '../../lib/hub-api'
import type { ParsedConversation } from '../../lib/session-messages'
import { authorLabel, parseWorkspaceCard, repositoryUrlForRemote } from '../../lib/session-page'
import { formatSessionCost, useLocalizedSessionTitle } from '../../lib/session-title'
import { ResumeMenu } from './resume-menu'
import { SessionSummary } from './session-summary'

interface Props {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  provider: SessionProvider
  conversation: ParsedConversation
  isDark: boolean
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
const MAX_SESSION_TITLE_LENGTH = 96

/** The public-session table of contents is a projection of authored prompts only. */
export function getUserPromptEntries(messages: readonly ConversationMessage[]): UserPromptEntry[] {
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

function formatObserved(observed: string): string {
  const timestamp = Date.parse(observed)
  return Number.isFinite(timestamp) ? humanDateTime(timestamp) : observed
}

export function SessionWorkbench({
  meta,
  view,
  provider,
  conversation,
  isDark,
  initialRecordIndex,
  spoolDocument,
}: Props) {
  const initialMessageId =
    initialRecordIndex === null
      ? null
      : (conversation.recordToMessageId.get(initialRecordIndex) ?? null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(initialMessageId)
  const [targetTurnIndex, setTargetTurnIndex] = useState<number | null>(null)
  const [previewPromptKey, setPreviewPromptKey] = useState<string | null>(null)
  const listRef = useRef<MessageListHandle>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const focusedTurnRef = useRef<HTMLElement | null>(null)
  const jumpFrameRef = useRef<number | null>(null)

  const card = parseWorkspaceCard(meta.cardJson)
  const resumable = isResumableSessionProvider(provider)
  const providerLabel = SESSION_PROVIDER_LABELS[provider]
  const isPublic = meta.visibility === 'public'
  const isTeam = meta.visibility === 'team'
  const visibilityTimestamp = isPublic ? meta.createdAt : meta.updatedAt
  const avatarName = meta.author.displayName ?? meta.author.handle ?? 'Spool author'
  const rawPrompts = useMemo(
    () => getUserPromptEntries(conversation.messages),
    [conversation.messages],
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
      ? conversation.title.trim() || 'Shared session'
      : (spoolDocument.opts.redact ? redactPlainText(spoolTitle, spoolRedactList) : spoolTitle) ||
        'Shared session'
  const fullTitle = useLocalizedSessionTitle(parsedSummary.titles, derivedTitle)
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
    spoolDocument === null ? conversation.messages.length : visibleSpoolTurnCount(spoolDocument)

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
              className="m-0 max-w-[760px] text-2xl leading-8 font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] text-[var(--text)]"
              title={fullTitle}
            >
              {title}
            </h1>
            <span className="sr-only">Session ID: {meta.sid}</span>
          </div>

          {resumable && (
            <section
              className="mt-4 w-full max-w-[720px] min-w-0"
              aria-labelledby="resume-session-title"
            >
              <h2 id="resume-session-title" className="sr-only">
                Resume in {providerLabel}
              </h2>
              <ResumeMenu sid={meta.sid} providerLabel={providerLabel} />
            </section>
          )}
        </header>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,720px)_280px] lg:items-start lg:gap-8">
          <div className="min-w-0">
            <SessionSummary markdown={parsedSummary.body || null} className="mb-6" />

            <section aria-labelledby="session-timeline-title">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2
                  id="session-timeline-title"
                  className="m-0 text-base font-semibold text-[var(--text)]"
                >
                  Session
                </h2>
                <span className="font-mono text-[11px] text-[var(--faint)] tabular-nums">
                  {messageCount}{' '}
                  {spoolDocument === null
                    ? messageCount === 1
                      ? 'message'
                      : 'messages'
                    : messageCount === 1
                      ? 'turn'
                      : 'turns'}
                </span>
              </div>

              <div className="min-w-0 lg:grid lg:grid-cols-[24px_minmax(0,1fr)] lg:gap-4">
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
                    <div className="min-w-0">
                      <MessageList
                        ref={listRef}
                        messages={conversation.messages}
                        isDark={isDark}
                        useWindowScroll
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
