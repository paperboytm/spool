// Persisted Security-feature preferences.
//
// Stored in ~/.spool/security.json next to ui.json. Kept in its own
// file (vs. piggybacking on ui.json) because the schema is feature-
// scoped and this lets the rest of Spool ignore security state when
// running with VITE_FEATURE_SECURITY off.
//
// Read pattern is tolerant of unknown / missing fields — older builds
// can write the file with extra keys and newer builds preserve them
// on every save. Each field has an explicit default so first-launch
// behaviour is deterministic.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPOOL_DIR } from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'

const SECURITY_CONFIG_PATH = join(SPOOL_DIR, 'security.json')

/** Persisted preferences. The renderer reads/writes via the
 *  `security:get-prefs` / `security:set-prefs` IPC channels. */
export interface SecurityPreferences {
  /** Per-kind ignore list. Findings whose kind appears here get
   *  inserted with state='dismissed' instead of 'active' on every
   *  scan. Empty by default. Removing a kind from this list does NOT
   *  retroactively un-dismiss old findings; the user can rescan to
   *  rebuild the dismissed set. */
  kindAllowlist: SensitiveKind[]
  /** Whether the Info drawer expands by default on Security page
   *  load. Off by default — info-tier kinds are kept as audit but
   *  hidden because of ~98% false-positive rate. */
  infoDefaultVisible: boolean
  /** What the scan worker does when sync emits a session-changed
   *  event. 'auto' = re-enqueue immediately; 'manual' = leave
   *  scan_profile dirty so the user can choose when to rescan. */
  rescanAfterSync: 'auto' | 'manual'
  /** Whether finding values on the Security page render blurred by
   *  default, with per-row hover to reveal. The Eye/EyeOff button in
   *  the page header writes directly to this pref, so the toggle is
   *  the same control as the Settings row — there is no ephemeral
   *  override layer. Off by default. */
  securityPageValuesBlurred: boolean
  /** Same as above for the session-detail Findings strip. Independent
   *  from the page setting so users can keep an at-a-glance strip
   *  hidden while the dedicated review page stays revealed (or vice
   *  versa). */
  findingsStripValuesBlurred: boolean
  /** Whether the user has opted into the Privacy Filter ML provider.
   *  The provider is a stub today; this preference is the toggle UI
   *  state so the user's choice survives a restart once ML lands. */
  pfEnabled: boolean
  /** True once the user has dismissed the in-page PF discovery callout
   *  on the Security page. Permanent — the Settings card stays as the
   *  ongoing management surface, the callout is only an acquisition
   *  prompt. */
  pfCalloutDismissed: boolean
  /** Survives renderer remounts + app restarts. True between the moment
   *  the user clicks Enable in the callout and the moment the runtime
   *  + backfill have settled. Lets main know to auto-flip pfEnabled
   *  the moment the download lands, and lets the callout render an
   *  "Activating..." state instead of vanishing into a silent gap. */
  pfActivationPending: boolean
}

const DEFAULTS: SecurityPreferences = {
  kindAllowlist: [],
  infoDefaultVisible: false,
  rescanAfterSync: 'auto',
  securityPageValuesBlurred: false,
  findingsStripValuesBlurred: false,
  pfEnabled: false,
  pfCalloutDismissed: false,
  pfActivationPending: false,
}

interface SecurityConfigFile {
  kindAllowlist?: unknown
  infoDefaultVisible?: unknown
  rescanAfterSync?: unknown
  /** Legacy single-flag predecessor of the per-surface blur prefs.
   *  Read for migration only; never written by current builds. */
  revealValuesOnHoverOnly?: unknown
  securityPageValuesBlurred?: unknown
  findingsStripValuesBlurred?: unknown
  pfEnabled?: unknown
  pfCalloutDismissed?: unknown
  pfActivationPending?: unknown
  [key: string]: unknown
}

function readFile(): SecurityConfigFile {
  try {
    if (!existsSync(SECURITY_CONFIG_PATH)) return {}
    return JSON.parse(readFileSync(SECURITY_CONFIG_PATH, 'utf8')) as SecurityConfigFile
  } catch {
    return {}
  }
}

function writeFile(config: SecurityConfigFile): void {
  mkdirSync(SPOOL_DIR, { recursive: true })
  writeFileSync(SECURITY_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

function normalizeKinds(raw: unknown): SensitiveKind[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is SensitiveKind => typeof x === 'string')
}

function normalizeRescan(raw: unknown): 'auto' | 'manual' {
  return raw === 'manual' ? 'manual' : 'auto'
}

export function loadSecurityPreferences(): SecurityPreferences {
  const c = readFile()
  // Per-surface blur prefs are split from the legacy single-flag
  // `revealValuesOnHoverOnly` (introduced 2026-04 in PR #262, replaced
  // 2026-05). When the new fields are absent on disk we treat the
  // legacy flag as the seed for BOTH surfaces so a user who already
  // opted into hover-blur keeps that posture after upgrading. Once
  // either new field has been written, the legacy value is ignored.
  const hasNewBlurFields =
    c.securityPageValuesBlurred !== undefined
    || c.findingsStripValuesBlurred !== undefined
  const legacyBlurred = c.revealValuesOnHoverOnly === true
  return {
    kindAllowlist: normalizeKinds(c.kindAllowlist),
    infoDefaultVisible: c.infoDefaultVisible === true,
    rescanAfterSync: normalizeRescan(c.rescanAfterSync),
    securityPageValuesBlurred: hasNewBlurFields
      ? c.securityPageValuesBlurred === true
      : legacyBlurred,
    findingsStripValuesBlurred: hasNewBlurFields
      ? c.findingsStripValuesBlurred === true
      : legacyBlurred,
    pfEnabled: c.pfEnabled === true,
    pfCalloutDismissed: c.pfCalloutDismissed === true,
    pfActivationPending: c.pfActivationPending === true,
  }
}

export function saveSecurityPreferences(next: Partial<SecurityPreferences>): SecurityPreferences {
  const current = readFile()
  // Validate the new values, falling back to defaults on bad input.
  const merged: SecurityConfigFile = { ...current }
  if (next.kindAllowlist !== undefined) merged.kindAllowlist = normalizeKinds(next.kindAllowlist)
  if (next.infoDefaultVisible !== undefined) merged.infoDefaultVisible = next.infoDefaultVisible === true
  if (next.rescanAfterSync !== undefined) merged.rescanAfterSync = normalizeRescan(next.rescanAfterSync)
  if (next.securityPageValuesBlurred !== undefined) merged.securityPageValuesBlurred = next.securityPageValuesBlurred === true
  if (next.findingsStripValuesBlurred !== undefined) merged.findingsStripValuesBlurred = next.findingsStripValuesBlurred === true
  if (next.pfEnabled !== undefined) {
    merged.pfEnabled = next.pfEnabled === true
    // Enabling pf supersedes the in-page discovery nudge — once a user
    // actually turns it on (via Settings or the callout itself) the
    // "Add Privacy Filter" prompt becomes redundant and should never
    // re-appear. The callout's Activating / Re-scanning states are
    // separate signals gated by pfActivationPending, not by this flag.
    if (next.pfEnabled === true) merged.pfCalloutDismissed = true
  }
  if (next.pfCalloutDismissed !== undefined) merged.pfCalloutDismissed = next.pfCalloutDismissed === true
  if (next.pfActivationPending !== undefined) merged.pfActivationPending = next.pfActivationPending === true
  writeFile(merged)
  return loadSecurityPreferences()
}

export { DEFAULTS as DEFAULT_SECURITY_PREFERENCES }
