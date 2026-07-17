import type { ComponentProps } from 'react'
import { BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import './session-note.css'

const markdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  a({ node: _node, href, children, ...props }) {
    const isExternal = typeof href === 'string' && /^(?:https?:)?\/\//i.test(href)

    return (
      <a
        {...props}
        href={href}
        {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    )
  },
  table({ node: _node, ...props }) {
    return (
      <div className="session-note__table-scroll">
        <table {...props} />
      </div>
    )
  },
  img({ node: _node, alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    )
  },
}

export function SessionNote({ markdown }: { markdown: string | null }) {
  const note = markdown?.trim()
  if (!note) return null

  return (
    <div className="session-note" role="region" aria-label="Session note">
      <div className="session-note__header">
        <BookOpen aria-hidden="true" size={14} strokeWidth={1.7} />
        <span>Session note</span>
      </div>
      <div className="session-note__body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {note}
        </ReactMarkdown>
      </div>
    </div>
  )
}
