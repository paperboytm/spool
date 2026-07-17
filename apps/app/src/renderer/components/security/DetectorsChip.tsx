// Inline detector summary for the Security page meta row.
//
// Surfaces what's actively producing findings — not just the opaque
// `regex@1,pf@1.5b-q4.r2` profile string, but a human-readable list with
// each detector's live status. The PF runtime can fail silently
// (model load throw, GPU adapter rejection) and the only signal used
// to be in Settings → Security. With this chip the user sees
// "Privacy Filter · failed" right next to the findings count and
// knows the scan didn't get the boost it claims to have.
//
// Polls pfGetRuntimeInfo at 3 s while PF is in the profile so a
// loading → ready / loading → failed transition surfaces without a
// page refresh.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Sparkles, AlertTriangle, Loader2, Shield } from 'lucide-react'
import { securityApi, type PfRuntimeInfo } from '../../api/security.js'

export default function DetectorsChip({ profile }: { profile: string | null }) {
  const { t } = useTranslation()
  const [pfRuntime, setPfRuntime] = useState<PfRuntimeInfo | null>(null)

  const hasPf = !!profile && /(^|,)pf@/.test(profile)
  const regexVersion = profile?.match(/regex@(\d+)/)?.[1] ?? null

  useEffect(() => {
    if (!hasPf) { setPfRuntime(null); return }
    let cancelled = false
    const tick = async () => {
      const info = await securityApi.pfGetRuntimeInfo().catch(() => null)
      if (!cancelled) setPfRuntime(info)
    }
    void tick()
    const id = setInterval(() => { void tick() }, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [hasPf])

  if (!profile) return null

  return (
    <span
      data-testid="security-detectors-chip"
      className="inline-flex items-center gap-1.5 align-baseline"
    >
      <DetectorPill
        label={t('security.detector_pattern_short', { defaultValue: 'Pattern matching' })}
        meta={regexVersion ? `v${regexVersion}` : null}
        tone="active"
        icon={<Shield size={9} strokeWidth={1.8} aria-hidden />}
      />
      {hasPf && (
        <DetectorPill
          label={t('security.detector_pf_short', { defaultValue: 'Privacy Filter' })}
          meta={pfMetaText(pfRuntime, t)}
          tone={pfTone(pfRuntime)}
          icon={pfIcon(pfRuntime)}
        />
      )}
    </span>
  )
}

function DetectorPill({
  label, meta, tone, icon,
}: {
  label: string
  meta: string | null
  tone: 'active' | 'loading' | 'failed'
  icon: React.ReactNode
}) {
  const palette = tone === 'failed'
    ? 'text-accent dark:text-accent-dark border-accent/40 dark:border-accent-dark/40'
    : tone === 'loading'
      ? 'text-warm-muted dark:text-dark-muted border-warm-border dark:border-dark-border'
      : 'text-warm-muted dark:text-dark-muted border-warm-border dark:border-dark-border'
  return (
    <span
      data-tone={tone}
      // font-mono matches the meta row's "{N} 项风险 · {N} 项信息"
      // typography exactly — sans-at-same-px optically reads bigger
      // than the mono digits next to it, which made the chips bulge
      // out of the row.
      className={`inline-flex items-center gap-[3px] h-[18px] px-1.5 rounded-[4px] border bg-warm-surface dark:bg-dark-surface font-mono text-[10px] ${palette}`}
    >
      {icon}
      <span>{label}</span>
      {meta && (
        <span className="text-warm-faint dark:text-dark-muted tabular-nums">{meta}</span>
      )}
    </span>
  )
}

function pfTone(info: PfRuntimeInfo | null): 'active' | 'loading' | 'failed' {
  if (!info) return 'loading'  // null = host not yet running
  if (info.status === 'failed') return 'failed'
  if (info.status === 'ready') return 'active'
  return 'loading'
}

function pfMetaText(
  info: PfRuntimeInfo | null,
  t: TFunction,
): string | null {
  if (!info) return t('security.detector_pf_runtime_loading', { defaultValue: 'starting…' })
  if (info.status === 'ready') {
    return info.runtime === 'webgpu'
      ? t('security.detector_pf_runtime_webgpu', { defaultValue: 'WebGPU' })
      : t('security.detector_pf_runtime_wasm', { defaultValue: 'WASM (CPU)' })
  }
  if (info.status === 'failed') {
    return t('security.detector_pf_runtime_failed', { defaultValue: 'failed' })
  }
  return t('security.detector_pf_runtime_loading', { defaultValue: 'loading…' })
}

function pfIcon(info: PfRuntimeInfo | null): React.ReactNode {
  if (info?.status === 'failed') return <AlertTriangle size={9} strokeWidth={1.9} aria-hidden />
  if (info?.status === 'ready') return <Sparkles size={9} strokeWidth={1.9} aria-hidden />
  return <Loader2 size={9} strokeWidth={1.9} className="animate-spin" aria-hidden />
}
