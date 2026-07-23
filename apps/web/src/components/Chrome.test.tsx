import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { Header } from './Chrome'

describe('Header', () => {
  it('can stay visible while a session page uses document scrolling', () => {
    const html = renderToStaticMarkup(<Header auth="out" sticky />)

    expect(html).toContain('class="sw-header sw-header-sticky"')
    expect(html).toContain('aria-label="Toggle light or dark"')
    expect(html).toContain('href="/explore"')
    expect(html).toContain('href="/docs/installation"')
    expect(html).toContain('aria-label="Docs"')
    expect(html).toContain('aria-label="Search Sessions"')
    expect(html).toContain('href="/docs/quick-start"')
    expect(html).toContain('>Publish</a>')
    expect(html).toContain('href="/sign-in"')
    expect(html).not.toContain('href="/me"')
    expect(html).toContain('Spool')
  })

  it('remains non-sticky by default on other pages', () => {
    const html = renderToStaticMarkup(<Header auth="out" />)

    expect(html).toContain('class="sw-header"')
    expect(html).not.toContain('sw-header-sticky')
  })

  it('shows a usable team shortcut for signed-in account chrome', () => {
    const html = renderToStaticMarkup(
      <Header
        auth={{ name: 'Alice', src: null }}
        contextTeam={{ id: 'team/a', name: 'Paperboy' }}
      />,
    )

    expect(html).toContain('href="/teams/team%2Fa"')
    expect(html).toContain('>Paperboy</span>')
    expect(html).toContain('href="/me"')
    expect(html).not.toContain('href="/sign-in"')
  })
})
