import { safeStorage } from 'electron'
import Store from 'electron-store'

type Schema = { session_enc: string | null }

// E2E test mode: skip safeStorage entirely. Headless CI Linux runners
// typically lack libsecret/keyring access, so safeStorage.isEncryptionAvailable()
// returns false and saveToken throws — which would prevent every e2e
// from exercising the signed-in branches of the share-publish UI.
// In-memory store mirrors the production interface (saveToken/loadToken/
// clearToken/isAvailable) so test runs land on the same code paths.
const E2E_TEST = process.env['SPOOL_E2E_TEST'] === '1'
let memoryToken: string | null = null

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
  if (E2E_TEST) return true
  return safeStorage.isEncryptionAvailable()
}

export function saveToken(token: string): void {
  if (E2E_TEST) {
    memoryToken = token
    return
  }
  if (!isAvailable()) throw new Error('safeStorage not available')
  const enc = safeStorage.encryptString(token).toString('base64')
  getStore().set('session_enc', enc)
}

export function loadToken(): string | null {
  if (E2E_TEST) return memoryToken
  const enc = getStore().get('session_enc')
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function clearToken(): void {
  if (E2E_TEST) {
    memoryToken = null
    return
  }
  getStore().set('session_enc', null)
}
