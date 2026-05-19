const RESERVED = new Set([
  'admin', 'support', 'help', 'api', 'www', 'me', 'mine', 'editor', 'share', 'shares',
  'snapshot', 'snapshots', 's', 'u', 'user', 'users', 'profile', 'profiles',
  'settings', 'login', 'signin', 'signout', 'signup', 'register',
  'terms', 'privacy', 'dmca', 'report', 'abuse', 'mail', 'root', 'system',
  'anonymous', 'deleted', 'undefined', 'null', 'spool',
])

const RE = /^[a-z][a-z0-9_-]{2,31}$/

export type HandleValidation =
  | { ok: true; handle: string }
  | { ok: false; reason: string }

export function validateHandle(raw: unknown): HandleValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'not a string' }
  const h = raw.trim().toLowerCase()
  if (!RE.test(h)) return { ok: false, reason: 'invalid format' }
  if (RESERVED.has(h)) return { ok: false, reason: 'reserved' }
  return { ok: true, handle: h }
}
