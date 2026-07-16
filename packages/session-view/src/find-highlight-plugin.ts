export type Range = { start: number; end: number }

export interface FindMatchNode {
  type: 'findMatch'
  value: string
  matchIndex: number
  isActive: boolean
  data?: {
    hName: 'mark'
    hProperties: { 'data-active': 'true' | 'false' }
    hChildren: Array<{ type: 'text'; value: string }>
  }
}

interface Options {
  ranges: ReadonlyArray<Range>
  matchIndexOffset: number
  activeMatchIndex: number
}

type AnyNode = { type: string; value?: string; children?: AnyNode[] }
type Transformer = (tree: AnyNode) => void

export const findHighlightPlugin = (options: Options): Transformer => {
  const { ranges, matchIndexOffset, activeMatchIndex } = options
  if (ranges.length === 0) return () => {}

  return (tree: AnyNode) => {
    let cursor = 0
    let rangeIdx = 0

    const makeFindMatch = (value: string, scan: number): FindMatchNode => {
      const globalIndex = matchIndexOffset + scan
      const isActive = globalIndex === activeMatchIndex
      return {
        type: 'findMatch',
        value,
        matchIndex: globalIndex,
        isActive,
        data: {
          hName: 'mark',
          hProperties: { 'data-active': isActive ? 'true' : 'false' },
          hChildren: [{ type: 'text', value }],
        },
      }
    }

    const splitValue = (
      value: string,
      nodeStart: number,
      nodeEnd: number,
      makeUnmatched: (slice: string) => AnyNode,
    ): AnyNode[] | null => {
      while (rangeIdx < ranges.length && (ranges[rangeIdx] as Range).end <= nodeStart) {
        rangeIdx += 1
      }
      const segments: AnyNode[] = []
      let local = 0
      let scan = rangeIdx
      while (scan < ranges.length && (ranges[scan] as Range).start < nodeEnd) {
        const r = ranges[scan] as Range
        const localStart = Math.max(0, r.start - nodeStart)
        const localEnd = Math.min(value.length, r.end - nodeStart)
        if (localStart > local) segments.push(makeUnmatched(value.slice(local, localStart)))
        segments.push(makeFindMatch(value.slice(localStart, localEnd), scan))
        local = localEnd
        scan += 1
      }
      if (segments.length === 0) return null
      if (local < value.length) segments.push(makeUnmatched(value.slice(local)))
      return segments
    }

    const walk = (node: AnyNode, parent: AnyNode | null, indexInParent: number) => {
      if (node.type === 'text') {
        const value = node.value ?? ''
        const nodeStart = cursor
        const nodeEnd = cursor + value.length
        cursor = nodeEnd
        const segments = splitValue(value, nodeStart, nodeEnd, (slice) => ({ type: 'text', value: slice }))
        if (segments && parent && parent.children) {
          parent.children.splice(indexInParent, 1, ...(segments as AnyNode[]))
          return segments.length
        }
        return 1
      }

      if (node.type === 'inlineCode' || node.type === 'code') {
        const value = node.value ?? ''
        const nodeStart = cursor
        const nodeEnd = cursor + value.length
        cursor = nodeEnd
        const codeType = node.type
        const segments = splitValue(value, nodeStart, nodeEnd, (slice) => ({ type: codeType, value: slice } as AnyNode))
        if (segments && parent && parent.children) {
          parent.children.splice(indexInParent, 1, ...(segments as AnyNode[]))
          return segments.length
        }
        return 1
      }

      if (typeof node.value === 'string') {
        // html, yaml, toml, math, inlineMath, definition, etc. — toString includes their .value
        // We don't split these; we just advance cursor so downstream text offsets stay aligned.
        cursor += node.value.length
        return 1
      }

      const altCandidate = (node as { alt?: unknown }).alt
      if (node.type === 'image' && typeof altCandidate === 'string') {
        cursor += altCandidate.length
        return 1
      }

      const children = node.children
      if (children) {
        let i = 0
        while (i < children.length) {
          const child = children[i]
          if (!child) {
            i += 1
            continue
          }
          const consumed = walk(child, node, i)
          i += consumed
        }
      }
      return 1
    }

    walk(tree, null, 0)
  }
}
