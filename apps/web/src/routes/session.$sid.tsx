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
import { SessionReader } from '../pages/session-reader'

interface HubMetaForOg {
  summaryMd?: string | null
  noteMd?: string | null
  count: number
  author: { handle: string | null; displayName: string | null }
}

export interface LoaderData {
  og: { title: string; description: string; origin: string } | null
}

async function loadSessionOgMeta(sid: string): Promise<LoaderData> {
  if (!SID_RE.test(sid)) throw notFound()
  if (!import.meta.env.SSR) return { og: null }

  const server = await import('@tanstack/react-start/server')
  const requestUrl = server.getRequest().url
  const origin = new URL(requestUrl).origin

  try {
    const apiOrigin = serverApiOrigin()
    const res = await fetch(`${apiOrigin}/api/hub/v1/sessions/${encodeURIComponent(sid)}`)
    if (res.status !== 200) return { og: null }
    const meta = (await res.json()) as HubMetaForOg
    const author = meta.author.handle
      ? `@${meta.author.handle}`
      : (meta.author.displayName ?? 'someone')
    return {
      og: {
        title: sessionOgTitle(meta.summaryMd ?? meta.noteMd),
        description: `A coding-agent session shared by ${author} — ${meta.count} records.`,
        origin,
      },
    }
  } catch {
    return { og: null }
  }
}

export const Route = createFileRoute('/session/$sid')({
  ssr: 'data-only',
  loader: ({ params }) => loadSessionOgMeta(params.sid),
  head: ({ loaderData, params }) => {
    const og = loaderData?.og
    if (!og) return {}
    return sessionOgHead({
      title: og.title,
      description: og.description,
      canonicalUrl: `${og.origin}/session/${params.sid}`,
    })
  },
  component: SessionSharePage,
})

function SessionSharePage() {
  const { sid } = Route.useParams()
  return <SessionReader sid={sid} />
}
