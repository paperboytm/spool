import { shell } from 'electron'
import crypto from 'node:crypto'
import { startLoopback } from './loopback-server.js'

export interface SignInResult {
  session_token: string
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
    handle?: string | null
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function clientId(): string {
  return process.env['SPOOL_GOOGLE_CLIENT_ID_DESKTOP'] ?? ''
}

function backend(): string {
  return process.env['SPOOL_SHARE_BACKEND'] ?? 'https://spool.share'
}

export async function signInWithGoogle(): Promise<SignInResult> {
  const cid = clientId()
  if (!cid) throw new Error('SPOOL_GOOGLE_CLIENT_ID_DESKTOP missing')
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

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', cid)
  auth.searchParams.set('redirect_uri', loop.redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
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
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  })
  if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`)
  const tokens = (await tokenRes.json()) as { id_token: string }

  const backendRes = await fetch(`${backend()}/api/auth/sign-in-with-id-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_token: tokens.id_token, nonce }),
  })
  if (!backendRes.ok) throw new Error(`backend sign-in ${backendRes.status}`)
  return (await backendRes.json()) as SignInResult
}
