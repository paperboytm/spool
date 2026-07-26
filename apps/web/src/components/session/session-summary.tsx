import type { ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const markdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  a({ node: _node, href, children, ...props }) {
    const isExternal = typeof href === 'string' && /^(?:https?:)?\/\//i.test(href)

    return (
      <a
        {...props}
        href={href}
        className="text-accent! focus-visible:outline-accent underline! decoration-1 underline-offset-2 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    )
  },
  table({ node: _node, ...props }) {
    return (
      <div className="rounded-control border-border mb-4 w-full overflow-x-auto border">
        <table {...props} />
      </div>
    )
  },
  img({ node: _node, alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        className="rounded-control border-border my-4 block h-auto max-w-full border"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    )
  },
}

export function SessionSummary({
  markdown,
  className,
  language,
}: {
  markdown: string | null
  className?: string
  language?: string | undefined
}) {
  const summary = markdown?.trim()
  if (!summary) return null

  return (
    <section className={className} aria-labelledby="session-summary-title">
      <h2 id="session-summary-title" className="text-summary text-foreground m-0 font-semibold">
        Summary
      </h2>
      <SessionMarkdown markdown={summary} className="mt-4" language={language} />
    </section>
  )
}

export function SessionMarkdown({
  markdown,
  className,
  language,
}: {
  markdown: string
  className?: string
  language?: string | undefined
}) {
  return (
    <div
      lang={language}
      className={`${className ?? ''} text-reading text-foreground [&_.task-list-item_input]:accent-accent [&_blockquote]:border-border-strong [&_blockquote]:text-muted [&_code]:rounded-badge [&_code]:border-border [&_code]:bg-surface [&_code]:py-half [&_h1]:border-border [&_h1]:text-section-title [&_h2]:border-border [&_h2]:text-summary [&_h3]:text-reading [&_h4]:text-ui [&_h5]:text-ui [&_h6]:text-ui [&_hr]:bg-border [&_pre]:rounded-control [&_pre]:border-border [&_pre]:bg-surface [&_pre]:text-button [&_table]:text-button [&_td]:border-border [&_th]:border-border [&_th]:bg-surface w-full leading-[1.65] [overflow-wrap:anywhere] [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0 [&_.task-list-item]:list-none [&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:h-3 [&_.task-list-item_input]:w-3 [&_blockquote]:m-0 [&_blockquote]:mb-3 [&_blockquote]:border-l-[3px] [&_blockquote]:py-1 [&_blockquote]:pl-3 [&_blockquote>p:last-child]:mb-0 [&_code]:border [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:pb-2 [&_h1]:leading-6 [&_h1]:font-semibold [&_h1]:tracking-[-0.01em] [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:leading-6 [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:leading-5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-2 [&_h4]:leading-5 [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:mb-2 [&_h5]:leading-5 [&_h5]:font-semibold [&_h6]:mt-3 [&_h6]:mb-2 [&_h6]:leading-5 [&_h6]:font-semibold [&_hr]:my-5 [&_hr]:h-px [&_hr]:border-0 [&_li+li]:mt-1 [&_li>p]:mb-2 [&_ol]:mt-0 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-0 [&_p]:mb-3 [&_pre]:m-0 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:leading-5 [&_pre]:[tab-size:2] [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[inherit] [&_table]:w-max [&_table]:min-w-full [&_table]:border-collapse [&_table]:leading-5 [&_tbody_tr:last-child_td]:border-b-0 [&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_td]:text-left [&_td]:align-top [&_th]:border-b [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:align-top [&_th]:font-semibold [&_ul]:mt-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&>:first-child]:mt-0 [&>:last-child]:mb-0`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
