import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, GitBranch, MessageSquare, User, Wrench } from 'lucide-react'
import type { ReplayGraph, ReplayGraphNode } from '@spool-lab/core'

type Props = {
  graph: ReplayGraph | null
  loading: boolean
}

export default function SessionReplayView({ graph, loading }: Props) {
  const { t } = useTranslation()
  const translate = (key: string) => t(key)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-faint dark:text-dark-muted">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-faint dark:text-dark-muted">
        <p className="text-sm">{t('session.replay_empty')}</p>
      </div>
    )
  }

  const toolCount = graph.nodes.filter(node => node.kind === 'tool_call').length
  const parentEdgeCount = graph.edges.filter(edge => edge.kind === 'parent').length

  return (
    <div className="flex-1 min-h-0 overflow-auto" data-testid="session-replay-view">
      <div className="max-w-[720px] px-6 pb-8">
        <div className="flex items-center gap-3 py-3 border-b border-warm-border dark:border-dark-border">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-warm-surface dark:bg-dark-surface text-accent dark:text-accent-dark">
            <GitBranch size={14} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium text-warm-text dark:text-dark-text">{t('session.replay_title')}</h3>
            <p className="mt-0.5 text-[11px] text-warm-muted dark:text-dark-muted">
              {t('session.replay_summary', {
                events: t('session.replay_events', { count: graph.nodes.length }),
                tools: t('session.replay_tools', { count: toolCount }),
                branches: t('session.replay_branches', { count: parentEdgeCount }),
              })}
            </p>
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="absolute left-[11px] top-2 bottom-2 w-px bg-warm-border dark:bg-dark-border"
          />
          <ol className="relative py-2">
            {graph.nodes.map((node, index) => (
              <ReplayNodeRow
                key={node.id}
                node={node}
                index={index}
                isLast={index === graph.nodes.length - 1}
                expanded={expandedNodeId === node.id}
                onToggle={() => setExpandedNodeId(value => value === node.id ? null : node.id)}
                t={translate}
              />
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

function ReplayNodeRow({
  node,
  index,
  isLast,
  expanded,
  onToggle,
  t,
}: {
  node: ReplayGraphNode
  index: number
  isLast: boolean
  expanded: boolean
  onToggle: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const meta = nodeMeta(node, t)
  const detail = node.event.kind === 'tool_call'
    ? node.event.toolName
    : node.event.contentText
  const label = detail.trim().length > 0
    ? node.label
    : fallbackLabel(node, t)

  return (
    <li className="relative flex gap-3 py-2" data-testid="session-replay-node">
      <div className="relative z-10 flex-none flex items-center justify-center w-6 h-6 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-muted dark:text-dark-muted">
        {meta.icon}
      </div>

      <div className={`min-w-0 flex-1 border-b border-warm-border/70 dark:border-dark-border/70 ${isLast ? 'border-b-0' : ''} pb-2`}>
        <button
          type="button"
          className="group flex w-full items-center gap-2 min-w-0 rounded-md text-left transition-colors hover:bg-warm-surface dark:hover:bg-dark-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent dark:focus-visible:ring-accent-dark"
          aria-expanded={expanded}
          aria-label={`${expanded ? t('common.collapse') : t('common.expand')} ${label}`}
          onClick={onToggle}
        >
          <span className="flex-none font-mono text-[11px] tabular-nums text-warm-faint dark:text-dark-muted">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={`flex-none inline-flex items-center h-5 px-1.5 rounded text-[10px] font-mono font-medium ${meta.badgeClass}`}>
            {meta.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-warm-text dark:text-dark-text" title={label}>
            {label}
          </span>
          <span className={`flex-none text-warm-faint dark:text-dark-muted transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
          </span>
        </button>

        {detail && !expanded && (
          <p className="mt-1 max-w-full overflow-hidden text-ellipsis text-[12px] leading-relaxed font-mono text-warm-muted dark:text-dark-muted line-clamp-2 select-text cursor-text">
            {detail}
          </p>
        )}

        {expanded && (
          <ReplayNodeDetail node={node} detail={detail} t={t} />
        )}
      </div>
    </li>
  )
}

function ReplayNodeDetail({
  node,
  detail,
  t,
}: {
  node: ReplayGraphNode
  detail: string
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const detailLabel = node.event.kind === 'tool_call'
    ? t('session.replay_detail_tool')
    : t('session.replay_detail_content')

  return (
    <div className="mt-2 border-t border-warm-border/70 dark:border-dark-border/70 pt-2" data-testid="session-replay-node-detail">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-warm-muted dark:text-dark-muted">
        <DetailMeta label={t('session.replay_detail_time')} value={formatTimestamp(node.timestamp)} />
        {node.event.parentEventId && (
          <DetailMeta label={t('session.replay_detail_parent')} value={shortEventId(node.event.parentEventId)} />
        )}
        <DetailMeta label={t('session.replay_detail_id')} value={shortEventId(node.eventId)} />
      </div>
      {detail.trim().length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-warm-faint dark:text-dark-muted">
            {detailLabel}
          </div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface p-2 text-[12px] leading-relaxed font-mono text-warm-text dark:text-dark-text">
            {detail}
          </pre>
        </div>
      )}
    </div>
  )
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-warm-faint dark:text-dark-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-warm-muted dark:text-dark-muted">{value}</span>
    </span>
  )
}

function nodeMeta(node: ReplayGraphNode, t: (key: string) => string): {
  label: string
  icon: ReactNode
  badgeClass: string
} {
  if (node.kind === 'user_prompt') {
    return {
      label: t('session.replay_badge_user'),
      icon: <User size={14} strokeWidth={1.5} aria-hidden />,
      badgeClass: 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted',
    }
  }
  if (node.kind === 'assistant_response') {
    return {
      label: t('session.replay_badge_ai'),
      icon: <Bot size={14} strokeWidth={1.5} aria-hidden />,
      badgeClass: 'bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark',
    }
  }
  if (node.kind === 'tool_call') {
    return {
      label: t('session.replay_badge_tool'),
      icon: <Wrench size={14} strokeWidth={1.5} aria-hidden />,
      badgeClass: 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted',
    }
  }
  return {
    label: t('session.replay_badge_note'),
    icon: <MessageSquare size={14} strokeWidth={1.5} aria-hidden />,
    badgeClass: 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted',
  }
}

function fallbackLabel(node: ReplayGraphNode, t: (key: string) => string): string {
  if (node.kind === 'user_prompt') return t('session.replay_fallback_user')
  if (node.kind === 'assistant_response') return t('session.replay_fallback_assistant')
  if (node.event.kind === 'tool_call') return node.event.toolName
  return t('session.replay_fallback_system')
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function shortEventId(value: string): string {
  const normalized = value.replace(/^message:/, '')
  if (normalized.length <= 24) return normalized
  return `${normalized.slice(0, 10)}...${normalized.slice(-10)}`
}
