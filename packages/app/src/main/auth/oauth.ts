// Generic loopback-PKCE OAuth flow for the desktop app. Each entry in
// PROVIDERS knows its own authorize/token endpoint, scopes, and env-var
// holding the desktop client id. Adding GitHub / Apple means
// registering one more entry — the flow itself, the IPC contract, and
// the loopback server stay the same.
//
// We forward the resulting id_token + nonce to the backend's
// /api/auth/sign-in-with-id-token with the provider name so the server
// runs the matching verifier. The session token comes back the same
// way regardless of which provider issued the id_token.

import { shell } from 'electron'
import crypto from 'node:crypto'

import { backendUrl } from '../share/backend-url.js'

import { startLoopback } from './loopback-server.js'

export type ProviderId = 'google'

interface ProviderConfig {
  authorizeUrl: string
  tokenUrl: string
  scopes: string
  /** Lookup for the desktop OAuth client id. Keep envvar names provider-
   *  specific so a misconfigured GitHub env can't masquerade as Google. */
  clientIdFromEnv: () => string | undefined
  /** Lookup for the desktop OAuth client secret. Google's "installed
   *  app" flow still requires `client_secret` at the token endpoint
   *  alongside PKCE — Google's own docs acknowledge it isn't truly
   *  secret for distributed apps but the API rejects the exchange
   *  without it. Other providers (GitHub PKCE etc.) may return
   *  undefined here; the token exchange will simply omit the field. */
  clientSecretFromEnv: () => string | undefined
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'openid email profile',
    clientIdFromEnv: () => process.env['SPOOL_GOOGLE_CLIENT_ID_DESKTOP'],
    clientSecretFromEnv: () => process.env['SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP'],
  },
}

function envVarNameFor(id: ProviderId): string {
  // Only google for now — extend with a switch when a second provider lands.
  if (id === 'google') return 'SPOOL_GOOGLE_CLIENT_ID_DESKTOP'
  throw new Error(`Unknown provider: ${id as string}`)
}

function secretEnvVarNameFor(id: ProviderId): string {
  if (id === 'google') return 'SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP'
  throw new Error(`Unknown provider: ${id as string}`)
}

export interface SignInResult {
  session_token: string
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
    handle?: string | null
    /** Epoch-ms when worker will hard-delete; null when account is healthy. */
    deletion_pending_until?: number | null
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function readShortBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  } catch {
    return ''
  }
}

export async function signInWith(providerId: ProviderId = 'google'): Promise<SignInResult> {
  const config = PROVIDERS[providerId]
  if (!config) throw new Error(`unknown provider: ${providerId}`)
  const cid = config.clientIdFromEnv()
  if (!cid) throw new Error(`${envVarNameFor(providerId)} missing`)
  const csecret = config.clientSecretFromEnv()
  // Google rejects the token exchange with "client_secret is missing"
  // for installed-app credentials even with PKCE. Fail early so the
  // user sees a clear "missing env" error instead of an opaque 400.
  if (providerId === 'google' && !csecret) {
    throw new Error(`${secretEnvVarNameFor(providerId)} missing`)
  }

  const verifier = b64url(crypto.randomBytes(64))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(24))
  const nonce = b64url(crypto.randomBytes(24))

  const loop = await startLoopback(state)

  const auth = new URL(config.authorizeUrl)
  auth.searchParams.set('client_id', cid)
  auth.searchParams.set('redirect_uri', loop.redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', config.scopes)
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('state', state)
  auth.searchParams.set('nonce', nonce)
  auth.searchParams.set('prompt', 'select_account')

  await shell.openExternal(auth.toString())
  const { code } = await loop.awaitCallback()

  const tokenBody = new URLSearchParams({
    code,
    client_id: cid,
    redirect_uri: loop.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  })
  if (csecret) tokenBody.set('client_secret', csecret)
  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  })
  if (!tokenRes.ok) {
    throw new Error(`token exchange ${tokenRes.status}: ${await readShortBody(tokenRes)}`)
  }
  const tokens = (await tokenRes.json()) as { id_token: string }

  const backendRes = await fetch(`${backendUrl()}/api/auth/sign-in-with-id-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: providerId, id_token: tokens.id_token, nonce }),
  })
  if (!backendRes.ok) {
    throw new Error(`backend sign-in ${backendRes.status}: ${await readShortBody(backendRes)}`)
  }
  return (await backendRes.json()) as SignInResult
}

/** @deprecated Use signInWith('google'). Kept as a thin shim while
 *  callsites migrate; remove when the IPC layer routes by provider. */
export function signInWithGoogle(): Promise<SignInResult> {
  return signInWith('google')
}
