import { Link } from '@tanstack/react-router'

type NavItem = { slug: string; title: string }
type NavGroup = { label: string; items: NavItem[] }

const DOCS_NAV: NavGroup[] = [
  {
    label: 'Getting Started',
    items: [
      { slug: '/docs/installation', title: 'Installation' },
      { slug: '/docs/quick-start', title: 'Quick Start' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { slug: '/docs/guides/publishing', title: 'Publishing Sessions' },
      { slug: '/docs/guides/reading-resuming', title: 'Reading and Resuming' },
      { slug: '/docs/guides/agent-integration', title: 'Agent Integration' },
      { slug: '/docs/guides/data-sources', title: 'Session Sources' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { slug: '/docs/reference/cli', title: 'CLI Commands' },
      { slug: '/docs/reference/configuration', title: 'Configuration' },
    ],
  },
]

const FLAT_NAV: NavItem[] = DOCS_NAV.flatMap((g) => g.items)

function splatOf(slug: string): string {
  return slug.replace(/^\/docs\//, '')
}

function DocsLink({ item, className }: { item: NavItem; className?: string }) {
  return (
    <Link to="/docs/$" params={{ _splat: splatOf(item.slug) }} className={className}>
      {item.title}
    </Link>
  )
}

export default function DocsLayout({
  currentPath,
  frontmatter,
  children,
}: {
  currentPath: string
  frontmatter: Record<string, unknown>
  children: React.ReactNode
}) {
  const normalized = currentPath.replace(/\/$/, '')
  const currentIndex = FLAT_NAV.findIndex((i) => i.slug === normalized)
  const prev = currentIndex > 0 ? FLAT_NAV[currentIndex - 1] : null
  const next =
    currentIndex >= 0 && currentIndex < FLAT_NAV.length - 1 ? FLAT_NAV[currentIndex + 1] : null

  return (
    <div className="docs">
      <aside className="docs-sidebar">
        {DOCS_NAV.map((group) => (
          <div className="group" key={group.label}>
            <div className="group-label">{group.label}</div>
            {group.items.map((item) => (
              <DocsLink
                key={item.slug}
                item={item}
                className={item.slug === normalized ? 'active' : ''}
              />
            ))}
          </div>
        ))}
      </aside>
      <main className="docs-main">
        <h1>{frontmatter['title'] as string}</h1>
        {typeof frontmatter['description'] === 'string' && frontmatter['description'] && (
          <p className="docs-description">{frontmatter['description']}</p>
        )}
        <div className="void-md">{children}</div>
        <nav className="docs-pager" aria-label="Pagination">
          {prev ? (
            <Link to="/docs/$" params={{ _splat: splatOf(prev.slug) }} className="prev">
              <div className="pager-label">← Previous</div>
              <div className="pager-title">{prev.title}</div>
            </Link>
          ) : (
            <span className="placeholder" />
          )}
          {next ? (
            <Link to="/docs/$" params={{ _splat: splatOf(next.slug) }} className="next">
              <div className="pager-label">Next →</div>
              <div className="pager-title">{next.title}</div>
            </Link>
          ) : (
            <span className="placeholder" />
          )}
        </nav>
      </main>
    </div>
  )
}
