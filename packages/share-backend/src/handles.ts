// Public profiles (/@handle pages) are cut from the launch scope: no
// client offers handle claiming, and the claim/check endpoints behind
// this gate return 404. Handles are the root of the whole profile
// surface — publish and visibility-PATCH already reject profile-listed
// without one, /@handle pages 404 without a row — so gating the claim
// path keeps everything downstream unreachable without touching it.
// That holds only while the handles table is empty: an existing row
// would keep its /@handle page, /api/me handle, and List-on-profile
// menu fully live. The production D1 launches with zero handle rows;
// if any get seeded before this gate is deployed, release them.
// If user feedback asks for public profiles, set PROFILES_ENABLED=1 on
// the Pages project and restore the client entry points — grep for
// PROFILES_ENABLED in share-web and SHOW_VISIBILITY_PICKER in the app,
// and restore the handle-release wording cut from share-web's
// DeleteAccountModal and the profile sections of /privacy and /terms.
export function profilesEnabled(env: { PROFILES_ENABLED?: string }): boolean {
  return env.PROFILES_ENABLED === '1'
}

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
