import type { DiscoverySessionItem } from '@spool-lab/session-kit'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { DiscoveryRow } from './Explore'

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
