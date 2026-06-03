// Two flavours of reserved name, merged into one set:
//   1) URL-routing words that already mean something on spool.pro
//      (collide with /api/*, /me, /settings, etc.)
//   2) Brand / impersonation guards. Cheap to add now; expensive to
//      take back from a squatter after launch.
const RESERVED = new Set([
  // routing
  'admin', 'support', 'help', 'api', 'www', 'me', 'mine', 'editor', 'share', 'shares',
  'snapshot', 'snapshots', 's', 'u', 'user', 'users', 'profile', 'profiles',
  'settings', 'login', 'signin', 'signout', 'signup', 'register',
  'terms', 'privacy', 'dmca', 'report', 'abuse', 'mail', 'root', 'system',
  'anonymous', 'deleted', 'undefined', 'null',
  'about', 'contact', 'home', 'docs', 'blog', 'auth', 'oauth',
  'static', 'assets', 'public', 'feed', 'rss', 'app', 'apps', 'dev',
  'new', 'edit',
  // brand / impersonation
  'spool', 'spoollab', 'spool-lab', 'staff', 'team', 'official',
  'anthropic', 'claude', 'paperboy',
])

// ASCII-only on purpose — closes off Unicode-homoglyph spoofs
// (Cyrillic `о`, Greek `α`, etc.) at the validation layer.
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
