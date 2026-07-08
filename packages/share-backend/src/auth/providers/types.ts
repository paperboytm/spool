// OAuth / OIDC provider abstraction. Each entry in the registry knows
// how to build its authorize URL, exchange an authorization code for an
// identity, and verify a native (desktop-loopback) id_token. The route
// handlers stay provider-agnostic; adding GitHub / Apple is registering
// one more object, no new endpoints.

export type ProviderId = 'google'

export interface IdentityClaim {
  provider: ProviderId
  /** Provider-stable user id. Must NOT be the email — emails get
   *  re-issued by some providers and would break login on change. */
  sub: string
  email: string
  name: string | null
  avatar_url: string | null
}

export interface BuildAuthRequestParams {
  state: string
  codeChallenge: string
  /** Absolute redirect URI; MUST exactly match the one registered with
   *  the provider AND the one used in the code exchange. */
  redirectUri: string
}

export interface ExchangeCodeParams {
  code: string
  codeVerifier: string
  redirectUri: string
}

export interface VerifyNativeIdTokenParams {
  idToken: string
  nonce: string
}

/** Minimal env contract — providers only see what they need. Concrete
 *  Env types in route handlers narrow this further. */
export interface ProviderEnv {
  // Web (browser → /api/auth/<provider>/callback) credentials
  GOOGLE_CLIENT_ID_WEB?: string
  GOOGLE_CLIENT_SECRET_WEB?: string
  // Native / desktop (Electron loopback) audience
  GOOGLE_CLIENT_ID_DESKTOP?: string
  // Local-dev bindings injected by share-dev.sh; never set in prod.
  // workerd's outbound fetch consults no proxy (workers-sdk#4515), so
  // on proxy-only dev networks the JWKS fetch and the token exchange
  // are rerouted: keys are host-prefetched, the exchange goes through
  // the share-web vite dev middleware (/__dev/google-token).
  DEV_JWKS?: string
  DEV_GOOGLE_TOKEN_URL?: string
}

export interface OAuthProvider {
  id: ProviderId
  /** Build the URL we redirect the browser to during /start. */
  buildAuthRequestUrl(params: BuildAuthRequestParams, env: ProviderEnv): string
  /** Web callback: exchange auth code for tokens, return IdentityClaim. */
  exchangeCode(params: ExchangeCodeParams, env: ProviderEnv): Promise<IdentityClaim>
  /** Desktop loopback: verify an id_token + nonce, return IdentityClaim.
   *  Providers that don't issue OIDC id_tokens (e.g. GitHub) will throw
   *  a NOT_IMPLEMENTED — desktop sign-in for them would use a different
   *  contract (PKCE → access token → user info call). */
  verifyNativeIdToken(
    params: VerifyNativeIdTokenParams,
    env: ProviderEnv,
  ): Promise<IdentityClaim>
}
