// In-page Privacy Filter discovery + activation callout. Sits at the
// top of the Security page so users who land here while reviewing
// findings get nudged + walked through the full activation flow
// without having to dig through Settings.
//
// Visual rhythm matches ScanBanner / ScanResultBanner (same height,
// rounded-lg, mb-5) so when one banner is replaced by another the
// layout doesn't jump. Parent gates: hidden while ScanBanner /
// ScanResultBanner are active so transient scan signals win.
//
// State machine (UI states it can render):
//
//   - failed                       : "Couldn't download" + Retry + ×
//   - downloading                  : "Downloading X / Y · Z%" + Cancel
//   - installed + activationPending: "Activating Privacy Filter…"
//   - installed + bytesDownloaded>0: "Resume Privacy Filter" + Resume + ×
//                                    (a partial download from a prior
//                                    cancel / app kill — Settings
//                                    callers see this too via the
//                                    download card progress)
//   - not-installed default        : "Add Privacy Filter" discovery
//
// Hidden when:
//   - prefs.pfCalloutDismissed (user clicked × explicitly), AND
//     none of the operational states above apply

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X, RotateCw, AlertTriangle, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { securityApi, type PfDownloadState, type SecurityPreferences } from '../../api/security.js'
import { formatBytes } from './format.js'

const INITIAL: PfDownloadState = { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: 0 }

export default function PfCallout() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<SecurityPreferences | null>(null)
  const [state, setState] = useState<PfDownloadState>(INITIAL)
  const prevActivationPending = useRef<boolean>(false)

  useEffect(() => {
    void securityApi.getPrefs().then(setPrefs).catch(() => { /* keep null → no render */ })
    void securityApi.pfGetState().then(setState).catch(() => { /* keep INITIAL */ })
    const offPrefs = securityApi.onPrefsChanged(setPrefs)
    const offState = securityApi.onPfState(setState)
    return () => { offPrefs(); offState() }
  }, [])

  // Sonner toast when the activation cycle finishes — fired by main
  // clearing pfActivationPending after pfRuntime starts + backfill
  // kicks. The toast keeps the user informed even after the callout
  // hands off to ScanBanner.
  useEffect(() => {
    const prev = prevActivationPending.current
    const now = prefs?.pfActivationPending ?? false
    if (prev && !now && prefs?.pfEnabled) {
      toast.success(t('security.pf_callout_activated', {
        defaultValue: 'Privacy Filter enabled · re-scanning your sessions',
      }))
    }
    prevActivationPending.current = now
  }, [prefs?.pfActivationPending, prefs?.pfEnabled, t])

  if (!prefs) return null

  const startDownload = async () => {
    // Persisting the intent in prefs (not a useRef) lets it survive
    // page navigation + the activation handshake spanning multiple
    // remounts. Main's pf-coordinator subscriber reads it on
    // phase=installed and finishes the activation on our behalf.
    await securityApi.setPrefs({ pfActivationPending: true })
    if (state.phase === 'installed') {
      await securityApi.setPrefs({ pfEnabled: true })
      return
    }
    await securityApi.pfDownloadStart()
  }

  const cancelDownload = () => {
    void securityApi.setPrefs({ pfActivationPending: false })
    void securityApi.pfDownloadCancel()
  }

  const dismiss = () => {
    void securityApi.setPrefs({
      pfActivationPending: false,
      pfCalloutDismissed: true,
    })
  }

  const totalBytes = state.bytesTotal || 945_000_000
  const percent = state.bytesTotal > 0
    ? Math.min(100, Math.round((state.bytesDownloaded / state.bytesTotal) * 100))
    : 0
  const hasPartial = state.phase === 'not-installed' && state.bytesDownloaded > 0

  // ── render branches ────────────────────────────────────────────

  if (state.phase === 'downloading') {
    return (
      <Shell testId="security-pf-callout" phase="downloading">
        <IconSlot>
          <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
        </IconSlot>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
            {t('security.pf_callout_downloading', { defaultValue: 'Downloading Privacy Filter' })}
          </span>
          <ProgressLine bytesDownloaded={state.bytesDownloaded} bytesTotal={state.bytesTotal} percent={percent} />
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
        <ProgressBar percent={percent} />
      </Shell>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Shell testId="security-pf-callout" phase="failed">
        <IconSlot>
          <AlertTriangle size={13} strokeWidth={1.9} aria-hidden />
        </IconSlot>
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
          <PrimaryButton testId="security-pf-callout-retry" onClick={() => { void startDownload() }} variant="quiet">
            <RotateCw size={11} strokeWidth={1.8} aria-hidden />
            {t('common.retry', { defaultValue: 'Retry' })}
          </PrimaryButton>
          <DismissButton onClick={dismiss} />
        </div>
      </Shell>
    )
  }

  // phase === 'installed' with activation pending → Activating bridge
  // (lives between download-complete and the moment ScanBanner takes
  // over). Parent unmounts us once scan kicks in.
  if (state.phase === 'installed' && prefs.pfActivationPending) {
    return (
      <Shell testId="security-pf-callout" phase="activating">
        <IconSlot>
          <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
        </IconSlot>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
            {t('security.pf_callout_activating', { defaultValue: 'Activating Privacy Filter' })}
          </span>
          <span className="text-[11px] text-warm-faint dark:text-dark-muted">
            {t('security.pf_callout_activating_body', {
              defaultValue: 'Loading the model and queuing your sessions for a fresh scan.',
            })}
          </span>
        </div>
        <span aria-hidden />
      </Shell>
    )
  }

  // Below this point the only visible states are discovery / resume,
  // both gated by !pfEnabled (already on → nothing to discover) and
  // by !pfCalloutDismissed (user has × dismissed → leave them alone).
  if (prefs.pfEnabled) return null
  if (prefs.pfCalloutDismissed) return null

  if (hasPartial) {
    return (
      <Shell testId="security-pf-callout" phase="partial">
        <IconSlot>
          <Sparkles size={13} strokeWidth={1.9} aria-hidden />
        </IconSlot>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
            {t('security.pf_callout_partial_title', {
              defaultValue: 'Resume Privacy Filter download',
            })}
          </span>
          <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
            <span className="inline-block w-[5.5em] text-right">{formatBytes(state.bytesDownloaded)}</span>
            {' / '}
            <span className="inline-block w-[5.5em] text-right">{formatBytes(totalBytes)}</span>
            {' '}
            {t('security.pf_callout_partial_suffix', { defaultValue: 'already downloaded.' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryButton testId="security-pf-callout-resume" onClick={() => { void startDownload() }}>
            <Download size={11} strokeWidth={1.9} aria-hidden />
            {t('security.pf_callout_resume', { defaultValue: 'Resume' })}
          </PrimaryButton>
          <DismissButton onClick={dismiss} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell testId="security-pf-callout" phase={state.phase}>
      <IconSlot>
        <Sparkles size={13} strokeWidth={1.9} aria-hidden />
      </IconSlot>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
          {t('security.pf_callout_title', {
            defaultValue: 'Add Privacy Filter for richer detection',
          })}
        </span>
        <span className="text-[11px] leading-[15px] text-warm-faint dark:text-dark-muted">
          {t('security.pf_callout_body', {
            defaultValue: 'Catches obfuscated emails, phone numbers, and DOB that regex patterns miss. On-device · {{size}}.',
            size: formatBytes(totalBytes),
          })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <PrimaryButton testId="security-pf-callout-enable" onClick={() => { void startDownload() }}>
          <Download size={11} strokeWidth={1.9} aria-hidden />
          {t('security.pf_callout_enable', { defaultValue: 'Enable' })}
        </PrimaryButton>
        <DismissButton onClick={dismiss} />
      </div>
    </Shell>
  )
}

function Shell({
  testId, phase, children,
}: {
  testId: string
  phase: string
  children: React.ReactNode
}) {
  // items-start so the leading icon + trailing actions sit at the
  // title baseline rather than between two text lines. 13px icons
  // get a small mt-0.5 below so they optically baseline-align with
  // the 13px title text.
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

function IconSlot({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 text-accent dark:text-accent-dark">
      {children}
    </span>
  )
}

function ProgressLine({
  bytesDownloaded, bytesTotal, percent,
}: {
  bytesDownloaded: number
  bytesTotal: number
  percent: number
}) {
  // Each value gets its own fixed-width right-aligned slot so digit
  // count transitions (47.3 MB → 100 MB; 5% → 100%) don't reflow.
  return (
    <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums whitespace-nowrap">
      <span className="inline-block w-[5.5em] text-right">{formatBytes(bytesDownloaded)}</span>
      {' / '}
      <span className="inline-block w-[5.5em] text-right">{formatBytes(bytesTotal)}</span>
      {' · '}
      <span className="inline-block w-[3em] text-right">{percent}%</span>
    </span>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent dark:bg-accent-dark transition-[width] duration-300"
      style={{ width: `${percent}%`, gridColumn: '1 / -1' }}
      aria-hidden
    />
  )
}

function PrimaryButton({
  testId, onClick, variant = 'accent', children,
}: {
  testId: string
  onClick: () => void
  variant?: 'accent' | 'quiet'
  children: React.ReactNode
}) {
  const cls = variant === 'accent'
    ? 'border border-accent/40 dark:border-accent-dark/40 bg-accent dark:bg-accent-dark text-white dark:text-warm-bg hover:opacity-90 font-medium transition-opacity'
    : 'border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 text-warm-text dark:text-dark-text transition-colors'
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 rounded-[6px] px-2.5 text-[12px] ${cls}`}
    >
      {children}
    </button>
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
