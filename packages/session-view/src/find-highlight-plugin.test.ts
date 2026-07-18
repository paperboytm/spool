import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { describe, it, expect } from 'vite-plus/test'

import { findHighlightPlugin } from './find-highlight-plugin.js'

function buildTree(
  markdown: string,
  ranges: Array<{ start: number; end: number }>,
  offset = 0,
  active = -1,
) {
  const processor = remark().use(remarkGfm).use(findHighlightPlugin, {
    ranges,
    matchIndexOffset: offset,
    activeMatchIndex: active,
  })
  return processor.runSync(processor.parse(markdown))
}

function collectMatches(
  tree: any,
): Array<{ value: string; matchIndex: number; isActive: boolean; dataActive: string }> {
  const out: Array<{ value: string; matchIndex: number; isActive: boolean; dataActive: string }> =
    []
  const walk = (node: any) => {
    if (node.type === 'findMatch') {
      out.push({
        value: node.value,
        matchIndex: node.matchIndex,
        isActive: node.isActive,
        dataActive: node.data?.hProperties?.['data-active'],
      })
    }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree)
  return out
}

describe('findHighlightPlugin', () => {
  it('splits a paragraph text node at a single match', () => {
    const md = 'hello world'
    const renderedText = toString(remark().use(remarkGfm).parse(md))
    const start = renderedText.indexOf('world')
    const tree = buildTree(md, [{ start, end: start + 5 }])
    const matches = collectMatches(tree)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      value: 'world',
      matchIndex: 0,
      isActive: false,
      dataActive: 'false',
    })
  })

  it('marks active match via isActive and data-active', () => {
    const md = 'foo bar foo'
    const text = toString(remark().use(remarkGfm).parse(md))
    const r1 = { start: text.indexOf('foo'), end: text.indexOf('foo') + 3 }
    const r2 = { start: text.indexOf('foo', 4), end: text.indexOf('foo', 4) + 3 }
    const tree = buildTree(md, [r1, r2], 0, 1)
    const matches = collectMatches(tree)
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ matchIndex: 0, isActive: false, dataActive: 'false' })
    expect(matches[1]).toMatchObject({ matchIndex: 1, isActive: true, dataActive: 'true' })
  })

  it('respects matchIndexOffset', () => {
    const md = 'foo'
    const tree = buildTree(md, [{ start: 0, end: 3 }], 7, 7)
    const matches = collectMatches(tree)
    expect(matches[0]).toMatchObject({ matchIndex: 7, isActive: true })
  })

  it('matches inside inline code', () => {
    const md = 'use `foo()` here'
    const text = toString(remark().use(remarkGfm).parse(md))
    const start = text.indexOf('foo()')
    const tree = buildTree(md, [{ start, end: start + 5 }])
    expect(collectMatches(tree).map((m) => m.value)).toEqual(['foo()'])
  })

  it('matches inside fenced code blocks', () => {
    const md = '```\nconst foo = 1\n```'
    const text = toString(remark().use(remarkGfm).parse(md))
    const start = text.indexOf('foo')
    const tree = buildTree(md, [{ start, end: start + 3 }])
    expect(collectMatches(tree).map((m) => m.value)).toEqual(['foo'])
  })

  it('handles match spanning two text segments (across emphasis)', () => {
    // 'a**b**c' renders as text 'abc'; a match for 'abc' at [0,3] crosses three text nodes.
    const md = 'a**b**c'
    const text = toString(remark().use(remarkGfm).parse(md))
    expect(text).toBe('abc')
    const tree = buildTree(md, [{ start: 0, end: 3 }])
    const matches = collectMatches(tree)
    expect(matches.map((m) => m.value).join('')).toBe('abc')
    expect(matches.every((m) => m.matchIndex === 0)).toBe(true)
  })

  it('is a no-op when ranges is empty', () => {
    const md = 'hello'
    const tree = buildTree(md, [])
    expect(collectMatches(tree)).toEqual([])
  })

  it('advances cursor past inline HTML so subsequent matches stay aligned', () => {
    // 'before <br/> match' — toString concatenates: "before <br/>match" (length depends on toString)
    const md = 'before <br/> match'
    const text = toString(remark().use(remarkGfm).parse(md))
    // 'match' should appear in the rendered text after the html
    const start = text.indexOf('match')
    expect(start).toBeGreaterThanOrEqual(0)
    const tree = buildTree(md, [{ start, end: start + 5 }])
    const matches = collectMatches(tree)
    expect(matches.map((m) => m.value)).toEqual(['match'])
  })

  it('advances cursor past image alt text', () => {
    const md = 'see ![diagram](x.png) below'
    const text = toString(remark().use(remarkGfm).parse(md))
    const start = text.indexOf('below')
    expect(start).toBeGreaterThanOrEqual(0)
    const tree = buildTree(md, [{ start, end: start + 5 }])
    const matches = collectMatches(tree)
    expect(matches.map((m) => m.value)).toEqual(['below'])
  })

  it('handles a range that exactly equals a text node', () => {
    // Range covers the entire 'hello' text node — boundary condition.
    const tree = buildTree('hello', [{ start: 0, end: 5 }])
    const matches = collectMatches(tree)
    expect(matches.map((m) => m.value)).toEqual(['hello'])
  })

  it('emits hChildren so <mark> renders with visible text after hast conversion', () => {
    // Without data.hChildren, mdast-util-to-hast produces an empty <mark></mark>
    // and the matched characters disappear from the rendered DOM.
    const tree = buildTree('hello world', [{ start: 6, end: 11 }])
    const findMatch = (node: any): any => {
      if (node.type === 'findMatch') return node
      if (node.children)
        for (const c of node.children) {
          const found = findMatch(c)
          if (found) return found
        }
      return null
    }
    const node = findMatch(tree)
    expect(node).not.toBeNull()
    expect(node.data?.hChildren).toEqual([{ type: 'text', value: 'world' }])
  })
})
