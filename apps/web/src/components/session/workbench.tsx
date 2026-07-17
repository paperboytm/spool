import { useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { MessageList, type MessageListHandle } from '@spool-lab/session-view'
import type { SessionViewV1 } from '@spool-lab/session-kit'

import { relativeDate } from '../../lib/dates'
import type { HubSessionMeta, RangeFetcher } from '../../lib/hub-api'
import { authorLabel, parseWorkspaceCard, resumeCommandFor } from '../../lib/session-page'
import type { ParsedConversation } from '../../lib/session-messages'
import { DiffPane } from './diff-pane'
import { SessionNote } from './session-note'
import './workbench.css'

interface Props {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  provider: 'claude' | 'codex'
  conversation: ParsedConversation
  isDark: boolean
  fetchRange: RangeFetcher
  initialRecordIndex: number | null
}

export function SessionWorkbench({
  meta,
  view,
  provider,
  conversation,
  isDark,
  fetchRange,
  initialRecordIndex,
}: Props) {
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(() =>
    initialRecordIndex === null
      ? null
      : conversation.recordToMessageId.get(initialRecordIndex) ?? null,
  )
  const [highlightRecord, setHighlightRecord] = useState<number | null>(initialRecordIndex)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<MessageListHandle>(null)

  const card = parseWorkspaceCard(meta.cardJson)
  const resume = resumeCommandFor(meta.sid)
  const title = conversation.title.trim() || 'Shared session'
  const providerLabel = provider === 'claude' ? 'Claude Code' : 'Codex CLI'

  const copy = () => {
    void navigator.clipboard.writeText(resume)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const jumpToRecord = (index: number) => {
    setHighlightRecord(index)
    const messageId = conversation.recordToMessageId.get(index)
    if (messageId === undefined) return
    setTargetMessageId(messageId)
    listRef.current?.scrollToMessageId(messageId)
  }

  return (
    <main className="sw-workbench" aria-labelledby="sw-workbench-title">
      <header className="sw-workbench-header" title={`Session ${meta.sid}`}>
        <div className="sw-workbench-heading">
          <h1 id="sw-workbench-title" className="sw-workbench-title">{title}</h1>
          <ul className="sw-workbench-meta" aria-label="Session details">
            <li>{authorLabel(meta)}</li>
            <li className="sw-workbench-provider">
              <span
                className="sw-workbench-provider-dot"
                data-provider={provider}
                aria-hidden="true"
              />
              {providerLabel}
            </li>
            <li>{relativeDate(meta.updatedAt)}</li>
            <li className="sw-workbench-mono">{meta.count} records</li>
            {view && (
              <li className="sw-workbench-mono sw-workbench-diffstat">
                {view.diffstat.files} files{' '}
                <span className="sw-workbench-adds">+{view.diffstat.adds}</span>{' '}
                <span className="sw-workbench-dels">-{view.diffstat.dels}</span>
              </li>
            )}
          </ul>
          <span className="sw-workbench-visually-hidden">Session ID: {meta.sid}</span>
        </div>

        <button
          type="button"
          className="sw-workbench-copy"
          title={resume}
          onClick={copy}
        >
          {copied
            ? <Check size={14} strokeWidth={1.8} aria-hidden="true" />
            : <Copy size={14} strokeWidth={1.8} aria-hidden="true" />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy resume command'}</span>
        </button>
      </header>

      {meta.noteMd?.trim() && (
        <div className="sw-workbench-note">
          <SessionNote markdown={meta.noteMd} />
        </div>
      )}

      <div className="sw-workbench-body">
        <nav className="sw-workbench-navigation" aria-label="Session navigation">
          {view && view.outline.length > 0 && (
            <section className="sw-workbench-navigation-section">
              <h2 className="sw-workbench-label">Prompts</h2>
              <div className="sw-workbench-navigation-list">
                {view.outline.map((entry) => (
                  <button
                    key={entry.i}
                    type="button"
                    className="sw-workbench-navigation-row"
                    onClick={() => jumpToRecord(entry.i)}
                  >
                    <span className="sw-workbench-mono sw-workbench-record-index">#{entry.i}</span>
                    <span className="sw-workbench-excerpt">{entry.excerpt.split('\n', 1)[0]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {view && view.files.length > 0 && (
            <section className="sw-workbench-navigation-section">
              <h2 className="sw-workbench-label">Files</h2>
              <div className="sw-workbench-navigation-list">
                {view.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    aria-pressed={openFile === file.path}
                    className={`sw-workbench-navigation-row sw-workbench-file${
                      openFile === file.path ? ' is-active' : ''
                    }`}
                    onClick={() => setOpenFile(openFile === file.path ? null : file.path)}
                  >
                    <span className="sw-workbench-mono sw-workbench-path" title={file.path}>
                      {file.path}
                    </span>
                    <span className="sw-workbench-mono sw-workbench-file-stat">
                      <span className="sw-workbench-adds">+{file.adds}</span>{' '}
                      <span className="sw-workbench-dels">-{file.dels}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {card && (
            <section className="sw-workbench-navigation-section sw-workbench-workspace">
              <h2 className="sw-workbench-label">Workspace</h2>
              {card.remotes[0] && (
                <span className="sw-workbench-mono sw-workbench-workspace-fact" title={card.remotes[0]}>
                  {card.remotes[0]}
                </span>
              )}
              <span className="sw-workbench-mono sw-workbench-workspace-fact">
                {card.branch ?? '(detached)'} @ {card.head ? card.head.slice(0, 7) : '?'}
              </span>
            </section>
          )}
        </nav>

        <section className="sw-workbench-conversation" aria-label="Conversation">
          <div className="sw-workbench-conversation-inner">
            {conversation.messages.length > 0
              ? (
                <MessageList
                  ref={listRef}
                  messages={conversation.messages}
                  isDark={isDark}
                  targetMessageId={targetMessageId}
                  showTargetHighlight={targetMessageId !== null}
                />
              )
              : <p className="sw-workbench-empty">No renderable messages in this session.</p>}
          </div>
        </section>

        {openFile && view && (
          <aside className="sw-workbench-diff" aria-label="File diff">
            <header className="sw-workbench-diff-header">
              <span className="sw-workbench-mono sw-workbench-diff-path" title={openFile}>
                {openFile}
              </span>
              <button
                type="button"
                className="sw-workbench-close-diff"
                aria-label="Close diff"
                onClick={() => setOpenFile(null)}
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </header>
            <div className="sw-workbench-diff-body">
              <DiffPane
                view={view}
                provider={provider}
                fetchRange={fetchRange}
                openFile={openFile}
                highlightRecord={highlightRecord}
                onSelectFile={setOpenFile}
                onJumpToRecord={jumpToRecord}
              />
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}
