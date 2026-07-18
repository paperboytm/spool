// Markdown content registry for the prerendered docs + blog surfaces.
// Replaces @void/md's generated `pages` array from the pages-mode era:
// the .md files under src/content are inlined into the bundle as raw
// strings via import.meta.glob, frontmatter is parsed here, and the
// docs/blog routes render the body with react-markdown at prerender
// time. The frontmatter dialect is deliberately tiny (string, ISO date,
// [inline, list]) — exactly what the existing files use.

export interface ContentPage {
  /** Route path, e.g. '/docs/installation' or '/blog/hello-spool' */
  path: string
  frontmatter: Record<string, unknown>
  body: string
}

const RAW = import.meta.glob('../content/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function pathFor(file: string): string {
  // '../content/docs/guides/data-sources.md' → '/docs/guides/data-sources'
  return file.replace(/^\.\.\/content/, '').replace(/\.md$/, '')
}

export function parseFrontmatter(src: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  if (!src.startsWith('---\n')) return { frontmatter: {}, body: src }
  const end = src.indexOf('\n---', 4)
  if (end < 0) return { frontmatter: {}, body: src }
  const block = src.slice(4, end)
  const body = src.slice(end + 4).replace(/^\n/, '')
  const frontmatter: Record<string, unknown> = {}
  for (const line of block.split('\n')) {
    const m = /^(\w[\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1] as string
    frontmatter[key] = parseScalar((m[2] ?? '').trim())
  }
  return { frontmatter, body }
}

function parseScalar(raw: string): unknown {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter((s) => s.length > 0)
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  return unquote(raw)
}

function unquote(s: string): string {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1)
  }
  return s
}

export const contentPages: ContentPage[] = Object.entries(RAW).map(([file, src]) => {
  const { frontmatter, body } = parseFrontmatter(src)
  return { path: pathFor(file), frontmatter, body }
})

export function contentPage(path: string): ContentPage | undefined {
  return contentPages.find((p) => p.path === path)
}

export interface BlogPostMeta {
  path: string
  title: string
  description?: string
  date: string
  author?: string
  tags: string[]
}

export function blogPosts(): BlogPostMeta[] {
  return contentPages
    .filter((p) => p.path.startsWith('/blog/'))
    .map((p) => {
      const fm = p.frontmatter
      return {
        path: p.path,
        title: typeof fm['title'] === 'string' ? fm['title'] : p.path,
        description: typeof fm['description'] === 'string' ? fm['description'] : undefined,
        date: typeof fm['date'] === 'string' ? fm['date'] : '',
        author: typeof fm['author'] === 'string' ? fm['author'] : undefined,
        tags: Array.isArray(fm['tags']) ? (fm['tags'] as string[]) : [],
        draft: Boolean(fm['draft']),
      }
    })
    .filter((p) => !p.draft)
    .map(({ draft: _draft, ...p }) => p as BlogPostMeta)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
