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
  /** Screen-share mode: when true, finding values are blurred until
   *  hover everywhere they're rendered (Security page session card +
   *  Findings strip). Off by default — the user is here to read the
   *  values, see ../renderer/components/SecurityPage.tsx. */
  revealValuesOnHoverOnly: boolean
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
  revealValuesOnHoverOnly: false,
  pfEnabled: false,
  pfCalloutDismissed: false,
  pfActivationPending: false,
}

interface SecurityConfigFile {
  kindAllowlist?: unknown
  infoDefaultVisible?: unknown
  rescanAfterSync?: unknown
  revealValuesOnHoverOnly?: unknown
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
  return {
    kindAllowlist: normalizeKinds(c.kindAllowlist),
    infoDefaultVisible: c.infoDefaultVisible === true,
    rescanAfterSync: normalizeRescan(c.rescanAfterSync),
    revealValuesOnHoverOnly: c.revealValuesOnHoverOnly === true,
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
  if (next.revealValuesOnHoverOnly !== undefined) merged.revealValuesOnHoverOnly = next.revealValuesOnHoverOnly === true
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
