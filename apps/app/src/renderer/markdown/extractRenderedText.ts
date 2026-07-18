import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'

const processor = remark().use(remarkGfm)

export function extractRenderedText(markdown: string): string {
  if (!markdown) return ''
  const tree = processor.parse(markdown)
  return toString(tree)
}
