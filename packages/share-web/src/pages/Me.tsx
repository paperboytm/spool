import { useCallback, useEffect, useState } from 'react'

import {
  cancelAccountDeletion,
  claimHandle,
  fetchMe,
  fetchMyShares,
  revokeShare,
  scheduleAccountDeletion,
  signOut,
  type MeResponse,
  type MeShareRow,
} from '../lib/api'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse; shares: MeShareRow[] }
  | { kind: 'error' }

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString()
  } catch {
    return ''
  }
}

function formatExpiry(ts: number | null): string | null {
  if (ts === null) return null
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return null
  }
}

function shareUrl(id: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(id)}`
}

function HandleClaim({ onClaimed }: { onClaimed: (handle: string) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const result = await claimHandle(value.trim().toLowerCase())
    setBusy(false)
    if (result.kind === 'ok') {
      onClaimed(result.handle)
      return
    }
    if (result.kind === 'taken') setErr('That handle is taken.')
    else if (result.kind === 'invalid') setErr(result.reason)
    else if (result.kind === 'rate-limited') setErr('Too many attempts — try again tomorrow.')
    else setErr('Something went wrong.')
  }

  return (
    <form className="me-claim" onSubmit={onSubmit} noValidate>
      <label>
        <span>Claim a handle</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="alice"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy || value.trim().length === 0}>
        {busy ? 'Claiming…' : 'Claim'}
      </button>
      {err && <p className="me-error" role="alert">{err}</p>}
    </form>
  )
}

function ShareRow({
  row,
  onUnpublish,
}: {
  row: MeShareRow
  onUnpublish: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const revoked = row.revoked_at !== null
  const expiry = formatExpiry(row.expires_at)

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(row.id))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  async function unpublish() {
    if (busy || revoked) return
    setBusy(true)
    await onUnpublish(row.id)
    setBusy(false)
  }

  return (
    <li className={`me-share${revoked ? ' me-share-revoked' : ''}`}>
      <div className="me-share-main">
        <span className="me-share-title">{row.title}</span>
        <span className="me-share-meta">
          {row.visibility === 'profile-listed' ? 'Profile-listed' : 'Unlisted'}
          {' · '}
          published {formatDate(row.published_at)}
          {expiry && ` · expires ${expiry}`}
          {revoked && ' · unpublished'}
        </span>
      </div>
      <div className="me-share-actions">
        <a href={`/s/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
          View
        </a>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {!revoked && (
          <button type="button" onClick={unpublish} disabled={busy} className="me-share-danger">
            {busy ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}
      </div>
    </li>
  )
}

function DeleteAccount() {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'confirming' }
    | { kind: 'scheduled'; at: number }
    | { kind: 'cancelling' }
  >({ kind: 'idle' })

  async function schedule() {
    const r = await scheduleAccountDeletion()
    if (r.kind === 'ok') setState({ kind: 'scheduled', at: r.scheduled_at })
  }

  async function cancel() {
    setState({ kind: 'cancelling' })
    const ok = await cancelAccountDeletion()
    if (ok) setState({ kind: 'idle' })
    else setState({ kind: 'scheduled', at: 0 })
  }

  if (state.kind === 'scheduled' || state.kind === 'cancelling') {
    const when = state.kind === 'scheduled' && state.at > 0
      ? new Date(state.at).toLocaleString()
      : null
    return (
      <div className="me-delete me-delete-pending">
        <p>
          Account deletion is scheduled
          {when && ` for ${when}`}. You have 24 hours to cancel.
        </p>
        <button type="button" onClick={cancel} disabled={state.kind === 'cancelling'}>
          {state.kind === 'cancelling' ? 'Cancelling…' : 'Cancel deletion'}
        </button>
      </div>
    )
  }

  if (state.kind === 'confirming') {
    return (
      <div className="me-delete">
        <p>
          Deleting your account unpublishes every share, releases your
          handle, and removes your record after 24 hours. This can be
          undone within that window.
        </p>
        <div className="me-delete-actions">
          <button type="button" onClick={schedule} className="me-share-danger">
            Yes, delete my account
          </button>
          <button type="button" onClick={() => setState({ kind: 'idle' })}>
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="me-delete">
      <button type="button" onClick={() => setState({ kind: 'confirming' })}>
        Delete account…
      </button>
    </div>
  )
}

export function Me() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    // Parallel — shares is owned by /me's session cookie too, so the
    // request still flies in flight even before /me resolves.
    const [meResult, shares] = await Promise.all([fetchMe(), fetchMyShares()])
    if (meResult.kind === 'unauthenticated' || meResult.kind === 'forbidden') {
      // forbidden = account pending deletion; either way send them to
      // sign-in to recover via a fresh session.
      window.location.replace('/sign-in?next=/me')
      return
    }
    if (meResult.kind !== 'ok') {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ok', me: meResult.me, shares })
  }, [])

  useEffect(() => {
    document.title = 'Your account · spool.pro'
    load()
  }, [load])

  async function onUnpublish(id: string) {
    const ok = await revokeShare(id)
    if (!ok) return
    setState((s) => {
      if (s.kind !== 'ok') return s
      return {
        ...s,
        shares: s.shares.map((x) =>
          x.id === id ? { ...x, revoked_at: Date.now() } : x,
        ),
      }
    })
  }

  async function onSignOut() {
    await signOut()
    window.location.assign('/')
  }

  if (state.kind === 'loading') {
    return (
      <main className="reader-loading" aria-busy="true">
        <div className="reader-loading-card">Loading…</div>
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main className="me-page">
        <div className="me-card">
          <h1>Something went wrong</h1>
          <p>We couldn’t load your account. Try refreshing.</p>
        </div>
      </main>
    )
  }

  const { me, shares } = state
  return (
    <main className="me-page">
      <header className="me-header">
        {me.avatar_url ? <img className="me-avatar" src={me.avatar_url} alt="" /> : null}
        <div className="me-identity">
          {me.name && <h1 className="me-name">{me.name}</h1>}
          <p className="me-email">{me.email}</p>
          {me.handle ? (
            <p className="me-handle">
              <a href={`/@${me.handle}`}>@{me.handle}</a>
            </p>
          ) : null}
        </div>
        <button type="button" className="me-signout" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      {!me.handle && (
        <section className="me-section">
          <HandleClaim
            onClaimed={(handle) =>
              setState((s) => (s.kind === 'ok' ? { ...s, me: { ...s.me, handle } } : s))
            }
          />
        </section>
      )}

      <section className="me-section">
        <h2 className="me-section-title">Your shares</h2>
        {shares.length === 0 ? (
          <p className="me-empty">You haven’t published anything yet.</p>
        ) : (
          <ul className="me-share-list">
            {shares.map((row) => (
              <ShareRow key={row.id} row={row} onUnpublish={onUnpublish} />
            ))}
          </ul>
        )}
      </section>

      <section className="me-section me-danger-zone">
        <h2 className="me-section-title">Danger zone</h2>
        <DeleteAccount />
      </section>
    </main>
  )
}
