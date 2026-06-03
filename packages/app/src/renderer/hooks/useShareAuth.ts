import { useCallback, useEffect, useState } from 'react'

export type ShareAuthUser = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  handle: string | null
  /** Epoch-ms when worker will hard-delete this account; null when healthy.
   *  Non-null means the user is in the 24h grace window and every endpoint
   *  except /api/me + cancel-deletion will 403. */
  deletion_pending_until: number | null
} | null

// Cross-component auth state broadcast. Without this, two surfaces
// using useShareAuth() each maintain their own copy of `user` and a
// sign-in done in Settings/Account doesn't propagate to a Shares page
// rendered behind it — the user has to navigate away and back to see
// the new state. The bus is a thin EventTarget: every hook listens
// for 'change' events and refetches `/me`. We dispatch from the
// `signIn` / `signOut` / `refresh` actions, so a single source of
// truth on the main process backs every listener.
//
// Kept in this module (not a global file) because the event channel
// is exclusively an implementation detail of this hook.
const authBus =
  typeof window !== 'undefined' ? new EventTarget() : null
const AUTH_CHANGE_EVENT = 'spool:share-auth-change'

export function useShareAuth() {
  const [user, setUser] = useState<ShareAuthUser>(null)
  const [loading, setLoading] = useState(true)

  const fetchAndStore = useCallback(async (): Promise<ShareAuthUser> => {
    try {
      const u = await window.spoolShare.me()
      setUser(u as ShareAuthUser)
      return u as ShareAuthUser
    } catch {
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchAndStore().finally(() => {
      if (!cancelled) setLoading(false)
    })
    // Listen for sign-in / sign-out events from other instances of
    // this hook so all surfaces stay in sync without a route change.
    const onChange = () => { void fetchAndStore() }
    authBus?.addEventListener(AUTH_CHANGE_EVENT, onChange)
    return () => {
      cancelled = true
      authBus?.removeEventListener(AUTH_CHANGE_EVENT, onChange)
    }
  }, [fetchAndStore])

  const signIn = useCallback(async () => {
    await window.spoolShare.signIn()
    const full = await fetchAndStore()
    authBus?.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
    return full
  }, [fetchAndStore])

  const signOut = useCallback(async () => {
    await window.spoolShare.signOut()
    setUser(null)
    authBus?.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
  }, [])

  return { user, loading, signIn, signOut }
}
