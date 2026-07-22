// One-click share to spool.new (the v2 records share). Prepare runs
// locally and shows the honesty gate — record count, diffstat, redact
// findings — before anything leaves the machine; Share runs the same
// 3-step handshake the CLI uses. Mirrors RefreshFromSourceDialog's outer
// modal shape.

import { isDiscoverySessionSid } from '@spool-lab/session-kit'
import { Button } from '@spool-lab/ui'
import { Check, Copy, Link2, ShieldAlert, Trash2, UserRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HubSharePrepared } from '../../shared/hub-share.js'
import { useHotkeys } from '../hooks/useHotkeys.js'

interface Props {
  open: boolean
  sessionUuid: string
  /** Agent-generated or author-provided Markdown to review before sharing. */
  initialSummary?: string
  onClose: () => void
}

type DialogState =
  | { phase: 'preparing' }
  | { phase: 'ready'; prepared: HubSharePrepared; summary: string }
  | { phase: 'publishing'; prepared: HubSharePrepared; summary: string }
  | {
      phase: 'done'
      sid: string
      url: string
      publicByDefault: boolean
      profileHandle: string | null
    }
  | { phase: 'error'; message: string; unauthenticated: boolean }

export default function HubShareDialog({ open, sessionUuid, initialSummary = '', onClose }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<DialogState>({ phase: 'preparing' })
  const [copied, setCopied] = useState(false)
  const [withdrawal, setWithdrawal] = useState<'idle' | 'withdrawing' | 'withdrawn' | 'error'>(
    'idle',
  )
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  const busy = state.phase === 'preparing' || state.phase === 'publishing'
  useHotkeys({ Escape: onClose }, { active: open && !busy, modal: true })

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setWithdrawal('idle')
    setState({ phase: 'preparing' })
    let cancelled = false
    void window.spoolShare.hubSharePrepare(sessionUuid).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setState({ phase: 'ready', prepared: result.prepared, summary: initialSummary })
      } else {
        setState({ phase: 'error', message: result.error, unauthenticated: false })
      }
    })
    return () => {
      cancelled = true
    }
  }, [initialSummary, open, sessionUuid])

  const publish = useCallback(async () => {
    if (state.phase !== 'ready') return
    const publicByDefault = isDiscoverySessionSid(state.prepared.sid)
    setState({ phase: 'publishing', prepared: state.prepared, summary: state.summary })
    const result = await window.spoolShare.hubSharePublish(sessionUuid, state.summary)
    if (result.ok) {
      const me = publicByDefault ? await window.spoolShare.me().catch(() => null) : null
      setState({
        phase: 'done',
        sid: state.prepared.sid,
        url: result.url,
        publicByDefault,
        profileHandle: me?.handle ?? null,
      })
    } else {
      setState({
        phase: 'error',
        message: result.error === 'UNAUTHENTICATED' ? t('hubShare.signInHint') : result.error,
        unauthenticated: result.error === 'UNAUTHENTICATED',
      })
    }
  }, [state, sessionUuid, t])

  const withdraw = useCallback(async () => {
    if (state.phase !== 'done') return
    if (!window.confirm(t('hubShare.withdrawConfirm'))) return
    setWithdrawal('withdrawing')
    const result = await window.spoolShare.hubShareWithdraw(state.sid)
    setWithdrawal(result.ok ? 'withdrawn' : 'error')
  }, [state, t])

  if (!open) return null

  return (
    <div
      data-testid="hub-share-dialog"
      role="dialog"
      aria-modal="true"
      className="bg-warm-text/30 fixed inset-0 z-50 flex items-center justify-center dark:bg-black/40"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border w-[480px] max-w-[90vw] overflow-hidden rounded-[10px] border font-sans"
        style={{ boxShadow: '0 18px 48px rgba(10,10,10,0.18), 0 2px 6px rgba(10,10,10,0.08)' }}
      >
        <div className="px-6 pt-5 pb-5">
          <div className="text-accent dark:text-accent-dark flex items-center gap-1.5 text-[12px] font-medium">
            <Link2 size={13} strokeWidth={1.7} aria-hidden />
            <span>{t('hubShare.pretitle')}</span>
          </div>

          {state.phase === 'preparing' && (
            <p className="text-warm-muted dark:text-dark-muted mt-3 text-[13px]">
              {t('common.loading')}
            </p>
          )}

          {(state.phase === 'ready' || state.phase === 'publishing') && (
            <>
              <h2 className="text-warm-text dark:text-dark-text mt-2 text-[16px] font-semibold">
                {t(
                  isDiscoverySessionSid(state.prepared.sid)
                    ? 'hubShare.title'
                    : 'hubShare.linkOnlyTitle',
                )}
              </h2>
              <p className="text-warm-muted dark:text-dark-muted mt-1.5 text-[13px] leading-relaxed">
                {t(
                  isDiscoverySessionSid(state.prepared.sid)
                    ? 'hubShare.lead'
                    : 'hubShare.linkOnlyLead',
                  { records: state.prepared.count },
                )}
              </p>
              <p className="text-warm-faint dark:text-dark-muted mt-2 font-mono text-[11px]">
                {state.prepared.files} files{' '}
                <span className="text-status-success">+{state.prepared.adds}</span>{' '}
                <span className="text-status-error">-{state.prepared.dels}</span>
              </p>

              {state.prepared.secrets.total > 0 && (
                <div className="border-status-error/40 bg-status-error/10 mt-3 flex items-start gap-2 rounded-md border px-3 py-2">
                  <ShieldAlert
                    size={14}
                    strokeWidth={1.7}
                    className="text-status-error mt-0.5 flex-none"
                    aria-hidden
                  />
                  <p className="text-warm-text dark:text-dark-text text-[12px] leading-relaxed">
                    {t('hubShare.secretsWarning', {
                      total: state.prepared.secrets.total,
                      high: state.prepared.secrets.high,
                    })}
                  </p>
                </div>
              )}

              <label className="text-warm-muted dark:text-dark-muted mt-4 block text-[10px] font-semibold tracking-[0.08em] uppercase">
                {t('hubShare.summaryLabel')}
              </label>
              <textarea
                ref={summaryRef}
                data-testid="hub-share-summary"
                value={state.summary}
                placeholder={state.prepared.summaryPrefill}
                disabled={state.phase === 'publishing'}
                onChange={(e) => {
                  if (state.phase === 'ready') setState({ ...state, summary: e.target.value })
                }}
                rows={4}
                className="border-warm-border2 dark:border-dark-border2 bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-faint focus:border-accent dark:focus:border-accent-dark mt-1 w-full resize-y rounded-lg border px-3 py-2 text-[13px] focus:outline-none"
              />

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose} disabled={state.phase === 'publishing'}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="accent"
                  data-testid="hub-share-publish"
                  onClick={() => {
                    void publish()
                  }}
                  disabled={state.phase === 'publishing'}
                >
                  {state.phase === 'publishing'
                    ? t(
                        isDiscoverySessionSid(state.prepared.sid)
                          ? 'hubShare.publishing'
                          : 'hubShare.linkOnlyPublishing',
                      )
                    : t(
                        isDiscoverySessionSid(state.prepared.sid)
                          ? 'hubShare.publish'
                          : 'hubShare.linkOnlyPublish',
                      )}
                </Button>
              </div>
            </>
          )}

          {state.phase === 'done' && (
            <>
              <h2 className="text-warm-text dark:text-dark-text mt-2 flex items-center gap-1.5 text-[16px] font-semibold">
                <Check size={15} strokeWidth={2} className="text-status-success" aria-hidden />
                {t(
                  withdrawal === 'withdrawn'
                    ? 'hubShare.withdrawnTitle'
                    : state.publicByDefault
                      ? 'hubShare.doneTitle'
                      : 'hubShare.linkOnlyDoneTitle',
                )}
              </h2>
              <p className="text-warm-muted dark:text-dark-muted mt-1.5 text-[13px]">
                {t(
                  withdrawal === 'withdrawn'
                    ? 'hubShare.withdrawnLead'
                    : state.publicByDefault
                      ? 'hubShare.doneLead'
                      : 'hubShare.linkOnlyDoneLead',
                )}
              </p>
              {withdrawal !== 'withdrawn' && (
                <div className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface mt-3 flex items-center gap-2 rounded-lg border px-3 py-2">
                  <code
                    data-testid="hub-share-url"
                    className="text-warm-text dark:text-dark-text min-w-0 flex-1 truncate font-mono text-[12px]"
                  >
                    {state.url}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(state.url)
                      setCopied(true)
                    }}
                    className="flex-none"
                  >
                    <Copy size={11} strokeWidth={1.7} aria-hidden />
                    {copied ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
              )}
              {withdrawal === 'error' && (
                <p className="text-status-error mt-2 text-[12px]">{t('hubShare.withdrawError')}</p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {withdrawal !== 'withdrawn' && state.publicByDefault && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      window.open(profileUrl(state.url, state.profileHandle), '_blank', 'noopener')
                    }}
                  >
                    <UserRound size={12} strokeWidth={1.7} aria-hidden />
                    {t(state.profileHandle ? 'hubShare.viewProfile' : 'hubShare.setUpProfile')}
                  </Button>
                )}
                {withdrawal !== 'withdrawn' && (
                  <Button
                    variant="outline"
                    onClick={() => void withdraw()}
                    disabled={withdrawal === 'withdrawing'}
                    className="text-status-error"
                  >
                    <Trash2 size={12} strokeWidth={1.7} aria-hidden />
                    {t(withdrawal === 'withdrawing' ? 'hubShare.withdrawing' : 'hubShare.withdraw')}
                  </Button>
                )}
                <Button variant="accent" onClick={onClose}>
                  {t('hubShare.doneClose')}
                </Button>
              </div>
            </>
          )}

          {state.phase === 'error' && (
            <>
              <h2 className="text-warm-text dark:text-dark-text mt-2 text-[16px] font-semibold">
                {t('hubShare.errorTitle')}
              </h2>
              <p className="text-warm-muted dark:text-dark-muted mt-1.5 text-[13px] leading-relaxed">
                {state.message}
              </p>
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function profileUrl(sessionUrl: string, handle: string | null): string {
  return new URL(handle ? `/@${encodeURIComponent(handle)}` : '/me', sessionUrl).toString()
}
