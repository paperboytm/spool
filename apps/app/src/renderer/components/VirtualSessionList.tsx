import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Session } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import type { BucketKey } from '../../shared/formatDate.js'

export type SessionListRow =
  | { kind: 'header'; id: string; label: ReactNode; testId?: string; dataAttr?: Record<string, string>; collapsible?: boolean; defaultOpen?: boolean }
  | { kind: 'session'; id: string; session: Session; pinned?: boolean; showProject?: boolean; bucket?: BucketKey; headerId: string | null }
  | { kind: 'footer'; id: string; loading: boolean; exhausted: boolean; total: number }

type Props = {
  rows: SessionListRow[]
  onEndReached: () => void
  onPinChange?: (uuid: string, pinned: boolean) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
  /** Optional test id forwarded to the scroll container. */
  testId?: string
  /** When true (default), bucket headers can collapse the rows beneath them. */
  collapsibleSections?: boolean
}

/**
 * Virtualised list that flattens pinned/bucket/directory sections into one
 * scroll surface. Parents build the row list; this component only renders +
 * emits endReached for infinite-scroll pagination.
 */
export default function VirtualSessionList({
  rows,
  onEndReached,
  onPinChange,
  onOpenSession,
  onCopySessionId,
  onShare,
  testId,
  collapsibleSections = true,
}: Props) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  // Tracks which collapsible headers are explicitly closed. Headers not in
  // the set are open (we keep "closed" rather than "open" so newly arriving
  // headers default to open without needing to pre-populate state).
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const toggleHeader = useCallback((id: string) => {
    setClosed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const visible = useMemo<SessionListRow[]>(() => {
    if (!collapsibleSections || closed.size === 0) return rows
    return rows.filter(r => {
      if (r.kind === 'session') return r.headerId == null || !closed.has(r.headerId)
      return true
    })
  }, [rows, closed, collapsibleSections])

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={visible}
      computeItemKey={(_index, row) => row.id}
      defaultItemHeight={64}
      increaseViewportBy={400}
      endReached={onEndReached}
      data-testid={testId}
      className="flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      itemContent={(_index, row) => {
        if (row.kind === 'header') {
          const open = !closed.has(row.id)
          return (
            <SectionHeader
              row={row}
              open={open}
              onToggle={collapsibleSections && row.collapsible !== false ? () => toggleHeader(row.id) : null}
            />
          )
        }
        if (row.kind === 'footer') return <Footer loading={row.loading} exhausted={row.exhausted} total={row.total} />
        return (
          <SessionRow
            session={row.session}
            {...(row.pinned ? { pinned: true } : {})}
            {...(row.showProject ? { showProject: true } : {})}
            {...(row.bucket ? { bucket: row.bucket } : {})}
            {...(onPinChange ? { onPinChange } : {})}
            onOpenSession={onOpenSession}
            onCopySessionId={onCopySessionId}
            {...(onShare ? { onShare } : {})}
          />
        )
      }}
    />
  )
}

function SectionHeader({
  row,
  open,
  onToggle,
}: {
  row: Extract<SessionListRow, { kind: 'header' }>
  open: boolean
  onToggle: (() => void) | null
}) {
  const content = (
    <div
      data-testid={row.testId}
      {...(row.dataAttr ?? {})}
      className="px-6 pt-3 pb-1"
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group w-full flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none"
        >
          <span>{row.label}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
            className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
          >
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="block text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted select-none">
          {row.label}
        </span>
      )}
    </div>
  )
  return content
}

function Footer({ loading, exhausted, total }: { loading: boolean; exhausted: boolean; total: number }) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <div data-testid="session-list-loading" className="flex justify-center py-6 text-[11px] text-warm-faint dark:text-dark-muted">
        {t('library.footer_loadingMore')}
      </div>
    )
  }
  if (exhausted && total > 0) {
    return (
      <div data-testid="session-list-done" className="flex justify-center py-6 text-[11px] text-warm-faint dark:text-dark-muted">
        {t('library.footer_endOf', { count: total })}
      </div>
    )
  }
  return <div className="py-4" />
}
