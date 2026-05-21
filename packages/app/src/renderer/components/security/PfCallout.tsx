// In-page Privacy Filter discovery callout. Sits at the top of the
// Security page when the model isn't installed + enabled yet, so users
// who land here while reviewing findings get nudged to upgrade
// detection without having to dig through Settings.
//
// Visual rhythm matches ScanBanner / ScanResultBanner (same height,
// rounded-lg, mb-5) so when one banner is replaced by another the
// layout doesn't jump. The parent page decides whether to mount this
// component — see `hidden` prop usage in SecurityPage.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X, RotateCw, AlertTriangle, Download, Loader2 } from 'lucide-react'
import { securityApi, type PfDownloadState, type SecurityPreferences } from '../../api/security.js'
import { formatBytes } from './format.js'

const INITIAL: PfDownloadState = { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: 0 }

export default function PfCallout() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<SecurityPreferences | null>(null)
  const [state, setState] = useState<PfDownloadState>(INITIAL)
  const [busy, setBusy] = useState(false)
  // Tracks whether THIS callout instance kicked off the download. We
  // only auto-flip pfEnabled on install if the user opted in here —
  // a download started from Settings should leave the toggle alone.
  const intendingToEnable = useRef(false)

  useEffect(() => {
    void securityApi.getPrefs().then(setPrefs).catch(() => { /* keep null → no render */ })
    void securityApi.pfGetState().then(setState).catch(() => { /* keep INITIAL */ })
    const offPrefs = securityApi.onPrefsChanged(setPrefs)
    const offState = securityApi.onPfState(setState)
    return () => { offPrefs(); offState() }
  }, [])

  // Auto-enable after the download we started completes. We don't
  // need to clear `intendingToEnable` afterwards — setPrefs flipping
  // pfEnabled also auto-sets pfCalloutDismissed, which unmounts us.
  useEffect(() => {
    if (state.phase !== 'installed') return
    if (!intendingToEnable.current) return
    if (prefs?.pfEnabled) return
    void securityApi.setPrefs({ pfEnabled: true })
  }, [state.phase, prefs?.pfEnabled])

  if (!prefs) return null
  if (prefs.pfCalloutDismissed) return null
  if (prefs.pfEnabled) return null

  const startDownload = async () => {
    intendingToEnable.current = true
    if (state.phase === 'installed') {
      await securityApi.setPrefs({ pfEnabled: true })
      return
    }
    setBusy(true)
    try { await securityApi.pfDownloadStart() } finally { setBusy(false) }
  }

  const cancelDownload = () => {
    intendingToEnable.current = false
    void securityApi.pfDownloadCancel()
  }

  const dismiss = () => {
    intendingToEnable.current = false
    void securityApi.setPrefs({ pfCalloutDismissed: true })
  }

  const totalBytes = state.bytesTotal || 945_000_000
  const percent = state.bytesTotal > 0
    ? Math.min(100, Math.round((state.bytesDownloaded / state.bytesTotal) * 100))
    : 0

  if (state.phase === 'downloading') {
    return (
      <Shell testId="security-pf-callout" phase="downloading">
        <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 text-accent dark:text-accent-dark">
          <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
        </span>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
            {t('security.pf_callout_downloading', { defaultValue: 'Downloading Privacy Filter' })}
          </span>
          <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
            {formatBytes(state.bytesDownloaded)} / {formatBytes(state.bytesTotal)} · {percent}%
          </span>
        </div>
        <button
          type="button"
          data-testid="security-pf-callout-cancel"
          onClick={cancelDownload}
          className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
        >
          <X size={11} strokeWidth={1.8} aria-hidden />
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </button>
        <Progress percent={percent} />
      </Shell>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Shell testId="security-pf-callout" phase="failed">
        <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 text-accent dark:text-accent-dark">
          <AlertTriangle size={13} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
            {t('security.pf_callout_failed', { defaultValue: "Couldn't download Privacy Filter" })}
          </span>
          {state.error && (
            <span className="text-[11px] text-warm-faint dark:text-dark-muted truncate">
              {state.error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="security-pf-callout-retry"
            onClick={() => { void startDownload() }}
            className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
          >
            <RotateCw size={11} strokeWidth={1.8} aria-hidden />
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
          <DismissButton onClick={dismiss} />
        </div>
      </Shell>
    )
  }

  // not-installed (or installed but user hasn't enabled yet — both
  // surface the same primary CTA).
  return (
    <Shell testId="security-pf-callout" phase={state.phase}>
      <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 text-accent dark:text-accent-dark">
        <Sparkles size={13} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
          {t('security.pf_callout_title', {
            defaultValue: 'Add Privacy Filter for richer detection',
          })}
        </span>
        <span className="text-[11px] leading-[15px] text-warm-faint dark:text-dark-muted">
          {t('security.pf_callout_body', {
            defaultValue: "Catches names, addresses, and other patterns regex misses. On-device · {{size}}.",
            size: formatBytes(totalBytes),
          })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="security-pf-callout-enable"
          disabled={busy}
          onClick={() => { void startDownload() }}
          className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-accent/40 dark:border-accent-dark/40 bg-accent dark:bg-accent-dark text-white dark:text-warm-bg hover:opacity-90 px-2.5 text-[12px] font-medium disabled:opacity-60 transition-opacity"
        >
          {state.phase === 'installed'
            ? t('security.pf_callout_enable', { defaultValue: 'Enable' })
            : <>
                <Download size={11} strokeWidth={1.9} aria-hidden />
                {t('security.pf_callout_enable', { defaultValue: 'Enable' })}
              </>}
        </button>
        <DismissButton onClick={dismiss} />
      </div>
    </Shell>
  )
}

function Shell({
  testId, phase, children,
}: {
  testId: string
  phase: PfDownloadState['phase']
  children: React.ReactNode
}) {
  // items-start (not items-center) so the leading icon + trailing
  // actions sit at the TITLE baseline rather than the midpoint of
  // the 2-line title+body block. A 13px icon centered between two
  // lines visually floats — top-aligned with a tiny pt offset
  // anchors it to the title, matching shadcn / Notion / GitHub
  // inline alerts.
  return (
    <div
      data-testid={testId}
      data-phase={phase}
      className="relative grid items-start gap-3 mb-5 px-4 py-2.5 rounded-lg bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border overflow-hidden"
      style={{ gridTemplateColumns: 'auto 1fr auto' }}
    >
      {children}
    </div>
  )
}

function Progress({ percent }: { percent: number }) {
  return (
    <div
      className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent dark:bg-accent-dark transition-[width] duration-300"
      style={{ width: `${percent}%`, gridColumn: '1 / -1' }}
      aria-hidden
    />
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid="security-pf-callout-dismiss"
      onClick={onClick}
      aria-label={t('common.close', { defaultValue: 'Close' })}
      className="inline-flex items-center justify-center w-6 h-6 rounded-[5px] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
    >
      <X size={12} strokeWidth={1.8} aria-hidden />
    </button>
  )
}
