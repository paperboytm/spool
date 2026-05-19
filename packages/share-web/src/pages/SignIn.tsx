// Static sign-in screen. The actual OAuth dance happens server-side at
// /api/auth/google/start, which sets the session cookie and bounces
// back to `next`. `next` is already sanitized by the router via
// nextSafe(); we redefend on the click in case this page is reached
// directly.

import { nextSafe } from '../lib/route'

interface Props {
  next: string
}

export function SignIn({ next }: Props) {
  const safe = nextSafe(next)
  const href = `/api/auth/google/start?next=${encodeURIComponent(safe)}`

  return (
    <main className="signin-page">
      <div className="signin-card">
        <div className="signin-eyebrow">spool.share</div>
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
