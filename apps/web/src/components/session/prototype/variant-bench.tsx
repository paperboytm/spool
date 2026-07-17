// PROTOTYPE — throwaway (see NOTES.md in this directory).
//
// Variant B — "Workbench". The share page as a tool, not a document:
// full-width three-pane IDE layout. A dense toolbar carries identity +
// diffstat + the resume command; a left rail holds note / prompts /
// files for navigation; the conversation fills the center; selecting a
// file opens the diff as a persistent right pane. Primary affordance:
// navigating and inspecting.

import { useRef, useState } from 'react'
import { MessageList, type MessageListHandle } from '@spool-lab/session-view'

import { relativeDate } from '../../../lib/dates'
import { authorLabel, parseWorkspaceCard } from '../../../lib/session-page'
import { DiffPane } from '../diff-pane'
import type { VariantProps } from './variant-props'

export function VariantBench({ meta, view, provider, conversation, isDark, fetchRange }: VariantProps) {
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<MessageListHandle>(null)

  const card = parseWorkspaceCard(meta.cardJson)
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
    listRef.current?.scrollToMessageId(messageId)
  }

  return (
    <main className="swpb-main">
      <style>{CSS}</style>

      <div className="swpb-toolbar">
        <span className="swpb-provider">
          <span className="swpb-provider-dot" data-provider={provider} />
          {provider === 'claude' ? 'claude code' : 'codex cli'}
        </span>
        <span className="swpb-mono swpb-sid" title={meta.sid}>{meta.sid}</span>
        {view && (
          <span className="swpb-mono swpb-diffstat">
            {view.diffstat.files} files <b className="swpb-adds">+{view.diffstat.adds}</b>{' '}
            <b className="swpb-dels">-{view.diffstat.dels}</b>
          </span>
        )}
        <span className="swpb-spacer" />
        <span className="swpb-resume">
          <code className="swpb-mono">{resume}</code>
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </span>
        <span className="swpb-author">
          {authorLabel(meta)} · {relativeDate(meta.updatedAt)}
        </span>
      </div>

      <div className="swpb-body">
        <nav className="swpb-rail">
          {meta.noteMd && (
            <section>
              <span className="swpb-label">Note</span>
              <p className="swpb-note">{meta.noteMd}</p>
            </section>
          )}

          {view && view.outline.length > 0 && (
            <section>
              <span className="swpb-label">Prompts</span>
              {view.outline.map((entry) => (
                <button
                  key={entry.i}
                  type="button"
                  className="swpb-rail-row"
                  onClick={() => jumpToRecord(entry.i)}
                >
                  <span className="swpb-mono swpb-idx">#{entry.i}</span>
                  <span className="swpb-excerpt">{entry.excerpt.split('\n', 1)[0]}</span>
                </button>
              ))}
            </section>
          )}

          {view && view.files.length > 0 && (
            <section>
              <span className="swpb-label">Files</span>
              {view.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`swpb-rail-row swpb-file${openFile === file.path ? ' active' : ''}`}
                  onClick={() => setOpenFile(openFile === file.path ? null : file.path)}
                >
                  <span className="swpb-mono swpb-path">{file.path}</span>
                  <span className="swpb-mono swpb-stat">
                    <span className="swpb-adds">+{file.adds}</span> <span className="swpb-dels">-{file.dels}</span>
                  </span>
                </button>
              ))}
            </section>
          )}

          {card && (
            <section className="swpb-workspace">
              <span className="swpb-label">Workspace</span>
              <span className="swpb-mono swpb-fact">{card.remotes[0]}</span>
              <span className="swpb-mono swpb-fact">
                {card.branch ?? '(detached)'} @ {card.head ? card.head.slice(0, 7) : '?'}
              </span>
            </section>
          )}
        </nav>

        <section className="swpb-convo">
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
            : <p className="swpb-empty">No renderable messages in this session.</p>}
        </section>

        {openFile && view && (
          <aside className="swpb-diff">
            <header>
              <span className="swpb-mono swpb-diff-path">{openFile}</span>
              <button type="button" aria-label="Close diff" onClick={() => setOpenFile(null)}>×</button>
            </header>
            <div className="swpb-diff-body">
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
          </aside>
        )}
      </div>
    </main>
  )
}

const CSS = `
.swpb-main { flex: 1 1 auto; width: 100%; display: flex; flex-direction: column; }
.swpb-mono { font-family: 'Geist Mono', ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }

.swpb-toolbar {
  display: flex; align-items: center; gap: 16px;
  padding: 8px 16px; border-bottom: 1px solid var(--border);
  font-size: 12px; color: var(--muted); background: var(--bg);
}
.swpb-provider { display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-weight: 500; }
.swpb-provider-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--src-claude); }
.swpb-provider-dot[data-provider='codex'] { background: var(--src-chatgpt); }
.swpb-sid { font-size: 11px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swpb-diffstat { font-size: 11px; }
.swpb-adds { color: var(--ok); font-weight: 500; }
.swpb-dels { color: var(--err); font-weight: 500; }
.swpb-spacer { flex: 1; }
.swpb-resume { display: inline-flex; align-items: center; gap: 6px; }
.swpb-resume code {
  font-size: 11px; color: var(--text);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
  border-radius: 6px; padding: 3px 8px;
}
.swpb-resume button {
  border: 1px solid var(--accent); color: var(--accent); background: none;
  border-radius: 6px; font-size: 11px; padding: 2px 10px; cursor: pointer;
}
.swpb-resume button:hover { background: var(--accent); color: var(--accent-ink); }
.swpb-author { color: var(--muted); }

.swpb-body {
  display: flex; align-items: stretch;
  height: calc(100vh - 180px); min-height: 480px;
}

.swpb-rail {
  width: 280px; flex: none; overflow-y: auto;
  border-right: 1px solid var(--border); background: var(--bg-sink);
  padding: 16px 12px; display: flex; flex-direction: column; gap: 20px;
}
.swpb-label {
  display: block; font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 6px;
}
.swpb-note { margin: 0; font-size: 12px; line-height: 1.55; color: var(--text); }
.swpb-rail-row {
  display: flex; gap: 8px; width: 100%; text-align: left;
  background: none; border: 0; border-radius: 6px; padding: 4px 6px;
  font-size: 12px; color: var(--muted); cursor: pointer;
}
.swpb-rail-row:hover { background: var(--card); color: var(--text); }
.swpb-idx { color: var(--accent); font-size: 11px; flex: none; }
.swpb-excerpt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swpb-file { justify-content: space-between; }
.swpb-file.active { background: var(--accent-soft); color: var(--text); }
.swpb-path { font-size: 11px; overflow-wrap: anywhere; text-align: left; }
.swpb-stat { font-size: 10px; flex: none; }
.swpb-workspace { margin-top: auto; }
.swpb-fact { display: block; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }

.swpb-convo { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
.swpb-empty { color: var(--faint); font-size: 13px; padding: 24px; }

.swpb-diff {
  width: 44%; max-width: 640px; flex: none;
  border-left: 1px solid var(--border); display: flex; flex-direction: column;
  background: var(--bg);
}
.swpb-diff > header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
}
.swpb-diff-path { font-size: 11px; color: var(--text); overflow-wrap: anywhere; }
.swpb-diff > header button {
  background: none; border: 0; color: var(--muted); font-size: 16px; cursor: pointer; line-height: 1;
}
.swpb-diff > header button:hover { color: var(--text); }
.swpb-diff-body { flex: 1; overflow-y: auto; padding: 8px 12px; }
.swpb-diff-body .sw-session-diff { border: 0; box-shadow: none; background: none; padding: 0; }
/* The rail is the only file selector in this layout — hide DiffPane's
 * built-in tab strip so files aren't listed twice. */
.swpb-diff-body .diff-files { display: none; }

@media (max-width: 900px) {
  .swpb-rail { display: none; }
  .swpb-diff { position: fixed; inset: 60px 0 0 auto; width: 92vw; z-index: 46; box-shadow: -12px 0 40px rgba(0,0,0,0.18); }
}
`
