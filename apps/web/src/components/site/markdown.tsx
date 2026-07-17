import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** GFM markdown body for the prerendered docs/blog pages. Renders to
 *  React elements (no raw HTML pass-through), styled by the .void-md
 *  rules in docs.css — the class name survives from the @void/md era
 *  so the existing stylesheet keeps working. */
export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
}
