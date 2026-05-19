import type { PagesFunction } from '@cloudflare/workers-types'

import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  buildOauthCookie,
} from '../../../../src/auth/cookie'
import { safeNext } from '../../../../src/auth/next'
import { pkceChallenge, randomUrlSafe } from '../../../../src/auth/pkce'

type Env = { GOOGLE_CLIENT_ID_WEB: string }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const next = safeNext(url.searchParams.get('next'))
  const state = randomUrlSafe(24)
  const verifier = randomUrlSafe(64)
  const challenge = await pkceChallenge(verifier)

  const redirectUri = `${url.origin}/api/auth/google/callback`
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', ctx.env.GOOGLE_CLIENT_ID_WEB)
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('prompt', 'select_account')

  const headers = new Headers({ Location: auth.toString() })
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_STATE_COOKIE, `${state}|${next}`))
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_VERIFIER_COOKIE, verifier))
  return new Response(null, { status: 302, headers })
}
