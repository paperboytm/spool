import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { SessionSummary } from './session-summary'

function render(markdown: string | null): string {
  return renderToStaticMarkup(<SessionSummary markdown={markdown} />)
}

describe('SessionSummary', () => {
  it('renders no markup when the summary is missing or blank', () => {
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

  it('renders the summary inline without card chrome or an icon', () => {
    const html = render('Keep the context readable.')

    expect(html).toContain('<h2 id="session-summary-title"')
    expect(html).not.toContain('<header')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('rounded-[10px]')
    expect(html).not.toContain('bg-[var(--card)]')
  })

  it('marks localized Summary prose without changing the English UI heading', () => {
    const html = renderToStaticMarkup(
      <SessionSummary markdown="中文背景、动机和结果。" language="zh-CN" />,
    )

    expect(html).toContain('<h2 id="session-summary-title"')
    expect(html).toContain('lang="zh-CN"')
    expect(html).toContain('中文背景、动机和结果。')
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
    expect(html).not.toMatch(/<section\s+data-danger/)
    expect(html).not.toMatch(/<script\b/)
  })
})
