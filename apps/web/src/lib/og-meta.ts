// OG / Twitter Card head fragments for the share surfaces. In the
// standalone share-web era these were HTML strings injected into the
// static SPA shell by Pages Functions (scrapers don't run JS); the
// merged app SSRs /s/* and /session/* through TanStack Start, so the
// route head() renders these structured values instead and React does
// the escaping. Kept pure (values in, values out, no fetch) so the
// capping/fallback behaviour stays unit-testable in node.

export interface OgMeta {
  /** Snapshot conversation.title — gets length-capped. */
  title: string
  /** Absolute URL of the rendered 1200×630 PNG served by the backend. */
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

export interface HeadFragment {
  meta: Array<Record<string, string>>
  links: Array<Record<string, string>>
}

/** Head fragment for /s/<id>: page title + Open Graph + Twitter Card
 *  (summary_large_image — the backend renders an OG PNG for these). */
export function snapshotOgHead(og: OgMeta): HeadFragment {
  const title = (og.title ?? '').slice(0, MAX_TITLE_LEN) || FALLBACK_TITLE
  const desc = og.description ?? DEFAULT_DESC
  return {
    meta: [
      { title: `${title} · spool.pro` },
      { name: 'description', content: desc },
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: og.canonicalUrl },
      { property: 'og:image', content: og.ogImageUrl },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: desc },
      { name: 'twitter:image', content: og.ogImageUrl },
    ],
    links: [{ rel: 'canonical', href: og.canonicalUrl }],
  }
}

export interface SessionOgMeta {
  /** First line of the Summary, or a first-prompt excerpt. */
  title: string
  /** Author + record-count line. */
  description: string
  canonicalUrl: string
}

/** Head fragment for /session/<sid>: no OG image in this iteration, so
 *  the card degrades to a plain summary card instead of pointing
 *  scrapers at a broken image URL. */
export function sessionOgHead(og: SessionOgMeta): HeadFragment {
  const title = (og.title ?? '').slice(0, MAX_TITLE_LEN) || 'Shared session'
  const desc = og.description || 'A shared coding-agent session on Spool.'
  return {
    meta: [
      { title: `${title} · spool.pro` },
      { name: 'description', content: desc },
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: og.canonicalUrl },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: desc },
    ],
    links: [{ rel: 'canonical', href: og.canonicalUrl }],
  }
}

/** First line of the session Summary, or the generic fallback. Shared by
 *  the /session/<sid> loader and its tests. */
export function sessionOgTitle(summaryMd: string | null | undefined): string {
  const firstLine = summaryMd?.split('\n', 1)[0]?.trim()
  return firstLine || 'Shared session'
}
