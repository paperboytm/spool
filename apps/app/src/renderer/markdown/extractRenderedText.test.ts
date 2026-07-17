import { describe, it, expect } from 'vitest'
import { extractRenderedText } from './extractRenderedText.js'

describe('extractRenderedText', () => {
  it('strips bold/italic markers', () => {
    expect(extractRenderedText('**bold** and *italic*')).toBe('bold and italic')
  })

  it('preserves document order across paragraphs and code blocks', () => {
    const md = 'before\n\n```ts\nconst x = 1\n```\n\nafter'
    const text = extractRenderedText(md)
    const beforeAt = text.indexOf('before')
    const codeAt = text.indexOf('const x = 1')
    const afterAt = text.indexOf('after')
    expect(beforeAt).toBeGreaterThanOrEqual(0)
    expect(codeAt).toBeGreaterThan(beforeAt)
    expect(afterAt).toBeGreaterThan(codeAt)
  })

  it('keeps inline code text', () => {
    expect(extractRenderedText('use `foo()` here')).toBe('use foo() here')
  })

  it('keeps list item text', () => {
    expect(extractRenderedText('- one\n- two')).toContain('one')
    expect(extractRenderedText('- one\n- two')).toContain('two')
  })

  it('returns empty string for empty input', () => {
    expect(extractRenderedText('')).toBe('')
  })
})
