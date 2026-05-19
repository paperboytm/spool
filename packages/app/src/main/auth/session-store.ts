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

export function isAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveToken(token: string): void {
  if (!isAvailable()) throw new Error('safeStorage not available')
  const enc = safeStorage.encryptString(token).toString('base64')
  getStore().set('session_enc', enc)
}

export function loadToken(): string | null {
  const enc = getStore().get('session_enc')
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function clearToken(): void {
  getStore().set('session_enc', null)
}
