// Layer 2, left pane: the process. Row shells render straight from the
// view index (kind + excerpt are already there — zero record fetches for
// first paint); clicking a row fetches its full body lazily. Rows past
// PAGE are behind "Show more" so a 10k-record session doesn't build a
// 10k-node DOM on load.

import { useEffect, useRef, useState } from 'react'
import type { SessionViewV1, ViewIndexEntry } from '@spool-lab/session-kit'

import type { RangeFetcher } from '../../lib/hub-api'
import { fetchRecordsExact } from '../../lib/hub-api'
import { deepLinkHash } from '../../lib/session-page'
import { renderRecordSegments, type RecordSegment } from '../../lib/record-render'

const PAGE = 200
const RENDER_TRUNCATE_BYTES = 50 * 1024

type Expanded =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; segments: RecordSegment[] }

interface Props {
  view: SessionViewV1
  provider: 'claude' | 'codex'
  fetchRange: RangeFetcher
  highlightIndex: number | null
  /** Rows the timeline must be able to scroll to (deep link / hunk jump). */
  revealIndex: number | null
  onSelectFile: (path: string) => void
}

export function Timeline({ view, provider, fetchRange, highlightIndex, revealIndex, onSelectFile }: Props) {
  const [shown, setShown] = useState(Math.min(PAGE, view.index.length))
  const [expanded, setExpanded] = useState<Map<number, Expanded>>(new Map())
  const [fullText, setFullText] = useState<Set<number>>(new Set())
  const rowRefs = useRef(new Map<number, HTMLLIElement>())

  useEffect(() => {
    if (revealIndex === null) return
    if (revealIndex >= shown) setShown(Math.min(view.index.length, revealIndex + 50))
  }, [revealIndex, shown, view.index.length])

  useEffect(() => {
    if (revealIndex === null) return
    const row = rowRefs.current.get(revealIndex)
    row?.scrollIntoView({ block: 'center' })
  }, [revealIndex, shown])

  const toggle = (index: number) => {
    if (expanded.has(index)) {
      const next = new Map(expanded)
      next.delete(index)
      setExpanded(next)
      return
    }
    setExpanded((current) => new Map(current).set(index, { state: 'loading' }))
    fetchRecordsExact(fetchRange, index, index + 1)
      .then((records) => {
        const data = records[0]?.data ?? ''
        setExpanded((current) => new Map(current).set(index, {
          state: 'ready',
          segments: renderRecordSegments(provider, data),
        }))
      })
      .catch(() => {
        setExpanded((current) => new Map(current).set(index, { state: 'error' }))
      })
  }

  const copyDeepLink = (index: number) => {
    const url = new URL(window.location.href)
    url.hash = deepLinkHash(index)
    history.replaceState(null, '', url.toString())
    void navigator.clipboard.writeText(url.toString())
  }

  return (
    <div className="sw-session-timeline">
      <ol>
        {view.index.slice(0, shown).map((entry) => (
          <TimelineRow
            key={entry.i}
            entry={entry}
            expanded={expanded.get(entry.i)}
            highlighted={highlightIndex === entry.i}
            showFull={fullText.has(entry.i)}
            onToggle={() => toggle(entry.i)}
            onCopyLink={() => copyDeepLink(entry.i)}
            onShowFull={() => setFullText((current) => new Set(current).add(entry.i))}
            onSelectFile={onSelectFile}
            refCallback={(node) => {
              if (node) rowRefs.current.set(entry.i, node)
              else rowRefs.current.delete(entry.i)
            }}
          />
        ))}
      </ol>
      {shown < view.index.length && (
        <button
          type="button"
          className="sw-session-more"
          onClick={() => setShown(Math.min(view.index.length, shown + PAGE))}
        >
          Show {Math.min(PAGE, view.index.length - shown)} more of {view.index.length - shown}
        </button>
      )}
    </div>
  )
}

const KIND_LABEL: Record<ViewIndexEntry['kind'], string> = {
  user: 'prompt',
  assistant: 'reply',
  tool: 'tool',
  edit: 'edit',
  other: 'meta',
}

function TimelineRow(props: {
  entry: ViewIndexEntry
  expanded: Expanded | undefined
  highlighted: boolean
  showFull: boolean
  onToggle: () => void
  onCopyLink: () => void
  onShowFull: () => void
  onSelectFile: (path: string) => void
  refCallback: (node: HTMLLIElement | null) => void
}) {
  const { entry, expanded, highlighted, showFull } = props
  return (
    <li
      ref={props.refCallback}
      className={`sw-session-row kind-${entry.kind}${highlighted ? ' highlighted' : ''}`}
    >
      <div className="row-head">
        <button
          type="button"
          className="sw-session-mono idx"
          title="Copy deep link"
          onClick={props.onCopyLink}
        >
          #{entry.i}
        </button>
        <span className={`kind kind-${entry.kind}`}>{KIND_LABEL[entry.kind]}</span>
        {entry.tool && <span className="sw-session-mono tool">{entry.tool}</span>}
        {entry.file && (
          <button type="button" className="sw-session-mono file" onClick={() => props.onSelectFile(entry.file as string)}>
            {entry.file}
          </button>
        )}
        <button type="button" className="expand" onClick={props.onToggle}>
          {expanded ? 'collapse' : 'expand'}
        </button>
      </div>
      {entry.excerpt && !expanded && (
        <p className="row-excerpt">{clip(entry.excerpt, 240)}</p>
      )}
      {expanded?.state === 'loading' && <p className="row-loading">loading…</p>}
      {expanded?.state === 'error' && <p className="row-error">Could not load this record.</p>}
      {expanded?.state === 'ready' && (
        <div className="row-body">
          {expanded.segments.map((segment, index) => (
            <RecordSegmentView
              key={index}
              segment={segment}
              showFull={showFull}
              onShowFull={props.onShowFull}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function RecordSegmentView(props: {
  segment: RecordSegment
  showFull: boolean
  onShowFull: () => void
}) {
  const { segment, showFull } = props
  const truncated = !showFull && segment.text.length > RENDER_TRUNCATE_BYTES
  const text = truncated ? segment.text.slice(0, RENDER_TRUNCATE_BYTES) : segment.text
  return (
    <div className={`segment segment-${segment.kind}`}>
      {segment.label && <span className="sw-session-mono segment-label">{segment.label}</span>}
      <pre className="sw-session-mono segment-text">{text}</pre>
      {truncated && (
        <button type="button" className="expand" onClick={props.onShowFull}>
          Show all ({Math.round(segment.text.length / 1024)} KB)
        </button>
      )}
    </div>
  )
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
