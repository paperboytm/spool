import { BookOpen, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentInfo } from '../../preload/index.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { useHotkeys } from '../hooks/useHotkeys.js'

type ShareMethod = 'summary' | 'full'

type Props = {
  sessionUuid: string
  sessionTitle: string
  agents: AgentInfo[]
  activeAgentId: string
  onClose: () => void
  onCancelGeneration: () => void
  onOpenFull: () => void | Promise<void>
  onCreateSummary: (agent: AgentInfo) => Promise<void>
}

/**
 * Preflight shown for every session → Share action. Summary is the default
 * when an ACP agent is ready, but the full transcript always remains one
 * explicit choice away. This is also the privacy disclosure: it names the
 * user's agent and makes the agent/provider boundary clear before any model
 * receives the selected session.
 */
export default function ShareSessionDialog({
  sessionUuid,
  sessionTitle,
  agents,
  activeAgentId,
  onClose,
  onCancelGeneration,
  onOpenFull,
  onCreateSummary,
}: Props) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<ShareMethod>(agents.length > 0 ? 'summary' : 'full')
  const [selectedAgentId, setSelectedAgentId] = useState(
    agents.some((agent) => agent.id === activeAgentId) ? activeAgentId : (agents[0]?.id ?? ''),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  )

  // A fresh selected session is a fresh decision. Agent availability can
  // finish loading after the dialog appears; promote Summary to the default
  // only while there is no selected agent yet.
  useEffect(() => {
    setMethod(agents.length > 0 ? 'summary' : 'full')
    setSelectedAgentId(
      agents.some((agent) => agent.id === activeAgentId) ? activeAgentId : (agents[0]?.id ?? ''),
    )
    setBusy(false)
    setError(null)
    // `agents` intentionally does not reset a choice while this dialog is
    // already open. sessionUuid is the identity boundary for the preflight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUuid])

  useEffect(() => {
    if (selectedAgentId || agents.length === 0) return
    setSelectedAgentId(
      agents.some((agent) => agent.id === activeAgentId) ? activeAgentId : agents[0]!.id,
    )
    setMethod('summary')
  }, [agents, activeAgentId, selectedAgentId])

  const close = () => {
    if (busy) onCancelGeneration()
    else onClose()
  }
  useHotkeys({ Escape: close }, { modal: true })

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const summaryRadioRef = useRef<HTMLInputElement | null>(null)
  const fullRadioRef = useRef<HTMLInputElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const initialFocusRef = busy ? cancelRef : agents.length > 0 ? summaryRadioRef : fullRadioRef
  const trapRef = useFocusTrap<HTMLDivElement>(true, initialFocusRef)

  async function submit() {
    setError(null)
    if (method === 'full') {
      await onOpenFull()
      return
    }
    if (!selectedAgent) return

    setBusy(true)
    try {
      await onCreateSummary(selectedAgent)
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message.trim()
          ? cleanAgentError(reason.message)
          : t('shareSummary.error_generic')
      setError(message)
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-session-dialog-title"
      data-testid="share-session-dialog"
      ref={trapRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
      className="bg-warm-text/30 dark:bg-dark-bg/70 animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center px-4 backdrop-blur-[2px] duration-150"
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border flex w-full max-w-[480px] flex-col overflow-hidden rounded-[10px] border shadow-xl"
      >
        {busy && selectedAgent ? (
          <>
            <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
              <span className="bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[10px]">
                <Loader2 size={20} strokeWidth={1.6} className="animate-spin" aria-hidden />
              </span>
              <h2
                id="share-session-dialog-title"
                className="text-warm-text dark:text-dark-text text-[15px] font-semibold"
              >
                {t('shareSummary.creating_title')}
              </h2>
              <p className="text-warm-muted dark:text-dark-muted mt-2 max-w-[360px] text-[12px] leading-relaxed">
                {t('shareSummary.creating_body', { agent: selectedAgent.name })}
              </p>
              <TrustLabel agentName={selectedAgent.name} />
            </div>
            <div className="flex justify-end px-5 pb-5">
              <button
                type="button"
                ref={cancelRef}
                data-testid="share-summary-cancel-generation"
                onClick={close}
                className="text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text h-8 rounded-md px-3 text-[12px] font-medium transition-colors"
              >
                {t('shareSummary.cancel_generation')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pt-5 pb-3">
              <h2
                id="share-session-dialog-title"
                className="text-warm-text dark:text-dark-text text-[15px] font-semibold"
              >
                {t('shareSummary.title')}
              </h2>
              <p className="text-warm-muted dark:text-dark-muted mt-1 text-[12px] leading-relaxed">
                {t('shareSummary.subtitle')}
              </p>
              <p
                title={sessionTitle}
                className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted mt-3 truncate rounded-md border px-2 py-1 font-mono text-[11px]"
              >
                {sessionTitle}
              </p>
            </div>

            <div role="radiogroup" className="flex flex-col gap-2 px-5 py-2">
              <label
                data-testid="share-summary-option"
                data-selected={method === 'summary' ? '' : undefined}
                aria-disabled={agents.length === 0}
                className={`focus-within:ring-accent dark:focus-within:ring-accent-dark flex items-start gap-3 rounded-[10px] border p-4 transition-colors focus-within:ring-1 ${
                  agents.length === 0
                    ? 'border-warm-border dark:border-dark-border cursor-not-allowed opacity-55'
                    : method === 'summary'
                      ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark cursor-pointer'
                      : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2 cursor-pointer'
                }`}
              >
                <input
                  ref={summaryRadioRef}
                  type="radio"
                  name="share-method"
                  value="summary"
                  checked={method === 'summary'}
                  disabled={agents.length === 0}
                  onChange={() => setMethod('summary')}
                  className="sr-only"
                />
                <span className="text-accent dark:text-accent-dark mt-1 inline-flex h-6 w-6 flex-none items-center justify-center">
                  <Sparkles size={16} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-warm-text dark:text-dark-text block text-[13px] font-medium">
                    {selectedAgent
                      ? t('shareSummary.option_summary', { agent: selectedAgent.name })
                      : t('shareSummary.option_summary_unavailable_title')}
                  </span>
                  <span
                    data-testid="share-summary-agent-disclosure"
                    className="text-warm-muted dark:text-dark-muted mt-1 block text-[11px] leading-relaxed"
                  >
                    {selectedAgent
                      ? t('shareSummary.option_summary_body')
                      : t('shareSummary.option_summary_unavailable_body')}
                  </span>
                  {selectedAgent && <TrustLabel agentName={selectedAgent.name} />}
                </span>
              </label>

              {method === 'summary' && agents.length > 1 && selectedAgent && (
                <label className="text-warm-muted dark:text-dark-muted flex items-center gap-3 px-4 py-1 text-[11px]">
                  <span className="flex-1">{t('shareSummary.agent_label')}</span>
                  <select
                    data-testid="share-summary-agent-select"
                    value={selectedAgent.id}
                    onChange={(event) => setSelectedAgentId(event.target.value)}
                    className="bg-warm-surface dark:bg-dark-surface border-warm-border2 dark:border-dark-border2 text-warm-text dark:text-dark-text focus:border-accent dark:focus:border-accent-dark h-8 rounded-md border px-2 font-mono text-[11px] outline-none"
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label
                data-testid="share-full-option"
                data-selected={method === 'full' ? '' : undefined}
                className={`focus-within:ring-accent dark:focus-within:ring-accent-dark flex cursor-pointer items-start gap-3 rounded-[10px] border p-4 transition-colors focus-within:ring-1 ${
                  method === 'full'
                    ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
                }`}
              >
                <input
                  ref={fullRadioRef}
                  type="radio"
                  name="share-method"
                  value="full"
                  checked={method === 'full'}
                  onChange={() => setMethod('full')}
                  className="sr-only"
                />
                <span className="text-warm-muted dark:text-dark-muted mt-1 inline-flex h-6 w-6 flex-none items-center justify-center">
                  <BookOpen size={16} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-warm-text dark:text-dark-text block text-[13px] font-medium">
                    {t('shareSummary.option_full')}
                  </span>
                  <span className="text-warm-muted dark:text-dark-muted mt-1 block text-[11px] leading-relaxed">
                    {t('shareSummary.option_full_body')}
                  </span>
                </span>
              </label>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="share-summary-error"
                className="border-status-error/30 dark:border-status-error-dark/30 bg-warm-surface dark:bg-dark-surface mx-5 mt-2 rounded-md border px-3 py-2"
              >
                <p className="text-status-error dark:text-status-error-dark text-[11px] font-medium">
                  {t('shareSummary.error_title')}
                </p>
                <p className="text-warm-muted dark:text-dark-muted mt-1 text-[11px] leading-relaxed">
                  {error}
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
              <button
                type="button"
                ref={cancelRef}
                onClick={onClose}
                className="text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text h-8 rounded-md px-3 text-[12px] font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="share-session-continue"
                onClick={() => void submit()}
                disabled={method === 'summary' && !selectedAgent}
                className="bg-accent dark:bg-accent-dark inline-flex h-8 items-center gap-2 rounded-md px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {method === 'summary' ? (
                  <Sparkles size={13} strokeWidth={1.7} aria-hidden />
                ) : (
                  <BookOpen size={13} strokeWidth={1.7} aria-hidden />
                )}
                {method === 'summary'
                  ? t('shareSummary.continue_summary')
                  : t('shareSummary.continue_full')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TrustLabel({ agentName }: { agentName: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-testid="share-summary-trust-label"
      className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted mt-2 inline-flex rounded border px-2 py-1 font-mono text-[10px]"
    >
      {t('shareSummary.agent_trust', { agent: agentName })}
    </span>
  )
}

function cleanAgentError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}
