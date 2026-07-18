// Privacy Filter ML download / status card. Visual rhythm matches the
// Pattern matching card directly above it in SecurityPane.

import { Download, X, RotateCw, AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { securityApi, type PfDownloadState, type PfRuntimeInfo } from '../../../api/security.js'
import {
  useCachedSecurityPrefs,
  primeSecurityPrefsCache,
  patchSecurityPrefs,
} from '../../../api/securityPrefsCache.js'
import { formatBytes } from '../../security/format.js'
import Toggle from '../../Toggle.js'

const INITIAL: PfDownloadState = { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: 0 }

export default function PfDownloadCard() {
  const { t } = useTranslation()
  const [state, setState] = useState<PfDownloadState>(INITIAL)
  const [busy, setBusy] = useState(false)
  const prefs = useCachedSecurityPrefs()
  const [runtime, setRuntime] = useState<PfRuntimeInfo | null>(null)

  useEffect(() => {
    void securityApi
      .pfGetState()
      .then(setState)
      .catch(() => setState(INITIAL))
    if (prefs === null) {
      void primeSecurityPrefsCache()
    }
    const offState = securityApi.onPfState(setState)
    return () => {
      offState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      void securityApi
        .pfGetRuntimeInfo()
        .catch(() => null)
        .then((info) => {
          if (!cancelled) setRuntime(info)
        })
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [prefs?.pfEnabled, state.phase])

  const startDownload = async () => {
    setBusy(true)
    try {
      await securityApi.pfDownloadStart()
    } finally {
      setBusy(false)
    }
  }
  const cancelDownload = () => {
    void securityApi.pfDownloadCancel()
  }
  const togglePf = async (next: boolean) => {
    if (!prefs) return
    await patchSecurityPrefs({ pfEnabled: next })
  }

  const percent =
    state.bytesTotal > 0
      ? Math.min(100, Math.round((state.bytesDownloaded / state.bytesTotal) * 100))
      : 0

  return (
    <div
      data-testid="settings-detector-pf"
      data-phase={state.phase}
      className="border-warm-border dark:border-dark-border bg-warm-surface/40 dark:bg-dark-surface/40 relative rounded-[8px] border px-3.5 py-3"
    >
      <div className="min-w-0">
        {/* Title row reserves right-space so the absolute-positioned
         *  action (Download / Cancel / Toggle / Retry) doesn't run
         *  under "Privacy Filter · 945 MB". Body + footer below get
         *  full card width — was wrapping into 2-3 lines when the
         *  button competed for horizontal space in a flex row. */}
        <div className="mb-1 flex items-center gap-2 pr-14">
          <span className="text-warm-text dark:text-dark-text text-xs font-medium">
            {t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
          </span>
          <code className="text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface rounded px-1.5 py-0.5 font-mono text-[10px]">
            {formatBytes(state.bytesTotal || 945_000_000)}
          </code>
        </div>
        <p className="text-warm-faint dark:text-dark-muted mb-1.5 text-[11px] leading-[16px]">
          {t('settings.security.detector_pf_body', {
            defaultValue:
              'Fills regex blind spots: emails, phones, DOB, novel secrets. Names / addresses / URLs / accounts disabled.',
          })}
        </p>
        <p className="text-warm-faint dark:text-dark-muted/70 font-mono text-[10px]">
          {t('settings.security.detector_pf_footer', {
            defaultValue: 'OpenAI · Apache 2.0 · ~5-30s per session · on-device',
          })}
        </p>

        {runtime?.status === 'ready' && runtime.runtime && (
          <p
            data-testid="settings-pf-runtime"
            data-runtime={runtime.runtime}
            className="text-accent dark:text-accent-dark mt-1.5 font-mono text-[10px]"
          >
            {runtime.runtime === 'webgpu'
              ? t('settings.security.detector_pf_runtime_webgpu', { defaultValue: 'WebGPU' })
              : t('settings.security.detector_pf_runtime_wasm', { defaultValue: 'WASM (CPU)' })}
            {runtime.adapterLabel ? ` · ${runtime.adapterLabel}` : ''}
          </p>
        )}

        {(state.phase === 'downloading' ||
          ((state.phase === 'not-installed' || state.phase === 'failed') &&
            state.bytesDownloaded > 0)) && (
          <div className="mt-2.5" data-testid="settings-pf-progress">
            <div className="bg-warm-surface dark:bg-dark-surface h-1.5 overflow-hidden rounded-full">
              <div
                className={`h-full transition-[width] duration-200 ease-out ${
                  state.phase === 'downloading'
                    ? 'bg-accent dark:bg-accent-dark'
                    : // Cancelled or failed mid-flight — show the
                      // resume point in a dimmer tone so the user
                      // sees how far they got without confusing it
                      // for an active download.
                      'bg-accent/50 dark:bg-accent-dark/50'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            {/* tabular-nums keeps digit POSITIONS stable inside each
             *  value; explicit widths are unnecessary because the
             *  whole line uses mono + nowrap, so the only layout
             *  shift would be on a char-count flip (e.g. 99 → 100),
             *  rare enough to not justify the visible gap. */}
            <p className="text-warm-faint dark:text-dark-muted mt-1 font-mono text-[10px] whitespace-nowrap tabular-nums">
              {formatBytes(state.bytesDownloaded)}
              {' / '}
              {formatBytes(state.bytesTotal)}
              {' · '}
              {percent}%
            </p>
          </div>
        )}

        {state.phase === 'failed' && state.error && (
          <p className="text-accent dark:text-accent-dark mt-2 flex items-center gap-1.5 text-[11px]">
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
            onClick={() => {
              void startDownload()
            }}
            className="text-accent dark:text-accent-dark inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 transition-colors hover:underline disabled:opacity-60"
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
            className="text-accent dark:text-accent-dark inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            <X size={10} strokeWidth={1.8} aria-hidden />
            {t('settings.security.detector_pf_cancel', { defaultValue: 'Cancel' })}
          </button>
        )}
        {state.phase === 'installed' && prefs && (
          <Toggle
            checked={prefs.pfEnabled}
            onChange={(v) => {
              void togglePf(v)
            }}
            ariaLabel={t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
            testId="settings-pf-toggle"
          />
        )}
        {state.phase === 'failed' && (
          <button
            type="button"
            data-testid="settings-pf-retry"
            onClick={() => {
              void startDownload()
            }}
            className="text-accent dark:text-accent-dark inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            <RotateCw size={10} strokeWidth={1.8} aria-hidden />
            {t('settings.security.detector_pf_retry', { defaultValue: 'Retry' })}
          </button>
        )}
      </div>
    </div>
  )
}
