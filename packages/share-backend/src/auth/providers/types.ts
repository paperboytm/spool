// OAuth / OIDC provider abstraction. Each entry in the registry knows
// how to build its authorize URL and exchange an authorization code for
// an identity. The route handlers stay provider-agnostic; adding a
// provider is registering one more object, no new endpoints.
//
// Native surfaces (desktop app, CLI) do NOT go through a provider —
// they authenticate via the cli-auth broker (functions/api/cli-auth/),
// which rides on an approved web session instead of talking OAuth.

export type ProviderId = 'workos'

export interface IdentityClaim {
  provider: ProviderId
  /** Provider-stable user id. Must NOT be the email — emails get
   *  re-issued by some providers and would break login on change. */
  sub: string
  email: string
  name: string | null
  avatar_url: string | null
}

/** A bare (provider, sub) pointer into user_identities. `provider` is a
 *  plain string, not ProviderId: alias refs name LEGACY identity rows
 *  (e.g. 'google' from the pre-WorkOS era) that no longer have a
 *  registered provider behind them. */
export interface IdentityRef {
  provider: string
  sub: string
}

export interface BuildAuthRequestParams {
  state: string
  /** PKCE challenge minted by /start. Confidential-client providers
   *  (WorkOS) ignore it; a future public-client provider forwards it. */
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

export interface ExchangeNativeCodeParams {
  code: string
  /** PKCE verifier minted by the native app — the public-client stand-in
   *  for a client secret (WorkOS: "provide the code challenge when
   *  getting the authorization URL and the code verifier when
   *  authenticating a User"). */
  codeVerifier: string
}

/** Minimal env contract — providers only see what they need. Concrete
 *  Env types in route handlers narrow this further. */
export interface ProviderEnv {
  // WorkOS AuthKit (User Management). The API key doubles as the
  // client_secret in the code exchange and as the Bearer credential
  // for the identities lookup.
  WORKOS_CLIENT_ID?: string
  WORKOS_API_KEY?: string
  // Local-dev reroute injected by share-dev.sh; never set in prod.
  // workerd's outbound fetch consults no proxy (workers-sdk#4515), so
  // on proxy-only dev networks the server-side WorkOS calls (code
  // exchange, identities) swap their base URL for this. The
  // browser-facing authorize URL never reroutes.
  DEV_WORKOS_API_URL?: string
}

export interface OAuthProvider {
  id: ProviderId
  /** Build the URL we redirect the browser to during /start. */
  buildAuthRequestUrl(params: BuildAuthRequestParams, env: ProviderEnv): string
  /** Web callback: exchange auth code for tokens, return IdentityClaim. */
  exchangeCode(params: ExchangeCodeParams, env: ProviderEnv): Promise<IdentityClaim>
  /** Native (desktop) sign-in: redeem a PKCE authorization code minted
   *  by a public client — code_verifier instead of client_secret. The
   *  desktop app posts {code, verifier} to /api/auth/sign-in-with-code;
   *  providers without a public-client flow simply omit this. */
  exchangeNativeCode?(
    params: ExchangeNativeCodeParams,
    env: ProviderEnv,
  ): Promise<IdentityClaim>
  /** Optional migration hook. Called by the sign-in flows only when
   *  (provider, sub) has no user_identities row yet: returns identity
   *  refs under OTHER providers that denote the same human (e.g. the
   *  Google sub WorkOS reports for an AuthKit user), so a pre-existing
   *  account is linked instead of duplicated. Errors must propagate —
   *  failing open here would silently fork a legacy user's account. */
  resolveAliasIdentities?(sub: string, env: ProviderEnv): Promise<IdentityRef[]>
}
