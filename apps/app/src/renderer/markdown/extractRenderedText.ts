import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { toString } from 'mdast-util-to-string'

const processor = remark().use(remarkGfm)

export function extractRenderedText(markdown: string): string {
  if (!markdown) return ''
  const tree = processor.parse(markdown)
  return toString(tree)
}
