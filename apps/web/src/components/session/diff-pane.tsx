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
      <div className="min-h-[120px] rounded-[10px] border border-solid border-[var(--border)] bg-[var(--card)] p-5 text-xs text-[var(--faint)] shadow-[var(--shadow-card)]">
        No files were touched in this session.
      </div>
    )
  }

  const active = openFile ? diffs.get(openFile) : undefined

  return (
    <div className="min-h-[120px] rounded-[10px] border border-solid border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex flex-col gap-1">
        {view.files.map((file) => (
          <button
            key={file.path}
            type="button"
            aria-pressed={openFile === file.path}
            className={`m-0 flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border-0 px-2 py-1 text-left text-xs transition-colors duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              openFile === file.path
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft)]'
                : 'bg-transparent text-[var(--text)] hover:bg-[var(--card-2)]'
            }`}
            onClick={() => onSelectFile(file.path)}
          >
            <span className="min-w-0 truncate font-mono tabular-nums">{file.path}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-[#6BAF6B] dark:text-[#7DC07D]">+{file.adds}</span>{' '}
              <span className="text-[#C95A4F] dark:text-[#D67259]">-{file.dels}</span>
            </span>
          </button>
        ))}
      </div>

      {!openFile && (
        <p className="m-0 p-2 text-xs text-[var(--faint)]">Select a file to see its net change.</p>
      )}
      {active?.state === 'loading' && (
        <p className="m-0 p-2 text-xs text-[var(--faint)]">Computing diff from records…</p>
      )}
      {active?.state === 'error' && (
        <p className="m-0 p-2 text-xs text-[#C95A4F] dark:text-[#D67259]">
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
      <p className="m-0 p-2 text-xs text-[var(--faint)]">
        No net change — the edits cancelled out.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {diff.hunks.map((hunk, hunkIndex) => {
        const highlighted = highlightRecord !== null && hunk.recordIndices.includes(highlightRecord)
        const hunkLabel = (
          <>
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            <span className="text-[var(--accent)]">
              {' '}
              {hunk.recordIndices.map((index) => `#${index}`).join(' ')}
            </span>
          </>
        )
        const hunkHeaderClass =
          'block w-full border-0 border-b border-solid border-[var(--border)] bg-[var(--card-2)] px-2 py-1 text-left font-mono text-[11px] text-[var(--muted)] tabular-nums'
        return (
          <div
            key={hunkIndex}
            className={`overflow-hidden rounded-md border border-solid ${
              highlighted ? 'border-[var(--accent)]' : 'border-[var(--border)]'
            }`}
          >
            {onJumpToRecord ? (
              <button
                type="button"
                className={`m-0 cursor-pointer transition-colors duration-[80ms] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${hunkHeaderClass}`}
                title="Jump to the tool call that produced this hunk"
                onClick={() => onJumpToRecord(hunk.recordIndices[0] ?? 0)}
              >
                {hunkLabel}
              </button>
            ) : (
              <div className={hunkHeaderClass}>{hunkLabel}</div>
            )}
            <pre className="m-0 overflow-x-auto p-2 font-mono text-xs leading-[1.5] tabular-nums">
              {hunk.lines.map((line, lineIndex) => (
                <span
                  key={lineIndex}
                  className={`block whitespace-pre ${
                    line.kind === 'add'
                      ? 'bg-[color-mix(in_srgb,#6BAF6B_12%,transparent)] dark:bg-[color-mix(in_srgb,#7DC07D_12%,transparent)]'
                      : line.kind === 'del'
                        ? 'bg-[color-mix(in_srgb,#C95A4F_12%,transparent)] dark:bg-[color-mix(in_srgb,#D67259_12%,transparent)]'
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
