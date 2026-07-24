import {
  isSessionProvider,
  SESSION_PROVIDER_LABELS,
  type SessionProvider,
} from '@spool-lab/session-kit'
import { Avatar, Badge, ListRow, type BadgeVariant } from '@spool-lab/ui'
import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'

import { relativeDate } from '../lib/dates'

import '../styles/session-feed.css'

export interface SessionFeedAuthor {
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface SessionFeedRowProps {
  as?: 'article' | 'div' | 'li'
  sid: string
  title: string
  summary: string | null
  author: SessionFeedAuthor
  timestamp: number
  timestampVerb: 'published' | 'updated'
  metadata?: ReactNode
  lineage?: ReactNode
  trailing?: ReactNode
  className?: string
}

function authorLabel(author: SessionFeedAuthor): string {
  if (author.handle) return `@${author.handle}`
  return author.displayName ?? 'Spool author'
}

function inlineRelativeDate(timestamp: number): string {
  const label = relativeDate(timestamp)
  if (label === 'Today') return 'today'
  if (label === 'Yesterday') return 'yesterday'
  if (label === 'Just now') return 'just now'
  return label
}

export function SessionFeedRow({
  as = 'article',
  sid,
  title,
  summary,
  author,
  timestamp,
  timestampVerb,
  metadata,
  lineage,
  trailing,
  className,
}: SessionFeedRowProps) {
  const profileHref = author.handle ? `/@${encodeURIComponent(author.handle)}` : null
  const avatarName = author.displayName ?? author.handle ?? 'Spool author'
  const rowClassName = ['session-feed-row', className].filter(Boolean).join(' ')

  return (
    <ListRow
      as={as}
      className={rowClassName}
      leading={<Avatar src={author.avatarUrl} name={avatarName} alt="" size="md" />}
      attribution={
        <>
          {profileHref ? (
            <a href={profileHref} title={authorLabel(author)}>
              {authorLabel(author)}
            </a>
          ) : (
            <span title={authorLabel(author)}>{authorLabel(author)}</span>
          )}
          <span aria-hidden="true">·</span>
          <time
            dateTime={new Date(timestamp).toISOString()}
            title={new Date(timestamp).toLocaleString()}
          >
            {timestampVerb} {inlineRelativeDate(timestamp)}
          </time>
        </>
      }
      title={
        <h2>
          <a href={`/session/${encodeURIComponent(sid)}`}>{title}</a>
        </h2>
      }
      summary={
        summary ? summary : <span className="session-feed-summary is-missing">No Summary yet.</span>
      }
      metadata={metadata}
      lineage={lineage}
      trailing={trailing}
    />
  )
}

export function SessionSourceBadge({ provider }: { provider: string }) {
  const knownProvider: SessionProvider | null = isSessionProvider(provider) ? provider : null
  const label = knownProvider ? SESSION_PROVIDER_LABELS[knownProvider] : provider
  const variant: BadgeVariant = knownProvider ? `source-${knownProvider}` : 'neutral'
  const className = ['session-source', knownProvider ? `is-${knownProvider}` : 'is-unknown'].join(
    ' ',
  )

  return (
    <Badge className={className} variant={variant}>
      <Bot size={13} strokeWidth={1.7} aria-hidden="true" />
      {label}
    </Badge>
  )
}

export function SessionFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="session-feed-skeleton-list" aria-label="Loading Sessions" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="session-feed-skeleton-row" key={index} aria-hidden="true">
          <span className="session-feed-skeleton-avatar" />
          <span className="session-feed-skeleton-copy">
            <span className="session-feed-skeleton-line is-meta" />
            <span className="session-feed-skeleton-line is-title" />
            <span className="session-feed-skeleton-line" />
            <span className="session-feed-skeleton-line is-short" />
            <span className="session-feed-skeleton-line is-evidence" />
          </span>
        </div>
      ))}
    </div>
  )
}
