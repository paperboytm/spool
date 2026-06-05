import { useState } from 'react'
import { useShareAuth } from '../../hooks/useShareAuth.js'

/** Embedded sign-in card. Lives inside the Share popover's Publish
 *  tab (signed-out branch) and inside SettingsAccount (signed-out)
 *  so the user lands in one consistent surface no matter how they
 *  trigger sign-in.
 *
 *  The OAuth dance runs via useShareAuth.signIn — which wraps the
 *  IPC and broadcasts an auth-change event so every other mounted
 *  useShareAuth in the renderer re-syncs without a navigation. Going
 *  through the hook (instead of the raw IPC) is what makes "sign in
 *  on Settings → close Settings → Shares page reflects signed-in"
 *  work. Caller still receives onSignedIn so it can advance its own
 *  UI (e.g. refresh editor state). */
export function ConnectCard({
  onSignedIn,
}: {
  onSignedIn?: () => void
}) {
  const { signIn: dispatchSignIn } = useShareAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function signIn() {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await dispatchSignIn()
      onSignedIn?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface p-5">
      <h4 className="text-[14px] font-semibold text-warm-text dark:text-dark-text mb-1.5">
        Sign in to spool.pro
      </h4>
      <p className="text-[12px] leading-snug text-warm-muted dark:text-dark-muted mb-4">
        Spool only ever uploads snapshots you explicitly publish. Drafts and your library
        never leave this machine.
      </p>
      <button
        type="button"
        onClick={() => { void signIn() }}
        disabled={busy}
        data-testid="connect-card-signin"
        className="inline-flex items-center justify-center gap-2 h-7 px-3 rounded-md text-[12px] font-medium bg-white dark:bg-dark-surface2 text-[#1C1C18] dark:text-dark-text border border-warm-border2 dark:border-dark-border2 hover:border-accent hover:dark:border-accent-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-[1.6px] border-current border-t-transparent animate-spin" />
            Waiting for browser…
          </>
        ) : (
          <>
            <GoogleMark size={15} />
            Sign in with Google
          </>
        )}
      </button>
      {err && (
        <p className="mt-3 text-[11.5px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]">
          {err}
        </p>
      )}
    </div>
  )
}

function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
