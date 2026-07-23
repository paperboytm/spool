import {
  Avatar,
  Button,
  ButtonLink,
  IconButton,
  IconLink,
  MobileMenu,
  NavItem,
  Wordmark,
} from '@spool-lab/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { BookOpen, Moon, Search, Sun, Users } from 'lucide-react'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'

import { AUTH_IDENTITY_CHANGED, type AuthIdentity } from '../../lib/auth-cache'
import { resolveAuthState, type AuthState } from '../../lib/auth-state'
import { readCachedMe } from '../../lib/me-cache'
import { readThemeAttr, writeThemeAttr } from '../../lib/theme'
import { SpoolMark } from './spool-mark'

export default function SiteLayout({
  children,
  auth = 'auto',
}: {
  children: ReactNode
  auth?: AuthState
}) {
  const navigate = useNavigate()
  const resolvedAuth = useSiteAuth(auth)

  return (
    <div className="page-shell">
      <header className="top">
        <div className="wrap top-inner">
          <Link to="/" className="brand">
            <SpoolMark className="brand-mark" size={22} />
            <Wordmark />
          </Link>

          <nav className="site-main-nav" aria-label="Primary">
            <NavItem
              href="/explore?sort=recommended"
              onClick={(event) =>
                routeInApp(event, () =>
                  navigate({ to: '/explore', search: { sort: 'recommended' } }),
                )
              }
            >
              Explore
            </NavItem>
            <NavItem
              className="site-docs-link"
              href="/docs/installation"
              aria-label="Docs"
              leading={<BookOpen aria-hidden="true" />}
              onClick={(event) =>
                routeInApp(event, () =>
                  navigate({ to: '/docs/$', params: { _splat: 'installation' } }),
                )
              }
            >
              Docs
            </NavItem>
            <IconLink
              className="site-search-link"
              href="/explore"
              size="sm"
              aria-label="Search Sessions"
              onClick={(event) =>
                routeInApp(event, () =>
                  navigate({ to: '/explore', search: { sort: 'recommended' } }),
                )
              }
            >
              <Search aria-hidden="true" />
            </IconLink>
            <NavItem
              className="nav-hideable"
              href="/blog"
              onClick={(event) => routeInApp(event, () => navigate({ to: '/blog' }))}
            >
              Blog
            </NavItem>
          </nav>

          <div className="site-nav-actions">
            <ButtonLink
              className="site-publish-link"
              href="/docs/quick-start"
              size="sm"
              variant="accent"
            >
              Publish
            </ButtonLink>
            <ThemeToggle className="nav-hideable site-theme-toggle" />
            <SiteAccountActions auth={resolvedAuth} />
            <SiteMobileNavigation auth={resolvedAuth} />
          </div>
        </div>
      </header>

      <div className="page-content">{children}</div>

      <footer className="wrap">
        <div className="foot-top">
          <a href="https://paperboy.com" className="foot-brand">
            <SpoolMark size={18} />
            <span>
              Spool<span className="foot-dot">.</span>
            </span>
            <span className="foot-by">by Paperboy</span>
          </a>
          <div className="foot-links">
            <Link to="/explore" search={{ sort: 'recommended' }}>
              Explore
            </Link>
            <Link to="/docs/$" params={{ _splat: 'quick-start' }}>
              Publish
            </Link>
            <Link to="/docs/$" params={{ _splat: 'installation' }}>
              Docs
            </Link>
            <a href="https://github.com/paperboytm/spool">GitHub</a>
            <a href="https://discord.gg/aqeDxQUs5E">Discord</a>
            <a href="https://x.com/spoollabs">X</a>
            <Link to="/blog">Blog</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

/**
 * The account affordance is deliberately separate from the primary links:
 * login changes identity, not which Sessions the visitor is authorized to
 * read. Team and account links are navigation shortcuts only.
 */
export function SiteAccountActions({ auth }: { auth: AuthIdentity }) {
  if (auth === 'out') {
    return (
      <ButtonLink className="site-signin-link" href="/sign-in" size="sm" variant="ghost">
        Sign in
      </ButtonLink>
    )
  }

  return (
    <>
      <a className="site-team-link" href="/me#teams" title="Open your teams">
        <Users size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>Teams</span>
      </a>
      <a
        className="site-account-link"
        href="/me"
        title="Your account"
        aria-label="Open your account"
      >
        <Avatar src={auth.src} name={auth.name} alt="" size="md" />
      </a>
    </>
  )
}

export function SiteMobileNavigation({ auth }: { auth: AuthIdentity }) {
  return (
    <MobileMenu
      className="site-mobile-menu"
      triggerLabel="Open navigation"
      closeLabel="Close navigation"
    >
      <nav className="site-mobile-menu-items" aria-label="Mobile navigation">
        <NavItem href="/explore?sort=recommended">Explore</NavItem>
        <NavItem href="/docs/installation" leading={<BookOpen aria-hidden="true" />}>
          Docs
        </NavItem>
        <NavItem href="/explore" leading={<Search aria-hidden="true" />}>
          Search Sessions
        </NavItem>
        <NavItem href="/blog">Blog</NavItem>
        <ButtonLink href="/docs/quick-start" size="lg" variant="accent">
          Publish
        </ButtonLink>
        <ThemeToggle className="site-mobile-theme-toggle" showLabel />
        {auth === 'out' ? null : (
          <NavItem href="/me#teams" leading={<Users aria-hidden="true" />}>
            Teams
          </NavItem>
        )}
      </nav>
    </MobileMenu>
  )
}

function useSiteAuth(auth: AuthState): AuthIdentity {
  // The server and hydration frame both render signed-out chrome. Once
  // mounted, the local identity cache paints immediately while `/api/me`
  // revalidates it in the background.
  const [resolved, setResolved] = useState<AuthIdentity>(auth === 'auto' ? 'out' : auth)

  useEffect(() => {
    if (auth !== 'auto') {
      setResolved(auth)
      return
    }

    const cached = readCachedMe()
    if (cached) setResolved({ name: cached.name, src: cached.avatar_url })

    let alive = true
    const onIdentityChanged = (event: WindowEventMap[typeof AUTH_IDENTITY_CHANGED]) => {
      if (alive) setResolved(event.detail)
    }
    window.addEventListener(AUTH_IDENTITY_CHANGED, onIdentityChanged)
    void resolveAuthState().then((next) => {
      if (alive) setResolved(next)
    })

    return () => {
      alive = false
      window.removeEventListener(AUTH_IDENTITY_CHANGED, onIdentityChanged)
    }
  }, [auth])

  return resolved
}

function routeInApp(event: MouseEvent<HTMLAnchorElement>, navigate: () => void | Promise<void>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  void navigate()
}

function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
} = {}) {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    setIsDark(readThemeAttr() === 'dark')
  }, [])
  const onClick = () => {
    const next = isDark ? 'light' : 'dark'
    writeThemeAttr(next)
    setIsDark(!isDark)
  }
  const label = isDark ? 'Use light theme' : 'Use dark theme'
  if (showLabel) {
    return (
      <Button className={className} size="lg" variant="ghost" onClick={onClick} aria-label={label}>
        {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        <span>{label}</span>
      </Button>
    )
  }
  return (
    <IconButton
      className={className}
      size="sm"
      onClick={onClick}
      aria-label="Toggle theme"
      type="button"
    >
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </IconButton>
  )
}
