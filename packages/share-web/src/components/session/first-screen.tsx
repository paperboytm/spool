// Layer 1 (design §5): answers "what is this, is it worth my time".
// The author's subjective note and the machine evidence are separate
// zones on purpose — the note never overrides the evidence (§3.2).

import type { SessionViewV1 } from '@spool-lab/session-kit'

import { relativeDate } from '../../lib/dates'
import type { HubSessionMeta } from '../../lib/hub-api'
import {
  authorLabel,
  noteDisplayFor,
  parseLineage,
  parseWorkspaceCard,
  resumeCommandFor,
} from '../../lib/session-page'

interface Props {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  onOpenFile: (path: string) => void
  onJumpToRecord: (index: number) => void
}

export function FirstScreen({ meta, view, onOpenFile, onJumpToRecord }: Props) {
  const note = noteDisplayFor(meta.noteMd, view)
  const card = parseWorkspaceCard(meta.cardJson)
  const lineage = parseLineage(meta.lineageJson)
  const resumeCommand = resumeCommandFor(meta.sid)

  return (
    <section className="sw-session-first">
      <header className="sw-session-byline">
        {meta.author.avatarUrl
          ? <img className="avatar" src={meta.author.avatarUrl} alt="" width={20} height={20} />
          : <span className="avatar fallback" aria-hidden="true">{(authorLabel(meta)[1] ?? 's').toUpperCase()}</span>}
        <span className="who">{authorLabel(meta)}</span>
        <span className="dot">·</span>
        <span className="when">shared {relativeDate(meta.updatedAt)}</span>
        <span className="dot">·</span>
        <span className="sw-session-mono count">{meta.count} records</span>
        {lineage && (
          <>
            <span className="dot">·</span>
            <span className="lineage">
              fork of{' '}
              {lineage.url
                ? <a href={lineage.url}>{shortSid(lineage.sid)}@{lineage.position}</a>
                : <span className="sw-session-mono">{shortSid(lineage.sid)}@{lineage.position}</span>}
            </span>
          </>
        )}
      </header>

      <div className="sw-session-note-zone">
        {note.kind === 'note' && <p className="note-body">{note.note}</p>}
        {note.kind === 'last-reply' && (
          <NoteFallback label="Closing reply" body={note.lastReply} />
        )}
        {note.kind === 'prompt-and-reply' && (
          <>
            <NoteFallback label="First prompt" body={note.firstPrompt} />
            {note.lastReply && <NoteFallback label="Closing reply" body={note.lastReply} />}
          </>
        )}
        {note.kind === 'none' && <p className="note-empty">The author left no note.</p>}
      </div>

      <div className="sw-session-evidence">
        <div className="evidence-head">
          <span className="label">Machine evidence</span>
          {view && (
            <span className="sw-session-mono diffstat">
              {view.diffstat.files} files{' '}
              <span className="adds">+{view.diffstat.adds}</span>{' '}
              <span className="dels">-{view.diffstat.dels}</span>
            </span>
          )}
        </div>

        {view && view.files.length > 0 && (
          <ul className="evidence-files">
            {view.files.map((file) => (
              <li key={file.path}>
                <button type="button" className="file" onClick={() => onOpenFile(file.path)}>
                  <span className="sw-session-mono path">{file.path}</span>
                  <span className="sw-session-mono stat">
                    <span className="adds">+{file.adds}</span> <span className="dels">-{file.dels}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {view && view.outline.length > 0 && (
          <div className="evidence-outline">
            <span className="label">Prompts</span>
            <ol>
              {view.outline.slice(0, 12).map((entry) => (
                <li key={entry.i}>
                  <button type="button" onClick={() => onJumpToRecord(entry.i)}>
                    <span className="sw-session-mono idx">#{entry.i}</span>
                    <span className="excerpt">{firstLine(entry.excerpt)}</span>
                  </button>
                </li>
              ))}
              {view.outline.length > 12 && <li className="more">… {view.outline.length - 12} more</li>}
            </ol>
          </div>
        )}

        {card && (
          <div className="evidence-card">
            <span className="label">Workspace</span>
            <div className="sw-session-mono card-facts">
              {card.remotes[0] && <span>{card.remotes[0]}</span>}
              <span>
                {card.branch ?? '(detached)'} @ {card.head ? card.head.slice(0, 7) : '?'}
                {card.dirty.length > 0 && ` · ${card.dirty.length} dirty`}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="sw-session-resume">
        <code className="sw-session-mono">{resumeCommand}</code>
        <button
          type="button"
          className="copy"
          onClick={() => { void navigator.clipboard.writeText(resumeCommand) }}
        >
          Copy
        </button>
      </div>
    </section>
  )
}

function NoteFallback({ label, body }: { label: string; body: string }) {
  return (
    <div className="note-fallback">
      <span className="label">{label}</span>
      <p className="note-body">{body}</p>
    </div>
  )
}

function firstLine(value: string): string {
  const line = value.split('\n', 1)[0] ?? ''
  return line.length > 140 ? `${line.slice(0, 140)}…` : line
}

function shortSid(sid: string): string {
  const tail = sid.split('_')[1] ?? sid
  return `${sid.split('_')[0]}_${tail.slice(0, 8)}`
}
