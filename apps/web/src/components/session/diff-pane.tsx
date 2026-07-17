// Layer 2, right pane: the outcome. Per-file and lazy — selecting a file
// fetches only the records its edits need (view.files[].events), then the
// net diff is recomputed CLIENT-SIDE with session-kit. The hub never
// computes a diff, and a tampered author view is exposed right here.

import { useEffect, useState } from 'react'
import {
  composeSessionDiff,
  extractEditEvents,
  type SessionFileDiff,
  type SessionViewV1,
} from '@spool-lab/session-kit'

import { fetchRecordsByIndices, type RangeFetcher } from '../../lib/hub-api'

type FileDiffState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; diff: SessionFileDiff }

interface Props {
  view: SessionViewV1
  provider: 'claude' | 'codex'
  fetchRange: RangeFetcher
  openFile: string | null
  highlightRecord: number | null
  onSelectFile: (path: string) => void
  onJumpToRecord: (index: number) => void
}

export function DiffPane({ view, provider, fetchRange, openFile, highlightRecord, onSelectFile, onJumpToRecord }: Props) {
  const [diffs, setDiffs] = useState<Map<string, FileDiffState>>(new Map())

  useEffect(() => {
    if (!openFile || diffs.has(openFile)) return
    const entry = view.files.find((file) => file.path === openFile)
    if (!entry) return
    setDiffs((current) => new Map(current).set(openFile, { state: 'loading' }))
    fetchRecordsByIndices(fetchRange, entry.events)
      .then((records) => {
        const events = extractEditEvents(
          records.map((record) => ({ i: record.i, data: record.data })),
          { provider },
        )
        const diff = composeSessionDiff(events).files.find((file) => file.path === openFile)
        setDiffs((current) => new Map(current).set(
          openFile,
          diff ? { state: 'ready', diff } : { state: 'error' },
        ))
      })
      .catch(() => {
        setDiffs((current) => new Map(current).set(openFile, { state: 'error' }))
      })
  }, [openFile, diffs, view.files, fetchRange, provider])

  if (view.files.length === 0) {
    return <div className="sw-session-diff empty">No files were touched in this session.</div>
  }

  const active = openFile ? diffs.get(openFile) : undefined

  return (
    <div className="sw-session-diff">
      <div className="diff-files" role="tablist">
        {view.files.map((file) => (
          <button
            key={file.path}
            type="button"
            role="tab"
            aria-selected={openFile === file.path}
            className={`diff-file${openFile === file.path ? ' active' : ''}`}
            onClick={() => onSelectFile(file.path)}
          >
            <span className="sw-session-mono path">{file.path}</span>
            <span className="sw-session-mono stat">
              <span className="adds">+{file.adds}</span> <span className="dels">-{file.dels}</span>
            </span>
          </button>
        ))}
      </div>

      {!openFile && <p className="diff-hint">Select a file to see its net change.</p>}
      {active?.state === 'loading' && <p className="diff-hint">Computing diff from records…</p>}
      {active?.state === 'error' && (
        <p className="diff-error">Could not reconstruct this file&apos;s diff from the shared records.</p>
      )}
      {active?.state === 'ready' && (
        <FileDiffView
          diff={active.diff}
          highlightRecord={highlightRecord}
          onJumpToRecord={onJumpToRecord}
        />
      )}
    </div>
  )
}

function FileDiffView({ diff, highlightRecord, onJumpToRecord }: {
  diff: SessionFileDiff
  highlightRecord: number | null
  onJumpToRecord: (index: number) => void
}) {
  if (diff.hunks.length === 0) {
    return <p className="diff-hint">No net change — the edits cancelled out.</p>
  }
  return (
    <div className="diff-body">
      {diff.hunks.map((hunk, hunkIndex) => {
        const highlighted = highlightRecord !== null && hunk.recordIndices.includes(highlightRecord)
        return (
          <div key={hunkIndex} className={`diff-hunk${highlighted ? ' highlighted' : ''}`}>
            <button
              type="button"
              className="sw-session-mono hunk-head"
              title="Jump to the tool call that produced this hunk"
              onClick={() => onJumpToRecord(hunk.recordIndices[0] ?? 0)}
            >
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              <span className="records"> {hunk.recordIndices.map((index) => `#${index}`).join(' ')}</span>
            </button>
            <pre className="sw-session-mono hunk-lines">
              {hunk.lines.map((line, lineIndex) => (
                <span key={lineIndex} className={`line ${line.kind}`}>
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                  {line.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        )
      })}
    </div>
  )
}
