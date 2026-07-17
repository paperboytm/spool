import { createFileRoute, Link, notFound } from '@tanstack/react-router'

import { Markdown } from '../components/site/markdown'
import { contentPage } from '../lib/content'

export const Route = createFileRoute('/_site/blog/$slug')({
  loader: ({ params }) => {
    const page = contentPage(`/blog/${params.slug}`)
    if (!page) throw notFound()
    return page
  },
  head: ({ loaderData }) => {
    const fm = loaderData?.frontmatter ?? {}
    const title = typeof fm['title'] === 'string' ? fm['title'] : 'Blog'
    const description = fm['description']
    return {
      meta: [
        { title: `${title} | Spool` },
        ...(typeof description === 'string'
          ? [{ name: 'description', content: description }]
          : []),
        { property: 'og:type', content: 'article' },
        { property: 'og:title', content: title },
        ...(typeof description === 'string'
          ? [{ property: 'og:description', content: description }]
          : []),
      ],
    }
  },
  component: BlogPost,
})

function BlogPost() {
  const page = Route.useLoaderData()
  const fm = page.frontmatter as { title?: string; date?: string; author?: string; tags?: string[] }
  const formattedDate = fm.date
    ? new Date(fm.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''
  const tags = Array.isArray(fm.tags) ? fm.tags : []

  return (
    <>
      <header className="article-header">
        <h1>{fm.title}</h1>
        <div className="article-meta">
          {fm.author && <span>{fm.author}</span>}
          {formattedDate && <span>{formattedDate}</span>}
        </div>
        {tags.length > 0 && (
          <div className="article-tags">
            {tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      <article className="article-content void-md">
        <Markdown>{page.body}</Markdown>
      </article>

      <nav className="article-back">
        <Link to="/blog">← All posts</Link>
      </nav>
    </>
  )
}
