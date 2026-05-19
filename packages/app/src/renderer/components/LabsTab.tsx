import { useTranslation } from 'react-i18next'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { setLabsFlag } from '../lib/labsFlags.js'
import { useFeature, useSecurityEnabled, securityBuildCapable } from '../featureFlags.js'
import { setSecurityEnabledConfig } from '../api/securityEnabledCache.js'
import Toggle from './Toggle.js'

// Permanent Discord invite (same one used in README / CONTRIBUTING /
// landing). Auto-joins the user to the server on click.
const FEEDBACK_URL = 'https://discord.gg/aqeDxQUs5E'

export default function LabsTab() {
  const { t } = useTranslation()
  const shareOn = useFeature('share')
  const securityOn = useSecurityEnabled()
  // sharePublish is intentionally NOT rendered here pre-launch — see the
  // comment near DEV_DEFAULT_ON in featureFlags.ts. To dev-test the
  // remote publish surface, set VITE_FEATURE_SHAREPUBLISH=1 when running
  // `pnpm dev`. The Labs row will be restored at GA.

  // The Security toggle is backed by the general `agents.json` config
  // (not localStorage like the LabsFlags) so the main-process scan
  // worker reads the same opt-in. Optimistically mirror into the shared
  // cache so every Security surface flips instantly, then persist —
  // main boots/tears down the worker on the set-config IPC, no restart.
  async function toggleSecurity(next: boolean): Promise<void> {
    console.log('[security.lifecycle] Labs toggle →', next ? 'on' : 'off')
    setSecurityEnabledConfig(next)
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, securityEnabled: next })
    } catch (err) {
      console.error('[security.lifecycle] failed to persist securityEnabled:', err)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-warm-muted dark:text-dark-muted">
        {t('labs.intro')}
      </p>
      <LabsFlagRow
        flag="share"
        title={t('labs.share.title')}
        description={t('labs.share.description')}
        feedbackLabel={t('labs.share.feedback')}
        feedbackHref={FEEDBACK_URL}
        checked={shareOn}
        onToggle={(next) => setLabsFlag('share', next)}
      />
      {/* Only offer the Security opt-in in builds that actually ship the
       *  code (dev + VITE_FEATURE_SECURITY builds). Elsewhere the whole
       *  Security surface is tree-shaken out, so a toggle would be a
       *  dead control. */}
      {securityBuildCapable() && (
        <LabsFlagRow
          flag="security"
          title={t('labs.security.title')}
          description={t('labs.security.description')}
          feedbackLabel={t('labs.security.feedback')}
          feedbackHref={FEEDBACK_URL}
          checked={securityOn}
          onToggle={(next) => { void toggleSecurity(next) }}
        />
      )}
    </div>
  )
}

function LabsFlagRow({
  flag,
  title,
  description,
  feedbackLabel,
  feedbackHref,
  checked,
  onToggle,
}: {
  flag: string
  title: string
  description: string
  feedbackLabel: string
  feedbackHref: string
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div data-testid={`labs-row-${flag}`} className="py-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-warm-text dark:text-dark-text">
          {title}
        </h4>
        <Toggle
          checked={checked}
          onChange={onToggle}
          ariaLabel={title}
          testId={`labs-toggle-${flag}`}
        />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-warm-muted dark:text-dark-muted">
        {description}
      </p>
      <a
        href={feedbackHref}
        target="_blank"
        rel="noreferrer"
        data-testid={`labs-feedback-${flag}`}
        className="mt-2 flex items-center gap-2 text-[12px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <MessageSquare size={12} strokeWidth={1.5} aria-hidden />
        <span className="flex-1">{feedbackLabel}</span>
        <ChevronRight size={12} strokeWidth={1.5} aria-hidden />
      </a>
    </div>
  )
}
