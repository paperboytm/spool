// PROTOTYPE — throwaway (see NOTES.md in this directory).
//
// Variant A — "Document". The share page as a published article/gist:
// one centered reading column, the session title as an H1, the author
// note as a lede, machine evidence compressed into a slim facts strip.
// The conversation IS the page body. Diffs open in a right-hand slide
// -over drawer so reading flow never leaves the column. Primary
// affordance: reading.

import { useRef, useState } from 'react'
import { MessageList, type MessageListHandle } from '@spool-lab/session-view'

import { humanDate } from '../../../lib/dates'
import { authorLabel } from '../../../lib/session-page'
import { DiffPane } from '../diff-pane'
import type { VariantProps } from './variant-props'

export function VariantDoc({ meta, view, provider, conversation, isDark, fetchRange }: VariantProps) {
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<MessageListHandle>(null)

  const resume = `spool resume ${meta.sid}`
  const copy = () => {
    void navigator.clipboard.writeText(resume)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <main className="swpd-main">
      <style>{CSS}</style>

      <article className="swpd-article">
        <h1 className="swpd-title">{conversation.title || 'A shared session'}</h1>

        <div className="swpd-byline">
          {meta.author.avatarUrl
            ? <img className="swpd-avatar" src={meta.author.avatarUrl} alt="" />
            : <span className="swpd-avatar swpd-avatar-fallback">{authorLabel(meta)[1]?.toUpperCase() ?? 'S'}</span>}
          <span className="swpd-who">{authorLabel(meta)}</span>
          <span className="swpd-sep">·</span>
          <span>{humanDate(meta.updatedAt)}</span>
          <span className="swpd-sep">·</span>
          <span className="swpd-mono">{provider === 'claude' ? 'claude code' : 'codex cli'}</span>
          <span className="swpd-sep">·</span>
          <span className="swpd-mono">{meta.count} records</span>
        </div>

        {meta.noteMd && <p className="swpd-lede">{meta.noteMd}</p>}

        {view && (
          <div className="swpd-facts">
            <span className="swpd-mono swpd-diffstat">
              {view.diffstat.files} {view.diffstat.files === 1 ? 'file' : 'files'}{' '}
              <b className="swpd-adds">+{view.diffstat.adds}</b>{' '}
              <b className="swpd-dels">-{view.diffstat.dels}</b>
            </span>
            {view.files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="swpd-file-chip swpd-mono"
                onClick={() => setOpenFile(file.path)}
                title="Open the diff"
              >
                {file.path.split('/').pop()}
                <span className="swpd-chip-stat">
                  <span className="swpd-adds">+{file.adds}</span> <span className="swpd-dels">-{file.dels}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="swpd-convo">
          {conversation.messages.length > 0
            ? (
              <MessageList
                ref={listRef}
                messages={conversation.messages}
                isDark={isDark}
              />
            )
            : <p className="swpd-empty">No renderable messages in this session.</p>}
        </div>
      </article>

      <div className="swpd-resume">
        <code className="swpd-mono">{resume}</code>
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>

      {openFile && view && (
        <>
          <div className="swpd-drawer-backdrop" onClick={() => setOpenFile(null)} />
          <aside className="swpd-drawer">
            <header>
              <span className="swpd-mono swpd-drawer-path">{openFile}</span>
              <button type="button" aria-label="Close diff" onClick={() => setOpenFile(null)}>×</button>
            </header>
            <div className="swpd-drawer-body">
              <DiffPane
                view={view}
                provider={provider}
                fetchRange={fetchRange}
                openFile={openFile}
                highlightRecord={null}
                onSelectFile={setOpenFile}
                onJumpToRecord={() => setOpenFile(null)}
              />
            </div>
          </aside>
        </>
      )}
    </main>
  )
}

const CSS = `
.swpd-main { flex: 1 1 auto; width: 100%; }
.swpd-article { max-width: 720px; margin: 0 auto; padding: 40px 20px 96px; }
.swpd-mono { font-family: 'Geist Mono', ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }

.swpd-title {
  margin: 0 0 12px;
  font-size: 28px; font-weight: 650; line-height: 1.25; letter-spacing: -0.02em;
  color: var(--text);
}
.swpd-byline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13px; color: var(--muted); }
.swpd-byline .swpd-who { color: var(--text); font-weight: 500; }
.swpd-sep { color: var(--faint); }
.swpd-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.swpd-avatar-fallback {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600;
}

.swpd-lede {
  margin: 24px 0; padding-left: 16px; border-left: 3px solid var(--accent);
  font-size: 16px; line-height: 1.7; color: var(--text); white-space: pre-wrap;
}

.swpd-facts {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 12px 0; margin-bottom: 28px;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  font-size: 12px; color: var(--muted);
}
.swpd-diffstat { margin-right: 4px; }
.swpd-adds { color: var(--ok); font-weight: 500; }
.swpd-dels { color: var(--err); font-weight: 500; }
.swpd-file-chip {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--card-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 3px 8px; font-size: 11px; color: var(--text); cursor: pointer;
}
.swpd-file-chip:hover { border-color: var(--accent); color: var(--accent); }
.swpd-chip-stat { font-size: 10px; }

.swpd-convo { height: 74vh; min-height: 360px; display: flex; flex-direction: column; }
.swpd-empty { color: var(--faint); font-size: 13px; }

.swpd-resume {
  position: fixed; right: 20px; bottom: 20px; z-index: 40;
  display: flex; align-items: center; gap: 8px;
  background: var(--card); border: 1px solid var(--accent-line); border-radius: 8px;
  padding: 8px 12px; box-shadow: var(--shadow-card);
}
.swpd-resume code { font-size: 12px; color: var(--text); }
.swpd-resume button {
  border: 1px solid var(--accent); color: var(--accent); background: none;
  border-radius: 6px; font-size: 11px; font-weight: 500; padding: 4px 12px; cursor: pointer;
}
.swpd-resume button:hover { background: var(--accent); color: var(--accent-ink); }

.swpd-drawer-backdrop { position: fixed; inset: 0; z-index: 45; background: rgba(20, 20, 16, 0.28); }
.swpd-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 46;
  width: min(620px, 92vw); display: flex; flex-direction: column;
  background: var(--bg); border-left: 1px solid var(--border);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.18);
}
.swpd-drawer > header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.swpd-drawer-path { font-size: 12px; color: var(--text); overflow-wrap: anywhere; }
.swpd-drawer > header button {
  background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; line-height: 1;
}
.swpd-drawer > header button:hover { color: var(--text); }
.swpd-drawer-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.swpd-drawer-body .sw-session-diff { border: 0; box-shadow: none; background: none; padding: 0; }
`
