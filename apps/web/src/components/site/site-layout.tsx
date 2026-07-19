import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { readThemeAttr, writeThemeAttr } from '../../lib/theme'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <header className="top">
        <div className="wrap top-inner">
          <Link to="/" className="brand">
            <SpoolMark />
            Spool<span className="dot">.</span>
          </Link>
          <nav className="links">
            <Link to="/explore" search={{ sort: 'recommended' }}>
              Explore
            </Link>
            <Link to="/docs/$" params={{ _splat: 'installation' }}>
              Docs
            </Link>
            <Link to="/blog">Blog</Link>
            <span className="sep" />
            <a href="https://github.com/spool-lab/spool" className="iconbtn" aria-label="GitHub">
              <GhIcon />
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <div className="page-content">{children}</div>

      <footer className="wrap">
        <div className="foot-left">
          <div className="foot-prods">
            <Link to="/" className="foot-prod">
              <strong>Spool</strong>
              <span style={{ color: 'var(--accent)' }}>.</span>
            </Link>
          </div>
          <div>
            Share, understand, and continue agent Sessions. Made by{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              spool-lab
            </strong>
            .
          </div>
          <div className="legal">MIT · MADE IN THE OPEN · 2026</div>
          <div className="legal">SPOOL™ IS A TRADEMARK OF TYPESAFE LIMITED</div>
        </div>
        <div className="foot-right">
          <div>
            <Link to="/explore" search={{ sort: 'recommended' }}>
              Explore
            </Link>{' '}
            &nbsp;·&nbsp; <a href="https://github.com/spool-lab/spool">GitHub</a> &nbsp;·&nbsp;{' '}
            <a href="https://discord.gg/aqeDxQUs5E">Discord</a> &nbsp;·&nbsp;{' '}
            <a href="https://x.com/spoollabs">X</a> &nbsp;·&nbsp; <Link to="/blog">Blog</Link>
          </div>
          <div className="legal">SPOOL-LAB · @ MAIN</div>
        </div>
      </footer>
    </div>
  )
}

function SpoolMark() {
  return (
    <svg
      className="brand-mark"
      width="22"
      height="22"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
    >
      <ellipse cx="16" cy="9" rx="12" ry="4.5" strokeWidth="1.8" />
      <line x1="4" y1="9" x2="4" y2="22" strokeWidth="1.8" />
      <line x1="28" y1="9" x2="28" y2="22" strokeWidth="1.8" />
      <path d="M4 22 C4 24.5 9 27 16 27 C23 27 28 24.5 28 22" strokeWidth="1.8" />
      <ellipse cx="16" cy="11" rx="7" ry="2.5" strokeWidth="1.2" />
      <line x1="9" y1="11" x2="9" y2="20" strokeWidth="1.2" />
      <line x1="23" y1="11" x2="23" y2="20" strokeWidth="1.2" />
      <path d="M9 20 C9 21.5 12 23 16 23 C20 23 23 21.5 23 20" strokeWidth="1.2" />
      <ellipse cx="16" cy="11" rx="3" ry="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
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
    <button className="iconbtn" onClick={onClick} aria-label="Toggle theme" type="button">
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
    </button>
  )
}
