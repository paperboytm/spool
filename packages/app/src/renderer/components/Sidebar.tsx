import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ProjectGroup, Session, SessionSource, StatusInfo } from '@spool-lab/core'
import { Layers3 as LibraryIcon, Search as SearchIcon, Settings as SettingsIcon, Newspaper as SharesIcon, ShieldAlert as SecurityIcon, AlertTriangle, SquareTerminal, MoreHorizontal, Copy, Loader2, SquarePen } from 'lucide-react'
import { securityFeatureEnabled } from '../featureFlags.js'
import { useTranslation } from 'react-i18next'
import PinIcon from './PinIcon.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import {
  DEFAULT_SIDEBAR_SORT_ORDER,
  SIDEBAR_SORT_OPTIONS,
  type SidebarSortOrder,
} from '../../shared/sidebarSort.js'
import {
  DEFAULT_PINNED_SORT_ORDER,
  PINNED_SORT_OPTIONS,
  type PinnedSortOrder,
} from '../../shared/pinnedSort.js'
import Menu from './Menu.js'

type Props = {
  activeIdentityKey: string | null
  activeSessionUuid?: string | null
  onSelectProject: (identityKey: string) => void
  onSelectSession?: (sessionUuid: string) => void
  onSelectHome?: () => void
  isLibraryActive?: boolean
  onSelectShares?: () => void
  isSharesActive?: boolean
  onSelectSecurity?: () => void
  isSecurityActive?: boolean
  /** Total active high-severity findings across all sessions. When > 0
   *  the Security row gets a small AlertTriangle + count trailing badge
   *  so the user can see there's work to do without opening the page. */
  securityHighCount?: number
  onOpenSearch?: () => void
  syncStatus?: { phase: string; count: number; total: number } | null
  status?: StatusInfo | null
  onSettingsClick?: () => void
  showSourceDots?: boolean
  showSessionCount?: boolean
  sortOrder?: SidebarSortOrder
  onSortOrderChange?: (next: SidebarSortOrder) => void
  pinnedSortOrder?: PinnedSortOrder
  onPinnedSortOrderChange?: (next: PinnedSortOrder) => void
  onCopySessionId?: (source: SessionSource) => void
  onShareSession?: (uuid: string) => void
}

export default function Sidebar({ activeIdentityKey, activeSessionUuid = null, onSelectProject, onSelectSession, onSelectHome, isLibraryActive = false, onSelectShares, isSharesActive = false, onSelectSecurity, isSecurityActive = false, securityHighCount = 0, onOpenSearch, syncStatus, status, onSettingsClick, showSourceDots = true, showSessionCount = true, sortOrder = DEFAULT_SIDEBAR_SORT_ORDER, onSortOrderChange, pinnedSortOrder = DEFAULT_PINNED_SORT_ORDER, onPinnedSortOrderChange, onCopySessionId, onShareSession }: Props) {
  const { t } = useTranslation()
  const sidebarSortLabel = (value: SidebarSortOrder): string => {
    switch (value) {
      case 'recent': return t('sidebar.sort_recent')
      case 'name': return t('sidebar.sort_name')
      case 'most_sessions': return t('sidebar.sort_most_sessions')
    }
  }
  const pinnedSortLabel = (value: PinnedSortOrder): string => {
    switch (value) {
      case 'recent_pinned': return t('sidebar.sort_recent_pinned')
      case 'recent': return t('sidebar.sort_recent_used')
      case 'name': return t('sidebar.sort_name')
    }
  }
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [pinned, setPinned] = useState<Session[] | null>(null)
  const [pinnedOpen, setPinnedOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [status?.totalSessions])

  useEffect(() => {
    let cancelled = false
    function refresh() {
      window.spool.listPinnedSessions()
        .then(result => { if (!cancelled) setPinned(result) })
        .catch(() => { if (!cancelled) setPinned([]) })
    }
    refresh()
    window.addEventListener('spool:pin-change', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('spool:pin-change', refresh)
    }
  }, [status?.totalSessions])

  const sortedPinned = useMemo(
    () => (pinned ? sortPinnedSessions(pinned, pinnedSortOrder) : null),
    [pinned, pinnedSortOrder],
  )
  const visibleGroups = (groups ?? []).filter(g => g.sessionCount > 0)
  const projectGroups = useMemo(
    () => sortProjectGroups(visibleGroups.filter(g => g.identityKind !== 'loose'), sortOrder),
    [visibleGroups, sortOrder],
  )
  const looseGroup = visibleGroups.find(g => g.identityKind === 'loose')

  return (
    <aside
      data-testid="sidebar"
      className="w-60 flex-none bg-warm-surface dark:bg-dark-surface flex flex-col h-full overflow-hidden"
    >
      <nav className="px-2 pt-1 pb-2 flex-none flex flex-col gap-0.5" aria-label={t('sidebar.library')}>
        {onSelectHome && (
          <NavRow
            testId="sidebar-library"
            icon={<LibraryIcon size={14} strokeWidth={1.75} />}
            label={t('sidebar.library')}
            active={isLibraryActive}
            onClick={onSelectHome}
          />
        )}
        {onSelectShares && (
          <NavRow
            testId="sidebar-shares"
            icon={<SharesIcon size={14} strokeWidth={1.75} />}
            label={t('sidebar.shares')}
            active={isSharesActive}
            onClick={onSelectShares}
          />
        )}
        {onSelectSecurity && securityFeatureEnabled() && (
          <NavRow
            testId="sidebar-security"
            icon={<SecurityIcon size={14} strokeWidth={1.75} />}
            label={t('sidebar.security')}
            active={isSecurityActive}
            onClick={onSelectSecurity}
            {...(securityHighCount > 0
              ? {
                  trailing: (
                    <span
                      data-testid="sidebar-security-badge"
                      className="inline-flex items-center text-accent dark:text-accent-dark"
                      title={t('sidebar.security_badge', { count: securityHighCount, defaultValue: '{{count}} high-risk finding' })}
                      aria-label={t('sidebar.security_badge', { count: securityHighCount, defaultValue: '{{count}} high-risk finding' })}
                    >
                      <AlertTriangle size={11} strokeWidth={1.6} aria-hidden />
                    </span>
                  ),
                }
              : {})}
          />
        )}
        {onOpenSearch && (
          <NavRow
            testId="sidebar-search"
            icon={<SearchIcon size={14} strokeWidth={1.75} />}
            label={t('sidebar.search')}
            trailing={<KbdHint>⌘K</KbdHint>}
            onClick={onOpenSearch}
          />
        )}
      </nav>

      {sortedPinned && sortedPinned.length > 0 && onSelectSession && (
        <div className="flex-none">
          <SectionHeader
            label={t('sidebar.pinned')}
            open={pinnedOpen}
            onToggle={() => setPinnedOpen(open => !open)}
            testId="sidebar-pinned-toggle"
            trailing={onPinnedSortOrderChange ? (
              <Menu
                align="right"
                testId="sidebar-pinned-sort-menu"
                trigger={({ open, toggle }) => (
                  <button
                    type="button"
                    data-testid="sidebar-pinned-sort-trigger"
                    onClick={toggle}
                    title={t('sidebar.sortBy')}
                    aria-label={t('sidebar.sortBy')}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    className={`flex-none inline-flex items-center justify-end h-4 transition-opacity text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text ${
                      open ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M1 3.5h12M2.5 7h9M5 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
                items={PINNED_SORT_OPTIONS.map(option => ({
                  label: pinnedSortLabel(option.value),
                  active: pinnedSortOrder === option.value,
                  onSelect: () => onPinnedSortOrderChange(option.value),
                }))}
              />
            ) : null}
          />
          {pinnedOpen && (
            <div className="px-2 max-h-40 overflow-y-auto scrollbar-none">
              {sortedPinned.map(session => (
                <PinnedRow
                  key={session.sessionUuid}
                  session={session}
                  active={session.sessionUuid === activeSessionUuid}
                  onClick={() => onSelectSession(session.sessionUuid)}
                  {...(onCopySessionId ? { onCopySessionId } : {})}
                  {...(onShareSession ? { onShare: onShareSession } : {})}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <SectionHeader
          label={t('sidebar.projects')}
          open={projectsOpen}
          onToggle={() => setProjectsOpen(open => !open)}
          testId="sidebar-projects-toggle"
          trailing={onSortOrderChange ? (
            <Menu
              align="right"
              testId="sidebar-sort-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="sidebar-sort-trigger"
                  onClick={toggle}
                  title={t('sidebar.sortBy')}
                  aria-label={t('sidebar.sortBy')}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={`flex-none inline-flex items-center justify-end h-4 transition-opacity text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text ${
                    open ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M1 3.5h12M2.5 7h9M5 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              items={SIDEBAR_SORT_OPTIONS.map(option => ({
                label: sidebarSortLabel(option.value),
                active: sortOrder === option.value,
                onSelect: () => onSortOrderChange(option.value),
              }))}
            />
          ) : null}
        />

        {projectsOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto pb-3 px-2 scrollbar-none [mask-image:linear-gradient(to_bottom,black_calc(100%_-_20px),transparent)]">
            {groups === null ? (
              <SidebarSkeleton />
            ) : projectGroups.length === 0 && !looseGroup ? (
              <p className="px-2 py-3 text-xs text-warm-faint dark:text-dark-muted">
                {t('sidebar.noProjects')}
              </p>
            ) : (
              <>
                {projectGroups.map(group => (
                  <ProjectRow
                    key={group.identityKey}
                    group={group}
                    active={group.identityKey === activeIdentityKey}
                    showSourceDots={showSourceDots}
                    showSessionCount={showSessionCount}
                    onClick={() => onSelectProject(group.identityKey)}
                  />
                ))}

                {looseGroup && (
                  <>
                    <div className="my-2 mx-2 border-t border-warm-border dark:border-dark-border" />
                    <ProjectRow
                      group={looseGroup}
                      active={looseGroup.identityKey === activeIdentityKey}
                      showSourceDots={showSourceDots}
                      showSessionCount={showSessionCount}
                      onClick={() => onSelectProject(looseGroup.identityKey)}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <UpdateBanner />
      <SidebarStatus
        syncStatus={syncStatus ?? null}
        status={status ?? null}
        {...(onSettingsClick ? { onSettingsClick } : {})}
      />
    </aside>
  )
}

function NavRow({
  testId,
  icon,
  label,
  active = false,
  trailing,
  onClick,
}: {
  testId?: string
  icon: ReactNode
  label: string
  active?: boolean
  trailing?: ReactNode
  onClick: () => void
}) {
  const dataAttrs = testId ? { 'data-testid': testId } : {}
  return (
    <button
      type="button"
      {...dataAttrs}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'w-full flex items-center gap-2 px-2 py-1 rounded-md transition-colors duration-75 text-[13px]',
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text',
      ].join(' ')}
    >
      <span className="flex-none w-4 h-4 inline-flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing}
    </button>
  )
}

function KbdHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex-none font-mono text-[10px] tabular-nums text-warm-faint/80 dark:text-dark-muted/80">
      {children}
    </kbd>
  )
}

function SidebarStatus({
  syncStatus,
  status,
  onSettingsClick,
}: {
  syncStatus: { phase: string; count: number; total: number } | null
  status: StatusInfo | null
  onSettingsClick?: () => void
}) {
  const { t } = useTranslation()
  const text = getSyncStatusText(syncStatus, status, t as unknown as StatusT)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div className="flex-none h-[30px] pl-4 pr-4 flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-status-success dark:bg-status-success-dark' : 'bg-status-warning dark:bg-status-warning-dark animate-pulse'}`} />
        <span data-testid="status-text" className="text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate" title={text}>
          {text}
        </span>
      </div>
      {onSettingsClick && (
        <button
          type="button"
          data-testid="settings-button"
          onClick={onSettingsClick}
          title={t('sidebar.settings')}
          aria-label={t('sidebar.settings')}
          className="flex-none inline-flex items-center justify-center h-4 text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <SettingsIcon size={13} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

type UpdateStatus = {
  status: 'available' | 'downloading' | 'ready' | 'error'
  version?: string | undefined
  percent?: number | undefined
}

function UpdateBanner() {
  const { t } = useTranslation()
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Tracks the last status that wasn't 'error' so we can decide whether
  // an error event interrupted a user-visible action (download in
  // progress) — silent failures during background checks shouldn't
  // surface a banner from nowhere.
  const lastStatusRef = useRef<UpdateStatus['status'] | null>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)
  // Optimistic UI: render the user-initiated next step immediately on click
  // (download takes 0.5–2s to emit its first progress event; install fires
  // app-quit but the renderer still wants instant acknowledgement). Cleared
  // when the real status event arrives.
  const [pending, setPending] = useState<'preparing' | 'restarting' | null>(null)

  useEffect(() => {
    if (!window.spool?.onUpdateStatus) return
    const off = window.spool.onUpdateStatus((data) => {
      if (data.status === 'error') {
        setPending(null)
        if (lastStatusRef.current === 'downloading') {
          setUpdate({ status: 'error' })
        } else {
          setUpdate(null)
        }
        return
      }
      lastStatusRef.current = data.status
      setErrorDismissed(false)
      setPending(null)
      setUpdate(data)
    })
    return () => { off() }
  }, [])

  if (!update && !pending) return null
  if (update?.status === 'error' && errorDismissed && !pending) return null

  const effectiveStatus =
    pending === 'preparing' ? 'downloading' :
    pending === 'restarting' ? 'restarting' :
    update?.status ?? null

  const isPassive = effectiveStatus === 'downloading' || effectiveStatus === 'restarting'
  const isError = effectiveStatus === 'error'

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pending) return // already kicked off
    if (update?.status === 'available' || update?.status === 'error') {
      setPending('preparing')
      void window.spool?.downloadUpdate()
    } else if (update?.status === 'ready') {
      setPending('restarting')
      void window.spool?.installUpdate()
    }
  }

  const label =
    pending === 'preparing' ? t('update.downloading', { percent: 0 }) :
    pending === 'restarting' ? t('update.restart') :
    update?.status === 'available' ? `${t('update.available')}${update.version ? ` · v${update.version}` : ''}` :
    update?.status === 'ready' ? t('update.ready') :
    update?.status === 'error' ? t('common.retry') :
    update?.percent != null ? t('update.downloading', { percent: update.percent }) : t('update.downloading', { percent: 0 })

  const baseRow = 'flex-none mx-2 mb-2 h-9 px-3 rounded-md flex items-center gap-2 text-[12px] bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text transition-all duration-150'

  const icon =
    effectiveStatus === 'available' ? (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ) : effectiveStatus === 'ready' ? (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ) : isError ? (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ) : (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none animate-spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    )

  if (isPassive) {
    return (
      <div data-testid={`update-banner-${effectiveStatus}`} className={`${baseRow} text-warm-muted dark:text-dark-muted`}>
        {icon}
        <span className="flex-1 min-w-0 truncate">{label}</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div data-testid="update-banner-error" className={`${baseRow} pr-1 text-warm-muted dark:text-dark-muted`}>
        <button
          type="button"
          data-testid="update-banner-error-retry"
          onClick={onClick}
          title={t('common.retry')}
          aria-label={t('common.retry')}
          className="flex-1 min-w-0 flex items-center gap-2 -mx-1 px-1 rounded cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-black/[0.08] dark:active:bg-white/[0.08] active:scale-[0.99] transition-all duration-150"
        >
          {icon}
          <span className="flex-1 min-w-0 truncate text-left">{label}</span>
        </button>
        <button
          type="button"
          data-testid="update-banner-error-dismiss"
          onClick={(e) => { e.stopPropagation(); setErrorDismissed(true) }}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="flex-none inline-flex items-center justify-center w-6 h-6 rounded cursor-pointer text-warm-faint dark:text-dark-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-warm-text dark:hover:text-dark-text active:bg-black/[0.1] dark:active:bg-white/[0.1] active:scale-[0.95] transition-all duration-150"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid={`update-banner-${effectiveStatus}`}
      onClick={onClick}
      title={label}
      className={`${baseRow} text-left w-auto cursor-pointer hover:brightness-95 dark:hover:brightness-110 active:brightness-90 dark:active:brightness-115 active:scale-[0.99]`}
    >
      {icon}
      <span className="flex-1 min-w-0 truncate">{label}</span>
    </button>
  )
}

type StatusT = (key: string, opts?: Record<string, unknown>) => string

function getSyncStatusText(
  syncStatus: { phase: string; count: number; total: number } | null,
  status: StatusInfo | null,
  t: StatusT,
): string {
  if (syncStatus) {
    if (syncStatus.phase === 'scanning') return t('status.scanning')
    if (syncStatus.phase === 'syncing') return t('status.indexing', { count: syncStatus.count, total: syncStatus.total })
    if (syncStatus.phase === 'indexing') return t('status.building')
    if (syncStatus.phase === 'done' && status) {
      return t('status.sessionsNow_other', { count: status.totalSessions })
    }
  }
  if (!status) return t('status.loading')
  const lastSync = status.lastSyncedAt ? formatShortTimeAgo(status.lastSyncedAt, t) : t('status.never')
  return t('status.sessionsAgo_other', { count: status.totalSessions, ago: lastSync })
}

function formatShortTimeAgo(iso: string, t: StatusT): string {
  try {
    const utcIso = iso.endsWith('Z') ? iso : iso + 'Z'
    const diff = Date.now() - new Date(utcIso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return t('status.now')
    if (minutes < 60) return t('status.minutesAgo', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('status.hoursAgo', { count: hours })
    return t('status.daysAgo', { count: Math.floor(hours / 24) })
  } catch {
    return iso
  }
}

function SectionHeader({
  label,
  open,
  onToggle,
  testId,
  trailing,
}: {
  label: string
  open: boolean
  onToggle: () => void
  testId?: string
  trailing?: ReactNode
}) {
  return (
    <div className="group mx-2 mt-1 px-2 py-1 flex items-center gap-1">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={onToggle}
        className="flex-1 flex items-center gap-1.5 text-left text-[11px] font-medium text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text rounded-md select-none"
      >
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {trailing}
    </div>
  )
}

function PinnedRow({
  session,
  active,
  onClick,
  onCopySessionId,
  onShare,
}: {
  session: Session
  active: boolean
  onClick: () => void
  onCopySessionId?: (source: SessionSource) => void
  onShare?: (uuid: string) => void
}) {
  const { t } = useTranslation()
  const [resuming, setResuming] = useState(false)
  const [unpinning, setUnpinning] = useState(false)
  const title = session.title?.trim() || t('common.noTitle')
  const projectName = session.projectDisplayName || session.projectDisplayPath
  const resumeCommand = getSessionResumeCommand(session.source, session.sessionUuid, session.cwd)

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId?.(session.source)
  }

  async function handleUnpin() {
    if (unpinning) return
    setUnpinning(true)
    try {
      await window.spool.unpinSession(session.sessionUuid)
      window.dispatchEvent(new CustomEvent('spool:pin-change', { detail: { sessionUuid: session.sessionUuid, pinned: false } }))
    } finally {
      setUnpinning(false)
    }
  }

  return (
    <div
      data-testid="sidebar-pinned-row"
      data-session-uuid={session.sessionUuid}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      aria-label={projectName ? `${title}, ${projectName}` : title}
      className={`group w-full text-left flex items-center gap-1 px-2 py-1 rounded-md transition-colors duration-75 focus:outline-none ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <span className="flex-1 truncate text-[13px]" title={title}>{title}</span>
      <span
        className="flex-none flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="sidebar-pinned-unpin"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { void handleUnpin() }}
          aria-label={t('sidebar.unpin')}
          disabled={unpinning}
          className="inline-flex items-center justify-center h-4 text-accent/80 dark:text-accent-dark/80 hover:text-accent dark:hover:text-accent-dark transition-colors disabled:opacity-50"
        >
          <PinIcon size={13} filled />
        </button>
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="sidebar-pinned-menu-trigger"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggle}
              aria-label={t('common.more')}
              aria-haspopup="menu"
              aria-expanded={open}
              className="inline-flex items-center justify-center h-4 text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
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
              label: resuming ? t('common.loading') : t('session.resume_inTerminal'),
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
  )
}

function ProjectRow({
  group,
  active,
  showSourceDots,
  showSessionCount,
  onClick,
}: {
  group: ProjectGroup
  active: boolean
  showSourceDots: boolean
  showSessionCount: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const sourceList = group.sources.map(getSessionSourceLabel).join(', ')
  const sessionCountText = t('sidebar.sessionCount_other', { count: group.sessionCount })
  const ariaLabel = sourceList
    ? `${group.displayName}, ${sourceList}, ${sessionCountText}`
    : `${group.displayName}, ${sessionCountText}`
  return (
    <button
      data-testid="sidebar-project-row"
      data-identity-key={group.identityKey}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md transition-colors duration-75 ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <FolderIcon active={active} />
      <span className="flex-1 truncate text-[13px]">
        {group.displayName}
      </span>
      {showSourceDots && <SourceDots sources={group.sources} />}
      {showSessionCount && (
        <span className="flex-none font-mono text-[11px] tabular-nums text-warm-faint/70 dark:text-dark-muted/70">
          {group.sessionCount}
        </span>
      )}
    </button>
  )
}

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`flex-none ${active ? 'text-warm-faint dark:text-dark-muted' : 'text-warm-faint/70 dark:text-dark-muted/70'}`}
    >
      <path
        d="M1.5 4.2c0-.55.45-1 1-1h3l1.2 1.3h4.8c.55 0 1 .45 1 1v5.3c0 .55-.45 1-1 1H2.5c-.55 0-1-.45-1-1V4.2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SourceDots({ sources }: { sources: SessionSource[] }) {
  if (sources.length === 0) return null
  const tooltip = sources.map(getSessionSourceLabel).join(' · ')
  return (
    <span aria-hidden="true" title={tooltip} className="flex-none flex items-center gap-1">
      {sources.map(source => (
        <span
          key={source}
          className="block w-1.5 h-1.5 rounded-full"
          style={{ background: getSessionSourceColor(source) }}
        />
      ))}
    </span>
  )
}

function SidebarSkeleton() {
  return (
    <div className="px-2 py-1 space-y-1.5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-6 rounded-md bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse"
        />
      ))}
    </div>
  )
}

function sortProjectGroups(groups: ProjectGroup[], order: SidebarSortOrder): ProjectGroup[] {
  const sorted = [...groups]
  switch (order) {
    case 'name':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
      return sorted
    case 'most_sessions':
      sorted.sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
        return compareLastSessionAtDesc(a, b)
      })
      return sorted
    case 'recent':
    default:
      sorted.sort(compareLastSessionAtDesc)
      return sorted
  }
}

function sortPinnedSessions(sessions: Session[], order: PinnedSortOrder): Session[] {
  const sorted = [...sessions]
  switch (order) {
    case 'name':
      sorted.sort((a, b) => {
        const at = (a.title ?? '').trim()
        const bt = (b.title ?? '').trim()
        return at.localeCompare(bt, undefined, { sensitivity: 'base' })
      })
      return sorted
    case 'recent':
      sorted.sort((a, b) => {
        const ae = a.endedAt ?? ''
        const be = b.endedAt ?? ''
        return be.localeCompare(ae)
      })
      return sorted
    case 'recent_pinned':
    default:
      return sorted
  }
}

function compareLastSessionAtDesc(a: ProjectGroup, b: ProjectGroup): number {
  if (!a.lastSessionAt && !b.lastSessionAt) return 0
  if (!a.lastSessionAt) return 1
  if (!b.lastSessionAt) return -1
  return b.lastSessionAt.localeCompare(a.lastSessionAt)
}
