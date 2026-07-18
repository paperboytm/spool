import { describe, expect, it } from 'vite-plus/test'

import { COLORWAYS, DEFAULT_OPTS, PAPERS, TEMPLATES, TYPEFACES, normalizeOpts } from './types'

describe('curated option lists match the app picker (4 of each)', () => {
  // The app surfaces exactly 4 options for each axis. share-kit's
  // exported lists are now the source of truth — adding/removing a
  // template/paper/typeface/colorway here changes what users see.
  it('exposes 4 templates', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['chat', 'letter', 'forum', 'timeline'])
  })

  it('exposes 4 papers', () => {
    expect(PAPERS.map((p) => p.id)).toEqual(['snow', 'bone', 'graphite', 'ink'])
  })

  it('exposes 4 typefaces', () => {
    expect(TYPEFACES.map((t) => t.id)).toEqual(['inter', 'geist', 'fraunces', 'hanken-grotesk'])
  })

  it('exposes 4 colorways, ordered warm → cool', () => {
    expect(COLORWAYS.map((c) => c.id)).toEqual(['amber', 'walnut', 'sage', 'marine'])
  })
})

describe('normalizeOpts coerces stale ids to the defaults', () => {
  it('coerces an unknown template to DEFAULT_OPTS.template', () => {
    const out = normalizeOpts({ ...DEFAULT_OPTS, template: 'transcript' })
    expect(out.template).toBe(DEFAULT_OPTS.template)
  })

  it('coerces an unknown paper to DEFAULT_OPTS.paper', () => {
    // Regression for pre-v0.5.0 drafts that may carry paper: 'linen'.
    const out = normalizeOpts({ ...DEFAULT_OPTS, paper: 'linen' })
    expect(out.paper).toBe(DEFAULT_OPTS.paper)
  })

  it('coerces an unknown typeface to DEFAULT_OPTS.typeface', () => {
    const out = normalizeOpts({ ...DEFAULT_OPTS, typeface: 'comic-sans' })
    expect(out.typeface).toBe(DEFAULT_OPTS.typeface)
  })

  it('coerces an unknown colorway and resets accentHex too', () => {
    // Regression for pre-v0.5.0 drafts that may carry colorway: 'ink'
    // or 'bone' — without the accentHex reset the rendered accent
    // would keep its stale swatch.
    const out = normalizeOpts({
      ...DEFAULT_OPTS,
      colorway: 'ink' as never,
      accentHex: '#1C1C18',
    })
    expect(out.colorway).toBe(DEFAULT_OPTS.colorway)
    expect(out.accentHex).toBe(DEFAULT_OPTS.accentHex)
  })

  it('passes through valid opts unchanged', () => {
    const input = {
      ...DEFAULT_OPTS,
      template: 'timeline' as const,
      paper: 'graphite' as const,
      typeface: 'fraunces' as const,
      colorway: 'walnut' as const,
      accentHex: '#9F7A4C',
    }
    const out = normalizeOpts(input)
    expect(out.template).toBe('timeline')
    expect(out.paper).toBe('graphite')
    expect(out.typeface).toBe('fraunces')
    expect(out.colorway).toBe('walnut')
    expect(out.accentHex).toBe('#9F7A4C')
  })

  it('fills missing fields from DEFAULT_OPTS', () => {
    const out = normalizeOpts({})
    expect(out).toEqual(DEFAULT_OPTS)
  })

  it('survives garbage input without throwing', () => {
    expect(() => normalizeOpts(null)).not.toThrow()
    expect(() => normalizeOpts(undefined)).not.toThrow()
    expect(() => normalizeOpts('not an object')).not.toThrow()
    expect(() => normalizeOpts(42)).not.toThrow()
  })
})
