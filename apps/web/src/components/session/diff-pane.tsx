// Layer 2, right pane: the outcome. Per-file and lazy — selecting a file
// fetches only the records its edits need (view.files[].events), then the
// net diff is recomputed CLIENT-SIDE with session-kit. The hub never
// computes a diff, and a tampered author view is exposed right here.

import {
  composeSessionDiff,
  extractEditEvents,
  type SessionFileDiff,
  type SessionViewV1,
} from '@spool-lab/session-kit'
import { useEffect, useState } from 'react'

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
  onJumpToRecord?: (index: number) => void
}

export function DiffPane({
  view,
  provider,
  fetchRange,
  openFile,
  highlightRecord,
  onSelectFile,
  onJumpToRecord,
}: Props) {
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
        setDiffs((current) =>
          new Map(current).set(openFile, diff ? { state: 'ready', diff } : { state: 'error' }),
        )
      })
      .catch(() => {
        setDiffs((current) => new Map(current).set(openFile, { state: 'error' }))
      })
  }, [openFile, diffs, view.files, fetchRange, provider])

  if (view.files.length === 0) {
    return (
      <div className="rounded-card border-border bg-background text-button text-faint shadow-card min-h-[120px] border border-solid p-5">
        No files were touched in this session.
      </div>
    )
  }

  const active = openFile ? diffs.get(openFile) : undefined

  return (
    <div className="rounded-card border-border bg-background shadow-card min-h-[120px] border border-solid p-3">
      <div className="mb-2 flex flex-col gap-1">
        {view.files.map((file) => (
          <button
            key={file.path}
            type="button"
            aria-pressed={openFile === file.path}
            className={`rounded-control text-button duration-hover focus-visible:outline-accent m-0 flex w-full cursor-pointer items-center justify-between gap-3 border-0 px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
              openFile === file.path
                ? 'bg-accent-soft text-accent hover:bg-accent-soft'
                : 'text-foreground hover:bg-surface bg-transparent'
            }`}
            onClick={() => onSelectFile(file.path)}
          >
            <span className="min-w-0 truncate font-mono tabular-nums">{file.path}</span>
            <span className="text-meta shrink-0 font-mono tabular-nums">
              <span className="text-status-success">+{file.adds}</span>{' '}
              <span className="text-status-error">-{file.dels}</span>
            </span>
          </button>
        ))}
      </div>

      {!openFile && (
        <p className="text-button text-faint m-0 p-2">Select a file to see its net change.</p>
      )}
      {active?.state === 'loading' && (
        <p className="text-button text-faint m-0 p-2">Computing diff from records…</p>
      )}
      {active?.state === 'error' && (
        <p className="text-button text-status-error m-0 p-2">
          Could not reconstruct this file&apos;s diff from the shared records.
        </p>
      )}
      {active?.state === 'ready' && (
        <FileDiffView
          diff={active.diff}
          highlightRecord={highlightRecord}
          {...(onJumpToRecord ? { onJumpToRecord } : {})}
        />
      )}
    </div>
  )
}

function FileDiffView({
  diff,
  highlightRecord,
  onJumpToRecord,
}: {
  diff: SessionFileDiff
  highlightRecord: number | null
  onJumpToRecord?: (index: number) => void
}) {
  if (diff.hunks.length === 0) {
    return (
      <p className="text-button text-faint m-0 p-2">No net change — the edits cancelled out.</p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {diff.hunks.map((hunk, hunkIndex) => {
        const highlighted = highlightRecord !== null && hunk.recordIndices.includes(highlightRecord)
        const hunkLabel = (
          <>
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            <span className="text-accent">
              {' '}
              {hunk.recordIndices.map((index) => `#${index}`).join(' ')}
            </span>
          </>
        )
        const hunkHeaderClass =
          'block w-full border-0 border-b border-solid border-border bg-surface px-2 py-1 text-left font-mono text-meta text-muted tabular-nums'
        return (
          <div
            key={hunkIndex}
            className={`rounded-control overflow-hidden border border-solid ${
              highlighted ? 'border-accent' : 'border-border'
            }`}
          >
            {onJumpToRecord ? (
              <button
                type="button"
                className={`duration-hover hover:text-accent focus-visible:outline-accent m-0 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${hunkHeaderClass}`}
                title="Jump to the tool call that produced this hunk"
                onClick={() => onJumpToRecord(hunk.recordIndices[0] ?? 0)}
              >
                {hunkLabel}
              </button>
            ) : (
              <div className={hunkHeaderClass}>{hunkLabel}</div>
            )}
            <pre className="text-button m-0 overflow-x-auto p-2 font-mono leading-[1.5] tabular-nums">
              {hunk.lines.map((line, lineIndex) => (
                <span
                  key={lineIndex}
                  className={`block whitespace-pre ${
                    line.kind === 'add'
                      ? 'bg-status-success/10'
                      : line.kind === 'del'
                        ? 'bg-status-error/10'
                        : ''
                  }`}
                >
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
