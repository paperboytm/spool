import type { ComponentProps } from 'react'
import { BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const markdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  a({ node: _node, href, children, ...props }) {
    const isExternal = typeof href === 'string' && /^(?:https?:)?\/\//i.test(href)

    return (
      <a
        {...props}
        href={href}
        className="text-[var(--accent)]! underline! decoration-1 underline-offset-2 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    )
  },
  table({ node: _node, ...props }) {
    return (
      <div className="mb-4 w-full overflow-x-auto rounded-md border border-[var(--border)]">
        <table {...props} />
      </div>
    )
  },
  img({ node: _node, alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        className="my-4 block h-auto max-w-full rounded-md border border-[var(--border)]"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    )
  },
}

export function SessionNote({
  markdown,
  className,
}: {
  markdown: string | null
  className?: string
}) {
  const note = markdown?.trim()
  if (!note) return null

  return (
    <section
      className={`overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]${className ? ` ${className}` : ''}`}
      aria-labelledby="session-summary-title"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--card-2)] px-4 py-3">
        <BookOpen
          className="shrink-0 text-[var(--accent)]"
          aria-hidden="true"
          size={14}
          strokeWidth={1.7}
        />
        <h2 id="session-summary-title" className="m-0 text-[13px] font-semibold leading-4 text-[var(--text)]">
          Summary
        </h2>
      </header>
      <div
        className="w-full max-w-[840px] [overflow-wrap:anywhere] p-4 text-sm leading-[1.65] text-[var(--text)] md:px-6 md:pb-6 md:pt-5
          [&>:first-child]:mt-0 [&>:last-child]:mb-0
          [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:border-b [&_h1]:border-[var(--border)] [&_h1]:pb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:leading-6 [&_h1]:tracking-[-0.01em]
          [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:border-b [&_h2]:border-[var(--border)] [&_h2]:pb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-6 [&_h2]:tracking-[-0.01em]
          [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:leading-5
          [&_h4]:mb-2 [&_h4]:mt-3 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:leading-5
          [&_h5]:mb-2 [&_h5]:mt-3 [&_h5]:text-[13px] [&_h5]:font-semibold [&_h5]:leading-5
          [&_h6]:mb-2 [&_h6]:mt-3 [&_h6]:text-[13px] [&_h6]:font-semibold [&_h6]:leading-5
          [&_p]:mb-3 [&_p]:mt-0
          [&_ul]:mb-3 [&_ul]:mt-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:mt-0 [&_ol]:list-decimal [&_ol]:pl-6 [&_li+li]:mt-1 [&_li>p]:mb-2
          [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0 [&_.task-list-item]:list-none [&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:h-3 [&_.task-list-item_input]:w-3 [&_.task-list-item_input]:accent-[var(--accent)]
          [&_blockquote]:m-0 [&_blockquote]:mb-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--border-strong)] [&_blockquote]:py-1 [&_blockquote]:pl-3 [&_blockquote]:text-[var(--muted)] [&_blockquote>p:last-child]:mb-0
          [&_code]:rounded [&_code]:border [&_code]:border-[var(--border)] [&_code]:bg-[var(--bg-sink)] [&_code]:px-1 [&_code]:py-[2px] [&_code]:font-mono [&_code]:text-[0.9em]
          [&_pre]:m-0 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-[var(--border)] [&_pre]:bg-[var(--card-2)] [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre]:[tab-size:2]
          [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[inherit]
          [&_hr]:my-5 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-[var(--border)]
          [&_table]:w-max [&_table]:min-w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:leading-5
          [&_th]:border-b [&_th]:border-[var(--border)] [&_th]:bg-[var(--bg-sink)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:align-top
          [&_td]:border-b [&_td]:border-[var(--border)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-left [&_td]:align-top [&_tbody_tr:last-child_td]:border-b-0"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {note}
        </ReactMarkdown>
      </div>
    </section>
  )
}
