import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useShareAuth } from '../hooks/useShareAuth.js'
import { DeleteAccountConfirmModal } from './DeleteAccountConfirmModal.js'
import ProfileEditor from './ProfileEditor.js'
import { ConnectCard } from './share-editor/ConnectCard.js'

// Public profiles (/@handle pages) are cut from the launch scope —
// this hides the claim section below, the backend 404s the claim/check
// endpoints (share-backend PROFILES_ENABLED env var), and PublishTab
// hides its visibility picker (SHOW_VISIBILITY_PICKER). Flip all of
// them together if user feedback brings profiles back.
const PROFILES_ENABLED = false

// 320ms matches the web /me HandleClaim debounce — see share-web/Me.tsx.
// Without it, every keystroke fires a backend IPC + network call, and
// out-of-order responses can stamp a stale 'available' over a fresh
// 'taken' when the user is typing fast.
const HANDLE_CHECK_DEBOUNCE_MS = 320

type DeletionStatus = { kind: 'idle' } | { kind: 'pending'; executeAt: number }

export default function SettingsAccount() {
  const { t } = useTranslation()
  const { user, loading, signOut, refresh } = useShareAuth()
  const [handleDraft, setHandleDraft] = useState('')
  const [handleStatus, setHandleStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle')
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
    const normalized = v
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toLowerCase()
      .slice(0, 24)
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
      toast.success(t('settings.account.handle_claimedToast', { handle: handleDraft }))
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.account.handle_claimError')
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
      toast.error(t('settings.account.deletionScheduled_scheduleError'))
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
      toast.success(t('settings.account.deletionScheduled_cancelledToast'))
    } catch (err) {
      console.error('Cancel delete failed:', err)
      toast.error(t('settings.account.deletionScheduled_cancelError'))
    } finally {
      setCancellingDelete(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Identity + profile customization — avatar, display name,
       *  email/handle, and the contextual avatar actions all live in
       *  one row inside <ProfileEditor>. */}
      <ProfileEditor />

      {/* Handle claim */}
      {PROFILES_ENABLED && !user.handle && (
        <div>
          <h4 className="text-warm-text dark:text-dark-text mb-2 text-[12px] font-medium">
            {t('settings.account.handle_title')}
          </h4>
          <p className="text-warm-muted dark:text-dark-muted mb-2 text-[12px]">
            {t('settings.account.handle_help')}{' '}
            <span className="font-mono">spool.pro/@your-handle</span>.
          </p>
          <div className="flex items-center gap-2">
            <div className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface focus-within:border-accent dark:focus-within:border-accent-dark inline-flex h-9 flex-1 items-center rounded-[6px] border transition-colors">
              <span className="text-warm-faint dark:text-dark-muted pr-1 pl-3 font-mono text-[12px]">
                @
              </span>
              <input
                type="text"
                value={handleDraft}
                onChange={(e) => onHandleChange(e.target.value)}
                placeholder={t('settings.account.handle_placeholder')}
                className="text-warm-text dark:text-dark-text flex-1 bg-transparent font-mono text-[12px] outline-none"
                data-testid="settings-account-handle-input"
              />
              <HandleStatusIndicator status={handleStatus} t={t} />
            </div>
            <button
              type="button"
              onClick={() => {
                void onClaim()
              }}
              disabled={claiming || handleStatus !== 'available'}
              className="bg-accent dark:bg-accent-dark h-9 rounded-[6px] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {claiming ? t('settings.account.handle_saving') : t('settings.account.handle_save')}
            </button>
          </div>
          {/* Hints live below the input so the contextual copy doesn't
           *  fight the inline status pill for vertical space. Only
           *  shown for non-neutral states. */}
          {handleStatus === 'taken' && (
            <p className="text-warm-muted dark:text-dark-muted mt-1.5 text-[11px]">
              {t('settings.account.handle_hint_taken')}
            </p>
          )}
          {handleStatus === 'invalid' && (
            <p className="text-warm-muted dark:text-dark-muted mt-1.5 text-[11px]">
              {t('settings.account.handle_hint_invalid')}
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
          <div className="min-w-0 flex-1">
            <div className="text-warm-text dark:text-dark-text text-[12.5px] font-medium">
              {t('settings.account.signOut_title')}
            </div>
            <div className="text-warm-muted dark:text-dark-muted mt-0.5 text-[11.5px]">
              {t('settings.account.signOut_body')}
            </div>
          </div>
          <button
            type="button"
            data-testid="settings-account-signout"
            onClick={() => {
              void signOut()
            }}
            className="border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text hover:border-warm-border2 dark:hover:border-dark-border2 h-8 flex-none rounded-md border px-3 text-[12px] transition-colors"
          >
            {t('settings.account.signOut_title')}
          </button>
        </div>

        {/* Delete account — pending state shows the cool-off timer +
         *  Cancel CTA; idle state shows the destructive trigger that
         *  opens the centered confirm modal. */}
        {deletionStatus.kind === 'pending' ? (
          <div>
            <div className="text-[12.5px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
              {t('settings.account.deletionScheduled_title')}
            </div>
            <div className="text-warm-muted dark:text-dark-muted mt-0.5 text-[11.5px]">
              {(() => {
                // Split the localized string around the {{when}} marker so the
                // monospace timestamp can be inlined while keeping a single
                // translatable sentence.
                const parts = t('settings.account.deletionScheduled_body', {
                  when: ' WHEN ',
                }).split(' WHEN ')
                const when = new Date(deletionStatus.executeAt).toLocaleString()
                return (
                  <>
                    {parts[0]}
                    <span className="font-mono">{when}</span>
                    {parts[1] ?? ''}
                  </>
                )
              })()}
            </div>
            <button
              type="button"
              onClick={() => {
                void onCancelDelete()
              }}
              disabled={cancellingDelete}
              className="border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text hover:border-warm-border2 dark:hover:border-dark-border2 mt-2 h-8 rounded-md border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancellingDelete
                ? t('settings.account.deletionScheduled_cancelling')
                : t('settings.account.deletionScheduled_cancel')}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
                {t('settings.account.deleteAccount_title')}
              </div>
              <div className="text-warm-muted dark:text-dark-muted mt-0.5 text-[11.5px]">
                {t('settings.account.deleteAccount_body')}
              </div>
            </div>
            <button
              type="button"
              data-testid="settings-account-delete"
              onClick={() => setShowDeleteConfirm(true)}
              className="h-8 flex-none rounded-md border border-[color:var(--color-status-error)]/30 px-3 text-[12px] font-medium whitespace-nowrap text-[color:var(--color-status-error)] transition-colors hover:bg-[color:var(--color-status-error)]/8 dark:border-[color:var(--color-status-error-dark)]/30 dark:text-[color:var(--color-status-error-dark)] dark:hover:bg-[color:var(--color-status-error-dark)]/8"
            >
              {t('settings.account.deleteAccount_title')}
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
        onConfirm={() => {
          void onScheduleDelete()
        }}
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
  t,
}: {
  status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (status === 'idle') return null
  if (status === 'checking') {
    return (
      <span
        className="text-warm-faint dark:text-dark-muted inline-flex items-center gap-1 px-2 text-[10px] font-medium"
        aria-label={t('settings.account.handle_status_checking_aria')}
      >
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        {t('settings.account.handle_status_checking')}
      </span>
    )
  }
  if (status === 'available') {
    return (
      <span className="inline-flex items-center gap-1 px-2 text-[10px] font-medium text-[color:var(--color-status-success,#3E7D52)] dark:text-[color:var(--color-status-success-dark,#6FB286)]">
        <Check size={10} strokeWidth={2.5} aria-hidden />
        {t('settings.account.handle_status_available')}
      </span>
    )
  }
  if (status === 'taken') {
    return (
      <span className="px-2 text-[10px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
        {t('settings.account.handle_status_taken')}
      </span>
    )
  }
  return (
    <span className="text-warm-muted dark:text-dark-muted px-2 text-[10px] font-medium">
      {t('settings.account.handle_status_invalid')}
    </span>
  )
}
