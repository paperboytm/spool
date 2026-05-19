// CSP strings for share-backend.
//
// API responses never serve HTML, so they get the strictest policy
// possible (`default-src 'none'`) plus `frame-ancestors 'none'` to
// prevent any embedding. The non-API HTML surface lives in `share-web`
// and ships its own CSP via `_headers`; we deliberately do not set CSP
// here for non-API routes.

export const API_CSP = "default-src 'none'; frame-ancestors 'none'"
