// E2E composition-root entry for the share-auth contract.
//
// This file is loaded ONLY when the build-time constant __SPOOL_E2E__ is
// `true` (test:e2e sets SPOOL_E2E_TEST=1 before electron-vite build).
// Production builds resolve __SPOOL_E2E__ to `false`; the `import()` in
// main/index.ts that brings this file in becomes unreachable; rollup
// drops the file from the bundle entirely. A grep-based unit test
// (`e2e-mode-clean.test.ts`) enforces that no production binary
// contains this module's marker strings.
//
// What this entry does:
//   1. Swaps the session-store impl to an in-memory backend (CI Linux
//      runners lack libsecret/keyring; production safeStorage path
//      would throw).
//   2. Registers the share-auth IPC channels with a fake-code POST
//      override for the WorkOS PKCE dance. The rest of performSignIn —
//      prior-revoke, saveToken, EventTarget broadcast — runs exactly
//      as in production, only against the swapped storage and a mock
//      backend.

import { _setImpl as setSessionStoreImpl, type SessionStoreImpl } from '../auth/session-store.js'
import type { SignInResult } from '../auth/workos-auth.js'
import { registerShareAuthIpc } from '../ipc/share-auth.js'
import { backendUrl } from '../share/backend-url.js'

let memoryToken: string | null = null

const memoryStore: SessionStoreImpl = {
  isAvailable: () => true,
  saveToken: (token) => {
    memoryToken = token
  },
  loadToken: () => memoryToken,
  clearToken: () => {
    memoryToken = null
  },
}

async function e2eSignIn(): Promise<SignInResult> {
  // No browser, no WorkOS: the mock backend accepts the fake-code
  // marker on the same wire contract the real PKCE flow uses.
  const res = await fetch(`${backendUrl()}/api/auth/sign-in-with-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'workos',
      code: 'e2e-fake-code',
      code_verifier: 'e2e-fake-verifier',
    }),
  })
  if (!res.ok) {
    throw new Error(`e2e backend sign-in ${res.status}`)
  }
  return (await res.json()) as SignInResult
}

export function registerShareAuthIpcForE2E(): void {
  setSessionStoreImpl(memoryStore)
  registerShareAuthIpc(e2eSignIn)
}
