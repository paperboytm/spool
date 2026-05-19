// Bare-bones path matcher. We intentionally avoid react-router for an
// SPA this small — a handful of static routes (`/s/<id>`, `/@<handle>`,
// `/me`, `/sign-in`) and one catch-all tombstone is not worth a
// dependency.
//
// `nextSafe` defends `?next=` query params against open-redirect abuse:
// only same-origin, single-slash, no-protocol paths pass through.

export type Route =
  | { kind: 'reader'; id: string }
  | { kind: 'profile'; handle: string }
  | { kind: 'me' }
  | { kind: 'sign-in'; next: string }
  | { kind: 'tombstone'; reason: 'not-found' }

// Slugs are nanoid(21) — URL-safe base64 alphabet
// (A–Z a–z 0–9 _ -). Enforce the exact length so a wandering
// `/s/foo` returns a clean 404 tombstone instead of a 30-second fetch.
const SLUG_RE = /^[A-Za-z0-9_-]{21}$/

// Mirror of the server-side validator in share-backend/src/handles.ts.
// We check on the client too so `/@bogus!!` falls through to tombstone
// instead of issuing a guaranteed-404 fetch.
const HANDLE_RE = /^[a-z][a-z0-9_-]{2,31}$/

export function routeFor(pathname: string, search: string = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/'

  // Reader: /s/<slug>
  if (path.startsWith('/s/')) {
    const id = decodeURIComponent(path.slice(3))
    if (!SLUG_RE.test(id)) return { kind: 'tombstone', reason: 'not-found' }
    return { kind: 'reader', id }
  }

  // Profile: /@<handle>
  if (path.startsWith('/@')) {
    const handle = decodeURIComponent(path.slice(2)).toLowerCase()
    if (!HANDLE_RE.test(handle)) return { kind: 'tombstone', reason: 'not-found' }
    return { kind: 'profile', handle }
  }

  // Me: /me
  if (path === '/me') return { kind: 'me' }

  // Sign-in: /sign-in?next=<safe>
  if (path === '/sign-in') {
    const params = new URLSearchParams(search)
    return { kind: 'sign-in', next: nextSafe(params.get('next')) }
  }

  return { kind: 'tombstone', reason: 'not-found' }
}

/** Same-origin redirect target. Returns the path verbatim only when it
 *  is a relative same-origin path; everything else collapses to `/`.
 *  - rejects absolute URLs (`http://evil.com`)
 *  - rejects protocol-relative URLs (`//evil.com`)
 *  - rejects backslash sneakers (`/\evil.com`)
 *  - rejects path-traversal (`/..`)
 *
 *  Keep AT LEAST as strict as the server's `safeNext` in
 *  `packages/share-backend/src/auth/next.ts` — the server runs first on
 *  the OAuth callback, but defense-in-depth means this guard catches a
 *  drifted backend. */
export function nextSafe(raw: string | null | undefined): string {
  if (!raw) return '/'
  if (typeof raw !== 'string') return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  if (raw.startsWith('/\\')) return '/'
  if (raw.includes('..')) return '/'
  // Hostname-escaping schemes that browsers still resolve.
  if (/^\/?(javascript|data|vbscript):/i.test(raw)) return '/'
  return raw
}
