// Security headers for the runtime-SSR'd app surfaces (/s/*, /session/*,
// /@*, /explore, /me, /my-sessions, /teams*, /sign-in, /cli-auth). Port of the Cloudflare Pages `_headers`
// file from the standalone share-web era — same values, same per-route
// CSP split — applied by the request middleware in src/start.ts because
// the merged app serves these routes through the TanStack Start worker
// instead of Pages.
//
// The marketing/docs/blog/legal surfaces are prerendered static assets
// in production and never pass through the middleware, which matches
// the old world where the landing Pages project shipped no `_headers`.
// `/terms` + `/privacy` stay indexable for the same reason they carried
// `! X-Robots-Tag` before: Google's OAuth brand verification fetches
// the privacy URL.
//
// script-src carries a per-request nonce because TanStack Start SSR
// injects inline hydration scripts — the old static SPA shell had none,
// which is how plain `script-src 'self'` used to work. The nonce is
// generated in src/start.ts and threaded to the router (router ssr
// option) so the framework stamps it onto every inline script it emits.

const IMG_SRC_READER =
  "'self' data: https://spool.new https://spool.pro https://lh3.googleusercontent.com https://workoscdn.com https://images.workoscdn.com"

function csp(
  nonce: string | undefined,
  opts: { formAction: 'self' | 'none'; imgSrc: string },
): string {
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self'"
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${opts.imgSrc}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    `form-action '${opts.formAction}'`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'interest-cohort=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
}

/** Prefixes served by the SSR worker at runtime. Everything else is
 *  either a prerendered static asset (marketing site) or an unknown
 *  path that falls through to the tombstone — the latter still gets
 *  the noindex defaults. */
const READER_PREFIXES = ['/s/', '/session/', '/@']
const ACCOUNT_PATHS = ['/me', '/my-sessions', '/teams', '/sign-in', '/cli-auth']
const ACCOUNT_PREFIXES = ['/teams/']
const PUBLIC_APP_PATHS = ['/explore']
const PRERENDERED_PREFIXES = ['/daemon', '/connectors', '/blog', '/docs', '/terms', '/privacy']

function isAccountPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return (
    ACCOUNT_PATHS.includes(path) || ACCOUNT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}

export function securityHeadersFor(
  pathname: string,
  nonce?: string,
): Record<string, string> | null {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (READER_PREFIXES.some((p) => pathname.startsWith(p))) {
    return {
      ...BASE_HEADERS,
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': csp(nonce, { formAction: 'none', imgSrc: IMG_SRC_READER }),
    }
  }

  if (isAccountPath(pathname)) {
    return {
      ...BASE_HEADERS,
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': csp(nonce, { formAction: 'self', imgSrc: IMG_SRC_READER }),
    }
  }

  if (PUBLIC_APP_PATHS.includes(path)) {
    return {
      ...BASE_HEADERS,
      'Content-Security-Policy': csp(nonce, { formAction: 'self', imgSrc: IMG_SRC_READER }),
    }
  }

  // Prerendered marketing surface: static in prod, SSR'd only in dev —
  // no special headers either way (parity with the old landing site).
  if (path === '/' || PRERENDERED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return null
  }

  // Unknown path → tombstone 404. Keep the old share-web site default.
  return { ...BASE_HEADERS, 'X-Robots-Tag': 'noindex' }
}

/** Legacy snapshot documents retain their 30s revoke window. Account,
 *  Team, and v2 Session documents are always private/no-store because the
 *  middleware cannot safely infer a Session's tenant visibility from the
 *  final HTML response. Other routes keep their default cache behavior. */
export function cacheHeaderFor(pathname: string, status: number): string | null {
  if (isAccountPath(pathname) || pathname.startsWith('/session/')) return 'private, no-store'
  if (!READER_PREFIXES.some((p) => pathname.startsWith(p))) return null
  return status === 200 ? 'public, max-age=30, s-maxage=30, must-revalidate' : 'no-store'
}

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
