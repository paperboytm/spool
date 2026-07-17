// One-click share to spool.pro (the v2 records share). Prepare runs
// locally and shows the honesty gate — record count, diffstat, redact
// findings — before anything leaves the machine; publish runs the same
// 3-step handshake the CLI uses. Mirrors RefreshFromSourceDialog's outer
// modal shape.

import { Check, Copy, Globe, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from '../hooks/useHotkeys.js'
import type { HubSharePrepared } from '../../shared/hub-share.js'

interface Props {
  open: boolean
  sessionUuid: string
  onClose: () => void
}

type DialogState =
  | { phase: 'preparing' }
  | { phase: 'ready'; prepared: HubSharePrepared; note: string }
  | { phase: 'publishing'; prepared: HubSharePrepared; note: string }
  | { phase: 'done'; url: string }
  | { phase: 'error'; message: string; unauthenticated: boolean }

export default function HubShareDialog({ open, sessionUuid, onClose }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<DialogState>({ phase: 'preparing' })
  const [copied, setCopied] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const busy = state.phase === 'preparing' || state.phase === 'publishing'
  useHotkeys({ Escape: onClose }, { active: open && !busy, modal: true })

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setState({ phase: 'preparing' })
    let cancelled = false
    void window.spoolShare.hubSharePrepare(sessionUuid).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setState({ phase: 'ready', prepared: result.prepared, note: '' })
      } else {
        setState({ phase: 'error', message: result.error, unauthenticated: false })
      }
    })
    return () => { cancelled = true }
  }, [open, sessionUuid])

  const publish = useCallback(async () => {
    if (state.phase !== 'ready') return
    setState({ phase: 'publishing', prepared: state.prepared, note: state.note })
    const result = await window.spoolShare.hubSharePublish(sessionUuid, state.note)
    if (result.ok) {
      setState({ phase: 'done', url: result.url })
    } else {
      setState({
        phase: 'error',
        message: result.error === 'UNAUTHENTICATED' ? t('hubShare.signInHint') : result.error,
        unauthenticated: result.error === 'UNAUTHENTICATED',
      })
    }
  }, [state, sessionUuid, t])

  if (!open) return null

  return (
    <div
      data-testid="hub-share-dialog"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-warm-text/30 dark:bg-black/40"
      onClick={(e) => { if (!busy && e.target === e.currentTarget) onClose() }}
    >
      <div
        className="font-sans bg-warm-bg dark:bg-dark-bg rounded-[10px] w-[480px] max-w-[90vw] overflow-hidden border border-warm-border dark:border-dark-border"
        style={{ boxShadow: '0 18px 48px rgba(28,28,24,0.18), 0 2px 6px rgba(28,28,24,0.08)' }}
      >
        <div className="px-6 pt-5 pb-5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent dark:text-accent-dark">
            <Globe size={13} strokeWidth={1.7} aria-hidden />
            <span>{t('hubShare.pretitle')}</span>
          </div>

          {state.phase === 'preparing' && (
            <p className="mt-3 text-[13px] text-warm-muted dark:text-dark-muted">{t('common.loading')}</p>
          )}

          {(state.phase === 'ready' || state.phase === 'publishing') && (
            <>
              <h2 className="mt-2 text-[16px] font-semibold text-warm-text dark:text-dark-text">
                {t('hubShare.title')}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-warm-muted dark:text-dark-muted">
                {t('hubShare.lead', { records: state.prepared.count })}
              </p>
              <p className="mt-2 text-[11px] font-mono text-warm-faint dark:text-dark-muted">
                {state.prepared.files} files{' '}
                <span className="text-status-success">+{state.prepared.adds}</span>{' '}
                <span className="text-status-error">-{state.prepared.dels}</span>
              </p>

              {state.prepared.secrets.total > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2">
                  <ShieldAlert size={14} strokeWidth={1.7} className="flex-none mt-0.5 text-status-error" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-warm-text dark:text-dark-text">
                    {t('hubShare.secretsWarning', {
                      total: state.prepared.secrets.total,
                      high: state.prepared.secrets.high,
                    })}
                  </p>
                </div>
              )}

              <label className="mt-4 block text-[10px] font-semibold tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted">
                {t('hubShare.noteLabel')}
              </label>
              <textarea
                ref={noteRef}
                data-testid="hub-share-note"
                value={state.note}
                placeholder={state.prepared.notePrefill}
                disabled={state.phase === 'publishing'}
                onChange={(e) => {
                  if (state.phase === 'ready') setState({ ...state, note: e.target.value })
                }}
                rows={4}
                className="mt-1 w-full resize-y rounded-lg border border-warm-border2 dark:border-dark-border2 bg-warm-surface dark:bg-dark-surface px-3 py-2 text-[13px] text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-faint focus:outline-none focus:border-accent dark:focus:border-accent-dark"
              />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={state.phase === 'publishing'}
                  className="h-8 px-3 rounded-md text-[13px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors disabled:opacity-60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="hub-share-publish"
                  onClick={() => { void publish() }}
                  disabled={state.phase === 'publishing'}
                  className="h-8 px-4 rounded-md text-[13px] font-medium bg-accent dark:bg-accent-dark text-white dark:text-[#1A1206] hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {state.phase === 'publishing' ? t('hubShare.publishing') : t('hubShare.publish')}
                </button>
              </div>
            </>
          )}

          {state.phase === 'done' && (
            <>
              <h2 className="mt-2 flex items-center gap-1.5 text-[16px] font-semibold text-warm-text dark:text-dark-text">
                <Check size={15} strokeWidth={2} className="text-status-success" aria-hidden />
                {t('hubShare.doneTitle')}
              </h2>
              <p className="mt-1.5 text-[13px] text-warm-muted dark:text-dark-muted">{t('hubShare.doneLead')}</p>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 py-2">
                <code data-testid="hub-share-url" className="flex-1 min-w-0 truncate font-mono text-[12px] text-warm-text dark:text-dark-text">
                  {state.url}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.url)
                    setCopied(true)
                  }}
                  className="flex-none inline-flex items-center gap-1 h-6 px-2 rounded border border-accent dark:border-accent-dark text-[11px] text-accent dark:text-accent-dark hover:bg-accent/10 dark:hover:bg-accent-dark/10 transition-colors"
                >
                  <Copy size={11} strokeWidth={1.7} aria-hidden />
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-4 rounded-md text-[13px] font-medium bg-accent dark:bg-accent-dark text-white dark:text-[#1A1206] hover:opacity-90 transition-opacity"
                >
                  {t('hubShare.doneClose')}
                </button>
              </div>
            </>
          )}

          {state.phase === 'error' && (
            <>
              <h2 className="mt-2 text-[16px] font-semibold text-warm-text dark:text-dark-text">
                {t('hubShare.errorTitle')}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-warm-muted dark:text-dark-muted">
                {state.message}
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-3 rounded-md text-[13px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
