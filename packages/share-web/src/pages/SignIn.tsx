// Static sign-in screen. The actual OAuth dance happens server-side at
// /api/auth/google/start, which sets the session cookie and bounces
// back to `next`. `next` is already sanitized by the router via
// nextSafe(); we redefend on the click in case this page is reached
// directly.

import { useEffect, useState } from 'react'

import { fetchMe } from '../lib/api'
import { nextSafe } from '../lib/route'

interface Props {
  next: string
}

export function SignIn({ next }: Props) {
  const safe = nextSafe(next)
  const href = `/api/auth/google/start?next=${encodeURIComponent(safe)}`

  // If the user is already authenticated, bounce straight to next
  // instead of showing the sign-in pitch — re-clicking "Sign in" would
  // otherwise create a fresh KV session and orphan the live one for
  // its full 30-day TTL (web doesn't have the desktop's prior-token
  // revoke flow). A short 'checking' state avoids flashing the sign-
  // in card before the redirect lands.
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((r) => {
      if (cancelled) return
      if (r.kind === 'ok') {
        window.location.replace(safe)
        return
      }
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [safe])

  if (checking) {
    return (
      <main className="reader-loading" aria-busy="true">
        <div className="reader-loading-card">Checking session…</div>
      </main>
    )
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <div className="signin-eyebrow">spool.pro</div>
        <h1 className="signin-title">Sign in</h1>
        <p className="signin-body">
          Sign in to publish, manage, and unpublish your shares.
        </p>
        <a className="signin-button" href={href}>
          Sign in with Google
        </a>
        <p className="signin-footnote">
          We use Google only to verify your identity. We don’t request
          any data from your Google account beyond your email, name,
          and picture.
        </p>
      </div>
    </main>
  )
}
