// Pure formatting helpers used across the Security page surface.
//
// Extracted from the large SecurityPage.tsx so each function can be
// unit-tested independently of the React tree.

import { HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS, type SensitiveKind } from '@spool-lab/redact'
import type { ScanStatus } from '@spool-lab/core'

/** Threshold (sessions) below which a burst is treated as "ambient
 *  background work" — the meta-row pulse dot replaces the full
 *  ScanBanner. Manual `Rescan all` always far exceeds this; the
 *  threshold filters out sync-driven 1-3 session bursts that don't
 *  deserve full banner real estate. */
export const AMBIENT_BANNER_THRESHOLD = 5

/** True iff a status snapshot represents a meaningful, ongoing burst
 *  the user should see a full ScanBanner for. The two conditions:
 *
 *  - **`backfillTotal >= threshold`**: filters out tiny auto bursts
 *    (the worker's high-water mark for this burst is significant).
 *  - **`displayBusy`**: caller-provided sticky-off mirror of "worker
 *    is currently busy" — survives sub-1500ms idle gaps so the banner
 *    doesn't strobe between two backfill waves.
 *
 *  Result-banner ("Scan complete · N high · M low") is NOT gated on
 *  busy state — see SecurityPage.tsx's ScanResultBanner site. */
export function shouldShowScanBanner(
  status: ScanStatus | null,
  displayBusy: boolean,
  threshold: number = AMBIENT_BANNER_THRESHOLD,
): boolean {
  if (!status) return false
  return displayBusy && status.backfillTotal >= threshold
}

/** "Sessions still to scan" — drives the progress bar's `inFlight`.
 *  Anchored to `backfillRemaining` ALONE; intentionally does NOT
 *  add the +1 for the scanning slot. The +1 would bounce the count
 *  up at scanOne start and down at scanOne end, causing the
 *  rendered `(total - inFlight) / total` to dip backwards on every
 *  cross-session transition — most visible on a remount that
 *  captured a "scanning != null" snapshot after the previous
 *  reading saw "between scans". */
export function scanInFlightCount(status: ScanStatus): number {
  return status.backfillRemaining
}

/** Drop the long Claude model id (`claude-sonnet-4-5-20251022`) to
 *  the compact `sonnet 4.5` form used in session meta rows.
 *
 *  - Strips the `claude-` prefix and the trailing date suffix.
 *  - Joins major/minor with a `.` when both are present so the date
 *    suffix gets a clean cutoff at the family + version boundary.
 *  - Falls through to the original string for any non-Claude id (so
 *    GPT and Gemini models pass through unchanged).
 */
export function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

/** Format a `scan_completed_at` ISO timestamp as a small relative
 *  string ("just now" / "12m ago" / "3h ago" / "5d ago"). Anchored
 *  at `Date.now()`; returns "just now" for clock skew (negative
 *  deltas) and "" for unparseable input. */
export function formatScanAgo(iso: string, now: number = Date.now()): string {
  try {
    const t = new Date(iso).getTime()
    const ms = now - t
    if (!Number.isFinite(ms) || ms < 0) return 'just now'
    const s = Math.floor(ms / 1000)
    if (s < 45) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  } catch {
    return ''
  }
}

/** Whether a SensitiveKind belongs to the HIGH severity tier
 *  (credentials). Thin wrapper around the redact set so callers
 *  don't have to import the set + check membership inline. */
export function isHighKind(kind: string): boolean {
  return HIGH_SEVERITY_KINDS.has(kind as SensitiveKind)
}

/** Whether a SensitiveKind belongs to the INFO tier (paths / IPs /
 *  internal hostnames). Used to suppress info-tier kinds from the
 *  default Security page view. */
export function isInfoKind(kind: string): boolean {
  return INFO_SEVERITY_KINDS.has(kind as SensitiveKind)
}

/** Human-readable label for the per-kind purge mask + dismiss copy.
 *  E.g. `api-key` → `API key`. Returns the input unchanged for
 *  unknown kinds (forward-compat with kinds added later in the
 *  redact package). */
export function friendlyKind(kind: string): string {
  return FRIENDLY_KIND_MAP[kind] ?? kind
}

const FRIENDLY_KIND_MAP: Record<string, string> = {
  'api-key': 'API key',
  'private-key': 'private key',
  'jwt': 'JWT',
  'bearer': 'bearer token',
  'kubeconfig-token': 'kubeconfig token',
  'env-var': 'env var',
  'url-creds': 'URL credentials',
  'connection-string': 'connection string',
  'ssh-key': 'SSH key',
  'cloud-cred-ini': 'cloud creds',
  'netrc': 'netrc',
  'basic-auth': 'basic auth',
  'generic-secret': 'secret',
  'email': 'email',
  'person-name': 'name',
  'phone': 'phone',
  'street-address': 'address',
  'credit-card': 'credit card',
  'ssn': 'SSN',
  'date-of-birth': 'DOB',
  'absolute-path': 'absolute path',
  'ip': 'IP address',
  'internal-host': 'internal host',
}
