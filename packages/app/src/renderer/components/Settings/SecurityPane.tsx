// Settings → Security pane.
//
// Layout follows the Image #22 handoff but typography + padding match
// the rest of the Settings tabs (see GeneralTab + SourcesTab in
// SettingsPanel.tsx): top-level wrapper is `space-y-6` with no extra
// padding, section headers use the project-wide uppercase 11px label,
// row labels are 12px warm-muted, descriptions are 11px warm-faint.
//
// State persisted via securityApi.setPrefs(); see ../../../main/
// securityPreferences.ts for the on-disk schema.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, ArrowRight } from 'lucide-react'
import type { ScanStatus, AllowlistEntryRow } from '@spool-lab/core'
import { securityApi, type SecurityPreferences } from '../../api/security.js'
import Toggle from '../Toggle.js'
import Menu from '../Menu.js'
import AllowlistManageModal from '../security/AllowlistManageModal.js'

export default function SecurityPane() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [prefs, setPrefs] = useState<SecurityPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [allowlistOpen, setAllowlistOpen] = useState(false)
  const [allowlistEntries, setAllowlistEntries] = useState<AllowlistEntryRow[]>([])

  useEffect(() => {
    void securityApi.getScanStatus().then(setStatus).catch(() => setStatus(null))
    void securityApi.getPrefs().then(setPrefs).catch(() => setPrefs(null))
    void refreshAllowlist()
    const off = securityApi.onPrefsChanged((next) => setPrefs(next))
    return () => off()
  }, [])

  async function refreshAllowlist() {
    const rows = await securityApi.listAllowlistEntries().catch(() => [])
    setAllowlistEntries(rows)
  }

  async function update(next: Partial<SecurityPreferences>) {
    if (!prefs) return
    setPrefs({ ...prefs, ...next })
    const saved = await securityApi.setPrefs(next)
    setPrefs(saved)
  }

  async function rescanAll() {
    setBusy(true)
    try {
      await securityApi.rescanAll()
      const s = await securityApi.getScanStatus()
      setStatus(s)
    } finally {
      setBusy(false)
    }
  }

  const globalCount = allowlistEntries.filter(e => e.scope === 'global').length
  const sessionCount = allowlistEntries.filter(e => e.scope === 'session').length
  const profile = status?.currentProfile ?? 'regex@4'

  return (
    <div className="space-y-6">
      {/* Detectors */}
      <Section title={t('settings.security.detectors_title', { defaultValue: 'Detectors' })}>
        {/* Pattern matching card — active, never togglable */}
        <div
          data-testid="settings-detector-pattern"
          className="rounded-[8px] border border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark px-3.5 py-3 mb-2"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-warm-text dark:text-dark-text">
                  {t('settings.security.detector_pattern_title', { defaultValue: 'Pattern matching' })}
                </span>
                <code className="font-mono text-[10px] text-accent dark:text-accent-dark">
                  {profile}
                </code>
              </div>
              <p className="text-[11px] leading-[16px] text-warm-faint dark:text-dark-muted mb-1.5">
                {t('settings.security.detector_pattern_body', {
                  defaultValue: 'Vendor-prefixed tokens (AKIA, ghp_, sk-ant), PEM blocks, env vars, and connection strings.',
                })}
              </p>
              <p className="font-mono text-[10px] text-warm-faint dark:text-dark-muted/70">
                {t('settings.security.detector_pattern_footer', {
                  defaultValue: '13 detectors · sub-100ms per session',
                })}
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.06em] font-medium text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border">
              {t('settings.security.detector_always_on', { defaultValue: 'Always on' })}
            </span>
          </div>
        </div>

        {/* Privacy Filter card — coming soon */}
        <div
          data-testid="settings-detector-pf"
          className="rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface/40 dark:bg-dark-surface/40 px-3.5 py-3"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-warm-text dark:text-dark-text">
                  {t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
                </span>
                <code className="font-mono text-[10px] text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded">
                  ~800 MB
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
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium text-warm-faint dark:text-dark-muted">
                {t('settings.security.detector_coming_soon', { defaultValue: 'Coming soon' })}
              </span>
              {/* Visually disabled; also blocks keyboard activation
               *  via inert so screen-reader / keyboard users can't
               *  trip the no-op onChange while the ML runtime is
               *  still in stub form. `inert` is not in React 18's
               *  stock HTMLAttributes typings; the cast spreads it
               *  through as a plain HTML attribute. */}
              <span
                className="pointer-events-none opacity-50"
                aria-hidden="true"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...({ inert: '' } as any)}
              >
                <Toggle
                  checked={prefs?.pfEnabled ?? false}
                  onChange={() => { /* stub until ML runtime lands */ }}
                  ariaLabel={t('settings.security.detector_pf_title', { defaultValue: 'Privacy Filter' })}
                  testId="settings-pf-toggle"
                />
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Defaults */}
      <Section title={t('settings.security.defaults_title', { defaultValue: 'Defaults' })}>
        <div className="space-y-4">
          <DefaultsRow
            label={t('settings.security.info_default_label', { defaultValue: 'Informational signals' })}
            description={t('settings.security.info_default_sub', {
              defaultValue: 'Show absolute-path, ip, and internal-host in the Security page by default. Audit showed ~98% false-positive rate.',
            })}
            control={
              <Toggle
                checked={prefs?.infoDefaultVisible ?? false}
                onChange={(v) => { void update({ infoDefaultVisible: v }) }}
                ariaLabel={t('settings.security.info_default_label', { defaultValue: 'Informational signals' })}
                testId="settings-info-default"
              />
            }
          />
          <DefaultsRow
            label={t('settings.security.rescan_after_sync_label', { defaultValue: 'Rescan after sync' })}
            description={t('settings.security.rescan_after_sync_sub', {
              defaultValue: 'When new sessions land, automatically re-run detectors on the affected sessions in the background.',
            })}
            control={
              <SmallSelect
                value={prefs?.rescanAfterSync ?? 'auto'}
                onChange={(v) => { void update({ rescanAfterSync: v as 'auto' | 'manual' }) }}
                options={[
                  { value: 'auto', label: t('settings.security.rescan_after_sync_auto', { defaultValue: 'Auto' }) },
                  { value: 'manual', label: t('settings.security.rescan_after_sync_manual', { defaultValue: 'Manual' }) },
                ]}
                testid="settings-rescan-after-sync"
              />
            }
          />
          <DefaultsRow
            label={t('settings.security.reveal_hover_label', { defaultValue: 'Reveal values on hover only' })}
            description={t('settings.security.reveal_hover_sub', {
              defaultValue: 'In the strip and Security page, blur finding values until you hover. Off = always visible.',
            })}
            control={
              <Toggle
                checked={prefs?.revealValuesOnHoverOnly ?? false}
                onChange={(v) => { void update({ revealValuesOnHoverOnly: v }) }}
                ariaLabel={t('settings.security.reveal_hover_label', { defaultValue: 'Reveal values on hover only' })}
                testId="settings-reveal-hover"
              />
            }
          />
        </div>
      </Section>

      {/* Allowlist */}
      <Section title={t('settings.security.allowlist_title', { defaultValue: 'Allowlist' })}>
        <DefaultsRow
          label={t('settings.security.allowlist_row_title', { defaultValue: 'Global allowlist' })}
          description={t('settings.security.allowlist_stats', {
            defaultValue: '{{global}} hashes allowlisted everywhere · {{session}} dismissed in a single session.',
            global: globalCount,
            session: sessionCount,
          })}
          control={
            <button
              type="button"
              data-testid="settings-allowlist-manage"
              onClick={() => setAllowlistOpen(true)}
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
            >
              {t('settings.security.allowlist_manage', { defaultValue: 'Manage' })}
              <ArrowRight size={11} strokeWidth={1.8} aria-hidden />
            </button>
          }
        />
      </Section>

      {/* Actions */}
      <Section title={t('settings.security.actions_title', { defaultValue: 'Actions' })}>
        <DefaultsRow
          label={t('settings.security.rescan_button', { defaultValue: 'Rescan all sessions' })}
          description={t('settings.security.rescan_sub', {
            defaultValue: 'Reapply the active profile to every session. Usually only needed after toggling a detector.',
          })}
          control={
            <button
              type="button"
              data-testid="settings-rescan-all"
              disabled={busy}
              onClick={() => { void rescanAll() }}
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text disabled:opacity-60 transition-colors"
            >
              <RotateCw size={11} strokeWidth={1.8} aria-hidden className={busy ? 'animate-spin' : ''} />
              {busy
                ? t('settings.security.rescan_busy', { defaultValue: 'Re-scanning…' })
                : t('settings.security.rescan_idle', { defaultValue: 'Rescan' })}
            </button>
          }
        />
      </Section>

      {allowlistOpen && (
        <AllowlistManageModal
          onClose={() => {
            setAllowlistOpen(false)
            void refreshAllowlist()
          }}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.08em] uppercase mb-2">
        {title}
      </h4>
      {children}
    </div>
  )
}

interface DefaultsRowProps {
  label: string
  description?: string
  control: ReactNode
}
function DefaultsRow({ label, description, control }: DefaultsRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className="text-xs text-warm-muted dark:text-dark-muted">{label}</span>
        {description && (
          <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

interface SmallSelectProps {
  value: string
  onChange: (next: string) => void
  options: { value: string; label: string }[]
  testid?: string
}
function SmallSelect({ value, onChange, options, testid }: SmallSelectProps) {
  const current = options.find(o => o.value === value) ?? options[0]
  return (
    <Menu
      align="right"
      items={options.map(o => ({
        label: o.label,
        active: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          data-testid={testid}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
          className={`inline-flex items-center gap-2 h-7 min-w-[110px] rounded-[6px] border bg-warm-surface dark:bg-dark-surface pl-3 pr-2 text-[12px] text-warm-text dark:text-dark-text outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0 ${
            open
              ? 'border-accent dark:border-accent-dark'
              : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
          }`}
        >
          <span className="flex-1 text-left truncate">{current?.label ?? value}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`h-3 w-3 flex-none text-warm-muted dark:text-dark-muted transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    />
  )
}
