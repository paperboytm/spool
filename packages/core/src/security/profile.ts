// Scan profile — a composite identifier for the set of providers
// that produced the findings in a session.
//
// Persisted on `sessions.scan_profile`. Compare to the worker's
// current profile string at startup to detect rescan candidates:
//
//   stored = NULL                  → never scanned, enqueue
//   stored = 'regex@3'             → matches current 'regex@3', skip
//   stored = 'regex@3,pf@1.5b-q4'  → user disabled pf, enqueue rescan
//
// Provider versions are bumped manually when detection logic changes.
// REDACT_DETECTOR_VERSION lives next to the regex detector in
// `@spool-lab/redact` (added in PR 1a); we re-export it here for
// callers that only depend on @spool-lab/core.

// v4: tightened IPv6 (rejects HH:MM:SS look-alikes) + dropped
// `.local` from internal-host TLDs (collides with `.env.local`).
// Bumping the version forces a rescan on every session, so old
// findings under the v3 rules get replaced with the cleaner v4 set.
export const REDACT_DETECTOR_VERSION = 4

export interface ProfileOpts {
  /** Regex detector revision. Bump in lockstep with rule changes. */
  regexVersion?: number
  /** Whether the Privacy Filter ML provider is enabled. */
  pfEnabled?: boolean
  /** Privacy Filter model + quant level, e.g. '1.5b-q4'. Required
   *  when `pfEnabled` is true. */
  pfVersion?: string
}

export interface ParsedProfile {
  regex: number
  pf?: string
}

/** Build the canonical profile string for the current detector set.
 *  Order is fixed (regex first, pf second) so equality is structural. */
export function currentProfileString(opts: ProfileOpts = {}): string {
  const regexVersion = opts.regexVersion ?? REDACT_DETECTOR_VERSION
  const parts = [`regex@${regexVersion}`]
  if (opts.pfEnabled) {
    if (!opts.pfVersion) {
      throw new Error('currentProfileString: pfVersion is required when pfEnabled is true')
    }
    parts.push(`pf@${opts.pfVersion}`)
  }
  return parts.join(',')
}

/** Parse a profile string back into structured fields. Returns null
 *  for inputs that don't look like a profile (e.g. legacy values,
 *  manual edits). Strict — unknown tokens cause a null return so the
 *  worker treats them as "stale, rescan". */
export function parseProfile(s: string | null | undefined): ParsedProfile | null {
  if (!s) return null
  const parts = s.split(',').map(p => p.trim()).filter(Boolean)
  let regex: number | undefined
  let pf: string | undefined
  for (const part of parts) {
    const at = part.indexOf('@')
    if (at <= 0) return null
    const name = part.slice(0, at)
    const ver = part.slice(at + 1)
    if (!ver) return null
    if (name === 'regex') {
      const n = Number(ver)
      if (!Number.isInteger(n) || n < 1) return null
      regex = n
    } else if (name === 'pf') {
      pf = ver
    } else {
      return null
    }
  }
  if (regex === undefined) return null
  return pf !== undefined ? { regex, pf } : { regex }
}

/** Structural equality on profile strings — order-insensitive but
 *  same-content. */
export function profilesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseProfile(a)
  const pb = parseProfile(b)
  if (!pa || !pb) return false
  return pa.regex === pb.regex && pa.pf === pb.pf
}

/** Names of the providers active in a profile. Used by
 *  `deleteActiveFindings(... providers)` so rescanning with a smaller
 *  provider set doesn't clobber prior findings the user may still
 *  want (e.g. disabling pf shouldn't delete pf's historical hits;
 *  they just stop being refreshed). */
export function providersInProfile(s: string): string[] {
  const parsed = parseProfile(s)
  if (!parsed) return []
  const out: string[] = ['regex']
  if (parsed.pf) out.push('pf')
  return out
}
