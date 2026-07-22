import { Avatar, Button, IconButton, SectionLabel } from '@spool-lab/ui'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Footer, Header, Icon, Page } from '../components/Chrome'
import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { ProfileEditor } from '../components/ProfileEditor'
import { TeamsSection } from '../components/TeamsSection'
import {
  cancelAccountDeletion,
  checkHandle,
  claimHandle,
  fetchMe,
  fetchMyShares,
  revokeShare,
  setShareVisibility,
  scheduleAccountDeletion,
  signOut,
  type MeFetchResult,
  type MeResponse,
  type MeShareRow,
  type MySharesFetchResult,
  type DeleteAccountResult,
} from '../lib/api'
import { humanDate, humanDateTime } from '../lib/dates'

// Public profiles (/@handle pages) are cut from the launch scope. This
// gates the handle-claim entry point; the backend gates the API side
// (the backend PROFILES_ENABLED env var — flip both together if user
// feedback brings profiles back). Everything downstream — the profile
// page, the per-share "List on profile" action — already keys off the
// user having a handle, so it stays dark on its own.
const PROFILES_ENABLED = false

// Match the server-side handle regex (apps/backend/src/handles.ts).
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
      legacySharesUnavailable?: boolean
      deleteOpen?: boolean
      unpublishTarget?: MeShareRow | null
      unpublishBusy?: boolean
      unpublishErr?: string | null
    }
  | { kind: 'error' }

// Pure mapping from the two parallel fetch results to a load outcome.
// Kept side-effect-free (no setState, no navigation) so the
// /api/me-vs-/api/me/shares failure matrix can be unit-tested without a
// DOM. The caller turns 'redirect' into a navigation and the rest into
// a LoadState.
//
// The asymmetry that motivates this: a 5xx/network failure on
// /api/me/shares must NOT collapse into the empty-state ("nothing
// published") — that's a lie. Legacy snapshots are secondary to current
// Hub Sessions, though, so their failure no longer blocks the whole
// account. The outcome carries an explicit unavailable state for that
// section. 'forbidden' (deletion-pending) is expected because the legacy
// section is hidden during the grace window.
export type LoadOutcome =
  | { kind: 'redirect' }
  | { kind: 'error' }
  | {
      kind: 'ok'
      me: MeResponse
      shares: MeShareRow[]
      legacySharesUnavailable?: boolean
    }

export function resolveLoadOutcome(
  meResult: MeFetchResult,
  sharesResult: MySharesFetchResult,
): LoadOutcome {
  if (meResult.kind === 'unauthenticated') return { kind: 'redirect' }
  if (meResult.kind !== 'ok') return { kind: 'error' }
  if (sharesResult.kind === 'ok') {
    return { kind: 'ok', me: meResult.me, shares: sharesResult.shares }
  }
  // deletion-pending: shares are hidden anyway, render with an empty list.
  if (sharesResult.kind === 'forbidden') {
    return { kind: 'ok', me: meResult.me, shares: [] }
  }
  // 'error' or a racing 'unauthenticated': keep current Sessions and Teams
  // usable, but do not misrepresent unavailable legacy data as an empty list.
  return { kind: 'ok', me: meResult.me, shares: [], legacySharesUnavailable: true }
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
                e.target.value.toLowerCase().replace(HANDLE_NORMALISE, '').slice(0, HANDLE_MAX_LEN),
              )
            }
          />
        </div>
      </label>
      <Button type="submit" variant="accent" disabled={submitDisabled}>
        {busy ? 'Claiming…' : 'Claim'}
      </Button>
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

function renderAvailability(a: HandleAvailability): {
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
  hasHandle,
  onUnpublishRequest,
  onToggleVisibility,
}: {
  row: MeShareRow
  disabled?: boolean
  /** Whether "List on profile" is offered — requires a live handle
   *  (the server enforces the same gate). Unlisting is always offered. */
  hasHandle: boolean
  onUnpublishRequest: (row: MeShareRow) => void
  onToggleVisibility: (row: MeShareRow) => Promise<{ ok: boolean; reason?: string }>
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
    <li className={`sw-share${revoked ? ' revoked' : ''}${disabled ? ' disabled' : ''}`}>
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
          <span
            className="sw-share-vis"
            title={
              listed
                ? 'Public — visible in Explore, search, and on your profile'
                : 'Public — visible in Explore and search'
            }
          >
            <Icon name="globe" size={12} />
            Public{listed ? ' · on profile' : ''}
          </span>
          <span>published {humanDate(row.published_at)}</span>
        </span>
      </a>
      {/* Row actions live in a single ⋯ menu: hover-revealed
       *  (always visible on touch — see
       *  the hover:none media rule), pinned while open. Revoked rows
       *  get no actions at all — the slug is permanently 410, so Copy
       *  link would hand out a dead URL. */}
      {!disabled && !revoked && (
        <RowMenu
          copied={copied}
          listed={listed}
          canList={hasHandle}
          onCopy={() => void copy()}
          onToggleVisibility={() => onToggleVisibility(row)}
          onUnpublish={() => onUnpublishRequest(row)}
        />
      )}
    </li>
  )
}

function RowMenu({
  copied,
  listed,
  canList,
  onCopy,
  onToggleVisibility,
  onUnpublish,
}: {
  copied: boolean
  listed: boolean
  canList: boolean
  onCopy: () => void
  onToggleVisibility: () => Promise<{ ok: boolean; reason?: string }>
  onUnpublish: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function toggleVisibility() {
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await onToggleVisibility()
    setBusy(false)
    if (r.ok) {
      setOpen(false)
    } else {
      // No toast surface on the web — the failure renders inline in
      // the open menu and clears when it closes.
      setErr(r.reason ?? 'Could not change visibility.')
    }
  }

  return (
    <div ref={rootRef} className="sw-rowmenu">
      <IconButton
        size="sm"
        type="button"
        className="sw-rowmenu-trigger"
        onClick={() => {
          setErr(null)
          setOpen((v) => !v)
        }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more-h" size={14} />
      </IconButton>
      {open && (
        <div role="menu" className="sw-rowmenu-pop">
          {/* Copy keeps the menu open so the "Copied" confirmation is
           *  visible where the click happened; the parent resets the
           *  copied flag after 1.5s. */}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            role="menuitem"
            className={`sw-rowmenu-item${copied ? ' ok' : ''}`}
            onClick={onCopy}
          >
            <Icon name={copied ? 'check' : 'link'} size={13} />
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {/* Profile listing is optional; both states remain public and discoverable. */}
          {(listed || canList) && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              role="menuitem"
              className="sw-rowmenu-item"
              disabled={busy}
              onClick={() => void toggleVisibility()}
            >
              <Icon name={listed ? 'link-2' : 'globe'} size={13} />
              {listed ? 'Remove from profile' : 'List on profile'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            role="menuitem"
            className="sw-rowmenu-item danger"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              onUnpublish()
            }}
          >
            <Icon name="eye-off" size={13} />
            Unpublish
          </Button>
          {err && <p className="sw-rowmenu-err">{err}</p>}
        </div>
      )}
    </div>
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

export function deleteAccountScheduleFailureMessage(
  result: Exclude<DeleteAccountResult, { kind: 'ok' }>,
): string {
  if (result.kind === 'conflict') {
    return `Account deletion is blocked: ${result.detail ?? 'transfer ownership of or archive every Team you own first.'}`
  }
  return 'Could not schedule deletion — try again.'
}

export function DeleteAccountModal({
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
    setErr(deleteAccountScheduleFailureMessage(r))
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
          keeps your shares and account intact.
        </p>
      ) : (
        <p className="sw-modal-body">
          Your personally owned Sessions are withdrawn and your account is removed after 24 hours.
          Team-owned Sessions remain with their Team. If you own an active Team, transfer ownership
          or archive the Team before continuing. You can undo this from the same place within that
          window.
        </p>
      )}
      {err && (
        <p className="sw-modal-error" role="alert">
          {err}
        </p>
      )}
      <div className="sw-modal-actions">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {pending ? (
          <Button type="button" variant="accent" onClick={onCancel} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel deletion'}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onSchedule} disabled={busy}>
            {busy ? 'Scheduling…' : 'Yes, delete account'}
          </Button>
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
    <ModalShell open={target !== null} busy={busy} onClose={onClose} labelledBy="unpublish-title">
      <h2 id="unpublish-title" className="sw-modal-title">
        Unpublish this share?
      </h2>
      {target && (
        <p className="sw-modal-target sw-mono" title={target.title}>
          {target.title}
        </p>
      )}
      <p className="sw-modal-body">
        This permanently deletes the snapshot from R2 and locks the URL to{' '}
        <span className="sw-mono">410 Gone</span>. The slug can never be reused. To share this
        conversation again, run <span className="sw-mono">npx @spool-lab/cli share</span> — you'll
        get a new URL.
      </p>
      <div className="sw-modal-actions">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={onConfirm} disabled={busy}>
          {busy ? 'Unpublishing…' : 'Yes, unpublish permanently'}
        </Button>
      </div>
    </ModalShell>
  )
}

export function Me() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [showRevoked, setShowRevoked] = useState(false)
  // Re-entrancy lock on confirmUnpublish: the button is `disabled={busy}`
  // but a double-tap on a slow device can fire onClick twice before React
  // commits the `unpublishBusy: true` write. The ref blocks the second
  // call synchronously, before any async work.
  const unpublishingRef = useRef(false)
  // confirmUnpublish closes over `state`, which can be stale if a
  // background refreshMe() re-rendered between modal-open and the confirm
  // click. Mirror the current target into a ref so the action always
  // operates on what the modal is actually showing.
  const unpublishTargetRef = useRef<MeShareRow | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const [meResult, sharesResult] = await Promise.all([fetchMe(), fetchMyShares()])
    const outcome = resolveLoadOutcome(meResult, sharesResult)
    if (outcome.kind === 'redirect') {
      window.location.replace('/sign-in?next=/me')
      return
    }
    if (outcome.kind === 'error') {
      setState({ kind: 'error' })
      return
    }
    setState({
      kind: 'ok',
      me: outcome.me,
      shares: outcome.shares,
      ...(outcome.legacySharesUnavailable ? { legacySharesUnavailable: true } : {}),
    })
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

  const refreshLegacyShares = useCallback(async () => {
    const result = await fetchMyShares()
    if (result.kind === 'unauthenticated') {
      window.location.assign('/sign-in?next=/me')
      return
    }
    setState((current) => {
      if (current.kind !== 'ok') return current
      if (result.kind !== 'ok') return { ...current, legacySharesUnavailable: true }
      return { ...current, shares: result.shares, legacySharesUnavailable: false }
    })
  }, [])

  useEffect(() => {
    document.title = 'Your account · spool.new'
    void load()
  }, [load])

  // Keep the unpublish-target ref in lockstep with the rendered target so
  // confirmUnpublish never reads a stale closed-over value.
  const currentTarget = state.kind === 'ok' ? (state.unpublishTarget ?? null) : null
  useEffect(() => {
    unpublishTargetRef.current = currentTarget
  }, [currentTarget])

  async function onToggleVisibility(row: MeShareRow): Promise<{ ok: boolean; reason?: string }> {
    const next =
      row.visibility === 'profile-listed' ? ('unlisted' as const) : ('profile-listed' as const)
    const r = await setShareVisibility(row.id, next)
    if (r.kind === 'ok') {
      setState((s) => {
        if (s.kind !== 'ok') return s
        return {
          ...s,
          shares: s.shares.map((x) => (x.id === row.id ? { ...x, visibility: next } : x)),
        }
      })
      return { ok: true }
    }
    if (r.kind === 'unauthenticated') {
      window.location.assign('/sign-in?next=/me')
      return { ok: true } // navigating away; don't paint an error first
    }
    if (r.kind === 'needs-handle') {
      return { ok: false, reason: 'Claim a handle first — listing needs a profile page.' }
    }
    if (r.kind === 'forbidden') {
      return { ok: false, reason: 'Your account is pending deletion — cancel it first.' }
    }
    if (r.kind === 'rate-limited') {
      return { ok: false, reason: 'Too many changes — wait a minute.' }
    }
    if (r.kind === 'gone' || r.kind === 'not-found') {
      return { ok: false, reason: 'Share not found (already unpublished?).' }
    }
    return { ok: false, reason: 'Could not change visibility — try again.' }
  }

  async function onUnpublish(id: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await revokeShare(id)
    if (r.kind === 'ok') {
      setState((s) => {
        if (s.kind !== 'ok') return s
        return {
          ...s,
          shares: s.shares.map((x) => (x.id === id ? { ...x, revoked_at: Date.now() } : x)),
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
    setState((s) => (s.kind === 'ok' ? { ...s, me: { ...s.me, deletion_pending_until: null } } : s))
    void refreshLegacyShares()
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
            <Button
              type="button"
              variant="outline"
              style={{ marginTop: 20 }}
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const { me, shares } = state
  const pendingUntil = me.deletion_pending_until
  const pending = pendingUntil !== null
  // Live shares stay flat (server order: published_at desc); revoked
  // history collapses into its own section, newest revoke first.
  const liveShares = shares.filter((s) => s.revoked_at === null)
  const revokedShares = shares
    .filter((s) => s.revoked_at !== null)
    .sort((a, b) => (b.revoked_at ?? 0) - (a.revoked_at ?? 0))

  function openDelete() {
    setState((s) => (s.kind === 'ok' ? { ...s, deleteOpen: true } : s))
  }
  function closeDelete() {
    setState((s) => (s.kind === 'ok' ? { ...s, deleteOpen: false } : s))
  }
  function onDeletionScheduled(at: number) {
    setState((s) => (s.kind === 'ok' ? { ...s, me: { ...s.me, deletion_pending_until: at } } : s))
  }
  function requestUnpublish(row: MeShareRow) {
    setState((s) => (s.kind === 'ok' ? { ...s, unpublishTarget: row, unpublishErr: null } : s))
  }
  function closeUnpublish() {
    setState((s) => (s.kind === 'ok' ? { ...s, unpublishTarget: null, unpublishErr: null } : s))
  }
  async function confirmUnpublish() {
    // Read the target from the ref, not the closed-over `state`: a
    // background refreshMe() between modal-open and click can leave this
    // closure pointing at a stale snapshot.
    const target = unpublishTargetRef.current
    if (!target) return
    if (unpublishingRef.current) return
    unpublishingRef.current = true
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
              <Button type="button" size="sm" variant="ghost" onClick={openDelete}>
                Cancel deletion
              </Button>{' '}
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
              <Avatar src={me.avatar_url} name={me.display_name} alt="" size="lg" />
              <div className="body">
                <h1 className="name">{me.display_name}</h1>
                {me.handle && (
                  <p className="handle accent">
                    <a href={`/@${me.handle}`}>@{me.handle}</a>
                  </p>
                )}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          ) : (
            <div className="sw-me-header">
              <div className="sw-me-header-main">
                <ProfileEditor me={me} onChanged={refreshMe} />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          )}

          {PROFILES_ENABLED && !me.handle && !pending && (
            <>
              <div className="sw-divider" style={{ margin: '24px 0 20px' }} />
              <HandleClaim
                onClaimed={(handle) =>
                  setState((s) => (s.kind === 'ok' ? { ...s, me: { ...s.me, handle } } : s))
                }
              />
            </>
          )}

          {!pending ? (
            <>
              <div className="sw-divider sw-account-section-divider" />
              <ManagedSessionsSection />
              <div className="sw-divider sw-account-section-divider" />
              <TeamsSection />
            </>
          ) : null}

          <div className="sw-divider sw-account-section-divider" />
          <SectionLabel
            className="sw-section-label"
            role="heading"
            aria-level={2}
            count={!pending && liveShares.length > 0 ? liveShares.length : undefined}
          >
            Legacy shares
          </SectionLabel>
          {!pending ? (
            <p className="sw-section-help">
              Snapshot links published by older Spool clients. Current Hub Sessions are managed
              above and Team-owned copies also appear in their workspace.
            </p>
          ) : null}
          {pending ? (
            <p className="sw-empty">
              Hidden while deletion is pending. Cancel deletion to restore the list.
            </p>
          ) : state.legacySharesUnavailable ? (
            <div className="sw-team-panel-error" role="alert">
              <p>
                Could not load legacy snapshot links. Current Sessions and Teams are unaffected.
              </p>
              <Button variant="outline" onClick={() => void refreshLegacyShares()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {liveShares.length === 0 ? (
                // No live shares. With zero revoked history this is the
                // genuine first-run empty-state (full CTA). With revoked
                // history below, a short line is enough — the collapsed
                // Unpublished section carries the rest of the story.
                revokedShares.length === 0 ? (
                  <p className="sw-empty">You haven’t published anything yet.</p>
                ) : (
                  <p className="sw-empty">No live shares.</p>
                )
              ) : (
                <ul className="sw-list">
                  {liveShares.map((row) => (
                    <ShareRow
                      key={row.id}
                      row={row}
                      disabled={pending}
                      hasHandle={me.handle !== null}
                      onUnpublishRequest={requestUnpublish}
                      onToggleVisibility={onToggleVisibility}
                    />
                  ))}
                </ul>
              )}
              {/* Revoked shares are history records: collapsed by default
               *  (they accumulate forever — only account deletion purges
               *  them) and display-only. The section only exists when
               *  there's history. */}
              {revokedShares.length > 0 && (
                <div className="sw-collapse">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    className="sw-collapse-head"
                    onClick={() => setShowRevoked((v) => !v)}
                    aria-expanded={showRevoked}
                  >
                    <span>Unpublished · {revokedShares.length}</span>
                    <span className={`sw-collapse-chev${showRevoked ? ' open' : ''}`} aria-hidden>
                      <Icon name="arrow-right" size={11} />
                    </span>
                  </Button>
                  {showRevoked && (
                    <ul className="sw-list">
                      {revokedShares.map((row) => (
                        <ShareRow
                          key={row.id}
                          row={row}
                          disabled={pending}
                          hasHandle={me.handle !== null}
                          onUnpublishRequest={requestUnpublish}
                          onToggleVisibility={onToggleVisibility}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          <p className="sw-signed-in-as">
            <span className="ico">
              <Icon name="lock" size={11} />
            </span>
            <span>Signed in as {me.email}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="sw-link-quiet"
              onClick={openDelete}
            >
              {pending ? 'Cancel deletion' : 'Delete account'}
            </Button>
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
