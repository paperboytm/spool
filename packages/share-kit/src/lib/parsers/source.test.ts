import { describe, expect, it } from 'vitest'
import { decodeEntities, stats } from './source.js'

describe('decodeEntities', () => {
  it('decodes the common entities', () => {
    expect(decodeEntities('a&nbsp;b')).toBe('a b')
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>')
    expect(decodeEntities('&quot;x&quot;')).toBe('"x"')
    expect(decodeEntities('it&#39;s')).toBe("it's")
    expect(decodeEntities('a &amp; b')).toBe('a & b')
  })

  it('decodes &amp; last so escaped entities survive one decode pass', () => {
    // `&amp;lt;` is an escaped `&lt;` — it must decode to the literal `&lt;`,
    // not be double-unescaped into `<`.
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeEntities('&amp;amp;')).toBe('&amp;')
  })
})

describe('stats', () => {
  it('counts CJK / kana / hangul as individual characters', () => {
    expect(stats([{ body: '你好世界' }]).wordCount).toBe(4)
    expect(stats([{ body: 'こんにちは' }]).wordCount).toBe(5)
    expect(stats([{ body: '안녕하세요' }]).wordCount).toBe(5)
  })

  it('counts latin runs as whitespace-delimited words', () => {
    expect(stats([{ body: 'the quick brown fox' }]).wordCount).toBe(4)
  })

  it('mixes CJK chars and latin words', () => {
    expect(stats([{ body: 'hello 世界' }]).wordCount).toBe(3)
  })
})
