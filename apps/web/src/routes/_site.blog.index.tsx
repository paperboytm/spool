import { createFileRoute, Link } from '@tanstack/react-router'

import { blogPosts } from '../lib/content'
import { PUBLIC_SITE_ORIGIN, siteOgImageMeta } from '../lib/site'

const TITLE = 'Blog — Spool'
const DESC = 'Updates, technical deep-dives, and product announcements from the Spool team.'

export const Route = createFileRoute('/_site/blog/')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESC },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: `${PUBLIC_SITE_ORIGIN}/blog/` },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESC },
      ...siteOgImageMeta(),
      { property: 'og:site_name', content: 'Spool' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESC },
    ],
    links: [
      { rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/blog/` },
      { rel: 'alternate', type: 'application/rss+xml', title: 'Spool Blog', href: '/blog/rss.xml' },
    ],
  }),
  component: BlogIndex,
})

function BlogIndex() {
  const posts = blogPosts()
  return (
    <>
      <header className="blog-header">
        <h1>Blog</h1>
        <p>Updates, technical deep-dives, and product announcements.</p>
      </header>
      <main className="posts">
        {posts.length === 0 && <div className="empty">No posts yet. Check back soon.</div>}
        {posts.map((post) => {
          const formattedDate = post.date
            ? new Date(post.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : ''
          return (
            <Link
              to="/blog/$slug"
              params={{ slug: post.path.replace(/^\/blog\//, '') }}
              className="post-card"
              key={post.path}
            >
              <h2>{post.title}</h2>
              {post.description && <p>{post.description}</p>}
              <div className="post-meta">
                {post.author && <span>{post.author}</span>}
                {formattedDate && <span>{formattedDate}</span>}
                {post.tags.length > 0 && (
                  <div className="post-tags">
                    {post.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </main>
    </>
  )
}
