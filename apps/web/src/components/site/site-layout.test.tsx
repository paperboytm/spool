import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { SiteAccountActions } from './site-layout'

describe('SiteAccountActions', () => {
  it('offers sign-in without implying an authenticated workspace', () => {
    const html = renderToStaticMarkup(<SiteAccountActions auth="out" />)

    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('>Sign in</a>')
    expect(html).not.toContain('href="/me"')
    expect(html).not.toContain('href="/me#teams"')
  })

  it('replaces sign-in with Team and personal account shortcuts', () => {
    const html = renderToStaticMarkup(<SiteAccountActions auth={{ name: 'Alice', src: null }} />)

    expect(html).toContain('href="/me#teams"')
    expect(html).toContain('>Teams</span>')
    expect(html).toContain('href="/me"')
    expect(html).toContain('aria-label="Open your account"')
    expect(html).not.toContain('>Sign in</a>')
  })
})
