import { ApiError } from '../../errors'
import { setDevJwks, verifyIdToken } from '../jwks'
import type {
  BuildAuthRequestParams,
  ExchangeCodeParams,
  IdentityClaim,
  OAuthProvider,
  ProviderEnv,
  VerifyNativeIdTokenParams,
} from './types'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = 'openid email profile'

function requireClientId(env: ProviderEnv): string {
  if (!env.GOOGLE_CLIENT_ID_WEB) throw new ApiError('INTERNAL', 'no GOOGLE_CLIENT_ID_WEB')
  return env.GOOGLE_CLIENT_ID_WEB
}

function requireClientSecret(env: ProviderEnv): string {
  if (!env.GOOGLE_CLIENT_SECRET_WEB) {
    throw new ApiError('INTERNAL', 'no GOOGLE_CLIENT_SECRET_WEB')
  }
  return env.GOOGLE_CLIENT_SECRET_WEB
}

function requireDesktopAudience(env: ProviderEnv): string {
  if (!env.GOOGLE_CLIENT_ID_DESKTOP) {
    throw new ApiError('INTERNAL', 'no GOOGLE_CLIENT_ID_DESKTOP')
  }
  return env.GOOGLE_CLIENT_ID_DESKTOP
}

export const googleProvider: OAuthProvider = {
  id: 'google',

  buildAuthRequestUrl(params: BuildAuthRequestParams, env: ProviderEnv): string {
    const auth = new URL(AUTHORIZE_URL)
    auth.searchParams.set('client_id', requireClientId(env))
    auth.searchParams.set('redirect_uri', params.redirectUri)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', SCOPES)
    auth.searchParams.set('state', params.state)
    auth.searchParams.set('code_challenge', params.codeChallenge)
    auth.searchParams.set('code_challenge_method', 'S256')
    auth.searchParams.set('prompt', 'select_account')
    return auth.toString()
  },

  async exchangeCode(params: ExchangeCodeParams, env: ProviderEnv): Promise<IdentityClaim> {
    // Local-dev reroutes — see ProviderEnv. No-ops in prod.
    if (env.DEV_JWKS) setDevJwks(env.DEV_JWKS)
    const tokenRes = await fetch(env.DEV_GOOGLE_TOKEN_URL ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: requireClientId(env),
        client_secret: requireClientSecret(env),
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: params.codeVerifier,
      }),
    })
    if (!tokenRes.ok) throw new ApiError('FORBIDDEN', 'token exchange')
    const tokens = (await tokenRes.json()) as { id_token: string }
    const claims = await verifyIdToken(tokens.id_token, {
      audience: requireClientId(env),
    })
    if (!claims.email) throw new ApiError('BAD_REQUEST', 'no email')
    return {
      provider: 'google',
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? null,
      avatar_url: claims.picture ?? null,
    }
  },

  async verifyNativeIdToken(
    params: VerifyNativeIdTokenParams,
    env: ProviderEnv,
  ): Promise<IdentityClaim> {
    const claims = await verifyIdToken(params.idToken, {
      audience: requireDesktopAudience(env),
      nonce: params.nonce,
    })
    if (!claims.email) throw new ApiError('BAD_REQUEST', 'no email')
    return {
      provider: 'google',
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? null,
      avatar_url: claims.picture ?? null,
    }
  },
}
