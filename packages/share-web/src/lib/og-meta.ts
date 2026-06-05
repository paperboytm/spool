// HTML utilities for the /s/<id> Pages Function. Kept pure (string-in,
// string-out, no fetch, no DOM) so the injection logic can be tested in
// node without spinning up workerd.

export interface OgMeta {
  /** Snapshot conversation.title — gets escaped + length-capped. */
  title: string
  /** Absolute URL of the rendered 1200×630 PNG served by share-backend. */
  ogImageUrl: string
  /** Absolute URL of the share itself; becomes <link rel="canonical">. */
  canonicalUrl: string
  /** Plain-text social description; defaults to a generic Spool blurb. */
  description?: string
}

// Twitter / Facebook truncate around 200 chars anyway, and capping in
// the meta tag means a hostile title can't blow up the response size.
const MAX_TITLE_LEN = 200
const DEFAULT_DESC = 'A shared conversation on Spool.'
const FALLBACK_TITLE = 'Shared conversation'

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return c
    }
  })
}

/** Produce the block of <title> + Open Graph + Twitter Card tags that
 *  goes inside <head>. Callers are expected to inject the returned
 *  string verbatim — every value is already HTML-escaped. */
export function buildOgTagBlock(meta: OgMeta): string {
  const rawTitle = (meta.title ?? '').slice(0, MAX_TITLE_LEN) || FALLBACK_TITLE
  const title = escapeHtmlAttr(rawTitle)
  const ogImage = escapeHtmlAttr(meta.ogImageUrl)
  const canonical = escapeHtmlAttr(meta.canonicalUrl)
  const desc = escapeHtmlAttr(meta.description ?? DEFAULT_DESC)
  return [
    `<title>${title} · spool.pro</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
  ].join('\n    ')
}

/** Replace the static template <title>spool.pro</title> with the
 *  caller's tag block, inserted immediately before </head>. Also strip
 *  the static `<meta name="robots" content="noindex">` — the SPA shell
 *  ships with noindex so the bare /index.html doesn't get crawled, but
 *  a served-with-200 share page IS something we want indexed. (Failure
 *  paths in [id].ts call passthroughShell instead, leaving the noindex
 *  intact for 404 / 410 / 502 / 500.)
 *
 *  The replace is intentionally narrow — we only touch the bits we
 *  own; everything else (vite-generated <script>, etc) flows through
 *  unchanged. Returns the html untouched (and warns) when </head> is
 *  missing so a corrupted ASSETS response doesn't fail silently. */
export function injectMetaIntoHtml(html: string, tagBlock: string): string {
  if (!/<\/head>/i.test(html)) {
    console.warn('[og-meta] </head> not found in HTML shell — OG tags not injected')
    return html
  }
  return html
    .replace(/<title>[^<]*<\/title>\s*/i, '')
    .replace(/<meta[^>]+name=["']robots["'][^>]*>\s*/i, '')
    .replace(/<\/head>/i, `    ${tagBlock}\n  </head>`)
}
