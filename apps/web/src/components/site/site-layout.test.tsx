import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { SiteAccountActions, SiteMobileNavigation } from './site-layout'

describe('SiteAccountActions', () => {
  it('offers sign-in without implying an authenticated workspace', () => {
    const html = renderToStaticMarkup(<SiteAccountActions auth="out" />)

    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('>Sign in</a>')
    expect(html).not.toContain('href="/me"')
    expect(html).not.toContain('href="/teams"')
  })

  it('collapses signed-in shortcuts behind the single avatar menu', () => {
    const html = renderToStaticMarkup(<SiteAccountActions auth={{ name: 'Alice', src: null }} />)

    expect(html).toContain('aria-label="Open account menu"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('>Sign in</a>')
    // Library, Teams, theme, and sign out live inside the menu — the
    // header itself no longer stacks parallel account links.
    expect(html).not.toContain('>Teams</span>')
    expect(html).not.toContain('href="/me"')
  })
})

describe('SiteMobileNavigation', () => {
  it('keeps every public action reachable from the compact header', () => {
    const html = renderToStaticMarkup(<SiteMobileNavigation auth="out" />)

    expect(html).toContain('site-mobile-menu')
    expect(html).toContain('aria-label="Mobile navigation"')
    expect(html).toContain('>Sessions</span>')
    expect(html).toContain('>Docs</span>')
    expect(html).toContain('>Publish</a>')
    expect(html).toContain('Use dark theme')
    // Search lives inside the Sessions feed now; Blog moved to the footer.
    expect(html).not.toContain('Search Sessions')
    expect(html).not.toContain('>Blog</span>')
    expect(html).not.toContain('href="/explore')
    expect(html).not.toContain('href="/teams"')
  })

  it('adds workspace navigation for a signed-in visitor', () => {
    const html = renderToStaticMarkup(<SiteMobileNavigation auth={{ name: 'Alice', src: null }} />)

    expect(html).toContain('href="/my-sessions"')
    expect(html).toContain('href="/teams"')
    expect(html).toContain('>Teams</span>')
  })
})
