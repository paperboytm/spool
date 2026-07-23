import type { DiscoverySessionItem } from '@spool-lab/session-kit'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { clearedExploreSearch, DiscoveryRow, ExplorePage, submittedExploreSearch } from './Explore'

const item: DiscoverySessionItem = {
  sid: 'claude_abc12345',
  title: 'Prevent refresh-token races across browser tabs',
  summaryExcerpt: 'Implemented a single-flight refresh path and replay protection.',
  agent: 'claude',
  author: {
    handle: 'maya',
    displayName: 'Maya Chen',
    avatarUrl: null,
  },
  evidence: {
    records: 96,
    messages: 42,
    toolCalls: 18,
    files: 7,
    additions: 214,
    deletions: 63,
  },
  lineage: { sourceSid: 'codex_source123' },
  publishedAt: Date.now() - 120_000,
  updatedAt: Date.now() - 120_000,
}

describe('DiscoveryRow', () => {
  it('renders attribution, Summary, source, machine evidence, and lineage', () => {
    const html = renderToStaticMarkup(<DiscoveryRow item={item} />)

    expect(html).toContain('/@maya')
    expect(html).toContain('@maya')
    expect(html).toContain('Prevent refresh-token races across browser tabs')
    expect(html).toContain('Implemented a single-flight refresh path')
    expect(html).toContain('Claude Code')
    expect(html).toContain('42 messages')
    expect(html).toContain('18 tools')
    expect(html).toContain('7 files')
    expect(html).toContain('+214')
    expect(html).toContain('−63')
    expect(html).toContain('/session/codex_source123')
    expect(html).toContain('Continued from source Session')
  })
})

describe('Explore controls', () => {
  it('exposes pressed filters and associates sort tabs with the result panel', () => {
    const html = renderToStaticMarkup(
      <ExplorePage search={{ sort: 'recommended' }} onSearchChange={() => {}} />,
    )

    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>All agents<\/button>/)
    expect(html).toContain('aria-controls="explore-results"')
    expect(html).toContain('id="explore-results"')
    expect(html).toContain('role="tabpanel"')
    for (const label of ['Explore', 'My Sessions', 'Teams']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).not.toContain('aria-label="Home"')
    expect(html).not.toContain('aria-label="Docs"')
    expect(html).toContain('>Top</')
    expect(html).toContain('>Recent</')
    expect(html).not.toContain('>For you</')
    expect(html).not.toContain('>Trending</')
    expect(html).not.toContain('>Latest</')
    expect(html).toContain('href="/docs/installation"')
    expect(html).not.toContain('Share a Session')
  })

  it('keeps the selected order while submitting or clearing a search', () => {
    const search = { q: 'old', sort: 'recent' as const, agent: 'codex' as const }

    expect(submittedExploreSearch(search, '  refresh   races ')).toEqual({
      q: 'refresh races',
      sort: 'recent',
      agent: 'codex',
    })
    expect(clearedExploreSearch(search)).toEqual({ sort: 'recent', agent: 'codex' })
  })
})
