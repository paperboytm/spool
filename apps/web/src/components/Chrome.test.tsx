import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { Footer, Header } from './Chrome'

describe('Header', () => {
  it('can stay visible while a session page uses document scrolling', () => {
    const html = renderToStaticMarkup(<Header auth="out" sticky />)

    expect(html).toContain('class="sw-header sw-header-sticky"')
    expect(html).toContain('href="/sessions"')
    expect(html).not.toContain('href="/explore')
    expect(html).not.toContain('aria-label="Docs"')
    // Search belongs to the Sessions feed; the header keeps one action
    // (Publish) plus the account affordance.
    expect(html).not.toContain('aria-label="Search Sessions"')
    expect(html).not.toContain('aria-label="Toggle light or dark"')
    expect(html).toContain('href="/docs/quick-start"')
    expect(html).toContain('>Publish</a>')
    expect(html).toContain('aria-label="Session language"')
    expect(html).toContain('aria-label="Show Sessions in English" aria-pressed="true"')
    expect(html).toContain('aria-label="用中文显示 Session" aria-pressed="false"')
    expect(html).toContain('sw-header-mobile-menu')
    expect(html).toContain('aria-label="Mobile navigation"')
    expect(html).not.toContain('>Search Sessions</span>')
    expect(html).toContain('href="/docs/installation"')
    expect(html).toContain('>Docs</span>')
    expect(html).toContain('Use dark theme')
    expect(html).toContain('<span>Session language</span>')
    expect(html).toContain('href="/sign-in"')
    expect(html).not.toContain('href="/me"')
    expect(html).toContain('Spool')
  })

  it('remains non-sticky by default on other pages', () => {
    const html = renderToStaticMarkup(<Header auth="out" />)

    expect(html).toContain('class="sw-header"')
    expect(html).not.toContain('sw-header-sticky')
  })

  it('keeps signed-in account chrome behind the avatar menu', () => {
    const html = renderToStaticMarkup(
      <Header
        auth={{ name: 'Alice', src: null }}
        contextTeam={{ id: 'team/a', name: 'Paperboy' }}
      />,
    )

    expect(html).toContain('aria-label="Open account menu"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('sw-header-desktop-actions')
    // The mobile disclosure still exposes the workspace shortcuts.
    expect(html).toContain('sw-header-mobile-menu-items')
    expect(html).toContain('href="/my-sessions"')
    expect(html).toContain('href="/teams/team%2Fa"')
    expect(html).toContain('>Paperboy</span>')
    expect(html).not.toContain('href="/sign-in"')
  })
})

describe('Footer', () => {
  it('groups Docs with legal and repository resources', () => {
    const html = renderToStaticMarkup(<Footer />)

    expect(html).toContain('href="/docs/installation"')
    expect(html).toContain('href="/blog"')
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('https://github.com/paperboytm/spool')
  })
})
