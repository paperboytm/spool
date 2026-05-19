import type { KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { COOKIE_NAME, clearCookie, readCookie } from '../../../src/auth/cookie'
import { destroySession } from '../../../src/auth/session'

type Env = { SESSIONS: KVNamespace }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const token =
    readCookie(ctx.request, COOKIE_NAME) ??
    (ctx.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null)
  if (token) await destroySession(ctx.env.SESSIONS, token)
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append('Set-Cookie', clearCookie(COOKIE_NAME))
  return new Response('{"ok":true}', { headers })
}
