// WorkOS AuthKit (User Management) provider — the only registered
// provider. The browser is redirected to the hosted AuthKit page
// (provider=authkit), which runs whichever sign-in methods the WorkOS
// environment enables (Google, email+code, SSO, ...). The web flow is a
// confidential client: the code exchange carries WORKOS_API_KEY as
// client_secret, so no PKCE params are sent on the authorize URL and
// the codeVerifier from /start is ignored.
//
// Native surfaces split:
//   - Desktop app: PKCE public client (WorkOS's blessed Electron shape —
//     github.com/workos/electron-authkit-example). The app runs authorize
//     in the system browser with code_challenge + a spool:// callback and
//     posts {code, verifier} to /api/auth/sign-in-with-code, which lands
//     in exchangeNativeCode below. code_verifier replaces client_secret;
//     the docs don't define sending both, so the native exchange omits
//     the API key entirely.
//   - CLI: never touches WorkOS — the cli-auth broker
//     (functions/api/cli-auth/) rides on an approved web session.

import { ApiError } from '../../errors'
import type {
  BuildAuthRequestParams,
  ExchangeCodeParams,
  ExchangeNativeCodeParams,
  IdentityClaim,
  IdentityRef,
  OAuthProvider,
  ProviderEnv,
} from './types'

// The authorize URL is browser-facing and never rerouted; server-side
// calls (authenticate, identities) go through apiBase() so local dev on
// proxy-only networks can swap the host (see ProviderEnv.DEV_WORKOS_API_URL).
const AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize'
const DEFAULT_API_BASE = 'https://api.workos.com'

type WorkosUser = {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  profile_picture_url?: string | null
}

function requireClientId(env: ProviderEnv): string {
  if (!env.WORKOS_CLIENT_ID) throw new ApiError('INTERNAL', 'no WORKOS_CLIENT_ID')
  return env.WORKOS_CLIENT_ID
}

function requireApiKey(env: ProviderEnv): string {
  if (!env.WORKOS_API_KEY) throw new ApiError('INTERNAL', 'no WORKOS_API_KEY')
  return env.WORKOS_API_KEY
}

function apiBase(env: ProviderEnv): string {
  return env.DEV_WORKOS_API_URL ?? DEFAULT_API_BASE
}

function claimFromUser(user: WorkosUser): IdentityClaim {
  if (!user.email) throw new ApiError('BAD_REQUEST', 'no email')
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return {
    provider: 'workos',
    sub: user.id,
    email: user.email,
    name: name === '' ? null : name,
    avatar_url: user.profile_picture_url ?? null,
  }
}

export const workosProvider: OAuthProvider = {
  id: 'workos',

  buildAuthRequestUrl(params: BuildAuthRequestParams, env: ProviderEnv): string {
    const auth = new URL(AUTHORIZE_URL)
    auth.searchParams.set('client_id', requireClientId(env))
    auth.searchParams.set('redirect_uri', params.redirectUri)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('provider', 'authkit')
    auth.searchParams.set('state', params.state)
    return auth.toString()
  },

  async exchangeCode(params: ExchangeCodeParams, env: ProviderEnv): Promise<IdentityClaim> {
    const res = await fetch(`${apiBase(env)}/user_management/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: requireClientId(env),
        client_secret: requireApiKey(env),
        code: params.code,
      }),
    })
    if (!res.ok) throw new ApiError('FORBIDDEN', 'token exchange')
    const body = (await res.json()) as { user?: WorkosUser }
    if (!body.user?.id) throw new ApiError('FORBIDDEN', 'token exchange')
    return claimFromUser(body.user)
  },

  async exchangeNativeCode(
    params: ExchangeNativeCodeParams,
    env: ProviderEnv,
  ): Promise<IdentityClaim> {
    const res = await fetch(`${apiBase(env)}/user_management/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: requireClientId(env),
        code: params.code,
        code_verifier: params.codeVerifier,
      }),
    })
    if (!res.ok) throw new ApiError('FORBIDDEN', 'token exchange')
    const body = (await res.json()) as { user?: WorkosUser }
    if (!body.user?.id) throw new ApiError('FORBIDDEN', 'token exchange')
    return claimFromUser(body.user)
  },

  async resolveAliasIdentities(sub: string, env: ProviderEnv): Promise<IdentityRef[]> {
    const res = await fetch(
      `${apiBase(env)}/user_management/users/${encodeURIComponent(sub)}/identities`,
      { headers: { authorization: `Bearer ${requireApiKey(env)}` } },
    )
    if (!res.ok) throw new ApiError('INTERNAL', 'workos identities fetch')
    const rows = (await res.json()) as Array<{ idp_id?: string; provider?: string }>
    const refs: IdentityRef[] = []
    for (const row of rows) {
      // Only Google predates WorkOS in this codebase; other IdP rows
      // (Microsoft, GitHub, ...) have no legacy identities to match.
      if (row.provider === 'GoogleOAuth' && row.idp_id) {
        refs.push({ provider: 'google', sub: row.idp_id })
      }
    }
    return refs
  },
}
