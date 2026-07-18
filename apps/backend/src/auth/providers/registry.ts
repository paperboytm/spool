// Provider registry. Add a new sign-in method here and it becomes
// available on /api/auth/<id>/{start,callback} + the desktop loopback
// endpoint with no other code change.

import type { OAuthProvider, ProviderId } from './types'
import { workosProvider } from './workos'

const PROVIDERS: Record<ProviderId, OAuthProvider> = {
  workos: workosProvider,
}

export function getProvider(id: string): OAuthProvider | null {
  return id in PROVIDERS ? PROVIDERS[id as ProviderId] : null
}

export function listProviders(): readonly OAuthProvider[] {
  return Object.values(PROVIDERS)
}
