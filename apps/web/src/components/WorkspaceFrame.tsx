import {
  Avatar,
  Button,
  ButtonLink,
  IconButton,
  MobileMenu,
  NavItem,
  Wordmark,
} from '@spool-lab/ui'
import { Compass, Library, Moon, Search, Sun, UserRound, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import '../styles/workspace.css'

import { AUTH_IDENTITY_CHANGED, type AuthIdentity } from '../lib/auth-cache'
import { resolveAuthState } from '../lib/auth-state'
import { readCachedMe } from '../lib/me-cache'
import { readThemeAttr, writeThemeAttr } from '../lib/theme'
import { AccountMenu } from './AccountMenu'

export type WorkspaceDestination = 'feed' | 'library' | 'teams'

interface WorkspaceFrameProps {
  active: WorkspaceDestination
  children: ReactNode
  rightRail?: ReactNode
  layout?: 'feed' | 'wide'
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
  { id: 'teams', href: '/teams', label: 'Teams', icon: Users },
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

function PrimaryNavigation({
  active,
  className,
  label,
}: {
  active: WorkspaceDestination
  className: string
  label: string
}) {
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
  identity,
}: {
  active: WorkspaceDestination
  identity: AuthIdentity
}) {
  return (
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <a className="workspace-wordmark" href="/" aria-label="Spool home">
        <Wordmark />
      </a>
      <PrimaryNavigation
        active={active}
        className="workspace-primary-navigation"
        label="Primary navigation"
      />
      <div className="workspace-sidebar-footer">
        <UtilityLinks identity={identity} />
        <WorkspaceThemeToggle className="workspace-theme-toggle" />
      </div>
    </aside>
  )
}

export function WorkspaceMobileHeader({
  active,
  identity,
}: {
  active: WorkspaceDestination
  identity: AuthIdentity
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
          <PrimaryNavigation
            active={active}
            className="workspace-mobile-menu-primary"
            label="Mobile workspace navigation"
          />
          <nav className="workspace-mobile-menu-utilities" aria-label="Mobile resources">
            <NavItem href="/sessions" leading={<Search aria-hidden="true" />}>
              Search Sessions
            </NavItem>
            <ButtonLink href="/docs/quick-start" size="lg" variant="accent">
              Publish
            </ButtonLink>
            <WorkspaceThemeToggle className="workspace-mobile-theme" showLabel />
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
  children,
  rightRail,
  layout = 'wide',
  mainClassName,
  rootClassName,
}: WorkspaceFrameProps) {
  const identity = useWorkspaceIdentity()
  const withRightRail = rightRail !== undefined
  const shellClassName = ['workspace-shell', `is-${layout}`, withRightRail ? 'has-right-rail' : '']
    .filter(Boolean)
    .join(' ')
  const rootClasses = ['sw-root', 'workspace-root', rootClassName].filter(Boolean).join(' ')
  const mainClasses = ['workspace-main', mainClassName].filter(Boolean).join(' ')

  return (
    <div className={rootClasses}>
      <div className={shellClassName}>
        <WorkspaceSidebar active={active} identity={identity} />
        <main className={mainClasses}>
          <WorkspaceMobileHeader active={active} identity={identity} />
          {children}
        </main>
        {rightRail}
      </div>
    </div>
  )
}
