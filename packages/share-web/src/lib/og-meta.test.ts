import { describe, expect, it, vi } from 'vitest'

import { buildOgTagBlock, injectMetaIntoHtml } from './og-meta'

describe('buildOgTagBlock', () => {
  it('emits a <title>, canonical link, and the OG + Twitter Card set', () => {
    const out = buildOgTagBlock({
      title: 'My great chat',
      ogImageUrl: 'https://spool.pro/api/og/abc.png',
      canonicalUrl: 'https://spool.pro/s/abc',
    })
    expect(out).toContain('<title>My great chat · spool.pro</title>')
    expect(out).toContain('<link rel="canonical" href="https://spool.pro/s/abc">')
    expect(out).toContain('<meta property="og:type" content="article">')
    expect(out).toContain('<meta property="og:title" content="My great chat">')
    expect(out).toContain('<meta property="og:image" content="https://spool.pro/api/og/abc.png">')
    expect(out).toContain('<meta property="og:image:width" content="1200">')
    expect(out).toContain('<meta property="og:image:height" content="630">')
    expect(out).toContain('<meta property="og:url" content="https://spool.pro/s/abc">')
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(out).toContain('<meta name="twitter:title" content="My great chat">')
    expect(out).toContain('<meta name="twitter:image" content="https://spool.pro/api/og/abc.png">')
  })

  it('escapes attribute-breaking characters in the title to block injection', () => {
    // A publisher could pick a title that closes the meta attribute and
    // sneaks in additional tags. The output must contain no raw `<`, `>`,
    // or unescaped `"` inside the attribute values.
    const out = buildOgTagBlock({
      title: '"><script>alert(1)</script><meta x="',
      ogImageUrl: 'x',
      canonicalUrl: 'y',
    })
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('</script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&quot;')
  })

  it('truncates pathological titles to 200 chars', () => {
    const long = 'a'.repeat(500)
    const out = buildOgTagBlock({
      title: long,
      ogImageUrl: 'x',
      canonicalUrl: 'y',
    })
    const m = out.match(/property="og:title" content="(a+)"/)
    expect(m).not.toBeNull()
    expect(m![1]!.length).toBe(200)
  })

  it('falls back to a default title when the snapshot title is empty', () => {
    const out = buildOgTagBlock({
      title: '',
      ogImageUrl: 'x',
      canonicalUrl: 'y',
    })
    expect(out).toContain('<title>Shared conversation · spool.pro</title>')
  })

  it('uses the supplied description when present', () => {
    const out = buildOgTagBlock({
      title: 'T',
      ogImageUrl: 'x',
      canonicalUrl: 'y',
      description: 'Custom blurb',
    })
    expect(out).toContain('<meta name="description" content="Custom blurb">')
    expect(out).toContain('<meta property="og:description" content="Custom blurb">')
  })
})

describe('injectMetaIntoHtml', () => {
  it('replaces the default <title> and inserts the tag block before </head>', () => {
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <title>spool.pro</title>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
    ].join('\n')
    const block = '<meta property="og:title" content="hi">'
    const out = injectMetaIntoHtml(html, block)
    expect(out).not.toContain('<title>spool.pro</title>')
    // Block lands before </head>, after the existing <meta charset>.
    expect(out.indexOf(block)).toBeGreaterThan(out.indexOf('<meta charset'))
    expect(out.indexOf(block)).toBeLessThan(out.indexOf('</head>'))
    // Body and bootstrap untouched.
    expect(out).toContain('<div id="root"></div>')
  })

  it('does nothing destructive when </head> is missing', () => {
    const html = '<html><body>oops</body></html>'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = injectMetaIntoHtml(html, '<meta x="y">')
    expect(out).toBe(html)
    // Surfacing the failure makes a corrupted ASSETS response observable
    // in Cloudflare logs instead of silently shipping OG-less pages.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('strips the static <meta name="robots" content="noindex"> on inject', () => {
    // The SPA shell ships with noindex so the bare /index.html stays out
    // of search results. A served-with-200 share page is something we
    // want indexed, so the inject step must remove the noindex.
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="robots" content="noindex" />',
      '    <title>spool.pro</title>',
      '  </head>',
      '  <body></body>',
      '</html>',
    ].join('\n')
    const out = injectMetaIntoHtml(html, '<meta property="og:title" content="hi">')
    expect(out).not.toMatch(/name=["']robots["']/i)
  })

  it('leaves the noindex meta alone when </head> is missing (passthrough)', () => {
    const html = '<meta name="robots" content="noindex">'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = injectMetaIntoHtml(html, '<meta x="y">')
    expect(out).toBe(html)
    warn.mockRestore()
  })
})

describe('robots / cache invariants', () => {
  // These invariants matter on the live /s/<id> Pages Function: a 200
  // response should be indexable, but the failure passthrough paths
  // (passthroughShell in [id].ts) MUST keep noindex so that 410/404
  // shells don't pollute search results.
  it('a successful inject + buildOgTagBlock combo has no robots meta and a canonical link', () => {
    const html = [
      '<!doctype html>',
      '<html><head>',
      '<meta name="robots" content="noindex">',
      '<title>spool.pro</title>',
      '</head><body></body></html>',
    ].join('\n')
    const block = buildOgTagBlock({
      title: 'Hi',
      ogImageUrl: 'https://spool.pro/api/og/abc.png',
      canonicalUrl: 'https://spool.pro/s/abc',
    })
    const out = injectMetaIntoHtml(html, block)
    expect(out).not.toMatch(/name=["']robots["']/i)
    expect(out).toContain('rel="canonical"')
  })
})
