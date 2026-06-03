import { useCallback, useEffect, useRef, useState } from 'react'

import {
  cancelAccountDeletion,
  checkHandle,
  claimHandle,
  fetchMe,
  fetchMyShares,
  revokeShare,
  scheduleAccountDeletion,
  signOut,
  type MeResponse,
  type MeShareRow,
} from '../lib/api'

// Match the server-side handle regex (share-backend/src/handles.ts).
// We pre-filter input so check requests + the submit button respond
// to obvious mismatches without a round-trip.
const HANDLE_NORMALISE = /[^a-z0-9_-]/g
const HANDLE_MAX_LEN = 32
const HANDLE_MIN_LEN = 3
const CHECK_DEBOUNCE_MS = 320

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

type HandleAvailability =
  | { kind: 'idle' }
  | { kind: 'too-short' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'error' }

function HandleClaim({ onClaimed }: { onClaimed: (handle: string) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [availability, setAvailability] = useState<HandleAvailability>({ kind: 'idle' })
  // Sequence guards stale debounced responses overwriting fresher ones.
  const checkSeq = useRef(0)

  // Debounced availability check. Skips the round-trip for inputs that
  // can't possibly pass server-side validation.
  useEffect(() => {
    const handle = value
    if (handle.length === 0) {
      setAvailability({ kind: 'idle' })
      return
    }
    if (handle.length < HANDLE_MIN_LEN) {
      setAvailability({ kind: 'too-short' })
      return
    }
    setAvailability({ kind: 'checking' })
    const seq = ++checkSeq.current
    const timer = window.setTimeout(async () => {
      const r = await checkHandle(handle)
      if (seq !== checkSeq.current) return
      setAvailability(r)
    }, CHECK_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || availability.kind !== 'available') return
    setBusy(true)
    setErr(null)
    const result = await claimHandle(value)
    setBusy(false)
    if (result.kind === 'ok') {
      onClaimed(result.handle)
      return
    }
    if (result.kind === 'taken') {
      setErr('That handle was just taken — try a different one.')
      setAvailability({ kind: 'taken' })
    } else if (result.kind === 'invalid') {
      setErr(result.reason)
      setAvailability({ kind: 'invalid', reason: result.reason })
    } else if (result.kind === 'rate-limited') {
      setErr('Too many attempts — try again tomorrow.')
    } else {
      setErr('Something went wrong.')
    }
  }

  const status = renderAvailability(availability)
  const submitDisabled = busy || availability.kind !== 'available'

  return (
    <form className="me-claim" onSubmit={onSubmit} noValidate>
      <label>
        <span>Claim a handle</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="alice"
          maxLength={HANDLE_MAX_LEN}
          value={value}
          onChange={(e) =>
            setValue(
              e.target.value.toLowerCase().replace(HANDLE_NORMALISE, '').slice(0, HANDLE_MAX_LEN),
            )
          }
        />
      </label>
      <button type="submit" disabled={submitDisabled}>
        {busy ? 'Claiming…' : 'Claim'}
      </button>
      {status && (
        <p className={`me-handle-status me-handle-status-${status.tone}`} role="status">
          {status.text}
        </p>
      )}
      {err && <p className="me-error" role="alert">{err}</p>}
    </form>
  )
}

function renderAvailability(
  a: HandleAvailability,
): { tone: 'muted' | 'ok' | 'warn'; text: string } | null {
  switch (a.kind) {
    case 'idle':
      return null
    case 'too-short':
      return { tone: 'muted', text: `At least ${HANDLE_MIN_LEN} characters.` }
    case 'checking':
      return { tone: 'muted', text: 'Checking…' }
    case 'available':
      return { tone: 'ok', text: 'Available.' }
    case 'taken':
      return { tone: 'warn', text: 'Taken.' }
    case 'invalid':
      return { tone: 'warn', text: a.reason }
    case 'error':
      return { tone: 'warn', text: 'Could not check right now.' }
  }
}

function ShareRow({
  row,
  disabled,
  onUnpublish,
}: {
  row: MeShareRow
  /** Block unpublish actions entirely (e.g. account in deletion grace
   *  period — the backend would 403 anyway). */
  disabled?: boolean
  onUnpublish: (id: string) => Promise<{ ok: boolean; reason?: string }>
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
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
    if (busy || revoked || disabled) return
    setBusy(true)
    setErr(null)
    const r = await onUnpublish(row.id)
    setBusy(false)
    if (!r.ok) setErr(r.reason ?? 'Could not unpublish — try again.')
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
        {err && <span className="me-share-error" role="alert">{err}</span>}
      </div>
      <div className="me-share-actions">
        <a href={`/s/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
          View
        </a>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {!revoked && (
          <button
            type="button"
            onClick={unpublish}
            disabled={busy || disabled}
            className="me-share-danger"
          >
            {busy ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}
      </div>
    </li>
  )
}

function DeleteAccount({
  initialPendingUntil,
  onCancelled,
}: {
  /** Epoch-ms — when non-null on mount, /me boots straight into the
   *  scheduled / "cancel deletion" state instead of "Delete account…".
   *  Carries the cross-device case where the user scheduled deletion
   *  from desktop and now opens the web /me to recover. */
  initialPendingUntil: number | null
  /** Called after a successful cancel so the parent can clear its own
   *  banner / re-enable handle claim + unpublish. */
  onCancelled: () => void
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'confirming' }
    | { kind: 'scheduled'; at: number }
    | { kind: 'cancelling' }
  >(
    initialPendingUntil
      ? { kind: 'scheduled', at: initialPendingUntil }
      : { kind: 'idle' },
  )

  async function schedule() {
    const r = await scheduleAccountDeletion()
    if (r.kind === 'ok') setState({ kind: 'scheduled', at: r.scheduled_at })
  }

  async function cancel() {
    setState({ kind: 'cancelling' })
    const ok = await cancelAccountDeletion()
    if (ok) {
      setState({ kind: 'idle' })
      onCancelled()
    } else {
      setState({ kind: 'scheduled', at: 0 })
    }
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
    const [meResult, sharesResult] = await Promise.all([fetchMe(), fetchMyShares()])
    if (meResult.kind === 'unauthenticated') {
      window.location.replace('/sign-in?next=/me')
      return
    }
    if (meResult.kind !== 'ok') {
      // /api/me returns 200 even during the 24h grace window (PR 3
      // amend opened it for pending-deletion users so the cancel
      // path stays reachable); any other non-ok is genuine error.
      setState({ kind: 'error' })
      return
    }
    // Shares endpoint stays locked behind the default requireUser
    // policy — pending-deletion gets 403, which we treat as "no
    // shares to show" rather than punting to sign-in. The banner
    // explains why; the cancel-deletion button is right there.
    const shares = sharesResult.kind === 'ok' ? sharesResult.shares : []
    setState({ kind: 'ok', me: meResult.me, shares })
  }, [])

  useEffect(() => {
    document.title = 'Your account · spool.pro'
    load()
  }, [load])

  async function onUnpublish(id: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await revokeShare(id)
    if (r.kind === 'ok') {
      setState((s) => {
        if (s.kind !== 'ok') return s
        return {
          ...s,
          shares: s.shares.map((x) =>
            x.id === id ? { ...x, revoked_at: Date.now() } : x,
          ),
        }
      })
      return { ok: true }
    }
    if (r.kind === 'forbidden') {
      return { ok: false, reason: 'Your account is pending deletion — cancel it first.' }
    }
    if (r.kind === 'rate-limited') {
      return { ok: false, reason: 'Too many unpublish requests — wait a minute.' }
    }
    if (r.kind === 'not-found') {
      return { ok: false, reason: 'Share not found (already revoked?).' }
    }
    return { ok: false, reason: 'Could not unpublish — try again.' }
  }

  async function onSignOut() {
    await signOut()
    window.location.assign('/')
  }

  function onDeletionCancelled(): void {
    setState((s) =>
      s.kind === 'ok'
        ? { ...s, me: { ...s.me, deletion_pending_until: null } }
        : s,
    )
    // Re-fetch shares — they were 403'd while pending; now that the
    // user cancelled deletion they should reappear.
    fetchMyShares().then((r) => {
      if (r.kind !== 'ok') return
      setState((s) => (s.kind === 'ok' ? { ...s, shares: r.shares } : s))
    })
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
  const pendingUntil = me.deletion_pending_until
  const pending = pendingUntil !== null
  return (
    <main className="me-page">
      {pending && (
        <div className="me-banner me-banner-pending" role="alert">
          <strong>Account deletion is pending.</strong>{' '}
          {pendingUntil
            ? `Scheduled for ${new Date(pendingUntil).toLocaleString()}.`
            : null}{' '}
          Cancel deletion in the Danger zone below to restore access.
        </div>
      )}

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

      {!me.handle && !pending && (
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
        {pending ? (
          <p className="me-empty">
            Hidden while deletion is pending. Cancel deletion to restore the list.
          </p>
        ) : shares.length === 0 ? (
          <p className="me-empty">You haven’t published anything yet.</p>
        ) : (
          <ul className="me-share-list">
            {shares.map((row) => (
              <ShareRow
                key={row.id}
                row={row}
                disabled={pending}
                onUnpublish={onUnpublish}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="me-section me-danger-zone">
        <h2 className="me-section-title">Danger zone</h2>
        <DeleteAccount initialPendingUntil={pendingUntil} onCancelled={onDeletionCancelled} />
      </section>
    </main>
  )
}
