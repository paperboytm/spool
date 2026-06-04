// Provider registry. Add a new sign-in method here and it becomes
// available on /api/auth/<id>/{start,callback} + the desktop loopback
// endpoint with no other code change.

import { googleProvider } from './google'
import type { OAuthProvider, ProviderId } from './types'

const PROVIDERS: Record<ProviderId, OAuthProvider> = {
  google: googleProvider,
}

export function getProvider(id: string): OAuthProvider | null {
  return id in PROVIDERS ? PROVIDERS[id as ProviderId] : null
}

export function listProviders(): readonly OAuthProvider[] {
  return Object.values(PROVIDERS)
}
