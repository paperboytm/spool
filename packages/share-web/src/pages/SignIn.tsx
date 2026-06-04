// Static sign-in screen. The actual OAuth dance happens server-side at
// /api/auth/google/start, which sets the session cookie and bounces
// back to `next`. `next` is already sanitized by the router via
// nextSafe(); we redefend on the click in case this page is reached
// directly.

import { useEffect, useState } from 'react'

import { Footer, Header, Icon, Page, SpoolMark } from '../components/Chrome'
import { fetchMe } from '../lib/api'
import { nextSafe } from '../lib/route'

interface Props {
  next: string
}

export function SignIn({ next }: Props) {
  // share-web doesn't own `/` — in prod that's the landing site, in
  // dev it's empty → tombstone. When the caller didn't pin a `next`,
  // /me is the only post-auth destination that makes sense on this
  // origin. This applies BOTH to the OAuth round-trip (the backend
  // redirects to `next` after setting the cookie) AND to the already-
  // signed-in bounce below.
  const safe = nextSafe(next)
  const dest = safe === '/' ? '/me' : safe
  const href = `/api/auth/google/start?next=${encodeURIComponent(dest)}`

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
        window.location.replace(dest)
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
          <a className="sw-google-btn" href={href}>
            <Icon name="google" size={18} />
            Continue with Google
          </a>
          <div className="sw-signin-foot">
            <span className="ico">
              <Icon name="lock" size={14} />
            </span>
            <span>
              We use Google only to verify your identity — nothing beyond your email, name, and
              picture.
            </span>
          </div>
        </div>
      </main>
      <Footer />
    </Page>
  )
}
