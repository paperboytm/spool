import { createFileRoute } from '@tanstack/react-router'

import HomePage from '../components/site/home'
import { PUBLIC_SITE_ORIGIN, siteOgImageMeta } from '../lib/site'

const TITLE = 'Spool — One shared space for agent sessions'
const DESC =
  'Agents work on every machine; their Sessions die in local files. Spool streams them into one shared space — readable, searchable, and resumable — so agent work becomes team knowledge.'

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Spool',
  description:
    'Spool publishes real coding-agent Sessions readable end to end — the reasoning, the dead ends, and the author decisions behind the diff — so others can learn from the work and resume it.',
  url: PUBLIC_SITE_ORIGIN,
  author: { '@type': 'Organization', name: 'Spool', url: PUBLIC_SITE_ORIGIN },
})

export const Route = createFileRoute('/_site/')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESC },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: `${PUBLIC_SITE_ORIGIN}/` },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESC },
      ...siteOgImageMeta(),
      { property: 'og:site_name', content: 'Spool' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESC },
    ],
    links: [
      { rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/` },
      { rel: 'alternate', type: 'application/rss+xml', title: 'Spool Blog', href: '/blog/rss.xml' },
    ],
    scripts: [{ type: 'application/ld+json', children: JSON_LD }],
  }),
  component: HomeRoute,
})

export function HomeRoute() {
  return <HomePage />
}
