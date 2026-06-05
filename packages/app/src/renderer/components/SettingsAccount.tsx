import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { ConnectCard } from './share-editor/ConnectCard.js'
import { DeleteAccountConfirmModal } from './DeleteAccountConfirmModal.js'
import { useShareAuth } from '../hooks/useShareAuth.js'

// 320ms matches the web /me HandleClaim debounce — see share-web/Me.tsx.
// Without it, every keystroke fires a backend IPC + network call, and
// out-of-order responses can stamp a stale 'available' over a fresh
// 'taken' when the user is typing fast.
const HANDLE_CHECK_DEBOUNCE_MS = 320

type DeletionStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; executeAt: number }

export default function SettingsAccount() {
  const { user, loading, signOut, refresh } = useShareAuth()
  const [handleDraft, setHandleDraft] = useState('')
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [claiming, setClaiming] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus>({ kind: 'idle' })
  // Schedule + cancel are unilateral state changes against the
  // backend; double-clicking either would fire duplicate POSTs. We
  // surface the in-flight state on the buttons so the user gets a
  // signal beyond the disabled-attribute flicker.
  const [scheduling, setScheduling] = useState(false)
  const [cancellingDelete, setCancellingDelete] = useState(false)
  // Sequence counter drops out-of-order checkHandle responses; debounce
  // timer collapses a burst of keystrokes into a single network call.
  const checkSeqRef = useRef(0)
  const debounceRef = useRef<number | null>(null)

  // Reset the handle draft whenever the signed-in identity changes so the
  // claim input doesn't carry a stale value across account switches.
  // Deletion status is seeded from the server-side `deletion_pending_until`
  // so the Cancel CTA shows up when the user scheduled deletion from a
  // different device — otherwise this surface would look idle and the
  // user couldn't recover within the grace window.
  useEffect(() => {
    setHandleDraft('')
    setHandleStatus('idle')
    setShowDeleteConfirm(false)
    setDeletionStatus(
      user?.deletion_pending_until
        ? { kind: 'pending', executeAt: user.deletion_pending_until }
        : { kind: 'idle' },
    )
  }, [user?.id, user?.deletion_pending_until])

  if (loading) return null

  if (!user) {
    return (
      <div className="space-y-6">
        <ConnectCard
          onSignedIn={() => {
            void refresh()
          }}
        />
      </div>
    )
  }

  const onHandleChange = (v: string) => {
    const normalized = v.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().slice(0, 24)
    setHandleDraft(normalized)
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (normalized.length < 3) {
      setHandleStatus(normalized.length === 0 ? 'idle' : 'invalid')
      return
    }
    setHandleStatus('checking')
    const seq = ++checkSeqRef.current
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await window.spoolShare.checkHandle(normalized)
        if (seq !== checkSeqRef.current) return
        setHandleStatus(r.available ? 'available' : 'taken')
      } catch {
        if (seq !== checkSeqRef.current) return
        setHandleStatus('invalid')
      }
    }, HANDLE_CHECK_DEBOUNCE_MS)
  }

  const onClaim = async () => {
    if (claiming || handleStatus !== 'available') return
    setClaiming(true)
    try {
      await window.spoolShare.claimHandle(handleDraft)
      toast.success(`Handle @${handleDraft} claimed`)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Couldn\'t claim handle'
      toast.error(msg)
    } finally {
      setClaiming(false)
    }
  }

  const onScheduleDelete = async () => {
    if (scheduling) return
    setScheduling(true)
    try {
      const r = await window.spoolShare.scheduleDelete()
      const executeAt = r.execute_at ?? r.scheduled_at + 24 * 60 * 60 * 1000
      setDeletionStatus({ kind: 'pending', executeAt })
      setShowDeleteConfirm(false)
    } catch (err) {
      console.error('Schedule delete failed:', err)
      toast.error("Couldn't schedule deletion")
    } finally {
      setScheduling(false)
    }
  }

  const onCancelDelete = async () => {
    if (cancellingDelete) return
    setCancellingDelete(true)
    try {
      await window.spoolShare.cancelDelete()
      setDeletionStatus({ kind: 'idle' })
      toast.success('Deletion cancelled')
    } catch (err) {
      console.error('Cancel delete failed:', err)
      toast.error("Couldn't cancel deletion")
    } finally {
      setCancellingDelete(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="flex items-center gap-4">
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            referrerPolicy="no-referrer"
            className="w-12 h-12 rounded-full bg-warm-surface2 dark:bg-dark-surface2"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-warm-surface2 dark:bg-dark-surface2 flex items-center justify-center text-warm-faint dark:text-dark-muted text-xs">
            {(user.name ?? user.email).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-warm-text dark:text-dark-text truncate">
            {user.name ?? user.email}
          </div>
          <div className="text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate">
            {user.email}
          </div>
          {user.handle && (
            <div className="text-[11px] text-warm-muted dark:text-dark-muted mt-0.5">
              @{user.handle} · <span className="font-mono">spool.pro/@{user.handle}</span>
            </div>
          )}
        </div>
      </div>

      {/* Handle claim */}
      {!user.handle && (
        <div>
          <h4 className="text-[12px] font-medium text-warm-text dark:text-dark-text mb-2">
            Handle
          </h4>
          <p className="text-[12px] text-warm-muted dark:text-dark-muted mb-2">
            Claim a handle to get a public profile at <span className="font-mono">spool.pro/@your-handle</span>.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 inline-flex items-center h-9 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface focus-within:border-accent dark:focus-within:border-accent-dark transition-colors">
              <span className="pl-3 pr-1 text-[12px] font-mono text-warm-faint dark:text-dark-muted">@</span>
              <input
                type="text"
                value={handleDraft}
                onChange={(e) => onHandleChange(e.target.value)}
                placeholder="your-handle"
                className="flex-1 bg-transparent outline-none text-[12px] font-mono text-warm-text dark:text-dark-text"
                data-testid="settings-account-handle-input"
              />
              <HandleStatusIndicator status={handleStatus} />
            </div>
            <button
              type="button"
              onClick={() => { void onClaim() }}
              disabled={claiming || handleStatus !== 'available'}
              className="h-9 px-3 rounded-[6px] text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {claiming ? 'Saving…' : 'Save'}
            </button>
          </div>
          {/* Hints live below the input so the contextual copy doesn't
           *  fight the inline status pill for vertical space. Only
           *  shown for non-neutral states. */}
          {handleStatus === 'taken' && (
            <p className="mt-1.5 text-[11px] text-warm-muted dark:text-dark-muted">
              That handle is already claimed. Try a different one.
            </p>
          )}
          {handleStatus === 'invalid' && (
            <p className="mt-1.5 text-[11px] text-warm-muted dark:text-dark-muted">
              Use 3–24 lowercase letters, numbers, dash, or underscore.
            </p>
          )}
        </div>
      )}

      {/* Account actions — laid out as labeled text rows (heading +
       *  description + action button) rather than icon cards. The
       *  earlier card treatment was visually heavy enough that the
       *  destructive button text got truncated on narrow widths, and
       *  drawing borders around Sign out / Delete account made the
       *  surface read busier than the destructive content warrants.
       *  Sign out has no twostep confirm — it is fully reversible
       *  (the user can sign back in at any time) and matches the
       *  industry default (GitHub, Notion, Linear, Vercel, Slack).
       *  Delete account is irreversible and escalates to a centered
       *  modal, the same pattern UnpublishConfirmModal uses. */}
      <div className="space-y-5">
        {/* Sign out — labeled row, no card. */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-warm-text dark:text-dark-text">
              Sign out
            </div>
            <div className="mt-0.5 text-[11.5px] text-warm-muted dark:text-dark-muted">
              You'll need to sign back in to publish from this device.
            </div>
          </div>
          <button
            type="button"
            data-testid="settings-account-signout"
            onClick={() => { void signOut() }}
            className="flex-none h-8 px-3 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-[12px] text-warm-text dark:text-dark-text hover:border-warm-border2 dark:hover:border-dark-border2 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Delete account — pending state shows the cool-off timer +
         *  Cancel CTA; idle state shows the destructive trigger that
         *  opens the centered confirm modal. */}
        {deletionStatus.kind === 'pending' ? (
          <div>
            <div className="text-[12.5px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
              Deletion scheduled
            </div>
            <div className="mt-0.5 text-[11.5px] text-warm-muted dark:text-dark-muted">
              Your account and all published shares will be removed at{' '}
              <span className="font-mono">{new Date(deletionStatus.executeAt).toLocaleString()}</span>.
            </div>
            <button
              type="button"
              onClick={() => { void onCancelDelete() }}
              disabled={cancellingDelete}
              className="mt-2 h-8 px-3 rounded-md text-[12px] font-medium border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text hover:border-warm-border2 dark:hover:border-dark-border2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {cancellingDelete ? 'Cancelling…' : 'Cancel deletion'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
                Delete account
              </div>
              <div className="mt-0.5 text-[11.5px] text-warm-muted dark:text-dark-muted">
                Permanently remove your account and every published share. 24-hour cool-off.
              </div>
            </div>
            <button
              type="button"
              data-testid="settings-account-delete"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex-none h-8 px-3 rounded-md border border-[color:var(--color-status-error)]/30 dark:border-[color:var(--color-status-error-dark)]/30 text-[12px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)] hover:bg-[color:var(--color-status-error)]/8 dark:hover:bg-[color:var(--color-status-error-dark)]/8 transition-colors whitespace-nowrap"
            >
              Delete account
            </button>
          </div>
        )}
      </div>

      <DeleteAccountConfirmModal
        open={showDeleteConfirm}
        busy={scheduling}
        error={null}
        onClose={() => {
          if (!scheduling) setShowDeleteConfirm(false)
        }}
        onConfirm={() => { void onScheduleDelete() }}
      />
    </div>
  )
}

/**
 * Inline status pill inside the handle input. We render colour + icon
 * for `available` (green check) and leave the others as muted text —
 * the input border + a hint line below carries the failure cases, so
 * the pill doesn't need to compete for the user's attention.
 */
function HandleStatusIndicator({
  status,
}: {
  status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
}) {
  if (status === 'idle') return null
  if (status === 'checking') {
    return (
      <span
        className="px-2 inline-flex items-center gap-1 text-[10px] font-medium text-warm-faint dark:text-dark-muted"
        aria-label="Checking handle availability"
      >
        <span className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
        Checking
      </span>
    )
  }
  if (status === 'available') {
    return (
      <span className="px-2 inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--color-status-success,#3E7D52)] dark:text-[color:var(--color-status-success-dark,#6FB286)]">
        <Check size={10} strokeWidth={2.5} aria-hidden />
        Available
      </span>
    )
  }
  if (status === 'taken') {
    return (
      <span className="px-2 text-[10px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
        Taken
      </span>
    )
  }
  return (
    <span className="px-2 text-[10px] font-medium text-warm-muted dark:text-dark-muted">
      Invalid
    </span>
  )
}
