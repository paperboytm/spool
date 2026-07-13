// Scan profile — a composite identifier for the set of providers
// that produced the findings in a session.
//
// Persisted on `sessions.scan_profile`. Compare to the worker's
// current profile string at startup to detect rescan candidates:
//
//   stored = NULL                     → never scanned, enqueue
//   stored = 'regex@1'                → matches current 'regex@1', skip
//   stored = 'regex@1,pf@1.5b-q4.r2'  → user disabled pf, enqueue rescan
//
// Provider versions are bumped manually when detection logic changes.
// REDACT_DETECTOR_VERSION lives next to the regex detector in
// `@spool-lab/redact` (added in PR 1a); we re-export it here for
// callers that only depend on @spool-lab/core.

// Cache-nonce for the regex detector rule set. Bumping it makes
// `currentProfileString()` differ from what's stored on
// `sessions.scan_profile`, which the backfill loop reads as "this
// session needs a rescan". No semantic meaning outside that diff —
// it's NOT a user-visible "version of the security feature".
//
// Bump on every rule change so users with old stamps automatically
// pick up the new rules.
//   1 — initial release
//   2 — 2026-05-28: env-var detector now rejects values containing
//       non-ASCII letters (CJK / Cyrillic / Hangul / Arabic / emoji
//       are placeholder description text, never real env-var secrets).
//   3 — 2026-05-28: internal-host regex no longer case-insensitive
//       (drops PascalCase `SqlParser.internal` style FPs); validator
//       rejects trailing file-extensions (`runtime.prod.js`);
//       credit-card regex rejects decimal fractional parts
//       (`0.5227687358856201`). See issue #340.
export const REDACT_DETECTOR_VERSION = 3

export interface ProfileOpts {
  /** Regex detector revision. Bump in lockstep with rule changes. */
  regexVersion?: number
  /** Whether the Privacy Filter ML provider is enabled. */
  pfEnabled?: boolean
  /** Privacy Filter model + quant level, e.g. '1.5b-q4'. Required
   *  when `pfEnabled` is true. */
  pfVersion?: string
  /** Per-kind allowlist (Settings → Security → "Don't report"). Hashed
   *  into the profile string so flipping a kind triggers a real
   *  re-scan via `listSessionsNeedingScan` — otherwise sessions
   *  scanned before the toggle would never re-evaluate their findings
   *  and stale `state='active'` rows would linger for the now-
   *  allowlisted kind.
   *
   *  Order-insensitive: we sort + dedupe before hashing. Empty list
   *  collapses the segment so the profile stays `regex@4` (not
   *  `regex@4,allow@0`) — backward-compat with sessions stamped
   *  before the allowlist feature existed. */
  kindAllowlist?: readonly string[]
}

export interface ParsedProfile {
  regex: number
  pf?: string
  /** Short hex digest of the sorted kind allowlist; only present when
   *  the user has configured a non-empty list. */
  allow?: string
}

/** Build the canonical profile string for the current detector set.
 *  Order is fixed (regex → pf → allow) so equality is structural. */
export function currentProfileString(opts: ProfileOpts = {}): string {
  const regexVersion = opts.regexVersion ?? REDACT_DETECTOR_VERSION
  const parts = [`regex@${regexVersion}`]
  if (opts.pfEnabled) {
    if (!opts.pfVersion) {
      throw new Error('currentProfileString: pfVersion is required when pfEnabled is true')
    }
    parts.push(`pf@${opts.pfVersion}`)
  }
  const allowHash = hashKindAllowlist(opts.kindAllowlist)
  if (allowHash) parts.push(`allow@${allowHash}`)
  return parts.join(',')
}

/** FNV-1a 32-bit over the sorted+deduped kind list. Returns null for
 *  empty / undefined so the profile string stays minimal when no kinds
 *  are allowlisted (the common case). 8-char hex; collision risk is
 *  irrelevant — drift, not authenticity, is what we're detecting. */
function hashKindAllowlist(kinds: readonly string[] | undefined): string | null {
  if (!kinds || kinds.length === 0) return null
  const sorted = [...new Set(kinds)].sort()
  let h = 0x811c9dc5
  for (const k of sorted) {
    for (let i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x2c // ',' delimiter so ['a','bc'] !== ['ab','c']
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
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
  let allow: string | undefined
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
    } else if (name === 'allow') {
      allow = ver
    } else {
      return null
    }
  }
  if (regex === undefined) return null
  const result: ParsedProfile = { regex }
  if (pf !== undefined) result.pf = pf
  if (allow !== undefined) result.allow = allow
  return result
}

/** Structural equality on profile strings — order-insensitive but
 *  same-content. */
export function profilesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseProfile(a)
  const pb = parseProfile(b)
  if (!pa || !pb) return false
  return pa.regex === pb.regex && pa.pf === pb.pf && pa.allow === pb.allow
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
