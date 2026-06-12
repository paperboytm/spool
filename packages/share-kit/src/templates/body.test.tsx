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

describe('Body — shared compiled redact matcher', () => {
  const redact = [
    { value: 'sk_live_aaaabbbbccccdddd1111', replacement: '[redacted: Stripe key]' },
    { value: '/Users/chen/secret.txt', replacement: '[redacted path]' },
  ]

  function renderWith(text: string): string {
    return renderToStaticMarkup(
      <Body text={text} redact={redact} accent="#C85A00" accentBg="rgba(200,90,0,0.1)" />,
    )
  }

  it('masks every entry, and a second render off the cached matcher is byte-identical', () => {
    const text = 'key sk_live_aaaabbbbccccdddd1111 at /Users/chen/secret.txt and again sk_live_aaaabbbbccccdddd1111'
    const first = renderWith(text)
    expect(first).toContain('[redacted: Stripe key]')
    expect(first).toContain('[redacted path]')
    expect(first).not.toContain('sk_live_aaaabbbbccccdddd1111')
    // Same redact array identity -> compiled matcher is reused across
    // renders (and across turns). The output must not depend on that.
    const second = renderWith(text)
    expect(second).toBe(first)
  })

  it('a different redact list compiles its own matcher', () => {
    const html = renderToStaticMarkup(
      <Body
        text="other-secret here"
        redact={[{ value: 'other-secret', replacement: '[redacted]' }]}
        accent="#C85A00"
        accentBg="rgba(200,90,0,0.1)"
      />,
    )
    expect(html).toContain('[redacted]')
    expect(html).not.toContain('other-secret')
  })
})
