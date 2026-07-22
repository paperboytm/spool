import { Check, CircleAlert, Copy } from 'lucide-react'
import { Children, isValidElement, useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { copyCommandText, type CopyCommandState } from '../../lib/cli-command'

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (!isValidElement<{ children?: ReactNode }>(child)) return ''
      return textContent(child.props.children)
    })
    .join('')
}

type MarkdownPreProps = ComponentProps<'pre'> & { node?: unknown }

function CopyableCodeBlock({ children, node: _node, ...props }: MarkdownPreProps) {
  const [copyState, setCopyState] = useState<CopyCommandState>('idle')
  // react-markdown preserves a fence-closing newline. Leaving it on the
  // clipboard can execute a pasted shell command before the reader reviews it.
  const code = textContent(children).replace(/\n$/, '')
  const copied = copyState === 'copied'
  const failed = copyState === 'failed'

  const copy = () => {
    void copyCommandText(code).then(setCopyState)
  }

  return (
    <div className="md-code-block">
      <button
        type="button"
        className={`md-code-copy${copied ? ' is-copied' : ''}${failed ? ' is-copy-failed' : ''}`}
        onClick={copy}
        aria-label={copied ? 'Code copied' : failed ? 'Copy failed; try again' : 'Copy code'}
        title={copied ? 'Copied' : failed ? 'Copy failed; try again' : 'Copy code'}
      >
        {copied ? (
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
        ) : failed ? (
          <CircleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span aria-live="polite">{copied ? 'Copied' : failed ? 'Try again' : 'Copy'}</span>
      </button>
      <pre {...props}>{children}</pre>
    </div>
  )
}

const markdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  pre: CopyableCodeBlock,
}

/** GFM markdown body for the prerendered docs/blog pages. Renders to
 *  React elements (no raw HTML pass-through), styled by the .void-md
 *  rules in docs.css — the class name survives from the @void/md era
 *  so the existing stylesheet keeps working. */
export function Markdown({ children, copyCode = false }: { children: string; copyCode?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={copyCode ? markdownComponents : undefined}
    >
      {children}
    </ReactMarkdown>
  )
}
