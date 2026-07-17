// PROTOTYPE — throwaway (see NOTES.md in this directory).
//
// Variant C — "Cover card". The share page as a landing: a full-height
// hero answers "what is this, is it worth my time" with the author, the
// note as a pull-quote, a stat row, and the resume command as the
// primary CTA. The conversation and the changes live below the fold as
// two labelled sections. Primary affordance: the decision to engage.

import { useRef, useState } from 'react'
import { MessageList, type MessageListHandle } from '@spool-lab/session-view'

import { humanDate } from '../../../lib/dates'
import { authorLabel } from '../../../lib/session-page'
import { DiffPane } from '../diff-pane'
import type { VariantProps } from './variant-props'

export function VariantCover({ meta, view, provider, conversation, isDark, fetchRange }: VariantProps) {
  const [openFile, setOpenFile] = useState<string | null>(view?.files[0]?.path ?? null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<MessageListHandle>(null)
  const convoRef = useRef<HTMLElement>(null)
  const changesRef = useRef<HTMLElement>(null)

  const resume = `spool resume ${meta.sid}`
  const copy = () => {
    void navigator.clipboard.writeText(resume)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const jumpToRecord = (index: number) => {
    const messageId = conversation.recordToMessageId.get(index)
    if (messageId === undefined) return
    setTargetMessageId(messageId)
    convoRef.current?.scrollIntoView({ behavior: 'smooth' })
    listRef.current?.scrollToMessageId(messageId)
  }

  return (
    <main className="swpc-main">
      <style>{CSS}</style>

      <section className="swpc-hero">
        <span className="swpc-avatar">
          {meta.author.avatarUrl
            ? <img src={meta.author.avatarUrl} alt="" />
            : <span>{authorLabel(meta)[1]?.toUpperCase() ?? 'S'}</span>}
        </span>

        <p className="swpc-eyebrow">
          <b>{authorLabel(meta)}</b> shared a {provider === 'claude' ? 'Claude Code' : 'Codex CLI'} session
          {' · '}{humanDate(meta.updatedAt)}
        </p>

        <h1 className="swpc-title">{conversation.title || 'A shared session'}</h1>

        {meta.noteMd && <p className="swpc-quote">{meta.noteMd}</p>}

        <div className="swpc-stats">
          <span className="swpc-stat">
            <b className="swpc-mono">{meta.count}</b>
            <span>records</span>
          </span>
          {view && (
            <>
              <span className="swpc-stat">
                <b className="swpc-mono">{view.diffstat.files}</b>
                <span>{view.diffstat.files === 1 ? 'file changed' : 'files changed'}</span>
              </span>
              <span className="swpc-stat">
                <b className="swpc-mono"><i className="swpc-adds">+{view.diffstat.adds}</i> <i className="swpc-dels">-{view.diffstat.dels}</i></b>
                <span>lines</span>
              </span>
            </>
          )}
        </div>

        <div className="swpc-resume">
          <code className="swpc-mono">{resume}</code>
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>

        <div className="swpc-actions">
          <button
            type="button"
            className="swpc-primary"
            onClick={() => convoRef.current?.scrollIntoView({ behavior: 'smooth' })}
          >
            Read the conversation ↓
          </button>
          {view && view.files.length > 0 && (
            <button
              type="button"
              className="swpc-secondary"
              onClick={() => changesRef.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              View the changes
            </button>
          )}
        </div>
      </section>

      <section ref={convoRef} className="swpc-section">
        <span className="swpc-label">Conversation</span>
        <div className="swpc-convo">
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
            : <p className="swpc-empty">No renderable messages in this session.</p>}
        </div>
      </section>

      {view && view.files.length > 0 && (
        <section ref={changesRef} className="swpc-section">
          <span className="swpc-label">Changes</span>
          <div className="swpc-changes">
            <DiffPane
              view={view}
              provider={provider}
              fetchRange={fetchRange}
              openFile={openFile}
              highlightRecord={null}
              onSelectFile={setOpenFile}
              onJumpToRecord={jumpToRecord}
            />
          </div>
        </section>
      )}
    </main>
  )
}

const CSS = `
.swpc-main { flex: 1 1 auto; width: 100%; }
.swpc-mono { font-family: 'Geist Mono', ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; font-style: normal; }

.swpc-hero {
  min-height: calc(100vh - 160px);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 20px; padding: 48px 20px; text-align: center;
}
.swpc-avatar { width: 56px; height: 56px; border-radius: 50%; overflow: hidden; display: inline-flex; }
.swpc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.swpc-avatar > span {
  width: 100%; height: 100%; display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-soft); color: var(--accent); font-size: 22px; font-weight: 600;
}
.swpc-eyebrow { margin: 0; font-size: 13px; color: var(--muted); }
.swpc-eyebrow b { color: var(--text); font-weight: 500; }
.swpc-title {
  margin: 0; max-width: 26ch;
  font-size: 34px; font-weight: 650; line-height: 1.2; letter-spacing: -0.02em;
  color: var(--text);
}
.swpc-quote {
  margin: 0; max-width: 62ch;
  font-size: 15px; line-height: 1.65; color: var(--muted); white-space: pre-wrap;
}

.swpc-stats { display: flex; gap: 32px; margin-top: 4px; }
.swpc-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.swpc-stat > b { font-size: 20px; font-weight: 600; color: var(--text); }
.swpc-stat > span { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.swpc-adds { color: var(--ok); font-style: normal; }
.swpc-dels { color: var(--err); font-style: normal; }

.swpc-resume {
  display: flex; align-items: center; gap: 8px;
  background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 8px;
  padding: 10px 14px; margin-top: 4px;
}
.swpc-resume code { font-size: 13px; color: var(--text); }
.swpc-resume button {
  border: 1px solid var(--accent); color: var(--accent); background: none;
  border-radius: 6px; font-size: 11px; font-weight: 500; padding: 4px 12px; cursor: pointer;
}
.swpc-resume button:hover { background: var(--accent); color: var(--accent-ink); }

.swpc-actions { display: flex; gap: 12px; }
.swpc-primary {
  background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
  border-radius: 6px; font-size: 13px; font-weight: 500; padding: 8px 16px; cursor: pointer;
}
.swpc-primary:hover { filter: brightness(1.06); }
.swpc-secondary {
  background: none; color: var(--text); border: 1px solid var(--border-strong);
  border-radius: 6px; font-size: 13px; font-weight: 500; padding: 8px 16px; cursor: pointer;
}
.swpc-secondary:hover { border-color: var(--accent); color: var(--accent); }

.swpc-section { max-width: 960px; margin: 0 auto; padding: 32px 20px; scroll-margin-top: 16px; }
.swpc-label {
  display: block; font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 8px;
}
.swpc-convo {
  height: 78vh; min-height: 400px; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: var(--shadow-card); overflow: hidden; padding: 8px 0;
}
.swpc-empty { color: var(--faint); font-size: 13px; padding: 24px; }
.swpc-changes .sw-session-diff { background: var(--card); }
`
