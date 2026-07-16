import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, Virtuoso } from 'react-virtuoso'
import type { Session } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import type { BucketKey } from '../../shared/formatDate.js'

export type SessionListRow =
  | { kind: 'header'; id: string; label: ReactNode; testId?: string; dataAttr?: Record<string, string>; collapsible?: boolean; defaultOpen?: boolean; sticky?: boolean }
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
  /** Use react-virtuoso's grouped list so section headers stick at the top. */
  stickyHeaders?: boolean
}

type StickyGroup = {
  header: Extract<SessionListRow, { kind: 'header' }>
  items: SessionListRow[]
}

type StickySections = {
  prelude: SessionListRow[]
  groups: StickyGroup[]
}

type StickyItemData = SessionListRow | null

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
  stickyHeaders = false,
}: Props) {
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

  const stickySections = useMemo(() => buildStickySections(visible), [visible])
  const stickyData = useMemo<StickyItemData[]>(
    () => stickySections.groups.flatMap(group => [null, ...group.items]),
    [stickySections],
  )

  const renderRow = useCallback((row: SessionListRow) => {
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
  }, [closed, collapsibleSections, onCopySessionId, onOpenSession, onPinChange, onShare, toggleHeader])

  if (stickyHeaders && stickySections.groups.length > 0) {
    return (
      <div className="relative flex-1 min-h-0">
        <GroupedVirtuoso
          data={stickyData}
          groupCounts={stickySections.groups.map(group => group.items.length)}
          groupContent={(groupIndex) => {
            const row = stickySections.groups[groupIndex]!.header
            const open = !closed.has(row.id)
            return (
              <SectionHeader
                row={row}
                open={open}
                sticky
                onToggle={collapsibleSections && row.collapsible !== false ? () => toggleHeader(row.id) : null}
              />
            )
          }}
          computeItemKey={(index, row) => row?.id ?? `group-${index}`}
          defaultItemHeight={64}
          increaseViewportBy={400}
          endReached={onEndReached}
          data-testid={testId}
          className="h-full [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
          components={{
            Header: () => stickySections.prelude.length > 0
              ? <>{stickySections.prelude.map(row => <div key={row.id}>{renderRow(row)}</div>)}</>
              : null,
          }}
          itemContent={(_index, _groupIndex, row) => row ? renderRow(row) : null}
        />
      </div>
    )
  }

  return (
    <Virtuoso
      data={visible}
      computeItemKey={(_index, row) => row.id}
      defaultItemHeight={64}
      increaseViewportBy={400}
      endReached={onEndReached}
      data-testid={testId}
      className="flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      itemContent={(_index, row) => renderRow(row)}
    />
  )
}

function buildStickySections(rows: SessionListRow[]): StickySections {
  const prelude: SessionListRow[] = []
  const groups: StickyGroup[] = []
  let current: StickyGroup | null = null
  for (const row of rows) {
    if (row.kind === 'header' && row.sticky) {
      current = { header: row, items: [] }
      groups.push(current)
      continue
    }
    if (!current) {
      prelude.push(row)
      continue
    }
    current.items.push(row)
  }
  return { prelude, groups }
}

function SectionHeader({
  row,
  open,
  onToggle,
  sticky = false,
}: {
  row: Extract<SessionListRow, { kind: 'header' }>
  open: boolean
  onToggle: (() => void) | null
  sticky?: boolean
}) {
  const headerClassName = sticky
    ? 'relative z-30 flex h-8 items-center px-5 bg-warm-bg dark:bg-dark-bg border-b border-warm-border dark:border-dark-border'
    : 'px-6 pt-3 pb-1'
  const toggleClassName = sticky
    ? 'group flex max-w-full items-center gap-1.5 text-xs text-warm-text dark:text-dark-text select-none'
    : 'group w-full flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none'
  const labelClassName = sticky
    ? 'truncate text-xs text-warm-text dark:text-dark-text select-none'
    : 'block text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none'
  const content = (
    <div
      data-testid={row.testId}
      {...(row.dataAttr ?? {})}
      className={headerClassName}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={toggleClassName}
        >
          <span className="truncate">{row.label}</span>
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
        <div className={labelClassName}>
          {row.label}
        </div>
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
