import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { MySessionsPage } from './MySessions'
import { TeamsPage } from './Teams'

describe('workspace index pages', () => {
  it('gives personal Sessions a dedicated product destination', () => {
    const html = renderToStaticMarkup(<MySessionsPage />)

    expect(html).toContain('<h1>My Sessions</h1>')
    expect(html).toContain('Review your uploaded Sessions')
    expect(html).toContain('aria-label="My Sessions"')
  })

  it('gives Teams a dedicated index and creation surface', () => {
    const html = renderToStaticMarkup(<TeamsPage />)

    expect(html).toContain('<h1>Teams</h1>')
    expect(html).toContain('Open a Team’s recent Session feed')
    expect(html).toContain('Create team')
    expect(html).toContain('aria-label="Teams"')
  })
})
