// /session/<sid> — v2 hub session reader. Same shape as s.$slug.tsx:
// data-only SSR so scrapers get OG meta (replacing the share-web Pages
// Function functions/session/[sid].ts); the page itself stays
// client-rendered. No OG image in this iteration, so the head degrades
// to a summary card instead of pointing scrapers at a broken image URL.
//
// Invalid sids throw notFound() (404 + tombstone); meta failures only
// suppress OG tags and the SessionReader renders its own states.

import { createFileRoute, notFound } from '@tanstack/react-router'

import { sessionOgHead, sessionOgTitle } from '../lib/og-meta'
import { SID_RE } from '../lib/route'
import { serverApiOrigin } from '../lib/server-api-origin'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'
import { SessionReader } from '../pages/session-reader'

interface HubMetaForOg {
  summaryMd?: string | null
  noteMd?: string | null
  count: number
  author: { handle: string | null; displayName: string | null }
  visibility?: 'public' | 'link-only' | 'team'
}

export interface LoaderData {
  og: { title: string; description: string } | null
  noindex: boolean
}

async function loadSessionOgMeta(sid: string): Promise<LoaderData> {
  if (!SID_RE.test(sid)) throw notFound()
  if (!import.meta.env.SSR) return { og: null, noindex: false }

  try {
    const apiOrigin = serverApiOrigin()
    const res = await fetch(`${apiOrigin}/api/hub/v1/sessions/${encodeURIComponent(sid)}`)
    if (res.status !== 200) return { og: null, noindex: true }
    const meta = (await res.json()) as HubMetaForOg
    const author = meta.author.handle
      ? `@${meta.author.handle}`
      : (meta.author.displayName ?? 'someone')
    return {
      noindex: meta.visibility !== 'public',
      og: {
        title: sessionOgTitle(meta.summaryMd ?? meta.noteMd),
        description: `A coding-agent session shared by ${author} — ${meta.count} records.`,
      },
    }
  } catch {
    return { og: null, noindex: true }
  }
}

export const Route = createFileRoute('/session/$sid')({
  ssr: 'data-only',
  loader: ({ params }) => loadSessionOgMeta(params.sid),
  head: ({ loaderData, params }) => {
    const og = loaderData?.og
    const robots = loaderData?.noindex
      ? [{ name: 'robots', content: 'noindex, nofollow, noarchive' }]
      : []
    if (!og) return { meta: robots }
    const head = sessionOgHead({
      title: og.title,
      description: og.description,
      canonicalUrl: `${PUBLIC_SITE_ORIGIN}/session/${params.sid}`,
    })
    return { ...head, meta: [...(head.meta ?? []), ...robots] }
  },
  component: SessionSharePage,
})

function SessionSharePage() {
  const { sid } = Route.useParams()
  return <SessionReader sid={sid} />
}
