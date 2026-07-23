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

  it('replaces sign-in with Team and personal account shortcuts', () => {
    const html = renderToStaticMarkup(<SiteAccountActions auth={{ name: 'Alice', src: null }} />)

    expect(html).toContain('href="/teams"')
    expect(html).toContain('>Teams</span>')
    expect(html).toContain('href="/me"')
    expect(html).toContain('aria-label="Open your account"')
    expect(html).not.toContain('>Sign in</a>')
  })
})

describe('SiteMobileNavigation', () => {
  it('keeps every public action reachable from the compact header', () => {
    const html = renderToStaticMarkup(<SiteMobileNavigation auth="out" />)

    expect(html).toContain('site-mobile-menu')
    expect(html).toContain('aria-label="Mobile navigation"')
    expect(html).toContain('>Explore</span>')
    expect(html).not.toContain('>Docs</span>')
    expect(html).toContain('>Search Sessions</span>')
    expect(html).toContain('>Publish</a>')
    expect(html).toContain('Use dark theme')
    expect(html).not.toContain('href="/teams"')
  })

  it('adds Team navigation for a signed-in visitor', () => {
    const html = renderToStaticMarkup(<SiteMobileNavigation auth={{ name: 'Alice', src: null }} />)

    expect(html).toContain('href="/my-sessions"')
    expect(html).toContain('href="/teams"')
    expect(html).toContain('>Teams</span>')
  })
})
