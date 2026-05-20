import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SquareTerminal, MoreHorizontal, Copy, Loader2, SquarePen, AlertTriangle, Check } from 'lucide-react'
import type { Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import PinButton from './PinButton.js'
import Menu from './Menu.js'
import { formatRelativeDate, type BucketKey } from '../../shared/formatDate.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import { securityFeatureEnabled } from '../featureFlags.js'

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

export default function SessionRow({ session, pinned = false, showProject = false, bucket, onPinChange, onOpenSession, onCopySessionId, onShare }: Props) {
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
      className="group flex items-start gap-3 px-5 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors duration-75 cursor-pointer focus:outline-none focus:bg-warm-surface dark:focus:bg-dark-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <SourceBadge source={session.source} />
          <span className="text-sm font-medium text-warm-text dark:text-dark-text truncate">
            {title}
          </span>
        </div>
        <p className="pl-1.5 text-xs text-warm-faint dark:text-dark-muted truncate">
          {showProject && (
            <>
              <span className="text-warm-muted dark:text-dark-muted">{session.projectDisplayName}</span>
              {' · '}
            </>
          )}
          {date} · {t('session.msgs_other', { count: session.messageCount })}
          {model && ` · ${model}`}
        </p>
      </div>

      <div className="flex-none flex items-center gap-1 -mt-0.5" onClick={(e) => e.stopPropagation()}>
        <SecurityBadgeSlot session={session} />
        <span
          className={
            pinned
              ? 'opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
          }
        >
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={(next) => onPinChange?.(session.sessionUuid, next)}
          />
        </span>
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 transition-opacity">
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
                className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
              >
                <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
              </button>
            )}
            items={[
              ...(onShare ? [{
                label: t('shareEditor.openNew'),
                icon: <SquarePen size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => onShare(session.sessionUuid),
              }] : []),
              {
                label: resuming ? t('common.openingTerminal') : t('session.resume_inTerminal'),
                icon: resuming
                  ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" aria-hidden />
                  : <SquareTerminal size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleResume() },
                disabled: resuming,
              },
              ...(resumeCommand ? [{
                label: t('common.copyResumeCommand'),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyCommand() },
              }] : []),
              {
                label: t('sidebar.copySessionId'),
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyId() },
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
    <span className="flex-none inline-flex items-center justify-center w-5 h-5">
      <SecurityBadge session={session} />
    </span>
  )
}


function SecurityBadge({ session }: { session: Session }): React.ReactElement | null {
  const { t } = useTranslation()
  if (!securityFeatureEnabled()) return null
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
      const tooltip = t('security.badge_tooltip_resolved', { count: purged, defaultValue: '{{count}} resolved' })
      return (
        <span
          data-testid="security-badge"
          data-severity="resolved"
          title={tooltip}
          aria-label={tooltip}
          className="inline-flex items-center justify-center w-5 h-5 text-warm-muted dark:text-dark-muted"
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
    ? (low > 0
        ? t('security.badge_tooltip_mixed', { high, low, defaultValue: '{{high}} high-risk · {{low}} low' })
        : t('security.badge_tooltip_high', { count: high, defaultValue: '{{count}} high-risk' }))
    : t('security.badge_tooltip_low', { count: low, defaultValue: '{{count}} low' })
  const tone = isHigh ? 'text-accent dark:text-accent-dark' : 'text-warm-muted dark:text-dark-muted'

  return (
    <span
      data-testid="security-badge"
      data-severity={isHigh ? 'high' : 'low'}
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center justify-center w-5 h-5 ${tone}`}
    >
      <AlertTriangle size={13} strokeWidth={1.7} aria-hidden />
    </span>
  )
}

function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

