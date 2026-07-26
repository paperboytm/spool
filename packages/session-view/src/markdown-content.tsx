import {
  Children,
  isValidElement,
  memo,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import CodeBlock from './code-block.js'
import { findHighlightPlugin, type Range } from './find-highlight-plugin.js'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    mark: ['data*'],
  },
}

interface Props {
  text: string
  isDark: boolean
  findRanges?: ReadonlyArray<Range>
  matchIndexOffset?: number
  activeMatchIndex?: number
  onActiveMatchRef?: (node: HTMLElement | null) => void
}

function MarkdownContent({
  text,
  isDark,
  findRanges = [],
  matchIndexOffset = 0,
  activeMatchIndex = -1,
  onActiveMatchRef,
}: Props) {
  const remarkPlugins = useMemo(
    () =>
      [
        remarkGfm,
        [findHighlightPlugin, { ranges: findRanges, matchIndexOffset, activeMatchIndex }],
      ] as ComponentProps<typeof ReactMarkdown>['remarkPlugins'],
    [findRanges, matchIndexOffset, activeMatchIndex],
  )

  const rehypePlugins = useMemo(
    () =>
      [[rehypeSanitize, sanitizeSchema]] as ComponentProps<typeof ReactMarkdown>['rehypePlugins'],
    [],
  )

  const components: ComponentProps<typeof ReactMarkdown>['components'] = useMemo(
    () => ({
      pre(props) {
        const codeChild = Children.toArray(props.children).find(
          (c): c is ReactElement => isValidElement(c) && c.type === 'code',
        )
        if (!codeChild) {
          return <pre {...props} />
        }
        const codeProps = codeChild.props as { className?: string; children?: ReactNode }
        const match = /language-([\w-]+)/.exec(codeProps.className ?? '')
        const codeChildren = codeProps.children
        if (typeof codeChildren === 'string') {
          const code = codeChildren.replace(/\n$/, '')
          const lang = match?.[1]
          return lang ? (
            <CodeBlock code={code} lang={lang} isDark={isDark} />
          ) : (
            <CodeBlock code={code} isDark={isDark} />
          )
        }
        // Find-highlight has split the code block into mixed text + <mark> nodes.
        // Render plainly so the highlights survive; sacrifice shiki for this one block.
        return (
          <pre className="rounded-control border-border bg-surface-2 text-ui my-2 overflow-x-auto border p-3 font-mono leading-snug">
            <code>{codeChildren}</code>
          </pre>
        )
      },
      code({ children, ...rest }) {
        // Only inline code reaches here visibly — `pre` handles fenced cases.
        // Re-rendering of the inner `<code>` inside `pre`'s CodeBlock branch is discarded.
        return (
          <code
            {...rest}
            className="rounded-badge bg-surface py-half px-1 font-mono text-[0.92em] break-all whitespace-pre-wrap"
          >
            {children}
          </code>
        )
      },
      mark({ children, ...rest }) {
        const dataActive = (rest as { 'data-active'?: string })['data-active']
        const isActive = dataActive === 'true'
        return (
          <mark
            ref={isActive ? onActiveMatchRef : undefined}
            data-testid={isActive ? 'session-find-active-match' : undefined}
            className={`rounded-badge px-half text-inherit ${
              isActive ? 'bg-accent/35' : 'bg-accent/15'
            }`}
          >
            {children}
          </mark>
        )
      },
      // Wrapper-scrolls, table at natural width: a block table that
      // scrolls itself would crush wrappable columns to fit instead of
      // ever overflowing. Hover-reveal scrollbar via .spool-md-scroll.
      table({ node: _node, ...rest }) {
        return (
          <div className="spool-md-scroll my-2 overflow-x-auto">
            <table className="w-max border-collapse" {...rest} />
          </div>
        )
      },
      a({ children, href }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {children}
          </a>
        )
      },
    }),
    [isDark, onActiveMatchRef],
  )

  return (
    <div className="markdown-body text-reading text-foreground [&_blockquote]:border-border [&_blockquote]:text-muted [&_h1]:text-summary [&_h2]:text-session-title [&_h3]:text-reading [&_li]:my-half [&_td]:border-border [&_th]:border-border-strong cursor-text leading-relaxed break-words select-text [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_td]:max-w-[360px] [&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_th]:max-w-[360px] [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownContent)
