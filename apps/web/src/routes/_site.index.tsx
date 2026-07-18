import { createFileRoute } from '@tanstack/react-router'

import HomePage from '../components/site/home'

const TITLE = 'Spool — Share and continue agent sessions'
const DESC =
  'Turn real coding-agent Sessions into durable, readable links that others can understand and resume.'

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Spool',
  description:
    'Share real coding-agent Sessions as durable, readable links and continue them as new native work.',
  url: 'https://spool.pro',
  author: { '@type': 'Organization', name: 'Spool', url: 'https://spool.pro' },
})

export const Route = createFileRoute('/_site/')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESC },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://spool.pro/' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESC },
      { property: 'og:image', content: 'https://spool.pro/og-image.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:site_name', content: 'Spool' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESC },
      { name: 'twitter:image', content: 'https://spool.pro/og-image.png' },
    ],
    links: [
      { rel: 'canonical', href: 'https://spool.pro/' },
      { rel: 'alternate', type: 'application/rss+xml', title: 'Spool Blog', href: '/blog/rss.xml' },
    ],
    scripts: [{ type: 'application/ld+json', children: JSON_LD }],
  }),
  component: HomePage,
})
