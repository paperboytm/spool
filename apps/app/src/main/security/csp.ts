import { session as electronSession } from 'electron'

import { backendUrl, DEFAULT_BACKEND } from '../share/backend-url.js'

/**
 * Inject a `Content-Security-Policy` response header on every renderer
 * response from the default session. Industry pattern (Linear / Notion
 * / Slack desktop): drive CSP from the main process so dev + prod share
 * a single source of truth and Electron's "Insecure CSP" dev warning
 * disappears.
 *
 * The dev profile is intentionally looser:
 *   - `'unsafe-inline'` for Vite's injected `<script>` and `<style>`
 *     tags (the HMR runtime relies on it).
 *   - `ws://localhost:5173` for the HMR WebSocket.
 *   - `http://localhost:8788` so renderer-side fetches to the
 *     share-backend wrangler instance work without falling foul of
 *     `connect-src`.
 *
 * The prod profile drops everything except `'self'` plus the canonical
 * Spool domains. Avatar CDNs are limited to the Google user-content
 * host; if other providers land (GitHub, Apple) extend `IMG_ALLOW`.
 *
 * Notes:
 *   - `frame-ancestors 'none'` blocks any other page from iframing the
 *     renderer — Electron BrowserWindow can't be iframed, but the rule
 *     is harmless and good hygiene.
 *   - `object-src 'none'` kills plugin embedding which Electron doesn't
 *     ship anyway.
 *   - We do NOT set `report-uri` / `report-to` — the BrowserWindow has
 *     no audience to phone home to.
 *
 * If a renderer page introduces a new fetch target (e.g. a new
 * external API), add the origin to the matching directive here.
 */

// Backend origins: the renderer renders user-uploaded avatars served
// from `/api/avatars/<id>` on the share-backend. In dev that's the
// local wrangler at :8788; in prod it's spool.pro. Without these
// origins in img-src Chromium silently drops the request — the
// network tab shows nothing and the <img> renders as broken.
const IMG_ALLOW_DEV =
  "'self' data: blob: https://lh3.googleusercontent.com http://localhost:8788"
const IMG_ALLOW_PROD =
  "'self' data: blob: https://lh3.googleusercontent.com https://spool.pro https://*.spool.pro"

// The editor's PDF preview renders a generated `blob:` URL inside an
// `<iframe>` and lets Chromium's built-in PDF MIME handler take over.
// The handler iframes the viewer UI from
// `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/`, so we have
// to allow that scheme here or the iframe paints a blank grey
// rectangle with no console hint. `blob:` covers the document URL
// itself; both are required.
const FRAME_ALLOW = "'self' blob: chrome-extension:"

// The Chromium PDF viewer extension hosts the rendered PDF via an
// internal `<embed type="application/pdf">`. With `object-src 'none'`
// the embed mounts but the document never paints; allowing
// `chrome-extension:` keeps the viewer working without opening plugin
// loading from arbitrary origins.
const OBJECT_ALLOW = "'self' blob: chrome-extension:"

// `blob:` in connect-src lets `fetch(blobUrl)` work — the save-PDF
// path reads its own freshly-generated Blob back through `fetch(url)`
// to write it to disk. Without this directive the renderer can
// dereference the blob in `<img>` / `<iframe>` (frame-src / img-src
// cover that) but `fetch` itself silently fails with "Failed to
// fetch" and the save dialog never gets bytes.
const CONNECT_BLOB = 'blob:'

// `SPOOL_SHARE_BACKEND` redirects every main-process API call to a
// different backend (staging, local mock, future domain move) — the
// renderer's direct fetches (avatars in img-src, api calls in
// connect-src) must follow the same override or they silently 404
// behind CSP while main happily talks to the new host. The canonical
// spool.pro family stays in the prod allow-list unconditionally:
// published-share URLs and avatar links keep pointing there even when
// the API origin is overridden.
function overrideBackendOrigin(): string | null {
  try {
    // Compare normalized origins, not raw strings — an override of
    // `https://spool.pro/` (trailing slash) is still the default and
    // must not duplicate the origin in the policy.
    const origin = new URL(backendUrl()).origin
    return origin === new URL(DEFAULT_BACKEND).origin ? null : origin
  } catch {
    // Malformed override — main's fetches will fail loudly on their
    // own; don't let CSP construction crash the app over it.
    return null
  }
}

export function buildCsp(opts: { dev: boolean; backendOrigin?: string | null }): string {
  const extra = opts.backendOrigin ? ` ${opts.backendOrigin}` : ''
  if (opts.dev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `img-src ${IMG_ALLOW_DEV}${extra}`,
      `connect-src 'self' ${CONNECT_BLOB} http://localhost:8788 http://localhost:5173 ws://localhost:5173 ws://127.0.0.1:5173${extra}`,
      `frame-src ${FRAME_ALLOW}`,
      `object-src ${OBJECT_ALLOW}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; ')
  }
  return [
    "default-src 'self'",
    // Inline styles only — no inline scripts in the production bundle.
    // `unsafe-eval` is required by `vite-plugin-react`'s dev fast-refresh
    // but the prod build strips that out.
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${IMG_ALLOW_PROD}${extra}`,
    `connect-src 'self' ${CONNECT_BLOB} https://spool.pro https://*.spool.pro${extra}`,
    `frame-src ${FRAME_ALLOW}`,
    `object-src ${OBJECT_ALLOW}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ')
}

export function buildPfInferenceCsp(opts: { dev: boolean }): string {
  const scriptSrc = opts.dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: pf-model:"
    : "script-src 'self' 'wasm-unsafe-eval' blob: pf-model:"
  const connectSrc = opts.dev
    ? "connect-src 'self' pf-model: blob: http://localhost:5173 ws://localhost:5173 ws://127.0.0.1:5173"
    : "connect-src 'self' pf-model: blob:"
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob: pf-model:",
    connectSrc,
    "img-src 'none'",
    "font-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ')
}

export function isPfInferenceDocument(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/pf-inference.html')
  } catch {
    return false
  }
}

const DEV_CSP = buildCsp({ dev: true })
const PROD_CSP = buildCsp({ dev: false })
const PF_DEV_CSP = buildPfInferenceCsp({ dev: true })
const PF_PROD_CSP = buildPfInferenceCsp({ dev: false })

export function installRendererCsp(opts: { dev: boolean }): void {
  // Diagnostic escape hatch: setting SPOOL_DISABLE_CSP=1 skips the
  // installation entirely so we can A/B which directive is gating a
  // surface. Kept inside the module rather than at the call site so a
  // future Labs toggle could flip it via the renderer too.
  if (process.env['SPOOL_DISABLE_CSP'] === '1') return
  const policy = buildCsp({ dev: opts.dev, backendOrigin: overrideBackendOrigin() })
  const pfPolicy = opts.dev ? PF_DEV_CSP : PF_PROD_CSP
  electronSession.defaultSession.webRequest.onHeadersReceived(
    (details, callback) => {
      // Only inject CSP into responses for the documents we actually
      // ship. Chromium's built-in PDF viewer extension serves its UI
      // off `chrome-extension://`; if we replace that response's CSP
      // with ours the viewer can't load its own internal scripts /
      // styles / embeds and the iframe paints blank grey. Extensions
      // and Chromium-internal pages have their own appropriate CSPs;
      // we should not impose ours on top of them. `data:` URLs are
      // omitted deliberately — they're untrusted inline content, not
      // documents we author, and Electron doesn't fire
      // onHeadersReceived for them at the document level anyway.
      const url = details.url || ''
      const isAppDoc =
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('file://') ||
        url.startsWith('blob:')
      if (!isAppDoc) {
        // No header changes — let Electron pass the response through.
        callback({})
        return
      }
      const responseHeaders = { ...details.responseHeaders }
      // Strip any inbound CSP — Vite dev server in particular sends a
      // permissive header and Electron will pick whichever is most
      // restrictive; replacing avoids any union surprises.
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'content-security-policy') {
          delete responseHeaders[key]
        }
      }
      responseHeaders['Content-Security-Policy'] = [isPfInferenceDocument(url) ? pfPolicy : policy]
      callback({ responseHeaders })
    },
  )
}

// Exported for snapshot tests so policy drift gets caught in CI without
// spinning up an Electron app.
export const __cspFixtures = { DEV_CSP, PROD_CSP, PF_DEV_CSP, PF_PROD_CSP }
