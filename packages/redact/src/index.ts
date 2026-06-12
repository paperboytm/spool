// @spool-lab/redact — sensitive-data detection for Spool sessions.
//
// Surfaces:
//   • Share editor (pre-publish review of artifact content)
//   • Security Scan (planned) — background sweep of every local
//     `.spool` session, surfaces token/credential leaks in a report
//   • CLI `spool doctor` (planned) — same pipeline, headless
//
// Everything here runs locally, with no network access of any kind.
// See `providers.ts` for the pluggable boundary.

export type {
  SensitiveKind,
  SensitiveMatch,
  SensitiveGroup,
  SensitiveValue,
} from './types.js'

export {
  SENSITIVE_KIND_LABEL,
  SENSITIVE_KIND_ORDER,
} from './types.js'

export { detectWithRegex } from './detectors.js'

export {
  regexProvider,
  analyzeWith,
} from './providers.js'

export type { RedactProvider } from './providers.js'

export { luhnOk, shannon, hashValueForRedactExclude } from './validators.js'

export { maskValueByKind, detectVendor } from './mask.js'
export { rotationUrlForVendor, rotationUrlForToken } from './rotation.js'

export { HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS, severityOf } from './severity.js'
export type { Severity } from './severity.js'

import { detectWithRegex } from './detectors.js'
import type { SensitiveGroup, SensitiveKind, SensitiveMatch } from './types.js'
import { SENSITIVE_KIND_ORDER } from './types.js'

/** Convenience wrapper for the common "scan one string" call. Equivalent
 *  to `regexProvider.analyze(text)` minus the Promise — synchronous so
 *  it's safe to use during React render. */
export function detectSensitiveSpans(text: string): SensitiveMatch[] {
  return detectWithRegex(text)
}

// Detection is a pure function of the text, but the regex suite is a
// full multi-pattern scan — expensive when a caller re-scans thousands
// of bodies per policy change. Holders (share-kit turns, app publish
// gates) keep the SAME body-carrying objects across a session, so a
// WeakMap keyed on the holder gives cross-surface hits with zero
// invalidation hazard: the entry stores the body it was computed from
// and is ignored when the body has since changed, and dropping the
// holder drops the entry.
const spanCache = new WeakMap<object, { body: string; matches: SensitiveMatch[] }>()

/** Cached `detectSensitiveSpans`, keyed on a stable body-carrying
 *  object (e.g. a share-kit Turn). Semantically identical to scanning
 *  `holder.body` fresh. */
export function detectSensitiveSpansCached(holder: { body: string }): SensitiveMatch[] {
  const hit = spanCache.get(holder)
  if (hit && hit.body === holder.body) return hit.matches
  const matches = detectWithRegex(holder.body)
  spanCache.set(holder, { body: holder.body, matches })
  return matches
}

/** Group matches by kind, deduplicating identical literals so the
 *  editor's expanded list shows one row per decision (not one row
 *  per occurrence). `group.count` keeps the total occurrence sum so
 *  the header `×N` still reflects how often a value appears; each
 *  per-value entry carries its own occurrence count for callers that
 *  want to surface duplicates explicitly. */
export function groupBySensitiveKind(matches: SensitiveMatch[]): SensitiveGroup[] {
  const byKind = new Map<SensitiveKind, SensitiveMatch[]>()
  for (const m of matches) {
    const list = byKind.get(m.kind) ?? []
    list.push(m)
    byKind.set(m.kind, list)
  }
  return Array.from(byKind.entries())
    .map(([kind, list]) => {
      // Preserve first-seen order while counting duplicates.
      const order: string[] = []
      const counts = new Map<string, number>()
      for (const m of list) {
        const n = counts.get(m.value)
        if (n === undefined) {
          order.push(m.value)
          counts.set(m.value, 1)
        } else {
          counts.set(m.value, n + 1)
        }
      }
      return {
        kind,
        count: list.length,
        values: order.map((v) => ({ value: v, count: counts.get(v)! })),
        minConfidence: list.reduce((acc, m) => Math.min(acc, m.confidence), 1),
      }
    })
    .sort((a, b) => SENSITIVE_KIND_ORDER.indexOf(a.kind) - SENSITIVE_KIND_ORDER.indexOf(b.kind))
}
