const COOKIE_NAME = 'spool_session'
const OAUTH_STATE_COOKIE = '__spool_oauth_state'
const OAUTH_VERIFIER_COOKIE = '__spool_oauth_verifier'

export function buildSessionCookie(token: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

export function buildOauthCookie(name: string, value: string, maxAgeSec = 600): string {
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

export { COOKIE_NAME, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE }
