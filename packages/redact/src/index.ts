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
} from './types'

export {
  SENSITIVE_KIND_LABEL,
  SENSITIVE_KIND_ORDER,
} from './types'

export { detectWithRegex } from './detectors'

export {
  regexProvider,
  analyzeWith,
} from './providers'

export type { RedactProvider } from './providers'

export { luhnOk, shannon, hashValueForRedactExclude } from './validators'

export { maskValueByKind } from './mask'

export { HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS, severityOf } from './severity'
export type { Severity } from './severity'

import { detectWithRegex } from './detectors'
import type { SensitiveGroup, SensitiveKind, SensitiveMatch } from './types'
import { SENSITIVE_KIND_ORDER } from './types'

/** Convenience wrapper for the common "scan one string" call. Equivalent
 *  to `regexProvider.analyze(text)` minus the Promise — synchronous so
 *  it's safe to use during React render. */
export function detectSensitiveSpans(text: string): SensitiveMatch[] {
  return detectWithRegex(text)
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
