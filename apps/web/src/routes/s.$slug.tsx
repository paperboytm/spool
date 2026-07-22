// /s/<id> — v1 snapshot reader. `ssr: 'data-only'` keeps the heavy
// Reader client-rendered (exactly like the old SPA) while the loader
// runs server-side so social-platform scrapers — which don't execute
// JS — see real OG/Twitter tags. This replaces the share-web Pages
// Function functions/s/[id].ts.
//
// The loader fetches /api/meta/<id> (<1 KB) rather than the snapshot
// (capped at 2 MB): a viral share hit by every social-card scraper on
// the planet should not allocate the full conversation body just to
// read one title.
//
// Failure handling: an invalid slug throws notFound() (404 + tombstone,
// same as the old router). Any meta failure (gone, revoked, backend
// hiccup) only suppresses the OG tags — the Reader still mounts and
// renders its own nuanced tombstone/error states from the snapshot
// fetch, exactly like the old passthrough shell did. Cache-Control for
// these pages is set by the request middleware in start.ts based on
// the response status.

import { createFileRoute, notFound } from '@tanstack/react-router'

import { snapshotOgHead } from '../lib/og-meta'
import { SLUG_RE } from '../lib/route'
import { serverApiOrigin } from '../lib/server-api-origin'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'
import { Reader } from '../pages/Reader'

interface MetaForOg {
  // null on legacy shares published before the title field landed in
  // KV; we just render without a custom OG title in that case.
  title: string | null
  visibility?: string
  version?: number
}

export interface LoaderData {
  og: { title: string } | null
}

async function loadOgMeta(slug: string): Promise<LoaderData> {
  if (!SLUG_RE.test(slug)) throw notFound()
  if (!import.meta.env.SSR) return { og: null }

  try {
    const apiOrigin = serverApiOrigin()
    const res = await fetch(`${apiOrigin}/api/meta/${encodeURIComponent(slug)}`)
    if (res.status !== 200) return { og: null }
    const meta = (await res.json()) as MetaForOg
    return { og: { title: meta.title ?? '' } }
  } catch {
    return { og: null }
  }
}

export const Route = createFileRoute('/s/$slug')({
  ssr: 'data-only',
  loader: ({ params }) => loadOgMeta(params.slug),
  head: ({ loaderData, params }) => {
    const og = loaderData?.og
    if (!og) return {}
    return snapshotOgHead({
      title: og.title,
      ogImageUrl: `${PUBLIC_SITE_ORIGIN}/api/og/${params.slug}.png`,
      canonicalUrl: `${PUBLIC_SITE_ORIGIN}/s/${params.slug}`,
    })
  },
  component: SnapshotSharePage,
})

function SnapshotSharePage() {
  const { slug } = Route.useParams()
  return <Reader id={slug} />
}
