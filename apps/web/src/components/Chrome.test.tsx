import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { Header } from './Chrome'

describe('Header', () => {
  it('can stay visible while a session page uses document scrolling', () => {
    const html = renderToStaticMarkup(<Header auth="out" sticky />)

    expect(html).toContain('class="sw-header sw-header-sticky"')
  })

  it('remains non-sticky by default on other pages', () => {
    const html = renderToStaticMarkup(<Header auth="out" />)

    expect(html).toContain('class="sw-header"')
    expect(html).not.toContain('sw-header-sticky')
  })
})
