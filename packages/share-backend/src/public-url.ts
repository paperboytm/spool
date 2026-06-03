// Single source of truth for "what's the public origin of this deployment".
// Used by:
//   - OAuth start / callback to compute the registered redirect_uri
//   - publish to compute the share URL returned in the response
//
// Dev runs the OAuth callback through share-web's vite proxy (port 3002),
// so the redirect_uri the backend sends to Google must be the share-web
// origin even though wrangler itself listens on 8788. The PUBLIC_BASE_URL
// env var pins that origin; prod inherits the spool.pro default.
export const DEFAULT_PUBLIC_BASE_URL = 'https://spool.pro'

export function publicBaseUrl(env: { PUBLIC_BASE_URL?: string }): string {
  return env.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL
}
