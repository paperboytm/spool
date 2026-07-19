import type { Session } from '@spool-lab/core'
import { IconButton, ListRow } from '@spool-lab/ui'
import {
  SquareTerminal,
  MoreHorizontal,
  Copy,
  Loader2,
  SquarePen,
  AlertTriangle,
  Check,
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
    <ListRow
      as="div"
      data-testid="session-row"
      data-session-uuid={session.sessionUuid}
      {...(pinned ? { 'data-pinned': '' } : {})}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpen()
        }
      }}
      className="group focus:bg-warm-surface dark:focus:bg-dark-surface cursor-pointer focus:outline-none"
      title={
        <div className="flex min-w-0 items-center gap-2">
          <SourceBadge source={session.source} />
          <span className="truncate">{title}</span>
        </div>
      }
      metadata={
        <p className="truncate">
          {showProject && (
            <>
              <span>{session.projectDisplayName}</span>
              {' · '}
            </>
          )}
          {date} · {t('session.msgs_other', { count: session.messageCount })}
          {model && ` · ${model}`}
        </p>
      }
      trailing={
        <div className="flex flex-none items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                <IconButton
                  aria-label={t('common.moreActions')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
                </IconButton>
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
      }
    />
  )
}

/** Fixed-width state slot containing the SecurityBadge.
 *
 *  Naive placement (`{badge && <SecurityBadge />}` inline) shifts the pin
 *  icon column left on rows without a badge. Reserving the same canonical
 *  24px hit area as the adjacent icon buttons keeps those columns locked.
 *
 *  Icon size = 13 so AlertTriangle reads at the same visual weight as
 *  PinIcon while the outer slot preserves the accessible hit area. */
function SecurityBadgeSlot({ session }: { session: Session }): React.ReactElement {
  return (
    <span className="inline-flex h-6 w-6 flex-none items-center justify-center">
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
