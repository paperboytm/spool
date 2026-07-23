import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import HomePage from './home'

describe('homepage calls to action', () => {
  it('uses prominent, arrow-free labels in both CTA groups', () => {
    const html = renderToStaticMarkup(<HomePage />)

    expect(html.match(/>Explore Sessions</g)).toHaveLength(2)
    expect(html.match(/>Share Yours</g)).toHaveLength(2)
    expect(html).not.toContain('Explore Sessions →')
    expect(html).not.toContain('Share yours')
    expect(html).not.toContain('Share Yours →')
  })
})
