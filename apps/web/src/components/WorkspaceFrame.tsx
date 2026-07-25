import {
  Avatar,
  Button,
  ButtonLink,
  IconButton,
  MobileMenu,
  NavItem,
  Wordmark,
} from '@spool-lab/ui'
import {
  ChevronDown,
  Compass,
  Library,
  Moon,
  Plus,
  Search,
  Sun,
  UserRound,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'

import '../styles/workspace.css'

import { AUTH_IDENTITY_CHANGED, type AuthIdentity } from '../lib/auth-cache'
import { resolveAuthState } from '../lib/auth-state'
import { readCachedMe } from '../lib/me-cache'
import { fetchTeams, TEAM_SUMMARY_CHANGED, type TeamSummary } from '../lib/team-api'
import { readThemeAttr, writeThemeAttr } from '../lib/theme'
import { AccountMenu } from './AccountMenu'
import { SessionLanguageToggle } from './SessionLanguageToggle'

export type WorkspaceDestination = 'feed' | 'library' | 'teams'

interface WorkspaceFrameProps {
  active: WorkspaceDestination
  activeTeamId?: string | undefined
  children: ReactNode
  mainClassName?: string
  rootClassName?: string
}

const PRIMARY_DESTINATIONS: ReadonlyArray<{
  id: WorkspaceDestination
  href: string
  label: string
  icon: typeof Compass
}> = [
  { id: 'feed', href: '/sessions', label: 'Sessions', icon: Compass },
  { id: 'library', href: '/my-sessions', label: 'My Sessions', icon: Library },
]

function WorkspaceThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  // The server and hydration frame both render light controls. The boot
  // script has already applied the real page theme; the control catches up
  // after mount without asking React to discard its SSR tree.
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => setTheme(readThemeAttr()), [])
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    writeThemeAttr(next)
    setTheme(next)
  }, [theme])
  const label = theme === 'dark' ? 'Use light theme' : 'Use dark theme'
  const ThemeIcon = theme === 'dark' ? Moon : Sun

  if (showLabel) {
    return (
      <Button className={className} size="lg" variant="ghost" onClick={toggle} aria-label={label}>
        <ThemeIcon size={15} aria-hidden="true" />
        <span>{label}</span>
      </Button>
    )
  }

  return (
    <IconButton className={className} size="sm" onClick={toggle} title={label} aria-label={label}>
      <ThemeIcon size={15} aria-hidden="true" />
    </IconButton>
  )
}

export function WorkspacePrimaryNavigation({
  active,
  activeTeamId,
  className,
  label,
  teams,
  teamsAlwaysExpanded = false,
  teamsConfirmed,
}: {
  active: WorkspaceDestination
  activeTeamId?: string | undefined
  className: string
  label: string
  teams: TeamSummary[]
  teamsAlwaysExpanded?: boolean
  teamsConfirmed: boolean
}) {
  const navigationId = useId().replace(/:/g, '')
  const [teamsExpanded, setTeamsExpanded] = useState(active === 'teams' || teamsAlwaysExpanded)

  useEffect(() => {
    if (active === 'teams' || teamsAlwaysExpanded) setTeamsExpanded(true)
  }, [active, teamsAlwaysExpanded])

  return (
    <nav className={className} aria-label={label}>
      {PRIMARY_DESTINATIONS.map((item) => {
        const Icon = item.icon
        return (
          <NavItem
            key={item.id}
            aria-label={item.label}
            href={item.href}
            active={active === item.id}
            leading={<Icon aria-hidden="true" />}
          >
            {item.label}
          </NavItem>
        )
      })}
      <div className="workspace-team-navigation">
        {teamsConfirmed && !teamsAlwaysExpanded ? (
          <NavItem
            aria-label="Teams"
            active={active === 'teams'}
            current={false}
            aria-controls={`workspace-teams-${navigationId}`}
            aria-expanded={teamsExpanded}
            leading={<Users aria-hidden="true" />}
            trailing={
              <ChevronDown
                className="workspace-team-navigation-chevron"
                aria-hidden="true"
                data-expanded={teamsExpanded || undefined}
              />
            }
            onClick={() => setTeamsExpanded((expanded) => !expanded)}
          >
            Teams
          </NavItem>
        ) : (
          <NavItem
            aria-label="Teams"
            href="/teams"
            active={active === 'teams'}
            leading={<Users aria-hidden="true" />}
          >
            Teams
          </NavItem>
        )}
        {teamsConfirmed && (teamsExpanded || teamsAlwaysExpanded) ? (
          <div id={`workspace-teams-${navigationId}`} className="workspace-team-navigation-items">
            {teams.map((team) => (
              <NavItem
                key={team.id}
                className="workspace-team-navigation-item"
                href={`/teams/${encodeURIComponent(team.id)}`}
                active={activeTeamId === team.id}
                title={team.name}
              >
                {team.name}
              </NavItem>
            ))}
            <NavItem
              className="workspace-team-navigation-item workspace-team-create-link"
              href="/teams"
              active={active === 'teams' && activeTeamId === undefined}
              leading={<Plus aria-hidden="true" />}
            >
              Create team
            </NavItem>
          </div>
        ) : null}
      </div>
    </nav>
  )
}

function useWorkspaceIdentity(): AuthIdentity {
  const [identity, setIdentity] = useState<AuthIdentity>('out')

  useEffect(() => {
    const cached = readCachedMe()
    if (cached) setIdentity({ name: cached.name, src: cached.avatar_url })

    let alive = true
    const onIdentityChanged = (event: WindowEventMap[typeof AUTH_IDENTITY_CHANGED]) => {
      if (alive) setIdentity(event.detail)
    }
    window.addEventListener(AUTH_IDENTITY_CHANGED, onIdentityChanged)
    void resolveAuthState().then((next) => {
      if (alive) setIdentity(next)
    })

    return () => {
      alive = false
      window.removeEventListener(AUTH_IDENTITY_CHANGED, onIdentityChanged)
    }
  }, [])

  return identity
}

type WorkspaceTeamsState =
  | { kind: 'unknown' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; teams: TeamSummary[] }

function useWorkspaceTeams(): WorkspaceTeamsState {
  const [state, setState] = useState<WorkspaceTeamsState>({ kind: 'unknown' })

  useEffect(() => {
    let alive = true
    const refresh = () =>
      void fetchTeams().then((result) => {
        if (!alive) return
        setState(
          result.kind === 'ok'
            ? { kind: 'ready', teams: result.data.teams }
            : { kind: 'unavailable' },
        )
      })
    const onTeamSummaryChanged = (event: WindowEventMap[typeof TEAM_SUMMARY_CHANGED]) => {
      if (!alive) return
      setState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              teams: current.teams.map((team) =>
                team.id === event.detail.id ? event.detail : team,
              ),
            }
          : current,
      )
      // Revalidate after the immediate copy update so role, permissions, and
      // membership state still come from the server-confirmed projection.
      refresh()
    }

    window.addEventListener(TEAM_SUMMARY_CHANGED, onTeamSummaryChanged)
    refresh()
    return () => {
      alive = false
      window.removeEventListener(TEAM_SUMMARY_CHANGED, onTeamSummaryChanged)
    }
  }, [])

  return state
}

function UtilityLinks({ identity }: { identity: AuthIdentity }) {
  return (
    <nav className="workspace-sidebar-utilities" aria-label="Account and resources">
      {identity === 'out' ? (
        <a className="workspace-account-link" href="/sign-in">
          <UserRound size={14} strokeWidth={1.7} aria-hidden="true" />
          <span>Sign in</span>
        </a>
      ) : (
        <a className="workspace-account-link" href="/me">
          <Avatar src={identity.src} name={identity.name} alt="" size="sm" />
          <span>Account</span>
        </a>
      )}
      <div className="workspace-resource-links">
        <a href="/docs/installation">Docs</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/paperboytm/spool">GitHub</a>
      </div>
    </nav>
  )
}

function WorkspaceSidebar({
  active,
  activeTeamId,
  identity,
  teamsState,
}: {
  active: WorkspaceDestination
  activeTeamId?: string | undefined
  identity: AuthIdentity
  teamsState: WorkspaceTeamsState
}) {
  return (
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <a className="workspace-wordmark" href="/" aria-label="Spool home">
        <Wordmark />
      </a>
      <WorkspacePrimaryNavigation
        active={active}
        activeTeamId={activeTeamId}
        className="workspace-primary-navigation"
        label="Primary navigation"
        teams={teamsState.kind === 'ready' ? teamsState.teams : []}
        teamsConfirmed={teamsState.kind === 'ready'}
      />
      <div className="workspace-sidebar-footer">
        <UtilityLinks identity={identity} />
        <div
          className="workspace-sidebar-preferences"
          role="group"
          aria-label="Reading preferences"
        >
          <SessionLanguageToggle className="workspace-language-toggle" />
          <WorkspaceThemeToggle className="workspace-theme-toggle" />
        </div>
      </div>
    </aside>
  )
}

export function WorkspaceMobileHeader({
  active,
  activeTeamId,
  identity,
  teamsState = { kind: 'unknown' },
}: {
  active: WorkspaceDestination
  activeTeamId?: string | undefined
  identity: AuthIdentity
  teamsState?: WorkspaceTeamsState
}) {
  return (
    <header className="workspace-mobile-header">
      <a href="/" aria-label="Spool home">
        <Wordmark />
      </a>
      <div className="workspace-mobile-header-actions">
        {identity === 'out' ? (
          <ButtonLink href="/sign-in" size="sm" variant="ghost">
            Sign in
          </ButtonLink>
        ) : (
          <AccountMenu name={identity.name} src={identity.src} />
        )}
        <MobileMenu
          className="workspace-mobile-menu"
          triggerLabel="Open navigation"
          closeLabel="Close navigation"
        >
          <WorkspacePrimaryNavigation
            active={active}
            activeTeamId={activeTeamId}
            className="workspace-mobile-menu-primary"
            label="Mobile workspace navigation"
            teams={teamsState.kind === 'ready' ? teamsState.teams : []}
            teamsAlwaysExpanded
            teamsConfirmed={teamsState.kind === 'ready'}
          />
          <nav className="workspace-mobile-menu-utilities" aria-label="Mobile resources">
            <NavItem href="/sessions" leading={<Search aria-hidden="true" />}>
              Search Sessions
            </NavItem>
            <ButtonLink href="/docs/quick-start" size="lg" variant="accent">
              Publish
            </ButtonLink>
            <WorkspaceThemeToggle className="workspace-mobile-theme" showLabel />
            <SessionLanguageToggle className="workspace-mobile-language" showLabel />
            <div className="workspace-mobile-menu-resources">
              <a href="/docs/installation">Docs</a>
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
              <a href="https://github.com/paperboytm/spool">GitHub</a>
            </div>
          </nav>
        </MobileMenu>
      </div>
    </header>
  )
}

export function WorkspaceFrame({
  active,
  activeTeamId,
  children,
  mainClassName,
  rootClassName,
}: WorkspaceFrameProps) {
  const identity = useWorkspaceIdentity()
  const teamsState = useWorkspaceTeams()
  const rootClasses = ['sw-root', 'workspace-root', rootClassName].filter(Boolean).join(' ')
  const mainClasses = ['workspace-main', mainClassName].filter(Boolean).join(' ')

  return (
    <div className={rootClasses}>
      <div className="workspace-shell">
        <WorkspaceSidebar
          active={active}
          activeTeamId={activeTeamId}
          identity={identity}
          teamsState={teamsState}
        />
        <main className={mainClasses}>
          <WorkspaceMobileHeader
            active={active}
            activeTeamId={activeTeamId}
            identity={identity}
            teamsState={teamsState}
          />
          {children}
        </main>
      </div>
    </div>
  )
}
