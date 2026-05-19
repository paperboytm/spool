import { ipcMain } from 'electron'
import { signInWithGoogle } from '../auth/google-oauth.js'
import { saveToken, loadToken, clearToken, isAvailable } from '../auth/session-store.js'
import { authedFetch } from '../share/api-client.js'

export function registerShareAuthIpc(): void {
  ipcMain.handle('share-auth:available', () => isAvailable())

  ipcMain.handle('share-auth:signin', async () => {
    if (!isAvailable()) throw new Error('OS keychain unavailable')
    const result = await signInWithGoogle()
    saveToken(result.session_token)
    return result.user
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
