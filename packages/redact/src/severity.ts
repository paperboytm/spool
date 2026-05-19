// Severity tiers for the Security Scan surfaces.
//
//   high — a single leak is potentially catastrophic. Credentials,
//          cred files, structured tokens.
//   low  — annoying but recoverable. Identity-level (email / phone /
//          person-name / address / DOB / credit-card / SSN).
//   info — signal-only, not a credential leak. File paths, IP
//          addresses, internal-DNS hostnames. Audit-positive to
//          collect, but heavy false-positive rate when surfaced as
//          "findings" — the Security page hides this tier by default
//          and offers an opt-in toggle.
//
// The Library badge colour, the Security page Risk-panel grouping,
// and the inline-confirm policy for Dismiss vs Purge all derive from
// this three-way split. `scan_high_count` only counts `high`; the
// session badge only fires when a finding is `high` or `low`.

import type { SensitiveKind } from './types'

export const HIGH_SEVERITY_KINDS: ReadonlySet<SensitiveKind> = new Set([
  'private-key',
  'ssh-key',
  'cloud-cred-ini',
  'kubeconfig-token',
  'netrc',
  'connection-string',
  'url-creds',
  'api-key',
  'jwt',
  'bearer',
  'basic-auth',
  'env-var',
  'generic-secret',
])

/** Pattern hits that are useful as signal but are almost never an
 *  actual sensitive-data leak. Real-world audit on a 317-session
 *  archive showed ~100% noise from these kinds (file paths flagged
 *  every cwd reference, timestamps misclassified as IPv6, mDNS
 *  hostnames overlapping with `.env.local` filenames). Keeping them
 *  off the default Security view is the only way the surface stays
 *  signal-dense. */
export const INFO_SEVERITY_KINDS: ReadonlySet<SensitiveKind> = new Set([
  'absolute-path',
  'ip',
  'internal-host',
])

export type Severity = 'high' | 'low' | 'info'

export function severityOf(kind: SensitiveKind): Severity {
  if (HIGH_SEVERITY_KINDS.has(kind)) return 'high'
  if (INFO_SEVERITY_KINDS.has(kind)) return 'info'
  return 'low'
}
