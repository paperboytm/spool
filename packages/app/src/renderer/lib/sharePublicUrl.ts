/**
 * Resolve the public origin for `/s/<id>` share links shown in the
 * renderer (Published row in Shares page, etc.).
 *
 * Vite inlines `import.meta.env.VITE_SPOOL_SHARE_PUBLIC_URL` at build
 * time. In dev set this to `http://localhost:3002` (the share-web
 * vite server) via `packages/app/.env.development.local`. In prod
 * builds the env is unset and the function returns
 * `https://spool.pro`.
 *
 * Why this is a renderer concern (and not just a `published.url` echo):
 * the Published-tab list draws from a local cache of slugs and titles,
 * not the original publish response. The cache stores share IDs, so
 * the renderer reconstitutes URLs locally — the origin needs to be
 * runtime-known on this side.
 */

const DEFAULT_PUBLIC_URL = 'https://spool.pro'

export function sharePublicOrigin(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): string {
  const fromEnv = env['VITE_SPOOL_SHARE_PUBLIC_URL']?.trim()
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '')
  return DEFAULT_PUBLIC_URL
}

/** Convenience for "<origin>/s/<slug>". Encodes the slug so a future
 *  slug format with reserved URL chars still produces a valid link. */
export function sharePublicUrl(slug: string, env?: Record<string, string | undefined>): string {
  return `${sharePublicOrigin(env)}/s/${encodeURIComponent(slug)}`
}

/**
 * Resolve an avatar URL for an `<img src>` tag. The /api/me + /api/profiles
 * endpoints return either:
 *   - a relative path like "/api/avatars/<user_id>" (custom upload), OR
 *   - an absolute URL to the provider CDN (e.g. lh3.googleusercontent.com)
 *
 * Relative `/api/*` paths must hit the share-backend origin directly.
 * In prod the backend and public web share an origin (spool.pro) so
 * `sharePublicOrigin()` works as a fallback, but in dev they're split
 * (3002 = share-web vite, 8788 = wrangler) and the share-web vite proxy
 * only exists when that dev server is actually running. Prefer the
 * dedicated backend env so the renderer doesn't need a second vite up.
 */
export function shareBackendOrigin(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): string {
  const fromEnv = env['VITE_SPOOL_SHARE_BACKEND']?.trim()
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '')
  return sharePublicOrigin(env)
}

export function resolveAvatarUrl(
  raw: string,
  env?: Record<string, string | undefined>,
): string {
  if (/^https?:\/\//i.test(raw)) return raw
  if (!raw.startsWith('/')) return raw
  return `${shareBackendOrigin(env)}${raw}`
}
