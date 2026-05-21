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
      className="rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface/40 dark:bg-dark-surface/40 px-3.5 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-warm-text dark:text-dark-text">
              {t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
            </span>
            <code className="font-mono text-[10px] text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded">
              {formatBytes(state.bytesTotal || 945_000_000)}
            </code>
          </div>
          <p className="text-[11px] leading-[16px] text-warm-faint dark:text-dark-muted mb-1.5">
            {t('settings.security.detector_pf_body', {
              defaultValue: "PII patterns that regex can't catch — names, addresses, and similar.",
            })}
          </p>
          <p className="font-mono text-[10px] text-warm-faint dark:text-dark-muted/70">
            {t('settings.security.detector_pf_footer', {
              defaultValue: 'OpenAI Privacy Filter · Apache 2.0 · runs on-device',
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

          {state.phase === 'downloading' && (
            <div className="mt-2.5" data-testid="settings-pf-progress">
              <div className="h-1.5 rounded-full bg-warm-surface dark:bg-dark-surface overflow-hidden">
                <div
                  className="h-full bg-accent dark:bg-accent-dark transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-warm-faint dark:text-dark-muted tabular-nums whitespace-nowrap">
                <span className="inline-block w-[5.5em] text-right">{formatBytes(state.bytesDownloaded)}</span>
                {' / '}
                <span className="inline-block w-[5.5em] text-right">{formatBytes(state.bytesTotal)}</span>
                {' · '}
                <span className="inline-block w-[3em] text-right">{percent}%</span>
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

        <div className="shrink-0 flex items-center gap-2">
          {state.phase === 'not-installed' && (
            <button
              type="button"
              data-testid="settings-pf-download"
              disabled={busy}
              onClick={() => { void startDownload() }}
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text disabled:opacity-60 transition-colors"
            >
              <Download size={11} strokeWidth={1.8} aria-hidden />
              {t('settings.security.detector_pf_download', { defaultValue: 'Download' })}
            </button>
          )}
          {state.phase === 'downloading' && (
            <button
              type="button"
              data-testid="settings-pf-cancel"
              onClick={cancelDownload}
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
            >
              <X size={11} strokeWidth={1.8} aria-hidden />
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
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
            >
              <RotateCw size={11} strokeWidth={1.8} aria-hidden />
              {t('settings.security.detector_pf_retry', { defaultValue: 'Retry' })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
