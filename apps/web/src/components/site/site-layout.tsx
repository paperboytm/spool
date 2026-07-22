import { IconButton, IconLink, NavItem, Wordmark } from '@spool-lab/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type MouseEvent } from 'react'

import { readThemeAttr, writeThemeAttr } from '../../lib/theme'
import { SpoolMark } from './spool-mark'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  return (
    <div className="page-shell">
      <header className="top">
        <div className="wrap top-inner">
          <Link to="/" className="brand">
            <SpoolMark className="brand-mark" size={22} />
            <Wordmark />
          </Link>
          <nav className="links">
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
              href="/docs/installation"
              onClick={(event) =>
                routeInApp(event, () =>
                  navigate({ to: '/docs/$', params: { _splat: 'installation' } }),
                )
              }
            >
              Docs
            </NavItem>
            <NavItem
              className="nav-hideable"
              href="/blog"
              onClick={(event) => routeInApp(event, () => navigate({ to: '/blog' }))}
            >
              Blog
            </NavItem>
            <span className="sep" />
            <IconLink href="https://github.com/paperboytm/spool" size="sm" aria-label="GitHub">
              <GhIcon />
            </IconLink>
            <ThemeToggle />
          </nav>
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

function GhIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    setIsDark(readThemeAttr() === 'dark')
  }, [])
  const onClick = () => {
    const next = isDark ? 'light' : 'dark'
    writeThemeAttr(next)
    setIsDark(!isDark)
  }
  return (
    <IconButton size="sm" onClick={onClick} aria-label="Toggle theme" type="button">
      {isDark ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </IconButton>
  )
}
