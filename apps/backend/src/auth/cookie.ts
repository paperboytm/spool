export const COOKIE_NAME = 'spool_session'
export const OAUTH_STATE_COOKIE = '__spool_oauth_state'
export const OAUTH_VERIFIER_COOKIE = '__spool_oauth_verifier'

// Lifetime of the short-lived OAuth handshake cookies (state + PKCE
// verifier). Long enough for slow/manual sign-in, short enough that a
// stolen device can't replay an old handshake.
const OAUTH_COOKIE_TTL_SEC = 10 * 60

export function buildSessionCookie(token: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

export function buildOauthCookie(
  name: string,
  value: string,
  maxAgeSec = OAUTH_COOKIE_TTL_SEC,
): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.get('cookie') ?? ''
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
