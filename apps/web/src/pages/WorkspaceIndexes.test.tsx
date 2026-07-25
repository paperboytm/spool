import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { MySessionsPage } from './MySessions'
import { TeamsPage } from './Teams'

describe('workspace index pages', () => {
  it('gives personal Sessions a dedicated product destination', () => {
    const html = renderToStaticMarkup(<MySessionsPage />)

    expect(html).toContain('<h1>My Sessions</h1>')
    expect(html).toContain('<span>Recent</span>')
    expect(html).toContain('aria-label="Your Sessions"')
    expect(html).toContain('session-feed-skeleton-row')
    expect(html).not.toContain('Your library')
    expect(html).not.toContain('Manage who can read each uploaded Session')
    expect(html).toContain('aria-label="My Sessions"')
  })

  it('uses /teams as creation instead of a second Team index', () => {
    const html = renderToStaticMarkup(<TeamsPage />)

    expect(html).toContain('<h1>Create a Team</h1>')
    expect(html).toContain('Start a private workspace')
    expect(html).toContain('New team')
    expect(html).toContain('Create team')
    expect(html).not.toContain('Shared workspaces')
    expect(html).not.toContain('sw-teams-list')
    expect(html).toContain('aria-label="Teams"')
  })
})
