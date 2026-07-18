import type { Session } from '@spool-lab/core'
import {
  SquareTerminal,
  MoreHorizontal,
  Copy,
  Loader2,
  SquarePen,
  AlertTriangle,
  Check,
  ChevronRight,
  CornerDownRight,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatRelativeDate, type BucketKey } from '../../shared/formatDate.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import { useCachedSecurityPrefs } from '../api/securityPrefsCache.js'
import { SourceBadge } from './Badges.js'
import Menu from './Menu.js'
import PinButton from './PinButton.js'
import { compactModel } from './security/format.js'

type Props = {
  session: Session
  pinned?: boolean
  showProject?: boolean
  /** Stable bucket key so formatRelativeDate can short-circuit the
   *  redundant "today, …" / "yesterday, …" prefix when the row already
   *  sits under a bucket header. */
  bucket?: BucketKey
  onPinChange?: (uuid: string, pinned: boolean) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
  treeDepth?: number
  treeChildCount?: number
  treeExpanded?: boolean
  onToggleTree?: () => void
}

export default function SessionRow({
  session,
  pinned = false,
  showProject = false,
  bucket,
  onPinChange,
  onOpenSession,
  onCopySessionId,
  onShare,
  treeDepth = 0,
  treeChildCount = 0,
  treeExpanded = false,
  onToggleTree,
}: Props) {
  const { t } = useTranslation()
  const [resuming, setResuming] = useState(false)

  const looseT = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const title = session.title?.trim() || t('common.noTitle')
  const date = formatRelativeDate(session.startedAt, { ...(bucket ? { bucket } : {}), t: looseT })
  const model = compactModel(session.model)

  function handleOpen() {
    onOpenSession(session.sessionUuid)
  }

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
  }

  const resumeCommand = getSessionResumeCommand(session.source, session.sessionUuid, session.cwd)
  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
  }

  return (
    <div
      data-testid="session-row"
      data-session-uuid={session.sessionUuid}
      data-tree-depth={treeDepth}
      {...(pinned ? { 'data-pinned': '' } : {})}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpen()
        }
      }}
      className="group hover:bg-warm-surface dark:hover:bg-dark-surface focus:bg-warm-surface dark:focus:bg-dark-surface flex cursor-pointer items-start gap-3 px-5 py-3 transition-colors duration-75 focus:outline-none"
      style={{ paddingLeft: 20 + Math.min(treeDepth, 6) * 20 }}
    >
      <div className="text-warm-faint dark:text-dark-muted flex h-5 w-4 flex-none items-center justify-center">
        {treeChildCount > 0 && onToggleTree ? (
          <button
            type="button"
            data-testid="session-tree-toggle"
            onClick={(event) => {
              event.stopPropagation()
              onToggleTree()
            }}
            aria-label={`${t(treeExpanded ? 'common.collapse' : 'common.expand')}: ${title}`}
            aria-expanded={treeExpanded}
            title={t('library.childSessions', { count: treeChildCount })}
            className="text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text focus-visible:ring-warm-accent dark:focus-visible:ring-dark-accent inline-flex h-6 w-6 items-center justify-center rounded transition-colors duration-75 focus-visible:ring-1 focus-visible:outline-none"
          >
            <ChevronRight
              size={13}
              strokeWidth={1.7}
              aria-hidden
              className={`transition-transform duration-150 motion-reduce:transition-none ${treeExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : treeDepth > 0 ? (
          <CornerDownRight size={12} strokeWidth={1.5} aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <SourceBadge source={session.source} />
          <span className="text-warm-text dark:text-dark-text truncate text-sm font-medium">
            {title}
          </span>
        </div>
        <p className="text-warm-faint dark:text-dark-muted truncate pl-1.5 text-xs">
          {showProject && (
            <>
              <span className="text-warm-muted dark:text-dark-muted">
                {session.projectDisplayName}
              </span>
              {' · '}
            </>
          )}
          {date} · {t('session.msgs_other', { count: session.messageCount })}
          {model && ` · ${model}`}
          {treeChildCount > 0 && ` · ${t('library.childSessions', { count: treeChildCount })}`}
        </p>
      </div>

      <div
        className="-mt-0.5 flex flex-none items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <SecurityBadgeSlot session={session} />
        <span
          className={
            pinned
              ? 'opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'
              : 'opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'
          }
        >
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={(next) => onPinChange?.(session.sessionUuid, next)}
          />
        </span>
        <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-has-[[aria-expanded=true]]:opacity-100">
          <Menu
            align="right"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
                aria-label={t('common.moreActions')}
                aria-haspopup="menu"
                aria-expanded={open}
                className="text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text inline-flex h-5 w-5 items-center justify-center rounded transition-colors duration-75"
              >
                <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
              </button>
            )}
            items={[
              ...(onShare
                ? [
                    {
                      label: t('sidebar.shareSession'),
                      icon: <SquarePen size={14} strokeWidth={1.6} aria-hidden />,
                      onSelect: () => onShare(session.sessionUuid),
                    },
                  ]
                : []),
              {
                label: resuming ? t('common.openingTerminal') : t('session.resume_inTerminal'),
                icon: resuming ? (
                  <Loader2 size={14} strokeWidth={1.6} className="animate-spin" aria-hidden />
                ) : (
                  <SquareTerminal size={14} strokeWidth={1.6} aria-hidden />
                ),
                onSelect: () => {
                  void handleResume()
                },
                disabled: resuming,
              },
              ...(resumeCommand
                ? [
                    {
                      label: t('common.copyResumeCommand'),
                      icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                      onSelect: () => {
                        void handleCopyCommand()
                      },
                    },
                  ]
                : []),
              {
                label: t('sidebar.copySessionId'),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => {
                  void handleCopyId()
                },
              },
            ]}
          />
        </span>
      </div>
    </div>
  )
}

/** Fixed-width state slot containing the SecurityBadge.
 *
 *  Naive placement (`{badge && <SecurityBadge />}` inline) shifts the pin
 *  icon column left on rows without a badge. By reserving a 32px slot
 *  for every row — even when empty — the pin/menu icons lock to the
 *  same X across the entire library.
 *
 *  Vertical alignment: the slot is `h-5` to match `PinButton`'s `w-5
 *  h-5` button, and lives inside the action group so it inherits the
 *  group's `-mt-0.5` offset against the title row. Icon size = 13 so
 *  the AlertTriangle reads as the same visual weight as PinIcon (also
 *  size 13). */
function SecurityBadgeSlot({ session }: { session: Session }): React.ReactElement {
  return (
    <span className="inline-flex h-5 w-5 flex-none items-center justify-center">
      <SecurityBadge session={session} />
    </span>
  )
}

function SecurityBadge({ session }: { session: Session }): React.ReactElement | null {
  const { t } = useTranslation()
  // Per-user opt-out for the row-level badge. The pref defaults to
  // `true`; when the cache is still cold (`null`) we also render the
  // badge to avoid a visible appear-after-load flash on first paint.
  // Only an authoritative `false` suppresses it. SecurityPage and the
  // session-detail Findings strip render their own AlertTriangle and
  // are intentionally not gated by this pref.
  const prefs = useCachedSecurityPrefs()
  if (prefs && !prefs.sessionRowRiskIconVisible) return null
  const high = session.scanHighCount ?? 0
  const total = session.scanFindingCount ?? 0
  const purged = session.scanPurgedCount ?? 0
  const completed = session.scanCompletedAt != null
  const low = Math.max(0, total - high)

  // "All resolved" state: the session was scanned, has zero active
  // findings, but at least one was purged historically. Surfaces a
  // checkmark so the user can tell "scanned-clean from the start"
  // (no badge) from "scanned-clean because I purged it" (✓).
  if (high === 0 && low === 0) {
    if (completed && purged > 0) {
      const tooltip = t('security.badge_tooltip_resolved', {
        count: purged,
        defaultValue: '{{count}} resolved',
      })
      return (
        <span
          data-testid="security-badge"
          data-severity="resolved"
          title={tooltip}
          aria-label={tooltip}
          className="text-warm-muted dark:text-dark-muted inline-flex h-5 w-5 items-center justify-center"
        >
          <Check size={13} strokeWidth={1.7} aria-hidden />
        </span>
      )
    }
    return null
  }

  const isHigh = high > 0
  // Icon-only at the row level — the tooltip carries the exact count
  // so the row stays scan-readable at scale (Library home shows 50+
  // rows; per-row digits become visual noise). Hover gives detail.
  const tooltip = isHigh
    ? low > 0
      ? t('security.badge_tooltip_mixed', {
          high,
          low,
          defaultValue: '{{high}} high-risk · {{low}} low',
        })
      : t('security.badge_tooltip_high', { count: high, defaultValue: '{{count}} high-risk' })
    : t('security.badge_tooltip_low', { count: low, defaultValue: '{{count}} low' })
  const tone = isHigh ? 'text-accent dark:text-accent-dark' : 'text-warm-muted dark:text-dark-muted'

  return (
    <span
      data-testid="security-badge"
      data-severity={isHigh ? 'high' : 'low'}
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex h-5 w-5 items-center justify-center ${tone}`}
    >
      <AlertTriangle size={13} strokeWidth={1.7} aria-hidden />
    </span>
  )
}
