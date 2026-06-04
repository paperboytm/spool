import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Avatar,
  Footer,
  Header,
  Icon,
  Page,
} from '../components/Chrome'
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
import { humanDate, humanDateTime } from '../lib/dates'

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
  const checkSeq = useRef(0)

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
    <form className="sw-claim" onSubmit={onSubmit} noValidate>
      <label>
        <span>Claim a handle</span>
        <div className="sw-input-wrap">
          <span className="at">@</span>
          <input
            className="sw-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="alice"
            maxLength={HANDLE_MAX_LEN}
            value={value}
            onChange={(e) =>
              setValue(
                e.target.value
                  .toLowerCase()
                  .replace(HANDLE_NORMALISE, '')
                  .slice(0, HANDLE_MAX_LEN),
              )
            }
          />
        </div>
      </label>
      <button
        type="submit"
        className="sw-btn sw-btn-primary"
        disabled={submitDisabled}
        style={{ padding: '9px 18px' }}
      >
        {busy ? 'Claiming…' : 'Claim'}
      </button>
      {status && (
        <p className={`sw-claim-status ${status.tone}`} role="status">
          {status.icon === 'spin' ? (
            <span className="sw-spin sw-spin-anim ico" />
          ) : status.icon ? (
            <span className="ico">
              <Icon name={status.icon} size={12} />
            </span>
          ) : null}
          {status.text}
        </p>
      )}
      {err && (
        <p className="sw-claim-status warn" role="alert">
          <span className="ico">
            <Icon name="alert" size={12} />
          </span>
          {err}
        </p>
      )}
    </form>
  )
}

function renderAvailability(
  a: HandleAvailability,
): {
  tone: 'muted' | 'ok' | 'warn'
  text: string
  icon: 'check-circle' | 'x-circle' | 'alert' | 'spin' | null
} | null {
  switch (a.kind) {
    case 'idle':
      return null
    case 'too-short':
      return { tone: 'muted', text: `At least ${HANDLE_MIN_LEN} characters.`, icon: null }
    case 'checking':
      return { tone: 'muted', text: 'Checking…', icon: 'spin' }
    case 'available':
      return { tone: 'ok', text: 'Available.', icon: 'check-circle' }
    case 'taken':
      return { tone: 'warn', text: 'Taken — try another.', icon: 'x-circle' }
    case 'invalid':
      return { tone: 'warn', text: a.reason, icon: 'alert' }
    case 'error':
      return { tone: 'warn', text: 'Could not check right now.', icon: 'alert' }
  }
}

function ShareRow({
  row,
  disabled,
  onUnpublish,
}: {
  row: MeShareRow
  disabled?: boolean
  onUnpublish: (id: string) => Promise<{ ok: boolean; reason?: string }>
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const revoked = row.revoked_at !== null
  const expiry = row.expires_at !== null ? humanDate(row.expires_at) : null
  const listed = row.visibility === 'profile-listed'

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
    <li
      className={`sw-share${revoked ? ' revoked' : ''}${disabled ? ' disabled' : ''}`}
    >
      <div className="sw-share-main">
        <span className="sw-share-title">{row.title}</span>
        <span className="sw-share-meta">
          <span className={`sw-pill${listed ? ' listed' : ''}`}>
            {listed ? 'Listed' : 'Unlisted'}
          </span>
          <span>published {humanDate(row.published_at)}</span>
          {expiry && (
            <>
              <span className="dot-sep">·</span>
              <span>expires {expiry}</span>
            </>
          )}
          {revoked && (
            <>
              <span className="dot-sep">·</span>
              <span className="sw-pill revoked">Unpublished</span>
            </>
          )}
        </span>
        {err && (
          <span className="sw-share-error" role="alert">
            {err}
          </span>
        )}
      </div>
      <div className="sw-share-actions">
        <a
          className="sw-icon-btn"
          href={`/s/${encodeURIComponent(row.id)}`}
          target="_blank"
          rel="noreferrer"
          title="Open share"
          aria-label="Open share"
        >
          <Icon name="external" size={14} />
        </a>
        <button
          type="button"
          className={`sw-icon-btn${copied ? ' ok' : ''}`}
          onClick={copy}
          disabled={disabled}
          title={copied ? 'Copied' : 'Copy link'}
          aria-label={copied ? 'Copied' : 'Copy link'}
        >
          <Icon name={copied ? 'check' : 'link'} size={14} />
        </button>
        {!revoked && (
          busy ? (
            <span
              className="sw-icon-btn busy"
              aria-label="Unpublishing"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              <span className="sw-spin sw-spin-anim" style={{ width: 13, height: 13 }} />
            </span>
          ) : (
            <button
              type="button"
              className="sw-icon-btn danger"
              onClick={unpublish}
              disabled={disabled}
              title="Unpublish"
              aria-label="Unpublish"
            >
              <Icon name="eye-off" size={14} />
            </button>
          )
        )}
      </div>
    </li>
  )
}

function DeleteAccount({
  initialPendingUntil,
  onCancelled,
}: {
  initialPendingUntil: number | null
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
    const prev = state
    setState({ kind: 'cancelling' })
    const ok = await cancelAccountDeletion()
    if (ok) {
      setState({ kind: 'idle' })
      onCancelled()
    } else if (prev.kind === 'scheduled') {
      setState(prev)
    } else {
      setState({ kind: 'scheduled', at: 0 })
    }
  }

  if (state.kind === 'scheduled' || state.kind === 'cancelling') {
    const at = state.kind === 'scheduled' ? state.at : 0
    const when = at > 0 ? humanDateTime(at) : null
    return (
      <div className="sw-scheduled-box">
        <p>
          <strong>Account deletion is scheduled</strong>
          {when ? ` for ${when}` : ''}. You have 24 hours to cancel.
        </p>
        <button
          type="button"
          className="sw-btn sw-btn-ghost"
          onClick={cancel}
          disabled={state.kind === 'cancelling'}
        >
          {state.kind === 'cancelling' ? (
            <>
              <span className="sw-spin sw-spin-anim" style={{ width: 11, height: 11 }} />
              Cancelling…
            </>
          ) : (
            'Cancel deletion'
          )}
        </button>
      </div>
    )
  }

  if (state.kind === 'confirming') {
    return (
      <div className="sw-confirm-box">
        <p>
          Deleting your account unpublishes every share, releases your handle, and removes
          your record after 24 hours. This can be undone within that window.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sw-btn sw-btn-danger" onClick={schedule}>
            Yes, delete my account
          </button>
          <button
            type="button"
            className="sw-btn sw-btn-ghost"
            onClick={() => setState({ kind: 'idle' })}
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="sw-btn sw-btn-ghost"
      onClick={() => setState({ kind: 'confirming' })}
    >
      Delete account…
    </button>
  )
}

export function Me() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    const [meResult, sharesResult] = await Promise.all([fetchMe(), fetchMyShares()])
    if (meResult.kind === 'unauthenticated') {
      window.location.replace('/sign-in?next=/me')
      return
    }
    if (meResult.kind !== 'ok') {
      setState({ kind: 'error' })
      return
    }
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
    // share-web doesn't own `/` — in prod that's the landing site (a
    // separate Pages project routed by the worker), in dev there's
    // nothing → tombstone. /sign-in is the natural post-logout
    // destination either way: it confirms the signed-out state and
    // makes signing back in one click.
    window.location.assign('/sign-in')
  }

  function onDeletionCancelled(): void {
    setState((s) =>
      s.kind === 'ok' ? { ...s, me: { ...s.me, deletion_pending_until: null } } : s,
    )
    fetchMyShares().then((r) => {
      if (r.kind !== 'ok') return
      setState((s) => (s.kind === 'ok' ? { ...s, shares: r.shares } : s))
    })
  }

  if (state.kind === 'loading') {
    return (
      <Page>
        <Header auth="out" />
        <main className="sw-main center" aria-busy="true">
          <div className="sw-loading">
            <span className="sw-spin sw-spin-anim" />
            Loading account
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.kind === 'error') {
    return (
      <Page>
        <Header auth="out" />
        <main className="sw-main center">
          <div className="sw-card tight w-480">
            <div className="sw-rule" style={{ marginBottom: 20 }}>
              <span className="tag err">Error</span>
              <span className="line" />
            </div>
            <h1 className="sw-title">Something went wrong</h1>
            <p className="sw-lede">We couldn’t load your account.</p>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              style={{ marginTop: 20 }}
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const { me, shares } = state
  const pendingUntil = me.deletion_pending_until
  const pending = pendingUntil !== null
  const headerAuth = { name: me.name, src: me.avatar_url }

  return (
    <Page>
      <Header auth={headerAuth} />
      <main className="sw-main gap">
        {pending && (
          <div className="sw-banner pending" role="alert">
            <span className="ico">
              <Icon name="alert" size={16} />
            </span>
            <span>
              <strong>Account deletion is pending.</strong>{' '}
              {pendingUntil ? `Scheduled for ${humanDateTime(pendingUntil)}.` : null} Cancel
              it in the Danger zone below to restore access.
            </span>
          </div>
        )}

        <div className="sw-card w-600">
          <div className="sw-identity">
            <Avatar src={me.avatar_url} name={me.name} size={54} />
            <div className="body">
              {me.name && <h1 className="name">{me.name}</h1>}
              {me.handle ? (
                <p className="handle accent">
                  <a href={`/@${me.handle}`}>@{me.handle}</a>
                </p>
              ) : (
                <p className="handle">No public handle yet</p>
              )}
            </div>
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-sm"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>

          {!me.handle && !pending && (
            <>
              <div className="sw-divider" style={{ margin: '24px 0 20px' }} />
              <HandleClaim
                onClaimed={(handle) =>
                  setState((s) =>
                    s.kind === 'ok' ? { ...s, me: { ...s.me, handle } } : s,
                  )
                }
              />
            </>
          )}

          <div className="sw-divider" style={{ margin: '24px 0 18px' }} />
          <h2 className="sw-section-label" style={{ marginBottom: 14 }}>
            Your shares
            {!pending && shares.length > 0 && <span className="count">{shares.length}</span>}
          </h2>
          {pending ? (
            <p className="sw-empty">
              Hidden while deletion is pending. Cancel deletion to restore the list.
            </p>
          ) : shares.length === 0 ? (
            <p className="sw-empty">You haven’t published anything yet.</p>
          ) : (
            <ul className="sw-list">
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

          <div className="sw-danger-zone" style={{ marginTop: 24 }}>
            <h2
              className="sw-section-label"
              style={{ marginBottom: 14, color: 'var(--muted)' }}
            >
              Danger zone
            </h2>
            <DeleteAccount
              initialPendingUntil={pendingUntil}
              onCancelled={onDeletionCancelled}
            />
          </div>

          <p className="sw-signed-in-as">
            <span className="ico">
              <Icon name="lock" size={11} />
            </span>
            Signed in as {me.email}
          </p>
        </div>
      </main>
      <Footer />
    </Page>
  )
}
