import { useTranslation } from 'react-i18next'
import type { FragmentResult } from '@spool-lab/core'

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

export default function AiAnswerCard({ answer, streaming, agentName, sources, error, onResume, toolCalls }: Props) {
  const { t } = useTranslation()
  if (!answer && !streaming && !error) return null

  const activeToolCalls = toolCalls ? [...toolCalls.values()].filter(tc => tc.status === 'in_progress' || tc.status === 'pending') : []
  const completedToolCalls = toolCalls ? [...toolCalls.values()].filter(tc => tc.status === 'completed' || tc.status === 'failed') : []

  return (
    <div data-testid="ai-answer-card" className="mx-4 mt-3 mb-1 bg-accent-bg dark:bg-accent-bg-dark border border-warm-border2 dark:border-dark-border rounded-[10px] border-l-[3px] border-l-accent dark:border-l-accent-dark px-4 py-3.5 overflow-y-auto max-h-[60vh]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent dark:text-accent-dark tracking-[0.05em] uppercase">
          <SparklesIcon />
          {t('aiAnswer.agentSays', { agent: agentName })}
        </span>
        <span className="ml-auto text-[10px] font-mono bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border px-2 py-0.5 rounded text-warm-muted dark:text-dark-muted">
          {t('aiAnswer.agentLabel', { agent: agentName })}
        </span>
      </div>

      {/* Active tool calls — shown while streaming */}
      {activeToolCalls.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {activeToolCalls.map((tc, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-warm-muted dark:text-dark-muted">
              <span className="inline-block w-3 h-3 border-2 border-accent dark:border-accent-dark border-t-transparent rounded-full animate-spin flex-none" />
              <span className="text-accent dark:text-accent-dark">{TOOL_KIND_ICONS[tc.kind ?? ''] ?? '>'}</span>
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
              className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                tc.status === 'failed'
                  ? 'border-red-300 dark:border-red-800 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                  : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted bg-warm-bg dark:bg-dark-bg'
              }`}
            >
              <span>{tc.status === 'failed' ? '!' : TOOL_KIND_ICONS[tc.kind ?? ''] ?? '>'}</span>
              <span className="truncate max-w-[200px]">{tc.title}</span>
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      {error ? (
        <p data-testid="ai-error" className="text-[13px] text-red-600 dark:text-red-400 leading-relaxed">{error}</p>
      ) : answer ? (
        <p data-testid="ai-answer-text" className="text-[13px] text-warm-text dark:text-dark-text leading-[1.65] mb-2.5 whitespace-pre-wrap">
          {answer}
          {streaming && <span className="inline-block w-1.5 h-4 bg-accent dark:bg-accent-dark ml-0.5 animate-pulse align-text-bottom" />}
        </p>
      ) : streaming ? (
        <div className="flex items-center gap-2 text-[12px] text-warm-muted dark:text-dark-muted py-1">
          <span className="inline-block w-3.5 h-3.5 border-2 border-accent dark:border-accent-dark border-t-transparent rounded-full animate-spin" />
          <span>{t('aiAnswer.searching')}</span>
        </div>
      ) : null}

      {/* Source chips */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {sources.slice(0, 6).map((s, i) => (
            <span
              key={`${s.sessionUuid}-${i}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted"
            >
              {s.source} · {s.startedAt.slice(5, 10)}
            </span>
          ))}
        </div>
      )}

      {/* CTA — only shown when a resume target is wired (i.e. agent has a
          source we persisted a session row for: claude/codex/gemini/antigravity/opencode). */}
      {!streaming && answer && onResume && (
        <button
          onClick={onResume}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent dark:text-accent-dark bg-transparent border border-accent dark:border-accent-dark rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent-bg dark:hover:bg-accent-bg-dark transition-colors"
        >
          {t('aiAnswer.continueIn', { agent: agentName })}
        </button>
      )}
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
    </svg>
  )
}
