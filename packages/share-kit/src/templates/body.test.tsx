import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Body } from './body'

function renderBody(text: string): string {
  return renderToStaticMarkup(
    <Body text={text} accent="#C85A00" accentBg="rgba(200,90,0,0.1)" />,
  )
}

describe('Body — link hardening', () => {
  it('external links carry target=_blank and rel=noreferrer noopener', () => {
    const html = renderBody('See [the docs](https://example.com/page).')
    expect(html).toContain('href="https://example.com/page"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  it('in-page anchors stay same-frame (no target/rel)', () => {
    const html = renderBody('Jump to [section](#section).')
    expect(html).toContain('href="#section"')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain('rel="noreferrer noopener"')
  })

  it('react-markdown still neutralizes javascript: hrefs', () => {
    // react-markdown v10's default urlTransform strips dangerous
    // protocols, so the rendered href must not be the javascript: URL.
    const html = renderBody('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:alert')
  })
})
