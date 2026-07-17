import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SessionNote } from './session-note'

function render(markdown: string | null): string {
  return renderToStaticMarkup(<SessionNote markdown={markdown} />)
}

describe('SessionNote', () => {
  it('renders no markup when the note is missing or blank', () => {
    expect(render(null)).toBe('')
    expect(render(' \n\t ')).toBe('')
  })

  it('renders GFM headings, lists, and tables as semantic HTML', () => {
    const html = render(`# Session purpose

- Preserve context
- Explain decisions

| Area | Goal |
| --- | --- |
| Search | Find prior work |`)

    expect(html).toContain('<h1>Session purpose</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Preserve context</li>')
    expect(html).toContain('<li>Explain decisions</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<th>Area</th>')
    expect(html).toContain('<td>Find prior work</td>')
  })

  it('opens external links in a new tab without sharing the opener', () => {
    const html = render('[Spool](https://spool.dev/docs)')
    const anchor = html.match(/<a\b[^>]*>/)?.[0]

    expect(anchor).toBeDefined()
    expect(anchor).toContain('href="https://spool.dev/docs"')
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toMatch(/\brel="[^"]*\bnoopener\b[^"]*"/)
    expect(anchor).toMatch(/\brel="[^"]*\bnoreferrer\b[^"]*"/)
  })

  it('does not render raw HTML or scripts as elements', () => {
    const html = render(`# Safe content

<section data-danger="true">Unsafe HTML</section>
<script>globalThis.compromised = true</script>`)

    expect(html).toContain('<h1>Safe content</h1>')
    expect(html).not.toMatch(/<section\b/)
    expect(html).not.toMatch(/<script\b/)
  })
})
