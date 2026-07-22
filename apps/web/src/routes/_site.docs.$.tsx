// /docs/* — prerendered documentation pages. One splat route covers the
// whole tree (`/docs/installation`, `/docs/guides/data-sources`, …);
// the markdown registry in lib/content.ts is the source of truth and
// unknown paths fall through to the tombstone via notFound().

import { createFileRoute, notFound } from '@tanstack/react-router'

import DocsLayout from '../components/site/docs-layout'
import { Markdown } from '../components/site/markdown'
import { contentPage } from '../lib/content'

export const Route = createFileRoute('/_site/docs/$')({
  loader: ({ params }) => {
    const page = contentPage(`/docs/${params._splat ?? ''}`)
    if (!page) throw notFound()
    return page
  },
  head: ({ loaderData }) => {
    const title = loaderData ? String(loaderData.frontmatter['title'] ?? 'Docs') : 'Docs'
    const description = loaderData?.frontmatter['description']
    return {
      meta: [
        { title: `${title} | Spool` },
        ...(typeof description === 'string' ? [{ name: 'description', content: description }] : []),
      ],
    }
  },
  component: DocsPage,
})

function DocsPage() {
  const page = Route.useLoaderData()
  return (
    <DocsLayout currentPath={page.path} frontmatter={page.frontmatter}>
      <Markdown copyCode>{page.body}</Markdown>
    </DocsLayout>
  )
}
