// Privacy Filter ML download / status card. Visual rhythm matches the
// Pattern matching card directly above it in SecurityPane.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X, RotateCw, AlertTriangle } from 'lucide-react'
import { securityApi, type PfDownloadState, type PfRuntimeInfo, type SecurityPreferences } from '../../../api/security.js'
import { formatBytes } from '../../security/format.js'
import Toggle from '../../Toggle.js'

const INITIAL: PfDownloadState = { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: 0 }

export default function PfDownloadCard() {
  const { t } = useTranslation()
  const [state, setState] = useState<PfDownloadState>(INITIAL)
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<SecurityPreferences | null>(null)
  const [runtime, setRuntime] = useState<PfRuntimeInfo | null>(null)

  useEffect(() => {
    void securityApi.pfGetState().then(setState).catch(() => setState(INITIAL))
    void securityApi.getPrefs().then(setPrefs).catch(() => setPrefs(null))
    const offState = securityApi.onPfState(setState)
    const offPrefs = securityApi.onPrefsChanged(setPrefs)
    return () => { offState(); offPrefs() }
  }, [])

  // Poll runtime info while pfEnabled is on. ModelHost handshake can
  // take up to 90 s on cold WASM; 2 s lets the badge update without
  // spamming the IPC.
  useEffect(() => {
    if (!prefs?.pfEnabled || state.phase !== 'installed') {
      setRuntime(null)
      return
    }
    let cancelled = false
    const tick = () => {
      securityApi.pfGetRuntimeInfo()
        .catch(() => null)
        .then((info) => { if (!cancelled) setRuntime(info) })
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [prefs?.pfEnabled, state.phase])

  const startDownload = async () => {
    setBusy(true)
    try { await securityApi.pfDownloadStart() } finally { setBusy(false) }
  }
  const cancelDownload = () => { void securityApi.pfDownloadCancel() }
  const togglePf = async (next: boolean) => {
    if (!prefs) return
    setPrefs({ ...prefs, pfEnabled: next })
    const saved = await securityApi.setPrefs({ pfEnabled: next })
    setPrefs(saved)
  }

  const percent = state.bytesTotal > 0
    ? Math.min(100, Math.round((state.bytesDownloaded / state.bytesTotal) * 100))
    : 0

  return (
    <div
      data-testid="settings-detector-pf"
      data-phase={state.phase}
      className="relative rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface/40 dark:bg-dark-surface/40 px-3.5 py-3"
    >
      <div className="min-w-0">
        {/* Title row reserves right-space so the absolute-positioned
         *  action (Download / Cancel / Toggle / Retry) doesn't run
         *  under "Privacy Filter · 945 MB". Body + footer below get
         *  full card width — was wrapping into 2-3 lines when the
         *  button competed for horizontal space in a flex row. */}
        <div className="flex items-center gap-2 mb-1 pr-14">
            <span className="text-xs font-medium text-warm-text dark:text-dark-text">
              {t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
            </span>
            <code className="font-mono text-[10px] text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded">
              {formatBytes(state.bytesTotal || 945_000_000)}
            </code>
          </div>
          <p className="text-[11px] leading-[16px] text-warm-faint dark:text-dark-muted mb-1.5">
            {t('settings.security.detector_pf_body', {
              defaultValue: 'Fills regex blind spots: emails, phones, DOB, novel secrets. Names / addresses / URLs / accounts disabled.',
            })}
          </p>
          <p className="font-mono text-[10px] text-warm-faint dark:text-dark-muted/70">
            {t('settings.security.detector_pf_footer', {
              defaultValue: 'OpenAI · Apache 2.0 · ~5-30s per session · on-device',
            })}
          </p>

          {runtime?.status === 'ready' && runtime.runtime && (
            <p
              data-testid="settings-pf-runtime"
              data-runtime={runtime.runtime}
              className="mt-1.5 font-mono text-[10px] text-accent dark:text-accent-dark"
            >
              {runtime.runtime === 'webgpu'
                ? t('settings.security.detector_pf_runtime_webgpu', { defaultValue: 'WebGPU' })
                : t('settings.security.detector_pf_runtime_wasm', { defaultValue: 'WASM (CPU)' })}
              {runtime.adapterLabel ? ` · ${runtime.adapterLabel}` : ''}
            </p>
          )}

          {(state.phase === 'downloading' || ((state.phase === 'not-installed' || state.phase === 'failed') && state.bytesDownloaded > 0)) && (
            <div className="mt-2.5" data-testid="settings-pf-progress">
              <div className="h-1.5 rounded-full bg-warm-surface dark:bg-dark-surface overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-200 ease-out ${
                    state.phase === 'downloading'
                      ? 'bg-accent dark:bg-accent-dark'
                      // Cancelled or failed mid-flight — show the
                      // resume point in a dimmer tone so the user
                      // sees how far they got without confusing it
                      // for an active download.
                      : 'bg-accent/50 dark:bg-accent-dark/50'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {/* tabular-nums keeps digit POSITIONS stable inside each
               *  value; explicit widths are unnecessary because the
               *  whole line uses mono + nowrap, so the only layout
               *  shift would be on a char-count flip (e.g. 99 → 100),
               *  rare enough to not justify the visible gap. */}
              <p className="mt-1 font-mono text-[10px] text-warm-faint dark:text-dark-muted tabular-nums whitespace-nowrap">
                {formatBytes(state.bytesDownloaded)}
                {' / '}
                {formatBytes(state.bytesTotal)}
                {' · '}
                {percent}%
              </p>
            </div>
          )}

          {state.phase === 'failed' && state.error && (
            <p className="mt-2 text-[11px] text-accent dark:text-accent-dark flex items-center gap-1.5">
              <AlertTriangle size={11} strokeWidth={1.8} aria-hidden />
              {state.error}
            </p>
          )}
      </div>

      <div className="absolute top-3 right-3.5 flex items-center gap-2">
          {state.phase === 'not-installed' && (
            <button
              type="button"
              data-testid="settings-pf-download"
              disabled={busy}
              onClick={() => { void startDownload() }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent dark:text-accent-dark hover:underline underline-offset-2 disabled:opacity-60 transition-colors"
            >
              <Download size={10} strokeWidth={1.8} aria-hidden />
              {state.bytesDownloaded > 0
                ? t('settings.security.detector_pf_resume', { defaultValue: 'Resume' })
                : t('settings.security.detector_pf_download', { defaultValue: 'Download' })}
            </button>
          )}
          {state.phase === 'downloading' && (
            <button
              type="button"
              data-testid="settings-pf-cancel"
              onClick={cancelDownload}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent dark:text-accent-dark hover:underline underline-offset-2 transition-colors"
            >
              <X size={10} strokeWidth={1.8} aria-hidden />
              {t('settings.security.detector_pf_cancel', { defaultValue: 'Cancel' })}
            </button>
          )}
          {state.phase === 'installed' && (
            <Toggle
              checked={prefs?.pfEnabled ?? false}
              onChange={(v) => { void togglePf(v) }}
              ariaLabel={t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
              testId="settings-pf-toggle"
            />
          )}
          {state.phase === 'failed' && (
            <button
              type="button"
              data-testid="settings-pf-retry"
              onClick={() => { void startDownload() }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent dark:text-accent-dark hover:underline underline-offset-2 transition-colors"
            >
              <RotateCw size={10} strokeWidth={1.8} aria-hidden />
              {t('settings.security.detector_pf_retry', { defaultValue: 'Retry' })}
            </button>
          )}
      </div>
    </div>
  )
}
