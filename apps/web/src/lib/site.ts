import siteOgAssetPath from '../assets/site-og.png?url&no-inline'

/** Canonical public origin for metadata and links that must not depend on the
 * request host. `spool.pro` remains reachable for legacy shares, but new
 * public URLs and canonical tags always point at `spool.new`. */
export const PUBLIC_SITE_ORIGIN = 'https://spool.new'
export const PUBLIC_SITE_HOST = 'spool.new'

/** Vite fingerprints this pathname from the PNG bytes. A brand-card change
 * therefore gives social crawlers a genuinely new cache key instead of
 * relying on query-string behavior or a crawler-specific purge. */
export const SITE_OG_IMAGE_URL = new URL(siteOgAssetPath, PUBLIC_SITE_ORIGIN).href
export const SITE_OG_IMAGE_ALT = 'Spool — one shared space for agent sessions'

/** Shared image metadata for prerendered marketing surfaces. */
export function siteOgImageMeta(): Array<Record<string, string>> {
  return [
    { property: 'og:image', content: SITE_OG_IMAGE_URL },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: SITE_OG_IMAGE_ALT },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:image', content: SITE_OG_IMAGE_URL },
    { name: 'twitter:image:alt', content: SITE_OG_IMAGE_ALT },
  ]
}
