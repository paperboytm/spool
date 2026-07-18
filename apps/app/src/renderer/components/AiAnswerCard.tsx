import type { FragmentResult } from '@spool-lab/core'
import { useTranslation } from 'react-i18next'

interface ToolCallInfo {
  title: string
  status: string
  kind?: string | undefined
}

interface Props {
  answer: string
  streaming: boolean
  agentName: string
  agentId?: string
  sources: FragmentResult[]
  error?: string | null
  onResume?: () => void
  toolCalls?: Map<string, ToolCallInfo>
}

const TOOL_KIND_ICONS: Record<string, string> = {
  search: '/',
  read: '>',
  edit: '~',
  execute: '$',
  fetch: '@',
  think: '*',
}

export default function AiAnswerCard({
  answer,
  streaming,
  agentName,
  sources,
  error,
  onResume,
  toolCalls,
}: Props) {
  const { t } = useTranslation()
  if (!answer && !streaming && !error) return null

  const activeToolCalls = toolCalls
    ? [...toolCalls.values()].filter((tc) => tc.status === 'in_progress' || tc.status === 'pending')
    : []
  const completedToolCalls = toolCalls
    ? [...toolCalls.values()].filter((tc) => tc.status === 'completed' || tc.status === 'failed')
    : []

  return (
    <div
      data-testid="ai-answer-card"
      className="bg-accent-bg dark:bg-accent-bg-dark border-warm-border2 dark:border-dark-border border-l-accent dark:border-l-accent-dark mx-4 mt-3 mb-1 max-h-[60vh] overflow-y-auto rounded-[10px] border border-l-[3px] px-4 py-3.5"
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-accent dark:text-accent-dark flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] uppercase">
          <SparklesIcon />
          {t('aiAnswer.agentSays', { agent: agentName })}
        </span>
        <span className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted ml-auto rounded border px-2 py-0.5 font-mono text-[10px]">
          {t('aiAnswer.agentLabel', { agent: agentName })}
        </span>
      </div>

      {/* Active tool calls — shown while streaming */}
      {activeToolCalls.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {activeToolCalls.map((tc, i) => (
            <div
              key={i}
              className="text-warm-muted dark:text-dark-muted flex items-center gap-2 font-mono text-[11px]"
            >
              <span className="border-accent dark:border-accent-dark inline-block h-3 w-3 flex-none animate-spin rounded-full border-2 border-t-transparent" />
              <span className="text-accent dark:text-accent-dark">
                {TOOL_KIND_ICONS[tc.kind ?? ''] ?? '>'}
              </span>
              <span className="truncate">{tc.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Completed tool calls — collapsed summary */}
      {completedToolCalls.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {completedToolCalls.map((tc, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                tc.status === 'failed'
                  ? 'border-red-300 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                  : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted bg-warm-bg dark:bg-dark-bg'
              }`}
            >
              <span>{tc.status === 'failed' ? '!' : (TOOL_KIND_ICONS[tc.kind ?? ''] ?? '>')}</span>
              <span className="max-w-[200px] truncate">{tc.title}</span>
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      {error ? (
        <p
          data-testid="ai-error"
          className="text-[13px] leading-relaxed text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : answer ? (
        <p
          data-testid="ai-answer-text"
          className="text-warm-text dark:text-dark-text mb-2.5 text-[13px] leading-[1.65] whitespace-pre-wrap"
        >
          {answer}
          {streaming && (
            <span className="bg-accent dark:bg-accent-dark ml-0.5 inline-block h-4 w-1.5 animate-pulse align-text-bottom" />
          )}
        </p>
      ) : streaming ? (
        <div className="text-warm-muted dark:text-dark-muted flex items-center gap-2 py-1 text-[12px]">
          <span className="border-accent dark:border-accent-dark inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
          <span>{t('aiAnswer.searching')}</span>
        </div>
      ) : null}

      {/* Source chips */}
      {sources.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {sources.slice(0, 6).map((s, i) => (
            <span
              key={`${s.sessionUuid}-${i}`}
              className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted rounded border px-2 py-0.5 font-mono text-[11px]"
            >
              {s.source} · {s.startedAt.slice(5, 10)}
            </span>
          ))}
        </div>
      )}

      {/* CTA — only shown when a resume target is wired (i.e. agent has a
          source we persisted a session row for: claude/codex/gemini/opencode). */}
      {!streaming && answer && onResume && (
        <button
          onClick={onResume}
          className="text-accent dark:text-accent-dark border-accent dark:border-accent-dark hover:bg-accent-bg dark:hover:bg-accent-bg-dark inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-transparent px-3 py-1.5 text-xs font-medium transition-colors"
        >
          {t('aiAnswer.continueIn', { agent: agentName })}
        </button>
      )}
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  )
}
