// Single source of truth for "what's the public origin of this deployment".
// Used by:
//   - OAuth start / callback to compute the registered redirect_uri
//   - publish to compute the share URL returned in the response
//
// Dev runs the OAuth callback through the web app's Vite proxy (port 3002),
// so development defaults to that origin even though Wrangler listens on
// 8788. PUBLIC_BASE_URL can override any environment; production inherits
// the spool.new default.
export const DEFAULT_PUBLIC_BASE_URL = 'https://spool.new'
export const LOCAL_PUBLIC_BASE_URL = 'http://localhost:3002'

export function publicBaseUrl(env: { PUBLIC_BASE_URL?: string; ENV?: string }): string {
  return (
    env.PUBLIC_BASE_URL ??
    (env.ENV === 'development' ? LOCAL_PUBLIC_BASE_URL : DEFAULT_PUBLIC_BASE_URL)
  )
}
