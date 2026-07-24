import { describe, expect, it } from 'vite-plus/test'

import { sessionOgHead, sessionOgTitle, snapshotOgHead } from './og-meta'

function metaValue(
  fragment: { meta: Array<Record<string, string>> },
  key: 'name' | 'property',
  id: string,
): string | undefined {
  return fragment.meta.find((m) => m[key] === id)?.['content']
}

describe('snapshotOgHead', () => {
  it('emits a title, canonical link, and the OG + Twitter Card set', () => {
    const out = snapshotOgHead({
      title: 'My great chat',
      ogImageUrl: 'https://spool.new/api/og/abc.png',
      canonicalUrl: 'https://spool.new/s/abc',
    })
    expect(out.meta[0]).toEqual({ title: 'My great chat · spool.new' })
    expect(out.links).toEqual([{ rel: 'canonical', href: 'https://spool.new/s/abc' }])
    expect(metaValue(out, 'property', 'og:type')).toBe('article')
    expect(metaValue(out, 'property', 'og:title')).toBe('My great chat')
    expect(metaValue(out, 'property', 'og:image')).toBe('https://spool.new/api/og/abc.png')
    expect(metaValue(out, 'property', 'og:image:width')).toBe('1200')
    expect(metaValue(out, 'property', 'og:image:height')).toBe('630')
    expect(metaValue(out, 'property', 'og:url')).toBe('https://spool.new/s/abc')
    expect(metaValue(out, 'name', 'twitter:card')).toBe('summary_large_image')
    expect(metaValue(out, 'name', 'twitter:title')).toBe('My great chat')
    expect(metaValue(out, 'name', 'twitter:image')).toBe('https://spool.new/api/og/abc.png')
  })

  it('truncates pathological titles to 200 chars', () => {
    const long = 'a'.repeat(500)
    const out = snapshotOgHead({ title: long, ogImageUrl: 'x', canonicalUrl: 'y' })
    expect(metaValue(out, 'property', 'og:title')).toHaveLength(200)
    expect(out.meta[0]?.['title']).toBe(`${'a'.repeat(200)} · spool.new`)
  })

  it('falls back to a default title when the snapshot title is empty', () => {
    const out = snapshotOgHead({ title: '', ogImageUrl: 'x', canonicalUrl: 'y' })
    expect(out.meta[0]).toEqual({ title: 'Shared conversation · spool.new' })
    expect(metaValue(out, 'property', 'og:title')).toBe('Shared conversation')
  })

  it('uses the supplied description when present', () => {
    const out = snapshotOgHead({
      title: 'T',
      ogImageUrl: 'x',
      canonicalUrl: 'y',
      description: 'Custom blurb',
    })
    expect(metaValue(out, 'name', 'description')).toBe('Custom blurb')
    expect(metaValue(out, 'property', 'og:description')).toBe('Custom blurb')
  })

  it('defaults the description when none is supplied', () => {
    const out = snapshotOgHead({ title: 'T', ogImageUrl: 'x', canonicalUrl: 'y' })
    expect(metaValue(out, 'name', 'description')).toBe('A shared conversation on Spool.')
  })
})

describe('sessionOgHead', () => {
  it('emits a summary card without an og:image', () => {
    const out = sessionOgHead({
      title: 'Fix the auth flow',
      description: 'A coding-agent session shared by @xy — 12 records.',
      canonicalUrl: 'https://spool.new/session/claude_abc12345',
    })
    expect(out.meta[0]).toEqual({ title: 'Fix the auth flow · spool.new' })
    expect(metaValue(out, 'name', 'twitter:card')).toBe('summary')
    expect(out.meta.some((m) => m['property'] === 'og:image')).toBe(false)
    expect(out.links).toEqual([
      { rel: 'canonical', href: 'https://spool.new/session/claude_abc12345' },
    ])
  })

  it('falls back to generic title and description', () => {
    const out = sessionOgHead({ title: '', description: '', canonicalUrl: 'x' })
    expect(out.meta[0]).toEqual({ title: 'Shared session · spool.new' })
    expect(metaValue(out, 'name', 'description')).toBe('A shared coding-agent session on Spool.')
  })
})

describe('sessionOgTitle', () => {
  it('uses the generated Summary title instead of exposing the front-matter delimiter', () => {
    expect(
      sessionOgTitle(
        [
          '---',
          'title: Fix cached authentication redirects',
          'title_zh: 修复缓存身份导致的错误跳转',
          '---',
          'Longer body',
        ].join('\n'),
      ),
    ).toBe('Fix cached authentication redirects')
  })

  it('falls back to a Chinese generated title when no English title is present', () => {
    expect(sessionOgTitle('---\ntitle_zh: 修复会话标题\n---\nLonger body')).toBe('修复会话标题')
  })

  it('takes the first meaningful line of a legacy Summary and strips heading syntax', () => {
    expect(sessionOgTitle('Fix the auth flow\n\nLonger body')).toBe('Fix the auth flow')
    expect(sessionOgTitle('\n# Ship the auth fix\n\nLonger body')).toBe('Ship the auth fix')
  })

  it('trims whitespace', () => {
    expect(sessionOgTitle('  padded  \nrest')).toBe('padded')
  })

  it('falls back when the Summary is empty or missing', () => {
    expect(sessionOgTitle('')).toBe('Shared session')
    expect(sessionOgTitle(null)).toBe('Shared session')
    expect(sessionOgTitle(undefined)).toBe('Shared session')
    expect(sessionOgTitle('\nbody only')).toBe('body only')
  })
})
