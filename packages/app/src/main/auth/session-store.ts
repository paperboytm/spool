import { safeStorage } from 'electron'
import Store from 'electron-store'

type Schema = { session_enc: string | null }

let storeInstance: Store<Schema> | null = null

function getStore(): Store<Schema> {
  if (!storeInstance) {
    storeInstance = new Store<Schema>({
      name: 'spool-share-session',
      defaults: { session_enc: null },
    })
  }
  return storeInstance
}

/** Token storage interface. Default impl uses electron's safeStorage
 *  (OS keychain — Keychain on macOS, DPAPI on Windows, libsecret on
 *  Linux). See `_setImpl` for the swap seam. */
export interface SessionStoreImpl {
  isAvailable(): boolean
  saveToken(token: string): void
  loadToken(): string | null
  clearToken(): void
}

const safeStorageImpl: SessionStoreImpl = {
  isAvailable() {
    return safeStorage.isEncryptionAvailable()
  },
  saveToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage not available')
    const enc = safeStorage.encryptString(token).toString('base64')
    getStore().set('session_enc', enc)
  },
  loadToken(): string | null {
    const enc = getStore().get('session_enc')
    if (!enc) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  },
  clearToken(): void {
    getStore().set('session_enc', null)
  },
}

let impl: SessionStoreImpl = safeStorageImpl

/** Swap the underlying token storage. Composition-root seam — used by
 *  the e2e-mode entry to install an in-memory store before any IPC
 *  fires (CI Linux runners lack the libsecret/keyring access safeStorage
 *  requires). Production code never calls this; the call site lives
 *  behind a build-time `if (__SPOOL_E2E__)` guard in main/index.ts and
 *  is therefore absent from production bundles. */
export function _setImpl(newImpl: SessionStoreImpl): void {
  impl = newImpl
}

export function isAvailable(): boolean {
  return impl.isAvailable()
}

export function saveToken(token: string): void {
  impl.saveToken(token)
}

export function loadToken(): string | null {
  return impl.loadToken()
}

export function clearToken(): void {
  impl.clearToken()
}
