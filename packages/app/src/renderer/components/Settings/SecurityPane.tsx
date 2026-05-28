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

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  RotateCw, ArrowRight, ChevronDown, ChevronRight,
  Archive, Trash2, Check, Minus,
} from 'lucide-react'
import type { ScanStatus, AllowlistEntryRow } from '@spool-lab/core'
import {
  SENSITIVE_KIND_ORDER,
  SENSITIVE_KIND_LABEL,
  HIGH_SEVERITY_KINDS,
  INFO_SEVERITY_KINDS,
  type SensitiveKind,
} from '@spool-lab/redact'
import { securityApi, type SecurityPreferences, type BackupFileInfo } from '../../api/security.js'
import { useCachedSecurityPrefs, primeSecurityPrefsCache, patchSecurityPrefs } from '../../api/securityPrefsCache.js'
import { formatBytes } from '../security/format.js'
import { useSecurityEnabled } from '../../featureFlags.js'
import Toggle from '../Toggle.js'
import Menu from '../Menu.js'
import AllowlistManageModal from '../security/AllowlistManageModal.js'
import PfDownloadCard from './security/PfDownloadCard.js'
import { useSecurityReadiness } from '../../hooks/useSecurityReadiness.js'

export default function SecurityPane() {
  if (!useSecurityEnabled()) return null
  return <SecurityPaneGate />
}

function SecurityPaneGate() {
  const { t } = useTranslation()
  const readiness = useSecurityReadiness()
  if (!readiness.ready) {
    return <SecurityUnavailableNotice reason={readiness.reason} t={t} />
  }
  return <SecurityPaneInner />
}

function SecurityUnavailableNotice({
  reason,
  t,
}: {
  reason: 'booting' | 'scanner-unavailable'
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (reason === 'booting') {
    return (
      <div
        data-testid="security-readiness-booting"
        className="space-y-3 animate-pulse"
        aria-busy="true"
      >
        <div className="h-3 w-32 rounded bg-warm-border/60 dark:bg-dark-border/60" />
        <div className="h-16 rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface" />
        <div className="h-3 w-20 rounded bg-warm-border/60 dark:bg-dark-border/60" />
        <div className="h-24 rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface" />
      </div>
    )
  }
  return (
    <div
      data-testid="security-unavailable"
      role="alert"
      className="rounded-[8px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3.5 py-3"
    >
      <p className="text-xs font-medium text-warm-text dark:text-dark-text mb-1">
        {t('settings.security.unavailable_title', { defaultValue: 'Scanner unavailable' })}
      </p>
      <p className="text-[11px] leading-[16px] text-warm-faint dark:text-dark-muted">
        {t('settings.security.unavailable_body', {
          defaultValue: 'Spool could not start the security scan worker. Settings here are inactive until it recovers. Restarting the app usually resolves this; if it persists, check the developer console for the boot error.',
        })}
      </p>
    </div>
  )
}

function SecurityPaneInner() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ScanStatus | null>(null)
  // Subscribe to the shared prefs cache. Returns the cached value
  // synchronously when warm (the typical case — App.tsx primes at
  // mount, so by the time a user can click Settings the cache is
  // populated). Returns null on cold-start; the controls below render
  // null in their slot and the layout stays stable until the prime
  // resolves and useSyncExternalStore re-renders us.
  const prefs = useCachedSecurityPrefs()
  const [busy, setBusy] = useState(false)
  const [allowlistOpen, setAllowlistOpen] = useState(false)
  const [allowlistEntries, setAllowlistEntries] = useState<AllowlistEntryRow[]>([])

  useEffect(() => {
    void securityApi.getScanStatus().then(setStatus).catch(() => setStatus(null))
    void refreshAllowlist()
    if (prefs === null) {
      void primeSecurityPrefsCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshAllowlist() {
    const rows = await securityApi.listAllowlistEntries().catch(() => [])
    setAllowlistEntries(rows)
  }


  async function update(next: Partial<SecurityPreferences>) {
    if (!prefs) return
    await patchSecurityPrefs(next)
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
  // The Pattern matching card describes only the regex detector,
  // so strip any other provider segments (pf@…, allow@…) from the
  // displayed profile string — otherwise the chip leaks "pf is on"
  // info next to a card whose body talks about regex-only behaviour.
  const fullProfile = status?.currentProfile ?? 'regex@1'
  const regexProfile = fullProfile.match(/regex@\d+/)?.[0] ?? 'regex@1'

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
                  {regexProfile}
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

      </Section>

      {/* Defaults */}
      <Section title={t('settings.security.defaults_title', { defaultValue: 'Defaults' })}>
        <div className="space-y-4">
          {/* Two toggles grouped first, the dropdown last — same-shape
              controls read better adjacent than interleaved. */}
          <DefaultsRow
            label={t('settings.security.info_default_label', { defaultValue: 'Informational signals' })}
            description={t('settings.security.info_default_sub', {
              defaultValue: 'Show absolute-path, ip, and internal-host in the Security page by default. Audit showed ~98% false-positive rate.',
            })}
            control={prefs && (
              <Toggle
                checked={prefs.infoDefaultVisible}
                onChange={(v) => { void update({ infoDefaultVisible: v }) }}
                ariaLabel={t('settings.security.info_default_label', { defaultValue: 'Informational signals' })}
                testId="settings-info-default"
              />
            )}
          />
          {/* Blur defaults are split per surface so the at-a-glance
              strip (session detail) and the dedicated review page can
              be tuned independently. Each row mirrors the Eye/EyeOff
              icon on its corresponding surface — flipping either one
              updates the other. */}
          <DefaultsRow
            label={t('settings.security.blur_page_label', { defaultValue: 'Blur values on the Security page' })}
            description={t('settings.security.blur_page_sub', {
              defaultValue: 'Finding values render blurred on the Security page; hover or click a row to reveal. Off = always visible.',
            })}
            control={prefs && (
              <Toggle
                checked={prefs.securityPageValuesBlurred}
                onChange={(v) => { void update({ securityPageValuesBlurred: v }) }}
                ariaLabel={t('settings.security.blur_page_label', { defaultValue: 'Blur values on the Security page' })}
                testId="settings-blur-page"
              />
            )}
          />
          <DefaultsRow
            label={t('settings.security.blur_strip_label', { defaultValue: 'Blur values in the session strip' })}
            description={t('settings.security.blur_strip_sub', {
              defaultValue: 'Finding values render blurred in the session-detail Findings strip; hover or click to reveal. Off = always visible.',
            })}
            control={prefs && (
              <Toggle
                checked={prefs.findingsStripValuesBlurred}
                onChange={(v) => { void update({ findingsStripValuesBlurred: v }) }}
                ariaLabel={t('settings.security.blur_strip_label', { defaultValue: 'Blur values in the session strip' })}
                testId="settings-blur-strip"
              />
            )}
          />
          <DefaultsRow
            label={t('settings.security.row_risk_icon_label', { defaultValue: 'Risk icon on session rows' })}
            description={t('settings.security.row_risk_icon_sub', {
              defaultValue: 'Show the inline ⚠ / ✓ on rows in Sessions and Project view. Off = the dedicated Security page still surfaces the same findings.',
            })}
            control={prefs && (
              <Toggle
                checked={prefs.sessionRowRiskIconVisible}
                onChange={(v) => { void update({ sessionRowRiskIconVisible: v }) }}
                ariaLabel={t('settings.security.row_risk_icon_label', { defaultValue: 'Risk icon on session rows' })}
                testId="settings-row-risk-icon"
              />
            )}
          />
          <DefaultsRow
            label={t('settings.security.rescan_after_sync_label', { defaultValue: 'Rescan after sync' })}
            description={t('settings.security.rescan_after_sync_sub', {
              defaultValue: 'When new sessions land, automatically re-run detectors on the affected sessions in the background.',
            })}
            control={prefs && (
              <SmallSelect
                value={prefs.rescanAfterSync}
                onChange={(v) => { void update({ rescanAfterSync: v as 'auto' | 'manual' }) }}
                options={[
                  { value: 'auto', label: t('settings.security.rescan_after_sync_auto', { defaultValue: 'Auto' }) },
                  { value: 'manual', label: t('settings.security.rescan_after_sync_manual', { defaultValue: 'Manual' }) },
                ]}
                testid="settings-rescan-after-sync"
              />
            )}
          />
        </div>
      </Section>

      {/* Muted kinds — entire categories silently dismissed at scan time */}
      <Section title={t('settings.security.muted_kinds_title', { defaultValue: 'Muted kinds' })}>
        {prefs && (
          <MutedKindsRow
            value={prefs.kindAllowlist}
            onChange={(kinds) => { void update({ kindAllowlist: kinds }) }}
          />
        )}
      </Section>

      {/* Ignored items */}
      <Section title={t('settings.security.allowlist_title', { defaultValue: 'Ignored items' })}>
        <DefaultsRow
          label={t('settings.security.allowlist_row_title', { defaultValue: 'Findings you ignored' })}
          description={t('settings.security.allowlist_stats', {
            defaultValue: '{{global}} ignored everywhere · {{session}} ignored in a single session.',
            global: globalCount,
            session: sessionCount,
          })}
          control={
            <button
              type="button"
              data-testid="settings-ignored-manage"
              onClick={() => setAllowlistOpen(true)}
              className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface hover:border-warm-border2 dark:hover:border-dark-border2 px-2.5 text-[12px] text-warm-text dark:text-dark-text transition-colors"
            >
              {t('settings.security.allowlist_manage', { defaultValue: 'Review' })}
              <ArrowRight size={12} strokeWidth={1.5} aria-hidden />
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

      {/* Experimental — opt-in ML detection. Empirical FP rate on
          mixed code+chat content makes this unsuitable as a default;
          keep it gated behind explicit user enable so curious users
          can still try it on their own data. */}
      <Section title={t('settings.security.experimental_title', { defaultValue: 'Experimental' })}>
        <p className="text-[11px] leading-[16px] text-warm-faint dark:text-dark-muted mb-3">
          {t('settings.security.experimental_intro', {
            defaultValue: 'Opt-in detectors that are not yet recommended for daily use. False-positive rates may be high on code-heavy content.',
          })}
        </p>
        <PfDownloadCard />
      </Section>

      <Section title={t('settings.security.maintenance_title', { defaultValue: 'Maintenance' })}>
        <BackupsManager />
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

interface MutedKindsRowProps {
  value: readonly SensitiveKind[]
  onChange: (next: SensitiveKind[]) => void
}

/** Per-kind allowlist UI — entire SensitiveKind categories the user
 *  wants silenced at scan time. Findings still land in the DB
 *  (state='dismissed') for auditability, but the Library badge, the
 *  session strip, and the Security page sessions list all ignore
 *  them. Backfill kicks automatically on toggle via the SET_PREFS
 *  IPC side-effect.
 *
 *  Collapsed by default — most users won't touch this. The summary
 *  row exposes the count + an expand chevron; expanded view groups
 *  kinds by severity (high / low / info) as clickable chips. */
function MutedKindsRow({ value, onChange }: MutedKindsRowProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const muted = useMemo(() => new Set(value), [value])

  const groups = useMemo(() => {
    const high: SensitiveKind[] = []
    const low: SensitiveKind[] = []
    const info: SensitiveKind[] = []
    for (const k of SENSITIVE_KIND_ORDER) {
      if (HIGH_SEVERITY_KINDS.has(k)) high.push(k)
      else if (INFO_SEVERITY_KINDS.has(k)) info.push(k)
      else low.push(k)
    }
    return { high, low, info }
  }, [])

  function toggle(kind: SensitiveKind) {
    const next = new Set(muted)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    onChange([...next])
  }

  const count = muted.size

  return (
    <div>
      <button
        type="button"
        data-testid="settings-muted-kinds-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 text-left rounded -ml-1 pl-1 py-1 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
      >
        <div className="min-w-0 flex-1">
          <span className="text-xs text-warm-muted dark:text-dark-muted">
            {t('settings.security.muted_kinds_label', { defaultValue: 'Mute by kind' })}
          </span>
          <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">
            {count === 0
              ? t('settings.security.muted_kinds_sub_empty', {
                  defaultValue: 'Entire categories you never want to see. Findings still land as Dismissed for audit — just suppressed from the badge and lists.',
                })
              : t('settings.security.muted_kinds_sub_count', {
                  count,
                  defaultValue: '{{count}} kinds muted. Toggling a kind back on triggers a background rescan.',
                })}
          </p>
        </div>
        <span className="flex-none inline-flex items-center justify-center w-5 h-5 text-warm-faint dark:text-dark-muted">
          {open
            ? <ChevronDown size={13} strokeWidth={1.7} aria-hidden />
            : <ChevronRight size={13} strokeWidth={1.7} aria-hidden />}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <MutedKindsGroup
            label={t('security.severity_high', { defaultValue: 'High · credentials' })}
            kinds={groups.high}
            muted={muted}
            onToggle={toggle}
            tone="high"
          />
          <MutedKindsGroup
            label={t('security.severity_low', { defaultValue: 'Low · identity' })}
            kinds={groups.low}
            muted={muted}
            onToggle={toggle}
            tone="low"
          />
          <MutedKindsGroup
            label={t('security.severity_info', { defaultValue: 'Info · environment' })}
            kinds={groups.info}
            muted={muted}
            onToggle={toggle}
            tone="info"
          />
        </div>
      )}
    </div>
  )
}

interface MutedKindsGroupProps {
  label: string
  kinds: SensitiveKind[]
  muted: ReadonlySet<SensitiveKind>
  onToggle: (kind: SensitiveKind) => void
  tone: 'high' | 'low' | 'info'
}
function MutedKindsGroup({ label, kinds, muted, onToggle, tone }: MutedKindsGroupProps) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-warm-faint dark:text-dark-muted mb-1.5">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => {
          const active = muted.has(k)
          const palette = active
            // Active = muted (user said "don't report this kind"). Visually
            // emphasised with the same accent as the High tier so users see
            // at a glance which kinds they've turned off.
            ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark'
            // Inactive = will be reported. Subtle border that picks up tone
            // (high tier gets warmer, info gets a dashed border to indicate
            // it's already a quieter category).
            : tone === 'info'
              ? 'border-dashed border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
              : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
          return (
            <button
              key={k}
              type="button"
              data-testid="settings-muted-kind-chip"
              data-kind={k}
              data-muted={active}
              onClick={() => onToggle(k)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-[6px] border text-[11px] font-mono transition-colors ${palette}`}
            >
              {SENSITIVE_KIND_LABEL[k] ?? k}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function BackupsManager() {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<BackupFileInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy'>('idle')
  // Initial-load error is kept inline so it stays visible until the user
  // retries; delete success/failure goes through sonner toasts.
  const [loadError, setLoadError] = useState<string | null>(null)

  async function refresh() {
    try {
      const list = await securityApi.listBackups()
      setBackups(list)
      setLoadError(null)
      // Drop any selection entries that no longer exist on disk.
      setSelected(prev => {
        const next = new Set<string>()
        for (const b of list) if (prev.has(b.name)) next.add(b.name)
        return next
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      // Leave backups as-is (null on first load, prior list on refresh) so
      // we don't paint a misleading "No backups" message in place of the
      // actual error.
    }
  }

  useEffect(() => { void refresh() }, [])

  const toggle = (name: string) => {
    if (phase === 'busy') return
    setPhase('idle')
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const totalSize = (backups ?? []).reduce((a, b) => a + b.sizeBytes, 0)
  const selectedSize = (backups ?? [])
    .filter(b => selected.has(b.name))
    .reduce((a, b) => a + b.sizeBytes, 0)

  const autoBackups = (backups ?? []).filter(b => b.kind === 'auto')

  const selectAuto = () => {
    if (phase === 'busy' || autoBackups.length === 0) return
    setPhase('idle')
    setSelected(new Set(autoBackups.map(b => b.name)))
  }

  const selectAllButNewest = () => {
    if (phase === 'busy' || !backups || backups.length <= 1) return
    setPhase('idle')
    // backups is already mtime-desc; skip [0].
    setSelected(new Set(backups.slice(1).map(b => b.name)))
  }

  const toggleSelectAll = () => {
    if (phase === 'busy' || !backups) return
    setPhase('idle')
    // All selected → clear; otherwise (none or partial) → select all.
    if (selected.size === backups.length) setSelected(new Set())
    else setSelected(new Set(backups.map(b => b.name)))
  }

  async function onDeleteClick() {
    if (phase === 'busy' || selected.size === 0) return
    if (phase === 'idle') {
      setPhase('confirm')
      return
    }
    setPhase('busy')
    const requested = selected.size
    try {
      const res = await securityApi.deleteBackups([...selected])
      setSelected(new Set())
      setPhase('idle')
      await refresh()
      // Partial-delete case: some names couldn't be removed (raced with
      // another process, perms, etc.). Surface it instead of pretending
      // everything succeeded.
      if (res.deleted < requested) {
        toast.warning(t('settings.security.backups_delete_partial_title', {
          deleted: res.deleted,
          requested,
          defaultValue: 'Deleted {{deleted}} of {{requested}} backups',
        }), {
          description: t('settings.security.backups_delete_partial_desc', {
            size: formatBytes(res.bytesFreed),
            defaultValue: 'Freed {{size}}. Some files could not be removed — they may have been deleted by another process.',
          }),
        })
      } else {
        toast.success(t('settings.security.backups_delete_result', {
          count: res.deleted,
          size: formatBytes(res.bytesFreed),
          defaultValue: 'Deleted {{count}} backup files · freed {{size}}.',
        }))
      }
    } catch (e) {
      setPhase('idle')
      toast.error(t('settings.security.backups_delete_failed_title', {
        defaultValue: 'Could not delete backups',
      }), {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div data-testid="settings-backups">
      <div className="flex items-center gap-1.5 text-xs text-warm-muted dark:text-dark-muted">
        <Archive size={13} strokeWidth={1.7} aria-hidden className="text-warm-faint dark:text-dark-muted" />
        {t('settings.security.backups_label', { defaultValue: 'SQLite backups' })}
      </div>
      <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">
        {t('settings.security.backups_sub', {
          defaultValue: 'Snapshots Spool writes before destructive migrations or manual rollbacks. Pick which to delete.',
        })}
      </p>

      {backups === null && loadError ? (
        // Initial load failed — error message renders below.
        null
      ) : backups === null ? (
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          {t('settings.security.backups_loading', { defaultValue: 'Loading…' })}
        </p>
      ) : backups.length === 0 ? (
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          {t('settings.security.backups_empty', {
            defaultValue: 'No backups in ~/.spool/backups/.',
          })}
        </p>
      ) : (
        <>
          <div
            data-testid="settings-backups-list"
            className="mt-2 rounded-[6px] border border-warm-border dark:border-dark-border overflow-hidden"
          >
            <BackupsListHeader
              total={backups.length}
              totalSize={formatBytes(totalSize)}
              selectedCount={selected.size}
              selectedSize={formatBytes(selectedSize)}
              phase={phase}
              disabled={phase === 'busy'}
              onToggleAll={toggleSelectAll}
              onDeleteClick={() => { void onDeleteClick() }}
            />
            <ul className="max-h-72 overflow-y-auto divide-y divide-warm-border dark:divide-dark-border">
              {backups.map(b => (
                <BackupRow
                  key={b.name}
                  info={b}
                  checked={selected.has(b.name)}
                  disabled={phase === 'busy'}
                  onToggle={() => toggle(b.name)}
                />
              ))}
            </ul>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <BackupsChip
              label={t('settings.security.backups_select_auto', {
                count: autoBackups.length,
                defaultValue: 'Select auto ({{count}})',
              })}
              disabled={autoBackups.length === 0 || phase === 'busy'}
              onClick={selectAuto}
            />
            <BackupsChip
              label={t('settings.security.backups_select_but_newest', {
                defaultValue: 'Select all but newest',
              })}
              disabled={backups.length <= 1 || phase === 'busy'}
              onClick={selectAllButNewest}
            />
          </div>
        </>
      )}

      {loadError && (
        <p
          data-testid="settings-backups-load-error"
          className="mt-2 text-[11px] text-accent dark:text-accent-dark"
        >
          {t('settings.security.backups_load_failed', {
            defaultValue: 'Could not load backups: {{message}}',
            message: loadError,
          })}
        </p>
      )}
    </div>
  )
}

function BackupsListHeader({
  total,
  totalSize,
  selectedCount,
  selectedSize,
  phase,
  disabled,
  onToggleAll,
  onDeleteClick,
}: {
  total: number
  totalSize: string
  selectedCount: number
  selectedSize: string
  phase: 'idle' | 'confirm' | 'busy'
  disabled: boolean
  onToggleAll: () => void
  onDeleteClick: () => void
}) {
  const { t } = useTranslation()
  const state: 'none' | 'partial' | 'all' =
    selectedCount === 0 ? 'none'
    : selectedCount === total ? 'all'
    : 'partial'
  return (
    <div
      className={`flex items-center gap-2.5 h-8 px-2.5 text-[11px] border-b border-warm-border dark:border-dark-border bg-warm-surface2/40 dark:bg-dark-surface2/40 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <label className={`flex items-center gap-2.5 min-w-0 flex-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <span
          className={`relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-colors shrink-0 ${
            state === 'none'
              ? 'border-warm-border2 dark:border-dark-border2 bg-warm-surface dark:bg-dark-surface'
              : 'bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark'
          }`}
        >
          <input
            type="checkbox"
            checked={state === 'all'}
            disabled={disabled}
            onChange={onToggleAll}
            aria-checked={state === 'partial' ? 'mixed' : state === 'all'}
            className="sr-only"
          />
          {state === 'all' && <Check size={10} strokeWidth={2.5} className="text-white dark:text-warm-bg" aria-hidden />}
          {state === 'partial' && <Minus size={10} strokeWidth={3} className="text-white dark:text-warm-bg" aria-hidden />}
        </span>
        <span className="min-w-0 truncate text-warm-muted dark:text-dark-muted font-medium">
          {selectedCount === 0
            ? t('settings.security.backups_header_all', { defaultValue: 'All' })
            : t('settings.security.backups_header_selected_size', {
                count: selectedCount,
                size: selectedSize,
                defaultValue: '{{count}} selected · {{size}}',
              })}
        </span>
      </label>

      {selectedCount === 0 ? (
        <span className="shrink-0 font-mono tabular-nums text-warm-faint dark:text-dark-muted">
          {t('settings.security.backups_summary', {
            count: total,
            size: totalSize,
            defaultValue: '{{count}} files · {{size}} total',
          })}
        </span>
      ) : (
        <button
          type="button"
          data-testid="settings-backups-delete"
          data-phase={phase}
          onClick={onDeleteClick}
          disabled={phase === 'busy'}
          className={`shrink-0 inline-flex items-center gap-1 h-5 rounded-[4px] border px-1.5 text-[11px] font-medium disabled:opacity-50 transition-colors ${
            phase === 'confirm'
              ? 'border-accent dark:border-accent-dark bg-accent dark:bg-accent-dark text-white dark:text-warm-bg'
              : 'border-accent/40 dark:border-accent-dark/40 bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark hover:border-accent dark:hover:border-accent-dark'
          }`}
        >
          {phase === 'busy' ? (
            <RotateCw size={11} strokeWidth={1.8} aria-hidden className="animate-spin" />
          ) : (
            <Trash2 size={11} strokeWidth={1.8} aria-hidden />
          )}
          {phase === 'busy'
            ? t('settings.security.backups_deleting', { defaultValue: 'Deleting…' })
            : phase === 'confirm'
              ? t('settings.security.backups_confirm_delete_short', {
                  defaultValue: 'Click again to delete',
                })
              : t('settings.security.backups_delete_short', {
                  defaultValue: 'Delete',
                })}
        </button>
      )}
    </div>
  )
}

function BackupRow({
  info,
  checked,
  disabled,
  onToggle,
}: {
  info: BackupFileInfo
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const age = formatAge(info.mtimeMs, t as unknown as (k: string, o?: Record<string, unknown>) => string)
  return (
    <li>
      <label
        className={`flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors ${
          checked
            ? 'bg-accent-bg/40 dark:bg-accent-bg-dark/40'
            : 'hover:bg-warm-surface2/60 dark:hover:bg-dark-surface2/60'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span
          className={`relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-colors shrink-0 ${
            checked
              ? 'bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark'
              : 'border-warm-border2 dark:border-dark-border2 bg-warm-surface dark:bg-dark-surface'
          }`}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            className="sr-only"
          />
          {checked && <Check size={10} strokeWidth={2.5} className="text-white dark:text-warm-bg" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 font-mono truncate text-warm-text dark:text-dark-text">{info.name}</span>
        <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1 py-px rounded-sm ${
          info.kind === 'auto'
            ? 'bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark'
            : 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-muted dark:text-dark-muted'
        }`}>
          {info.kind === 'auto'
            ? t('settings.security.backups_kind_auto', { defaultValue: 'auto' })
            : t('settings.security.backups_kind_manual', { defaultValue: 'manual' })}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-warm-faint dark:text-dark-muted w-16 text-right">
          {formatBytes(info.sizeBytes)}
        </span>
        <span className="shrink-0 text-warm-faint dark:text-dark-muted w-20 text-right">{age}</span>
      </label>
    </li>
  )
}

function BackupsChip({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center h-6 rounded-[5px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-2 text-[11px] text-warm-muted dark:text-dark-muted hover:border-warm-border2 dark:hover:border-dark-border2 hover:text-warm-text dark:hover:text-dark-text disabled:opacity-50 disabled:hover:border-warm-border dark:disabled:hover:border-dark-border disabled:cursor-not-allowed transition-colors"
    >
      {label}
    </button>
  )
}

function formatAge(mtimeMs: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - mtimeMs
  if (diffMs < 0) return t('settings.security.backups_age_now', { defaultValue: 'just now' })
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return t('settings.security.backups_age_now', { defaultValue: 'just now' })
  if (min < 60) return t('settings.security.backups_age_min', { count: min, defaultValue: '{{count}}m ago' })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('settings.security.backups_age_hr', { count: hr, defaultValue: '{{count}}h ago' })
  const day = Math.floor(hr / 24)
  if (day < 30) return t('settings.security.backups_age_day', { count: day, defaultValue: '{{count}}d ago' })
  const mo = Math.floor(day / 30)
  return t('settings.security.backups_age_mo', { count: mo, defaultValue: '{{count}}mo ago' })
}
