import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { HomeRoute } from './_site.index'

describe('homepage route', () => {
  it('renders the real homepage instead of redirecting authenticated visitors', () => {
    const html = renderToStaticMarkup(createElement(HomeRoute))

    expect(html).toContain('class="home-page"')
    expect(html).toContain('Sessions everywhere.')
    expect(html).toContain('Explore Sessions')
  })
})
