// Shared chrome primitives for the spool.pro share-web pages. All five
// routes (Reader, Tombstone, Profile, Me, SignIn) compose Page + Header
// + Footer + the SW icon/avatar/wordmark vocab so a visual change lands
// in exactly one file.
//
// Theme contract: the root <html> carries data-theme = 'light' | 'dark'.
// ThemeToggle reads/writes that attribute + persists to localStorage;
// boot-time selection (system preference vs stored override) happens in
// main.tsx before React mounts, so there's no flash.

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { fetchMe } from '../lib/api'
import {
  type AuthIdentity,
  getCachedAuth,
  setCachedAuth,
} from '../lib/auth-cache'
import { readCachedMe } from '../lib/me-cache'

export type AuthState = AuthIdentity | 'auto'

async function resolveAuthState(): Promise<AuthIdentity> {
  const existing = getCachedAuth()
  if (existing) return existing
  const p = (async () => {
    const r = await fetchMe()
    if (r.kind === 'ok') {
      return { name: r.me.name, src: r.me.avatar_url } as AuthIdentity
    }
    return 'out' as AuthIdentity
  })()
  setCachedAuth(p)
  return p
}

const THEME_KEY = 'spool.share-web.theme'

function readThemeAttr(): 'light' | 'dark' {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'dark' ? 'dark' : 'light'
}

function writeThemeAttr(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore quota / private mode */
  }
}

export function bootTheme(): void {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
}

export function Page({
  children,
  surface,
}: {
  children: ReactNode
  /** Optional per-page surface override. 'paper' = parchment background,
   *  used by the Reader so the chrome blends into the template paper. */
  surface?: 'paper'
}) {
  return (
    <div className="sw-root">
      <div className="sw-page" data-surface={surface}>
        {children}
      </div>
    </div>
  )
}

function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <span className="sw-wordmark" style={{ fontSize: size }}>
      Spool<span className="dot">.</span>
    </span>
  )
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return ((parts[0]?.[0] ?? '') + (parts.at(-1)?.[0] ?? '')).toUpperCase()
}

export function Avatar({
  src,
  name,
  size = 32,
}: {
  src: string | null | undefined
  name: string | null | undefined
  size?: number
}) {
  const fontSize = Math.round(size * 0.4)
  // Track image-load failures so a blocked CDN (CSP, network) falls
  // through to initials instead of a broken-image icon.
  const [errored, setErrored] = useState(false)
  useEffect(() => {
    setErrored(false)
  }, [src])
  return (
    <span className="sw-avatar" style={{ width: size, height: size, fontSize }}>
      {src && !errored ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  )
}

type IconName =
  | 'external'
  | 'link'
  | 'link-2'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'x-circle'
  | 'arrow-right'
  | 'clock'
  | 'eye-off'
  | 'globe'
  | 'lock'
  | 'sun'
  | 'moon'
  | 'google'

export function Icon({
  name,
  size = 14,
  stroke = 1.6,
}: {
  name: IconName
  size?: number
  stroke?: number
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'external':
      return (
        <svg {...common}>
          <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10" />
          <path d="M9.5 2.5H13.5V6.5" />
          <path d="M13 3L7.5 8.5" />
        </svg>
      )
    case 'link':
      return (
        <svg {...common}>
          <path d="M6.5 9.5a2.5 2.5 0 0 0 3.6.1l2-2a2.55 2.55 0 0 0-3.6-3.6l-1.1 1.1" />
          <path d="M9.5 6.5a2.5 2.5 0 0 0-3.6-.1l-2 2a2.55 2.55 0 0 0 3.6 3.6l1.1-1.1" />
        </svg>
      )
    case 'link-2':
      // Lucide-style link-2: straight chain — distinct from the curvy
      // `link` glyph used by the copy-link button, so a meta-line
      // visibility marker (link-only share) doesn't read as the same
      // affordance as the copy action sitting next to it.
      return (
        <svg {...common}>
          <path d="M5 8h6" />
          <path d="M5.5 4.5h-2A2.5 2.5 0 0 0 1 7v2a2.5 2.5 0 0 0 2.5 2.5h2" />
          <path d="M10.5 4.5h2A2.5 2.5 0 0 1 15 7v2a2.5 2.5 0 0 1-2.5 2.5h-2" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12" />
          <path d="M8 2c1.7 2 2.6 4 2.6 6S9.7 14 8 14c-1.7 0-2.6-2-2.6-6S6.3 2 8 2z" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <path d="M3 8.5L6.5 12 13 4.5" />
        </svg>
      )
    case 'check-circle':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8L7.2 9.8 10.5 6" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...common}>
          <path d="M8 2.2L14.5 13.5h-13L8 2.2z" />
          <path d="M8 6.5v3.2" />
          <circle cx="8" cy="11.6" r="0.2" />
        </svg>
      )
    case 'x-circle':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8V8l2.2 1.4" />
        </svg>
      )
    case 'eye-off':
      return (
        <svg {...common}>
          <path d="M6.2 6.2A2.4 2.4 0 0 0 8 10.4a2.4 2.4 0 0 0 1.8-.8" />
          <path d="M2 8s2.4-4.2 6-4.2c.9 0 1.7.2 2.4.6M13.4 6.2A9 9 0 0 1 14 8s-2.4 4.2-6 4.2c-.5 0-1-.06-1.4-.18" />
          <path d="M2.5 2.5l11 11" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...common}>
          <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.4" />
          <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M13 9.4A5.2 5.2 0 0 1 6.6 3 5.3 5.3 0 1 0 13 9.4z" />
        </svg>
      )
    case 'google':
      return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
          <path
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            fill="#4285F4"
          />
          <path
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            fill="#34A853"
          />
          <path
            d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"
            fill="#FBBC05"
          />
          <path
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            fill="#EA4335"
          />
        </svg>
      )
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readThemeAttr())
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    writeThemeAttr(next)
    setTheme(next)
  }, [theme])
  return (
    <button
      type="button"
      className="sw-theme-toggle"
      onClick={toggle}
      title="Toggle theme"
      aria-label="Toggle light or dark"
    >
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
    </button>
  )
}

export function Header({ auth = 'auto' as AuthState }: { auth?: AuthState }) {
  // 'auto' = SWR pattern: first frame paints from the localStorage
  // cache, background fetchMe revalidates and rewrites. 'out' or an
  // explicit object lets a page short-circuit (SignIn knows the user
  // is unauthenticated by definition).
  const [resolved, setResolved] = useState<AuthState>(() => {
    if (auth !== 'auto') return auth
    const cached = readCachedMe()
    return cached
      ? ({ name: cached.name, src: cached.avatar_url } as AuthState)
      : 'out'
  })

  useEffect(() => {
    if (auth !== 'auto') return
    let alive = true
    resolveAuthState().then((next) => {
      if (alive) setResolved(next)
    })
    return () => {
      alive = false
    }
  }, [auth])

  return (
    <header className="sw-header">
      <a href="https://spool.pro/" aria-label="Spool home">
        <Wordmark />
      </a>
      <div className="sw-header-right">
        <ThemeToggle />
        {resolved === 'out' || resolved === 'auto' ? (
          <a className="sw-signin-link" href="/sign-in">
            Sign in
          </a>
        ) : (
          <a href="/me" title="Your account" style={{ display: 'inline-flex' }}>
            <Avatar src={resolved.src} name={resolved.name} size={30} />
          </a>
        )}
      </div>
    </header>
  )
}

export function Footer({
  report,
  reportHref,
}: {
  report?: boolean
  reportHref?: string
}) {
  return (
    <footer className="sw-footer">
      {report && reportHref && (
        <>
          <a href={reportHref} rel="nofollow">
            Report this share
          </a>
          <span className="sep">·</span>
        </>
      )}
      <a href="https://spool.pro">Learn about Spool</a>
      <span className="sep">·</span>
      <a href="/terms">Terms</a>
      <span className="sep">·</span>
      <a href="/privacy">Privacy</a>
    </footer>
  )
}

export function SpoolMark({
  size = 28,
  color = 'currentColor',
}: {
  size?: number
  color?: string
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke={color}
    >
      <ellipse cx="16" cy="9" rx="12" ry="4.5" strokeWidth="1.8" />
      <line x1="4" y1="9" x2="4" y2="22" strokeWidth="1.8" />
      <line x1="28" y1="9" x2="28" y2="22" strokeWidth="1.8" />
      <path
        d="M4 22 C4 24.5 9 27 16 27 C23 27 28 24.5 28 22"
        strokeWidth="1.8"
      />
      <ellipse cx="16" cy="11" rx="7" ry="2.5" strokeWidth="1.2" />
      <line x1="9" y1="11" x2="9" y2="20" strokeWidth="1.2" />
      <line x1="23" y1="11" x2="23" y2="20" strokeWidth="1.2" />
      <path
        d="M9 20 C9 21.5 12 23 16 23 C20 23 23 21.5 23 20"
        strokeWidth="1.2"
      />
      <ellipse cx="16" cy="11" rx="3" ry="1.2" fill={color} stroke="none" />
    </svg>
  )
}
