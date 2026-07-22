// /blog/rss.xml — served by the worker at runtime (tiny, cacheable).
// Port of the old void API route routes/blog/rss.xml.ts, reading from
// the markdown registry instead of @void/md's generated pages array.

import { createFileRoute } from '@tanstack/react-router'

import { blogPosts } from '../lib/content'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'

const SITE = PUBLIC_SITE_ORIGIN
const TITLE = 'Spool Blog'
const DESC = 'Updates, technical deep-dives, and product announcements from the Spool team.'

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const Route = createFileRoute('/blog/rss.xml')({
  server: {
    handlers: {
      GET: async () => {
        const items = blogPosts()
          .map((p) => {
            const pubDate = p.date ? new Date(p.date).toUTCString() : new Date().toUTCString()
            return `    <item>
      <title>${escape(p.title)}</title>
      <description>${escape(p.description ?? '')}</description>
      <link>${SITE}${p.path}</link>
      <guid>${SITE}${p.path}</guid>
      <pubDate>${pubDate}</pubDate>
      ${p.author ? `<author>${escape(p.author)}</author>` : ''}
    </item>`
          })
          .join('\n')

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(TITLE)}</title>
    <description>${escape(DESC)}</description>
    <link>${SITE}/blog/</link>
    <language>en</language>
${items}
  </channel>
</rss>`

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
