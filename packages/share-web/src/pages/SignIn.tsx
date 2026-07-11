// Static sign-in screen. The actual OAuth dance happens server-side at
// /api/auth/<provider>/start, which sets the session cookie and bounces
// back to `next`. `next` is already sanitized by the router via
// nextSafe(); we redefend on the click in case this page is reached
// directly.
//
// Provider list is data-driven — adding GitHub / email is one entry
// here plus the matching backend provider registration. The visual
// layout stays the same; only the button count grows.

import { useEffect, useState, type ReactNode } from 'react'

import { Footer, Header, Icon, Page, SpoolMark } from '../components/Chrome'
import { fetchMe } from '../lib/api'
import { nextSafe } from '../lib/route'

interface Props {
  next: string
}

type ProviderId = 'google'

interface ProviderEntry {
  id: ProviderId
  label: string
  icon: ReactNode
}

// Registered providers, rendered in order. v0.5 ships Google-only;
// adding GitHub is one extra entry + a matching backend provider.
const PROVIDERS: readonly ProviderEntry[] = [
  { id: 'google', label: 'Continue with Google', icon: <Icon name="google" size={18} /> },
]

function authStartHref(provider: ProviderId, dest: string): string {
  return `/api/auth/${provider}/start?next=${encodeURIComponent(dest)}`
}

export function SignIn({ next }: Props) {
  // share-web doesn't own `/` — in prod that's the landing site, in
  // dev it's empty → tombstone. When the caller didn't pin a `next`,
  // /me is the only post-auth destination that makes sense on this
  // origin. Applies both to the OAuth round-trip (the backend
  // redirects to `next` after setting the cookie) AND to the already-
  // signed-in bounce below.
  const safe = nextSafe(next)
  const dest = safe === '/' ? '/me' : safe

  // If the user is already authenticated, bounce straight to next
  // instead of showing the sign-in pitch — re-clicking "Sign in" would
  // otherwise create a fresh KV session and orphan the live one for
  // its full 30-day TTL (web doesn't have the desktop's prior-token
  // revoke flow). A short 'checking' state avoids flashing the sign-
  // in card before the redirect lands.
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchMe().then((r) => {
      if (cancelled) return
      if (r.kind === 'ok') {
        // Resolve `dest` through the URL constructor against the current
        // origin and forward only when the parsed origin matches. CodeQL
        // (js/client-side-unvalidated-url-redirection) recognises this
        // pattern as a same-origin guard, whereas a string-prefix check
        // is not visible to the static flow analysis even though it's
        // sufficient on paper. nextSafe() upstream is the primary line
        // of defence; this is the locally-provable belt-and-braces.
        let target = '/me'
        try {
          const url = new URL(dest, window.location.origin)
          if (url.origin === window.location.origin) {
            target = url.pathname + url.search + url.hash
          }
        } catch {
          // Malformed URL → keep the safe default.
        }
        window.location.replace(target)
        return
      }
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [dest])

  if (checking) {
    return (
      <Page>
        <Header auth="out" />
        <main className="sw-main center" aria-busy="true">
          <div className="sw-loading">
            <span className="sw-spin sw-spin-anim" />
            Checking session
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  return (
    <Page>
      <Header auth="out" />
      <main className="sw-main center">
        <div className="sw-card tight sw-signin w-420">
          <div className="sw-signin-emblem">
            <SpoolMark size={30} />
          </div>
          <div className="sw-eyebrow">spool.pro</div>
          <h1 className="sw-signin-title">Sign in</h1>
          <p className="sw-signin-sub">Publish, manage, and unpublish your shares.</p>
          {PROVIDERS.map((p) => (
            <a key={p.id} className="sw-google-btn" href={authStartHref(p.id, dest)}>
              {p.icon}
              {p.label}
            </a>
          ))}
          <div className="sw-signin-foot">
            <span className="ico">
              <Icon name="lock" size={14} />
            </span>
            <span>
              We use your provider only to verify your identity — nothing beyond your email,
              name, and picture.
            </span>
          </div>
          <p className="sw-signin-legal">
            By signing in you agree to the <a href="/terms">Terms</a> and{' '}
            <a href="/privacy">Privacy policy</a>.
          </p>
        </div>
      </main>
      <Footer />
    </Page>
  )
}
