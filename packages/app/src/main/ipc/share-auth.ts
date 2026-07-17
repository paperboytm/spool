import { ipcMain } from 'electron'
import { signInWithWorkos, type SignInResult } from '../auth/workos-auth.js'
import { saveToken, loadToken, clearToken, isAvailable } from '../auth/session-store.js'
import { authedFetch } from '../share/api-client.js'

export interface SignInDeps {
  loadToken: () => string | null
  saveToken: (token: string) => void
  signIn: () => Promise<SignInResult>
  revokePrior: () => Promise<void>
}

// Pure-ish orchestrator extracted for testability: takes its IO deps as
// args so the test suite can drive the "revoke-prior-then-signin" rule
// without standing up ipcMain or Electron's safeStorage.
export async function performSignIn(deps: SignInDeps): Promise<SignInResult['user']> {
  // If a session is already stored, the user is re-authenticating
  // (account switch, refresh after token loss, etc). Revoke it
  // server-side first so the new session doesn't leave the old KV
  // row dangling until its 30-day TTL. Best-effort: network failure
  // here must not block the new sign-in.
  if (deps.loadToken()) {
    try {
      await deps.revokePrior()
    } catch {
      // ignore — server will GC by TTL if revocation can't reach it now
    }
  }
  const result = await deps.signIn()
  deps.saveToken(result.session_token)
  return result.user
}

/** Optional override for the sign-in dance. Default is the production
 *  WorkOS PKCE flow (system browser + spool:// callback). Override
 *  exists so the e2e composition root can substitute a fake code POST
 *  that exercises the rest of the IPC + backend chain without a real
 *  browser. */
export type SignInImpl = () => Promise<SignInResult>

export function registerShareAuthIpc(
  signInImpl: SignInImpl = signInWithWorkos,
): void {
  ipcMain.handle('share-auth:available', () => isAvailable())

  ipcMain.handle('share-auth:signin', async () => {
    if (!isAvailable()) throw new Error('OS keychain unavailable')
    return performSignIn({
      loadToken,
      saveToken,
      signIn: signInImpl,
      revokePrior: async () => {
        await authedFetch('/api/auth/sign-out', { method: 'POST' })
      },
    })
  })

  ipcMain.handle('share-auth:me', async () => {
    if (!loadToken()) return null
    const r = await authedFetch('/api/me')
    if (r.status === 401) {
      clearToken()
      return null
    }
    if (!r.ok) throw new Error(`me ${r.status}`)
    return r.json()
  })

  ipcMain.handle('share-auth:signout', async () => {
    try {
      await authedFetch('/api/auth/sign-out', { method: 'POST' })
    } catch {
      // best-effort; we clear locally regardless
    }
    clearToken()
    return { ok: true }
  })
}
