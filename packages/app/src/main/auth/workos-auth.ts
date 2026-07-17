// WorkOS AuthKit sign-in for the desktop app — PKCE public client, per
// the official Electron example (github.com/workos/electron-authkit-example):
// authorize runs in the system browser, the callback comes back on the
// spool:// custom scheme, and code_verifier stands in for a client
// secret (the binary can be decompiled, so it must not carry one).
//
// The final code exchange runs SERVER-SIDE at /api/auth/sign-in-with-code:
// share-backend redeems the code with the verifier, reuses the exact web
// upsert + legacy-account-linking path, and mints a spool KV session.
// WorkOS tokens never land on this machine — the app stores exactly one
// credential (the spool session token, in the OS keychain).

import { shell } from 'electron'
import crypto from 'node:crypto'

import { fetchOnce } from '../net/robust-fetch.js'
import { backendUrl } from '../share/backend-url.js'

import { onDeepLink } from './deep-link.js'

const AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize'
// Registered as a redirect URI in the WorkOS dashboard (per environment;
// sandbox for dev, production for release builds).
export const AUTH_CALLBACK_URL = 'spool://auth/callback'
// AuthKit sign-in can involve email codes or account creation — give the
// human time. Matches the cli-auth broker's approval window.
const CALLBACK_TIMEOUT_MS = 15 * 60 * 1000

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

function awaitAuthCallback(state: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('sign-in timed out waiting for the browser callback'))
    }, CALLBACK_TIMEOUT_MS)
    const off = onDeepLink((url) => {
      if (url.host !== 'auth' || url.pathname !== '/callback') return false
      // A stale callback from an earlier, abandoned attempt carries the
      // wrong state — consume it silently and keep waiting for ours.
      // (Scheme hijacking by another app is defused by PKCE regardless:
      // a stolen code is useless without the verifier.)
      if (url.searchParams.get('state') !== state) return true
      clearTimeout(timer)
      off()
      const error = url.searchParams.get('error')
      if (error) {
        reject(
          new Error(url.searchParams.get('error_description') ?? `sign-in failed: ${error}`),
        )
        return true
      }
      const code = url.searchParams.get('code')
      if (!code) {
        reject(new Error('sign-in callback carried no authorization code'))
        return true
      }
      resolve({ code })
      return true
    })
  })
}

export async function signInWithWorkos(): Promise<SignInResult> {
  const clientId = process.env['SPOOL_WORKOS_CLIENT_ID']
  if (!clientId) throw new Error('SPOOL_WORKOS_CLIENT_ID missing')

  const verifier = b64url(crypto.randomBytes(64))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(24))

  const auth = new URL(AUTHORIZE_URL)
  auth.searchParams.set('client_id', clientId)
  auth.searchParams.set('redirect_uri', AUTH_CALLBACK_URL)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('provider', 'authkit')
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('state', state)

  // Subscribe BEFORE opening the browser — on a fast machine the
  // callback can race the openExternal promise.
  const callback = awaitAuthCallback(state)
  await shell.openExternal(auth.toString())
  const { code } = await callback

  // One-shot value (auth codes are single-use at WorkOS), so fetchOnce:
  // a side-effect-free probe picks the working transport (system proxy /
  // env proxy / direct), then the real POST is sent exactly once.
  const backendRes = await fetchOnce(`${backendUrl()}/api/auth/sign-in-with-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'workos', code, code_verifier: verifier }),
  })
  if (!backendRes.ok) {
    throw new Error(`backend sign-in ${backendRes.status}: ${await readShortBody(backendRes)}`)
  }
  return (await backendRes.json()) as SignInResult
}
