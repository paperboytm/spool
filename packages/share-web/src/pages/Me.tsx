import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

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
import { ProfileEditor } from '../components/ProfileEditor'

// Match the server-side handle regex (share-backend/src/handles.ts).
// We pre-filter input so check requests + the submit button respond
// to obvious mismatches without a round-trip.
const HANDLE_NORMALISE = /[^a-z0-9_-]/g
const HANDLE_MAX_LEN = 32
const HANDLE_MIN_LEN = 3
const CHECK_DEBOUNCE_MS = 320

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ok'
      me: MeResponse
      shares: MeShareRow[]
      deleteOpen?: boolean
      unpublishTarget?: MeShareRow | null
      unpublishBusy?: boolean
      unpublishErr?: string | null
    }
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
  onUnpublishRequest,
}: {
  row: MeShareRow
  disabled?: boolean
  onUnpublishRequest: (row: MeShareRow) => void
}) {
  const [copied, setCopied] = useState(false)
  const revoked = row.revoked_at !== null
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

  return (
    <li
      className={`sw-share${revoked ? ' revoked' : ''}${disabled ? ' disabled' : ''}`}
    >
      <a
        className="sw-share-link"
        href={`/s/${encodeURIComponent(row.id)}`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="sw-share-title" title={row.title}>
          {row.title}
        </span>
        <span className="sw-share-meta">
          {/* Visibility is an icon-only glyph with a tooltip — text label
           *  fought the title for visual weight (industry pattern:
           *  GitHub gist / YouTube / Google Docs). `link-2` is the
           *  straight-edge chain so it doesn't visually collide with
           *  the copy-link button's curvy `link` icon. */}
          <span
            className="sw-share-vis"
            title={
              listed
                ? 'On profile — visible on your /@handle page'
                : 'Link only — unlisted, accessible only with the URL'
            }
            aria-label={listed ? 'On profile' : 'Link only'}
          >
            <Icon name={listed ? 'globe' : 'link-2'} size={12} />
          </span>
          <span>published {humanDate(row.published_at)}</span>
          {revoked && (
            <>
              <span className="dot-sep">·</span>
              <span className="sw-pill revoked">Unpublished</span>
            </>
          )}
        </span>
      </a>
      {!disabled && (
        <div className="sw-share-actions">
          <button
            type="button"
            className={`sw-icon-btn${copied ? ' ok' : ''}`}
            onClick={copy}
            title={copied ? 'Copied' : 'Copy link'}
            aria-label={copied ? 'Copied' : 'Copy link'}
          >
            <Icon name={copied ? 'check' : 'link'} size={14} />
          </button>
          {!revoked && (
            <button
              type="button"
              className="sw-icon-btn danger"
              onClick={() => onUnpublishRequest(row)}
              title="Unpublish"
              aria-label="Unpublish"
            >
              <Icon name="eye-off" size={14} />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

// Generic modal shell used by both DeleteAccountModal and
// UnpublishConfirmModal. Esc + backdrop click close (gated by `busy`
// so we don't drop an in-flight request).
function ModalShell({
  open,
  busy,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean
  busy?: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])
  if (!open) return null
  return (
    <div
      className="sw-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="sw-modal">{children}</div>
    </div>
  )
}

function DeleteAccountModal({
  open,
  onClose,
  pendingUntil,
  onScheduled,
  onCancelled,
}: {
  open: boolean
  onClose: () => void
  pendingUntil: number | null
  onScheduled: (at: number) => void
  onCancelled: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pending = pendingUntil !== null

  // Reset transient state each time the modal re-opens — otherwise a
  // previous error lingers when the user re-triggers from the footer.
  useEffect(() => {
    if (open) {
      setBusy(false)
      setErr(null)
    }
  }, [open])

  async function onSchedule() {
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await scheduleAccountDeletion()
    setBusy(false)
    if (r.kind === 'ok') {
      onScheduled(r.scheduled_at)
      onClose()
      return
    }
    setErr('Could not schedule deletion — try again.')
  }

  async function onCancel() {
    if (busy) return
    setBusy(true)
    setErr(null)
    const ok = await cancelAccountDeletion()
    setBusy(false)
    if (ok) {
      onCancelled()
      onClose()
      return
    }
    setErr('Could not cancel deletion — try again.')
  }

  return (
    <ModalShell open={open} busy={busy} onClose={onClose} labelledBy="delete-account-title">
      <h2 id="delete-account-title" className="sw-modal-title">
        {pending ? 'Cancel account deletion?' : 'Delete account?'}
      </h2>
      {pending && pendingUntil ? (
        <p className="sw-modal-body">
          Scheduled for <span className="sw-mono">{humanDateTime(pendingUntil)}</span>. Cancelling
          keeps your shares, handle, and account intact.
        </p>
      ) : (
        <p className="sw-modal-body">
          Unpublishes every share, releases your handle, and removes your account record after 24
          hours. You can undo this from the same place within that window.
        </p>
      )}
      {err && (
        <p className="sw-modal-error" role="alert">
          {err}
        </p>
      )}
      <div className="sw-modal-actions">
        <button
          type="button"
          className="sw-btn sw-btn-ghost"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        {pending ? (
          <button
            type="button"
            className="sw-btn sw-btn-primary"
            onClick={onCancel}
            disabled={busy}
          >
            {busy ? 'Cancelling…' : 'Cancel deletion'}
          </button>
        ) : (
          <button
            type="button"
            className="sw-btn sw-btn-danger"
            onClick={onSchedule}
            disabled={busy}
          >
            {busy ? 'Scheduling…' : 'Yes, delete account'}
          </button>
        )}
      </div>
    </ModalShell>
  )
}

function UnpublishConfirmModal({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: MeShareRow | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <ModalShell
      open={target !== null}
      busy={busy}
      onClose={onClose}
      labelledBy="unpublish-title"
    >
      <h2 id="unpublish-title" className="sw-modal-title">
        Unpublish this share?
      </h2>
      {target && (
        <p className="sw-modal-target sw-mono" title={target.title}>
          {target.title}
        </p>
      )}
      <p className="sw-modal-body">
        This permanently deletes the snapshot from R2 and locks the URL to <span className="sw-mono">410 Gone</span>. The
        slug can never be reused. To share this conversation again, republish from the desktop app
        — you'll get a new URL.
      </p>
      <div className="sw-modal-actions">
        <button
          type="button"
          className="sw-btn sw-btn-ghost"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sw-btn sw-btn-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Unpublishing…' : 'Yes, unpublish permanently'}
        </button>
      </div>
    </ModalShell>
  )
}

export function Me() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // Re-entrancy lock on confirmUnpublish: the button is `disabled={busy}`
  // but a double-tap on a slow device can fire onClick twice before React
  // commits the `unpublishBusy: true` write. The ref blocks the second
  // call synchronously, before any async work.
  const unpublishingRef = useRef(false)

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

  // Re-fetch only /api/me (not /me/shares) after a profile edit so the
  // identity card + ProfileEditor surface reflect the new values
  // without disturbing the shares listing.
  const refreshMe = useCallback(async () => {
    const meResult = await fetchMe()
    if (meResult.kind === 'ok') {
      setState((s) => (s.kind === 'ok' ? { ...s, me: meResult.me } : s))
    }
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
        <Header />
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
        <Header />
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

  function openDelete() {
    setState((s) => (s.kind === 'ok' ? { ...s, deleteOpen: true } : s))
  }
  function closeDelete() {
    setState((s) => (s.kind === 'ok' ? { ...s, deleteOpen: false } : s))
  }
  function onDeletionScheduled(at: number) {
    setState((s) =>
      s.kind === 'ok' ? { ...s, me: { ...s.me, deletion_pending_until: at } } : s,
    )
  }
  function requestUnpublish(row: MeShareRow) {
    setState((s) => (s.kind === 'ok' ? { ...s, unpublishTarget: row, unpublishErr: null } : s))
  }
  function closeUnpublish() {
    setState((s) =>
      s.kind === 'ok' ? { ...s, unpublishTarget: null, unpublishErr: null } : s,
    )
  }
  async function confirmUnpublish() {
    if (state.kind !== 'ok' || !state.unpublishTarget) return
    if (unpublishingRef.current) return
    unpublishingRef.current = true
    const target = state.unpublishTarget
    setState((s) => (s.kind === 'ok' ? { ...s, unpublishBusy: true, unpublishErr: null } : s))
    try {
      const r = await onUnpublish(target.id)
      setState((s) => {
        if (s.kind !== 'ok') return s
        if (r.ok) {
          return { ...s, unpublishBusy: false, unpublishTarget: null, unpublishErr: null }
        }
        return {
          ...s,
          unpublishBusy: false,
          unpublishErr: r.reason ?? 'Could not unpublish — try again.',
        }
      })
    } finally {
      unpublishingRef.current = false
    }
  }

  return (
    <Page>
      <Header />
      <main className="sw-main gap">
        {pending && (
          <div className="sw-banner pending" role="alert">
            <span className="ico">
              <Icon name="alert" size={16} />
            </span>
            <span>
              <strong>Account deletion is pending.</strong>{' '}
              {pendingUntil ? `Scheduled for ${humanDateTime(pendingUntil)}.` : null}{' '}
              <button
                type="button"
                className="sw-banner-action"
                onClick={openDelete}
              >
                Cancel deletion
              </button>{' '}
              to restore access.
            </span>
          </div>
        )}

        <div className="sw-card w-600">
          {pending ? (
            // Pending deletion: identity is read-only. Skip the editable
            // ProfileEditor entirely so the surface communicates that
            // changes won't survive the grace window.
            <div className="sw-identity">
              <Avatar src={me.avatar_url} name={me.display_name} size={54} />
              <div className="body">
                <h1 className="name">{me.display_name}</h1>
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
          ) : (
            <div className="sw-me-header">
              <div className="sw-me-header-main">
                <ProfileEditor me={me} onChanged={refreshMe} />
              </div>
              <button
                type="button"
                className="sw-btn sw-btn-ghost sw-btn-sm"
                onClick={onSignOut}
              >
                Sign out
              </button>
            </div>
          )}

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
                  onUnpublishRequest={requestUnpublish}
                />
              ))}
            </ul>
          )}

          <p className="sw-signed-in-as">
            <span className="ico">
              <Icon name="lock" size={11} />
            </span>
            <span>Signed in as {me.email}</span>
            <button
              type="button"
              className="sw-link-quiet"
              onClick={openDelete}
            >
              {pending ? 'Cancel deletion' : 'Delete account'}
            </button>
          </p>
          {state.unpublishErr && (
            <p className="sw-unpublish-err" role="alert">
              {state.unpublishErr}
            </p>
          )}
        </div>
      </main>
      <Footer />
      <DeleteAccountModal
        open={state.deleteOpen === true}
        onClose={closeDelete}
        pendingUntil={pendingUntil}
        onScheduled={onDeletionScheduled}
        onCancelled={onDeletionCancelled}
      />
      <UnpublishConfirmModal
        target={state.unpublishTarget ?? null}
        busy={state.unpublishBusy === true}
        onClose={closeUnpublish}
        onConfirm={confirmUnpublish}
      />
    </Page>
  )
}
