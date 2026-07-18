// CLI login approval page (/cli-auth?code=XXXX-XXXX). `spool login`
// prints the same code it bakes into this URL; the user confirms the
// two match and approves, which mints a scoped sph_ token the CLI then
// claims by polling. Requires a web session — unauthenticated visitors
// bounce through /sign-in and land back here.
//
// The code in the URL is display material only: every decision is
// re-validated server-side against the signed-in session, and the URL
// never carries the pollable device_code.

import { useEffect, useState } from 'react'

import { Footer, Header, Icon, Page, SpoolMark } from '../components/Chrome'
import { type CliAuthInfo, decideCliAuth, fetchCliAuthInfo } from '../lib/cli-auth'

interface Props {
  code: string | null
}

type State =
  | { kind: 'checking' }
  | { kind: 'enter-code' }
  | { kind: 'ready'; info: CliAuthInfo; busy: boolean }
  | { kind: 'approved'; info: CliAuthInfo }
  | { kind: 'denied' }
  | { kind: 'gone' }
  | { kind: 'error' }

export function CliAuth({ code }: Props) {
  const [state, setState] = useState<State>(() =>
    code ? { kind: 'checking' } : { kind: 'enter-code' },
  )
  const [manualCode, setManualCode] = useState('')

  useEffect(() => {
    if (!code) return
    let cancelled = false
    void fetchCliAuthInfo(code).then((r) => {
      if (cancelled) return
      if (r.kind === 'ok') {
        setState({ kind: 'ready', info: r.info, busy: false })
        return
      }
      if (r.kind === 'unauthenticated') {
        // Round-trip through sign-in and land back on this exact URL.
        const next = encodeURIComponent(`/cli-auth?code=${encodeURIComponent(code)}`)
        window.location.replace(`/sign-in?next=${next}`)
        return
      }
      setState({ kind: r.kind })
    })
    return () => {
      cancelled = true
    }
  }, [code])

  const decide = (info: CliAuthInfo, decision: 'approve' | 'deny') => {
    setState({ kind: 'ready', info, busy: true })
    void decideCliAuth(info.user_code, decision).then((r) => {
      if (r.kind === 'ok') {
        setState(decision === 'approve' ? { kind: 'approved', info } : { kind: 'denied' })
      } else {
        setState({ kind: r.kind === 'gone' ? 'gone' : 'error' })
      }
    })
  }

  if (state.kind === 'checking') {
    return (
      <Shell busyLabel="Checking code">
        <div className="sw-loading">
          <span className="sw-spin sw-spin-anim" />
          Checking code
        </div>
      </Shell>
    )
  }

  if (state.kind === 'enter-code') {
    return (
      <Shell>
        <Card
          title="Approve CLI sign-in"
          sub="Enter the code shown in your terminal by spool login."
        >
          <form
            className="sw-cliauth-form"
            onSubmit={(e) => {
              e.preventDefault()
              const value = manualCode.trim()
              if (value === '') return
              // Full-page navigation, consistent with the SPA's
              // no-pushState convention — the route recomputes on load.
              window.location.replace(`/cli-auth?code=${encodeURIComponent(value)}`)
            }}
          >
            <input
              className="sw-input sw-cliauth-input"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="XXXX-XXXX"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-label="CLI sign-in code"
            />
            <button className="sw-btn sw-btn-primary" type="submit">
              Continue
            </button>
          </form>
        </Card>
      </Shell>
    )
  }

  if (state.kind === 'ready') {
    const { info, busy } = state
    return (
      <Shell>
        <Card
          title="Approve CLI sign-in"
          sub={
            info.label
              ? `A terminal on ${info.label} is asking to publish and manage shares as you.`
              : 'A terminal is asking to publish and manage shares as you.'
          }
        >
          <div className="sw-cliauth-code" aria-label="Confirmation code">
            {info.user_code}
          </div>
          <p className="sw-cliauth-hint">
            Approve only if this code matches the one in your terminal.
          </p>
          <div className="sw-cliauth-actions">
            <button
              className="sw-btn sw-btn-primary"
              disabled={busy}
              onClick={() => decide(info, 'approve')}
            >
              Approve
            </button>
            <button
              className="sw-btn sw-btn-ghost"
              disabled={busy}
              onClick={() => decide(info, 'deny')}
            >
              Deny
            </button>
          </div>
        </Card>
      </Shell>
    )
  }

  if (state.kind === 'approved') {
    return (
      <Shell>
        <Card
          icon={<Icon name="check-circle" size={22} />}
          title="CLI signed in"
          sub={
            state.info.label
              ? `You approved ${state.info.label}. Close this tab and return to your terminal.`
              : 'You approved the sign-in. Close this tab and return to your terminal.'
          }
        />
      </Shell>
    )
  }

  if (state.kind === 'denied') {
    return (
      <Shell>
        <Card
          icon={<Icon name="x-circle" size={22} />}
          title="Request denied"
          sub="Nothing was granted. The terminal will report the login as failed."
        />
      </Shell>
    )
  }

  if (state.kind === 'gone') {
    return (
      <Shell>
        <Card
          icon={<Icon name="clock" size={22} />}
          title="Code expired"
          sub="This code has expired or was already handled. Run spool login again for a fresh one."
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <Card
        icon={<Icon name="alert" size={22} />}
        title="Something went wrong"
        sub="Could not reach the server. Check your connection and try the link again."
      />
    </Shell>
  )
}

function Shell({ children, busyLabel }: { children: React.ReactNode; busyLabel?: string }) {
  return (
    <Page>
      <Header />
      <main className="sw-main center" {...(busyLabel ? { 'aria-busy': true } : {})}>
        {children}
      </main>
      <Footer />
    </Page>
  )
}

function Card({
  icon,
  title,
  sub,
  children,
}: {
  icon?: React.ReactNode
  title: string
  sub: string
  children?: React.ReactNode
}) {
  return (
    <div className="sw-card tight sw-signin w-420">
      <div className="sw-signin-emblem">{icon ?? <SpoolMark size={30} />}</div>
      <div className="sw-eyebrow">spool.pro</div>
      <h1 className="sw-signin-title">{title}</h1>
      <p className="sw-signin-sub">{sub}</p>
      {children}
    </div>
  )
}
